import QRCode from 'qrcode';
import type { Client } from 'whatsapp-web.js';
import { collections } from '../mongo';
import type { WaSessionState } from '../types';
import { createClient, deleteStoredSession } from './client';

const SESSION_DOC = 'session' as const;

export async function getSessionState(): Promise<WaSessionState> {
  const { waSession } = await collections();
  const doc = await waSession.findOne({ _id: SESSION_DOC });
  return (
    doc ?? {
      _id: SESSION_DOC,
      status: 'unlinked',
      qrDataUrl: null,
      qrExpiresAt: null,
      linkedAt: null,
      lastError: null,
      updatedAt: new Date(),
    }
  );
}

async function setState(patch: Partial<WaSessionState>): Promise<void> {
  const { waSession } = await collections();
  await waSession.updateOne(
    { _id: SESSION_DOC },
    { $set: { ...patch, updatedAt: new Date() } },
    { upsert: true },
  );
}

/**
 * Start a pairing attempt.
 *
 * The QR is rendered to a PNG data-URL and written to MongoDB; the Setup page
 * polls for it. WhatsApp rotates the QR roughly every 20s, so each rotation
 * overwrites the stored one and the page picks it up on its next poll.
 *
 * Resolves as soon as the QR is available so the HTTP request can return,
 * while the client keeps running in the background waiting for the scan.
 * `keepAlive` receives a promise that settles once the browser is closed; a
 * serverless caller must hand it to `after()`, or the function is frozen the
 * moment the QR response is sent and the session is never uploaded.
 */
export async function startLinking(
  opts: { keepAlive?: (work: Promise<void>) => void } = {},
): Promise<{ started: boolean; message: string }> {
  await deleteStoredSession();
  await setState({ status: 'awaiting_scan', qrDataUrl: null, qrExpiresAt: null, lastError: null });

  const client = await createClient();

  let closed = false;
  let markClosed!: () => void;
  opts.keepAlive?.(new Promise<void>((r) => (markClosed = r)));
  const close = () => {
    if (closed) return;
    closed = true;
    client.destroy().catch(() => {}).finally(markClosed);
  };

  return new Promise((resolve) => {
    let resolved = false;
    let saved = false;
    const finish = (message: string) => {
      if (!resolved) {
        resolved = true;
        resolve({ started: true, message });
      }
    };

    let scanned = false;
    let scanTimer: NodeJS.Timeout | null = null;

    client.on('qr', async (qr) => {
      // WhatsApp keeps rotating QR codes for as long as nobody scans, so an
      // abandoned attempt would otherwise hold Chromium open indefinitely.
      scanTimer ??= setTimeout(async () => {
        if (scanned) return;
        await setState({
          status: 'error',
          qrDataUrl: null,
          lastError: 'The QR code was not scanned in time. Generate a new one.',
        });
        close();
      }, 150_000);

      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      if (scanned || closed) return;
      await setState({
        status: 'awaiting_scan',
        qrDataUrl: dataUrl,
        qrExpiresAt: new Date(Date.now() + 60_000),
      });
      finish('QR ready — scan it from your phone.');
    });

    client.on('authenticated', () => {
      scanned = true;
      return setState({ status: 'awaiting_scan', qrDataUrl: null });
    });

    // RemoteAuth writes the session to MongoDB on this event, not on 'ready'.
    // Until it fires there is nothing durable to sync with, so this — not
    // 'ready' — is the point at which the browser may safely be closed.
    client.on('remote_session_saved', async () => {
      saved = true;
      await setState({ status: 'linked', qrDataUrl: null, linkedAt: new Date() });
      setTimeout(close, 5_000);
    });

    // Not 'linked' yet: the session is not durable until 'remote_session_saved'.
    // Leaving the status at awaiting_scan keeps the Setup page polling so it
    // flips to linked on its own once the upload lands.
    client.on('ready', async () => {
      finish('Linked — saving the session, this takes about a minute.');
      // RemoteAuth sleeps a hardcoded 60s after auth before it even begins
      // compressing the session, then has to upload it. Closing at 90s raced
      // that and left an empty GridFS bucket behind, so the dashboard read
      // "linked" while every sync still failed. Hold the browser open long
      // enough for the upload, and let 'remote_session_saved' close it sooner.
      setTimeout(async () => {
        if (!saved) {
          await setState({
            status: 'error',
            qrDataUrl: null,
            lastError: 'Paired, but the session was never saved to MongoDB. Try linking again.',
          });
        }
        close();
      }, 240_000);
    });

    client.on('auth_failure', async (m) => {
      await setState({ status: 'error', lastError: String(m), qrDataUrl: null });
      finish(`Authentication failed: ${m}`);
      close();
    });

    client.initialize().catch(async (e) => {
      await setState({ status: 'error', lastError: e.message, qrDataUrl: null });
      finish(`Could not start: ${e.message}`);
      close();
    });

    // Hard stop so a stuck pairing attempt cannot hold the function open — and,
    // more importantly, cannot leave an orphaned Chromium process behind when
    // initialize() hangs without ever emitting a QR.
    setTimeout(async () => {
      if (resolved) return;
      await setState({
        status: 'error',
        qrDataUrl: null,
        lastError: 'Timed out waiting for a QR code.',
      });
      finish('Timed out waiting for a QR code.');
      close();
    }, 60_000);
  });
}

/** Forget the stored session so a different number can be linked. */
export async function unlink(): Promise<void> {
  await deleteStoredSession();
  await setState({ status: 'unlinked', qrDataUrl: null, linkedAt: null, lastError: null });
}
