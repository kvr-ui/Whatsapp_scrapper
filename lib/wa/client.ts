import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { Client, RemoteAuth } from 'whatsapp-web.js';
import { MongoStore } from 'wwebjs-mongo';

export const SESSION_ID = 'focas-leads';

/** True when running inside a Vercel (or other read-only-fs) serverless function. */
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * RemoteAuth unzips the restored session to disk before Chromium can use it.
 * On Vercel only /tmp is writable, so the session lands there and is discarded
 * when the function freezes — MongoDB remains the source of truth.
 */
const DATA_PATH = IS_SERVERLESS
  ? '/tmp/wwebjs_auth'
  : path.join(process.cwd(), '.wwebjs_auth');

let mongoosePromise: Promise<typeof mongoose> | null = null;

/**
 * wwebjs-mongo talks to Mongo through mongoose, which is a separate connection
 * from the native driver used by the rest of the app. Cached the same way so a
 * warm function does not reconnect.
 */
function connectMongoose() {
  const uri = process.env.ENGINE_MONGO_URL;
  if (!uri) throw new Error('ENGINE_MONGO_URL is not set.');
  mongoosePromise ??= mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  return mongoosePromise;
}

/**
 * Bridge a path mismatch between whatsapp-web.js and wwebjs-mongo.
 *
 * RemoteAuth (1.34) compresses the session to `<dataPath>/<session>.zip`, but
 * MongoStore (1.1) still reads `<session>.zip` relative to the process working
 * directory. Every save therefore throws ENOENT, which creates the GridFS
 * bucket but uploads nothing — so pairing reports success while the session
 * silently does not exist, and every later sync fails as "not linked".
 *
 * Restoring is unaffected: `extractRemoteSession` passes an absolute path.
 *
 * The upload reads the zip where RemoteAuth actually wrote it rather than
 * copying it into the working directory, which is read-only on Vercel
 * (/var/task). `delete` is replaced too: MongoStore fires its GridFS deletes
 * without awaiting them, so a re-link could still see the old session.
 */
function bridgeSavePath(store: MongoStore, dataPath: string): MongoStore {
  const bucketFor = (session: string) =>
    new mongoose.mongo.GridFSBucket(mongoose.connection.db!, {
      bucketName: `whatsapp-${session}`,
    });

  store.save = async (options: { session: string }) => {
    const filename = `${options.session}.zip`;
    const bucket = bucketFor(options.session);

    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(path.join(dataPath, filename))
        .on('error', reject)
        .pipe(bucket.openUploadStream(filename))
        .on('error', reject)
        .on('finish', () => resolve());
    });

    // Keep only the upload that just finished.
    const docs = await bucket.find({ filename }).sort({ uploadDate: -1 }).toArray();
    await Promise.all(docs.slice(1).map((d) => bucket.delete(d._id)));
  };

  // MongoStore writes the download into `path` without creating its folder.
  // A fresh serverless instance has an empty /tmp, so the restore fails with
  // ENOENT before Chromium ever starts. Its error handler also only covers the
  // write side, so a failed download would hang instead of rejecting.
  store.extract = async (options: { session: string; path: string }) => {
    await fs.promises.mkdir(path.dirname(options.path), { recursive: true });
    const bucket = bucketFor(options.session);

    await new Promise<void>((resolve, reject) => {
      bucket
        .openDownloadStreamByName(`${options.session}.zip`)
        .on('error', reject)
        .pipe(fs.createWriteStream(options.path))
        .on('error', reject)
        .on('close', () => resolve());
    });
  };

  store.delete = async (options: { session: string }) => {
    const bucket = bucketFor(options.session);
    const docs = await bucket.find({ filename: `${options.session}.zip` }).toArray();
    await Promise.all(docs.map((d) => bucket.delete(d._id)));
  };

  return store;
}

export async function getSessionStore(): Promise<MongoStore> {
  await connectMongoose();
  return bridgeSavePath(new MongoStore({ mongoose }), DATA_PATH);
}

/** Whether a linked-device session is already stored in MongoDB. */
export async function hasStoredSession(): Promise<boolean> {
  const store = await getSessionStore();
  // wwebjs-mongo appends "-<clientId>" internally when RemoteAuth saves.
  return store.sessionExists({ session: `RemoteAuth-${SESSION_ID}` });
}

export async function deleteStoredSession(): Promise<void> {
  const store = await getSessionStore();
  await store.delete({ session: `RemoteAuth-${SESSION_ID}` }).catch(() => {});
}

/** Resolve the Chromium binary: bundled @sparticuz build on Vercel, local Chrome otherwise. */
async function resolveBrowser(): Promise<{ executablePath: string; args: string[] }> {
  if (IS_SERVERLESS) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return {
      executablePath: await chromium.executablePath(),
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
    };
  }

  const local =
    process.env.CHROME_PATH ||
    ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']
      .find((p) => fs.existsSync(p));

  if (!local) {
    throw new Error(
      'No local Chromium found. Install Chrome/Chromium or set CHROME_PATH in .env.local.',
    );
  }
  return {
    executablePath: local,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
}

/**
 * Build a client backed by the MongoDB-stored session. Nothing is launched
 * until `client.initialize()` is called.
 */
const WA_VERSIONS = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main';

/**
 * The WhatsApp Web build to load. A hardcoded build expires after about two
 * months: its archived HTML is removed and the phone refuses to pair with it
 * ("Couldn't link device"). So the current build is looked up on every start;
 * if the index is unreachable, WhatsApp's live build is used instead.
 */
async function resolveWebVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${WA_VERSIONS}/versions.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const { currentVersion } = (await res.json()) as { currentVersion?: string };
    return currentVersion || null;
  } catch {
    return null;
  }
}

export async function createClient(): Promise<Client> {
  const store = await getSessionStore();
  const { executablePath, args } = await resolveBrowser();
  const webVersion = await resolveWebVersion();

  return new Client({
    authStrategy: new RemoteAuth({
      store,
      clientId: SESSION_ID,
      dataPath: DATA_PATH,
      // Minimum accepted by RemoteAuth. A sync run is shorter than this, so in
      // practice the session is written back on the explicit save below.
      backupSyncIntervalMs: 60_000,
    }),
    puppeteer: {
      headless: true,
      executablePath,
      args,
      // Cold Chromium on Lambda-class hardware is slow to hand over a page.
      timeout: 120_000,
    },
    ...(webVersion
      ? {
          webVersion,
          webVersionCache: {
            type: 'remote' as const,
            remotePath: `${WA_VERSIONS}/html/{version}.html`,
          },
        }
      : { webVersionCache: { type: 'none' as const } }),
  });
}
