'use client';

import { useEffect, useState } from 'react';

interface Status {
  status: 'unlinked' | 'awaiting_scan' | 'linked' | 'error';
  qrDataUrl: string | null;
  linkedAt: string | null;
  lastError: string | null;
  linked: boolean;
}

export function LinkWhatsApp({ initial }: { initial: Status }) {
  const [status, setStatus] = useState<Status>(initial);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Poll while a pairing attempt is in flight — WhatsApp rotates the QR ~20s.
  useEffect(() => {
    if (!starting && status.status !== 'awaiting_scan') return;
    const id = setInterval(async () => {
      const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
      if (res.ok) setStatus(await res.json());
    }, 3000);
    return () => clearInterval(id);
  }, [starting, status.status]);

  async function begin() {
    setStarting(true);
    setMessage('Starting Chromium and requesting a QR code — this can take up to a minute.');
    try {
      const res = await fetch('/api/whatsapp/link', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      setMessage(body.message ?? 'Started.');
    } catch {
      setMessage('The request timed out, but pairing may still be starting. Watch for a QR below.');
    } finally {
      setStarting(false);
    }
  }

  async function unlink() {
    if (!confirm('Forget the stored WhatsApp session? Syncs will fail until you re-link.')) return;
    await fetch('/api/whatsapp/unlink', { method: 'POST' });
    setStatus({ ...status, status: 'unlinked', linked: false, qrDataUrl: null });
    setMessage('Session forgotten.');
  }

  if (status.linked && status.status === 'linked') {
    return (
      <div className="stack" style={{ gap: 14 }}>
        <div className="row">
          <span className="badge" data-tone="accent"><span className="dot" />linked</span>
          <span className="small muted">
            WhatsApp is linked and the weekly sync can run.
          </span>
        </div>
        <div className="row">
          <button className="btn" onClick={unlink}>Unlink this number</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {status.qrDataUrl ? (
        <div className="qr-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={status.qrDataUrl} alt="WhatsApp pairing QR code" />
        </div>
      ) : (
        <div className="qr-placeholder">
          <div>
            <div style={{ fontSize: 26, opacity: 0.4, marginBottom: 8 }}>⬚</div>
            <div className="small">
              {starting
                ? 'Waiting for a QR code…'
                : status.status === 'awaiting_scan'
                  ? 'Scanned — saving the session. This takes about a minute.'
                  : 'Press “Generate QR code” to begin.'}
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn" data-variant="primary" disabled={starting} onClick={begin}>
          {starting ? 'Starting…' : status.qrDataUrl ? 'Restart pairing' : 'Generate QR code'}
        </button>
      </div>

      {message && <div className="small muted" style={{ textAlign: 'center' }}>{message}</div>}
      {status.lastError && (
        <div className="notice" style={{ '--tone': 'var(--danger)' } as React.CSSProperties}>
          {status.lastError}
        </div>
      )}
    </div>
  );
}
