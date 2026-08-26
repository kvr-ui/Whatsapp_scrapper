'use client';

import { useState } from 'react';

/** Batch sizes offered for a WATI campaign upload; 0 means one single file. */
const PER_FILE_CHOICES = [100, 250, 500] as const;

/**
 * Both CSV exports. The current filter set is forwarded verbatim, so what the
 * table shows is exactly what lands in the file.
 *
 * WATI campaigns are uploaded in capped batches, so that export first asks how
 * many contacts belong in each file. Anything other than "one file" comes back
 * as a ZIP holding one CSV per batch.
 */
export function ExportButtons({ params }: { params: Record<string, string> }) {
  const [busy, setBusy] = useState<'wati' | 'full' | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function download(format: 'wati' | 'full', perFile = 0) {
    setBusy(format);
    setError(null);
    setNote(null);
    try {
      const qs = new URLSearchParams({ ...params, format });
      if (perFile) qs.set('perFile', String(perFile));

      const res = await fetch(`/api/export?${qs}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      const blob = await res.blob();
      const name =
        res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ??
        `${format}-export.csv`;

      // Anchor-click is the only way to name a client-side download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const rows = Number(res.headers.get('X-Row-Count') ?? 0);
      const files = Number(res.headers.get('X-File-Count') ?? 1);
      setNote(
        files > 1
          ? `${rows.toLocaleString()} contacts in ${files} files of ${perFile}.`
          : `${rows.toLocaleString()} contacts in one file.`,
      );
      setChoosing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <button
          className="btn"
          data-variant="primary"
          disabled={busy !== null}
          aria-expanded={choosing}
          onClick={() => { setChoosing((v) => !v); setError(null); setNote(null); }}
          title="Name + CountryCode + Phone, ready for WATI bulk upload"
        >
          {busy === 'wati' ? 'Preparing…' : '↓ WATI campaign CSV'}
        </button>
        <button
          className="btn"
          disabled={busy !== null}
          onClick={() => download('full')}
          title="Every field held for each lead, including unresolved numbers"
        >
          {busy === 'full' ? 'Preparing…' : '↓ All details CSV'}
        </button>
      </div>

      {choosing && (
        <div className="panel" style={{ padding: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Contacts per file</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {PER_FILE_CHOICES.map((n) => (
              <button
                key={n}
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() => download('wati', n)}
              >
                {n} per file
              </button>
            ))}
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => download('wati', 0)}
            >
              All in one file
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            Split exports download as a ZIP containing one CSV per batch.
          </div>
        </div>
      )}

      {note && <span className="small muted">{note}</span>}
      {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}
