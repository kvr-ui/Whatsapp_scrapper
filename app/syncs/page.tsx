import { Shell } from '@/components/Shell';
import { StatusBadge } from '@/components/Badge';
import { SyncButton } from '@/components/SyncButton';
import { listSyncRuns } from '@/lib/repo';
import { hasStoredSession } from '@/lib/wa/client';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SyncsPage() {
  const [runs, linked] = await Promise.all([
    listSyncRuns(50),
    hasStoredSession().catch(() => false),
  ]);

  return (
    <Shell title="Sync log" actions={<SyncButton linked={linked} />}>
      <div className="notice reveal" style={{ '--tone': 'var(--info)' } as React.CSSProperties}>
        An automatic sync runs every <strong>Monday at 02:00 UTC</strong> (07:30 IST) via Vercel Cron.
        You can also trigger one at any time with <strong>Sync now</strong>.
      </div>

      <section className="panel reveal">
        <div className="panel-head">
          <h2>{runs.length} recent run{runs.length === 1 ? '' : 's'}</h2>
        </div>
        <div className="panel-body flush">
          {runs.length === 0 ? (
            <div className="empty"><div className="empty-mark">⟲</div>No syncs recorded yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Started</th><th>Status</th><th>Trigger</th><th>Duration</th>
                    <th>Sources</th><th>Leads</th><th>New</th><th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r._id}>
                      <td className="cell-num small">{formatDate(r.startedAt ?? r.queuedAt)}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td><span className="badge">{r.trigger}</span></td>
                      <td className="cell-num cell-dim">
                        {r.durationMs ? `${(r.durationMs / 1000).toFixed(0)}s` : '—'}
                      </td>
                      <td className="cell-num">{r.stats.sources}</td>
                      <td className="cell-num">{r.stats.leadsSeen.toLocaleString('en-IN')}</td>
                      <td className="cell-num">
                        {r.stats.newLeads > 0
                          ? <span style={{ color: 'var(--accent)' }}>+{r.stats.newLeads}</span>
                          : <span className="faint">0</span>}
                      </td>
                      <td className="small" style={{ maxWidth: 320 }}>
                        {r.error ? (
                          <span style={{ color: 'var(--danger)' }}>{r.error}</span>
                        ) : r.stats.skippedGroups > 0 ? (
                          <span style={{ color: 'var(--amber)' }}>
                            {r.stats.skippedGroups} group(s) unreadable — skipped, not emptied
                          </span>
                        ) : (
                          <span className="faint">{r.step ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
