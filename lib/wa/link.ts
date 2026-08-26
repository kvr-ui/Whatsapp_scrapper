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
 */
export async function startLinking(): Promise<{ started: boolean; message: string }> {
  await deleteStoredSession();
  await setState({ status: 'awaiting_scan', qrDataUrl: null, qrExpiresAt: null, lastError: null });

  const client = await createClient();

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (message: string) => {
      if (!resolved) {
        resolved = true;
        resolve({ started: true, message });
      }
    };

    client.on('qr', async (qr) => {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      await setState({
        status: 'awaiting_scan',
        qrDataUrl: dataUrl,
        qrExpiresAt: new Date(Date.now() + 60_000),
      });
      finish('QR ready — scan it from your phone.');
    });

    client.on('authenticated', () => setState({ status: 'awaiting_scan', qrDataUrl: null }));

    // RemoteAuth writes the session to MongoDB on this event, not on 'ready'.
    client.on('remote_session_saved', async () => {
      await setState({ status: 'linked', qrDataUrl: null, linkedAt: new Date() });
    });

    client.on('ready', async () => {
      await setState({ status: 'linked', qrDataUrl: null, linkedAt: new Date() });
      finish('Linked.');
      // Give RemoteAuth time to zip and upload the session before shutting down.
      setTimeout(() => client.destroy().catch(() => {}), 90_000);
    });

    client.on('auth_failure', async (m) => {
      await setState({ status: 'error', lastError: String(m), qrDataUrl: null });
      finish(`Authentication failed: ${m}`);
      client.destroy().catch(() => {});
    });

    client.initialize().catch(async (e) => {
      await setState({ status: 'error', lastError: e.message, qrDataUrl: null });
      finish(`Could not start: ${e.message}`);
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
      client.destroy().catch(() => {});
    }, 60_000);
  });
}

/** Forget the stored session so a different number can be linked. */
export async function unlink(): Promise<void> {
  await deleteStoredSession();
  await setState({ status: 'unlinked', qrDataUrl: null, linkedAt: null, lastError: null });
}
