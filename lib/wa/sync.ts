import { randomUUID } from 'node:crypto';
import type { Client } from 'whatsapp-web.js';
import { collections, ensureIndexes } from '../mongo';
import type { SyncRun, SyncTrigger } from '../types';
import { createClient, hasStoredSession } from './client';
import {
  buildBroadcastSources,
  buildChannelSources,
  buildCommunities,
  buildContactSources,
  buildStandaloneGroups,
  readBroadcasts,
  readChannels,
  readContacts,
  readGroups,
  unlistedChannels,
  unreadableGroups,
  waitForChatSync,
} from './extract';
import type { RawChannel } from './extract';
import { persistSources } from './store';

const EMPTY_STATS = {
  sources: 0, leadsSeen: 0, newLeads: 0, updatedLeads: 0, unresolved: 0,
  skippedGroups: 0, skippedChannels: 0,
};

/**
 * Run one full extraction and write the result to MongoDB.
 *
 * Progress is written to the run document as it goes, so the dashboard can
 * show live status even though the caller is a fire-and-forget function.
 */
export async function runSync(
  trigger: SyncTrigger,
  opts: {
    includeBroadcasts?: boolean;
    includeChannels?: boolean;
    includeContacts?: boolean;
    /** Widen the contact sweep past the address book to everyone WhatsApp knows. */
    allContacts?: boolean;
  } = {},
): Promise<SyncRun> {
  await ensureIndexes();
  const { syncRuns } = await collections();

  const run: SyncRun = {
    _id: randomUUID(),
    status: 'running',
    trigger,
    queuedAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    durationMs: null,
    stats: { ...EMPTY_STATS },
    step: 'starting',
    error: null,
  };
  await syncRuns.insertOne(run);

  const step = async (s: string) => {
    run.step = s;
    await syncRuns.updateOne({ _id: run._id }, { $set: { step: s } });
  };

  let client: Client | null = null;
  let channels: RawChannel[] = [];

  try {
    if (!(await hasStoredSession())) {
      throw new Error(
        'WhatsApp is not linked. Open the dashboard → Setup and scan the QR code.',
      );
    }

    await step('launching browser');
    client = await createClient();

    await step('restoring session');
    await waitForReady(client);

    await step('waiting for chats to sync');
    const groupCount = await waitForChatSync(client);
    if (groupCount === 0) {
      throw new Error('No groups synced — make sure the linked phone is online.');
    }

    await step(`reading ${groupCount} groups`);
    const groups = await readGroups(client);

    const extracted = [...buildCommunities(groups), ...buildStandaloneGroups(groups)];

    if (opts.includeBroadcasts !== false) {
      await step('reading broadcast lists');
      const lists = await readBroadcasts(client).catch(() => []);
      extracted.push(...buildBroadcastSources(lists));
    }

    if (opts.includeChannels !== false) {
      await step('reading channels');
      // Channels are read best-effort: WhatsApp exposes their subscribers only
      // to the channel's own admins, so a failure here must not fail the run.
      channels = await readChannels(client).catch(() => []);
      extracted.push(...buildChannelSources(channels));
    }

    if (opts.includeContacts !== false) {
      await step('reading contacts');
      const contacts = await readContacts(client, { savedOnly: !opts.allContacts }).catch(() => []);
      extracted.push(...buildContactSources(contacts));
    }

    await step(`saving ${extracted.length} sources`);
    const stats = {
      ...(await persistSources(extracted)),
      skippedGroups: unreadableGroups(groups).length,
      skippedChannels: unlistedChannels(channels).length,
    };

    const finishedAt = new Date();
    const done: Partial<SyncRun> = {
      status: 'success',
      finishedAt,
      durationMs: finishedAt.getTime() - run.startedAt!.getTime(),
      stats,
      step: 'done',
    };
    await syncRuns.updateOne({ _id: run._id }, { $set: done });
    return { ...run, ...done } as SyncRun;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    const failed: Partial<SyncRun> = {
      status: 'failed',
      finishedAt,
      durationMs: finishedAt.getTime() - run.startedAt!.getTime(),
      error: message,
      step: run.step,
    };
    await syncRuns.updateOne({ _id: run._id }, { $set: failed });
    return { ...run, ...failed } as SyncRun;
  } finally {
    // destroy() can hang on a half-dead Chromium; never let it block the run.
    if (client) {
      await Promise.race([
        client.destroy().catch(() => {}),
        new Promise((r) => setTimeout(r, 10_000)),
      ]);
    }
  }
}

/** Resolve on `ready`, reject on auth failure or timeout. */
function waitForReady(client: Client, timeoutMs = 150_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('WhatsApp Web did not become ready in time.')),
      timeoutMs,
    );
    const done = (fn: () => void) => { clearTimeout(timer); fn(); };

    client.once('ready', () => done(resolve));
    client.once('auth_failure', (m) =>
      done(() => reject(new Error(`Authentication failed: ${m}`))),
    );
    client.once('qr', () =>
      done(() => reject(new Error('Stored session is no longer valid — re-link WhatsApp from Setup.'))),
    );
    client.initialize().catch((e) => done(() => reject(e)));
  });
}
