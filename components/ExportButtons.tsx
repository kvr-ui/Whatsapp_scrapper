'use client';

import { useEffect, useState } from 'react';
import type { SourceType } from '@/lib/types';

/** Batch sizes offered for a WATI campaign upload; 0 means one single file. */
const PER_FILE_CHOICES = [100, 250, 500] as const;

type SourceOption = { _id: string; label: string; type: SourceType; memberCount: number };

const TYPE_LABEL: Record<SourceType, string> = {
  community: 'Communities',
  group: 'Groups',
  broadcast: 'Broadcast lists',
};

/**
 * Both CSV exports. Any filter already applied on the page is forwarded
 * verbatim, so what the table shows is what lands in the file.
 *
 * The WATI export additionally asks, at download time, which community to pull
 * and how many contacts belong in each file — campaigns are uploaded to WATI in
 * capped batches, and the export is usually wanted one source at a time. Any
 * batch size other than "one file" comes back as a ZIP holding one CSV each.
 */
export function ExportButtons({ params }: { params: Record<string, string> }) {
  const [busy, setBusy] = useState<'wati' | 'full' | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [sources, setSources] = useState<SourceOption[] | null>(null);
  const [sourceId, setSourceId] = useState(params.sourceId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Loaded on first open rather than upfront: most visits never export.
  useEffect(() => {
    if (!choosing || sources !== null) return;
    let live = true;
    fetch('/api/sources')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => live && setSources(d.sources ?? []))
      .catch(() => live && setSources([]));
    return () => { live = false; };
  }, [choosing, sources]);

  async function download(format: 'wati' | 'full', perFile = 0) {
    setBusy(format);
    setError(null);
    setNote(null);
    try {
      const qs = new URLSearchParams({ ...params, format });
      if (perFile) qs.set('perFile', String(perFile));
      // The chooser wins over whatever the page had applied.
      if (format === 'wati') {
        if (sourceId) qs.set('sourceId', sourceId);
        else qs.delete('sourceId');
      }

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
      const from = sources?.find((s) => s._id === sourceId)?.label ?? 'all sources';

      if (rows === 0) {
        setNote(`No contacts with a resolvable number in ${from}.`);
      } else {
        setNote(
          files > 1
            ? `${rows.toLocaleString()} contacts from ${from}, in ${files} files of ${perFile}.`
            : `${rows.toLocaleString()} contacts from ${from}, in one file.`,
        );
        setChoosing(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  const grouped = (t: SourceType) => (sources ?? []).filter((s) => s.type === t);

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
        <div className="panel stack" style={{ padding: 12, gap: 12 }}>
          <div className="field">
            <label htmlFor="x-source">Source</label>
            <select
              id="x-source"
              value={sourceId}
              disabled={sources === null || busy !== null}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">
                {sources === null ? 'Loading sources…' : 'All sources'}
              </option>
              {(['community', 'group', 'broadcast'] as SourceType[]).map((t) =>
                grouped(t).length === 0 ? null : (
                  <optgroup key={t} label={TYPE_LABEL[t]}>
                    {grouped(t).map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.label} ({s.memberCount.toLocaleString()})
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">Contacts per file</div>
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
            <div className="small muted">
              Split exports download as a ZIP containing one CSV per batch.
            </div>
          </div>
        </div>
      )}

      {note && <span className="small muted">{note}</span>}
      {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}
