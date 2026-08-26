import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Stat } from '@/components/Stat';
import { Sparkline } from '@/components/Sparkline';
import { StatusBadge, TypeBadge } from '@/components/Badge';
import { SyncButton } from '@/components/SyncButton';
import { ExportButtons } from '@/components/ExportButtons';
import { getDashboardStats, getWeeklyGrowth, listSources, listSyncRuns } from '@/lib/repo';
import { hasStoredSession } from '@/lib/wa/client';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [stats, growth, sources, runs, linked] = await Promise.all([
    getDashboardStats(),
    getWeeklyGrowth(12),
    listSources(),
    listSyncRuns(5),
    hasStoredSession().catch(() => false),
  ]);

  return (
    <Shell title="Overview" actions={<SyncButton linked={linked} />}>
      {!linked && (
        <div className="notice reveal">
          WhatsApp is not linked yet, so no sync can run.{' '}
          <Link href="/setup" style={{ color: 'var(--accent)' }}>Open Setup</Link> and scan the QR code.
        </div>
      )}

      <div className="stat-grid reveal">
        <Stat label="Total leads" value={stats.totalLeads} tone="accent"
          note={`${stats.sourceCount} source${stats.sourceCount === 1 ? '' : 's'} tracked`} />
        <Stat label="Reachable" value={stats.withPhone}
          note={`${stats.unresolved} number${stats.unresolved === 1 ? '' : 's'} unresolved`} />
        <Stat label="New this week" value={stats.newThisWeek} tone="info"
          note={`${stats.newThisMonth} in the last 30 days`} />
        <Stat label="Admins" value={stats.admins} tone="amber" note="community leaders" />
        <Stat
          label="Last sync"
          value={stats.lastRun ? formatRelative(stats.lastRun.finishedAt ?? stats.lastRun.queuedAt) : '—'}
          tone={stats.lastRun?.status === 'failed' ? 'danger' : undefined}
          note={stats.lastRun ? `${stats.lastRun.status} · ${stats.lastRun.trigger}` : 'never run'}
        />
      </div>

      <div className="two-col reveal">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>New leads per week</h2>
              <div className="eyebrow" style={{ marginTop: 3 }}>Last 12 weeks</div>
            </div>
          </div>
          <div className="panel-body">
            <Sparkline data={growth} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Export</h2>
          </div>
          <div className="panel-body stack" style={{ gap: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>
              The WATI export asks which source to pull and how many contacts per file.
              For role, date or free-text filters, start from the{' '}
              <Link href="/leads" style={{ color: 'var(--accent)' }}>Leads</Link> page instead.
            </p>
            <ExportButtons params={{}} />
          </div>
        </section>
      </div>

      <div className="two-col reveal">
        <section className="panel">
          <div className="panel-head">
            <h2>Sources</h2>
            <Link href="/sources" className="btn btn-sm" data-variant="ghost">View all →</Link>
          </div>
          <div className="panel-body flush">
            {sources.length === 0 ? (
              <div className="empty">
                <div className="empty-mark">⬡</div>
                No communities extracted yet.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Source</th><th>Type</th><th>Members</th><th>Synced</th></tr>
                  </thead>
                  <tbody>
                    {sources.slice(0, 6).map((s) => (
                      <tr key={s._id}>
                        <td className="cell-name">
                          <Link href={`/leads?sourceId=${encodeURIComponent(s._id)}`}>{s.label}</Link>
                        </td>
                        <td><TypeBadge type={s.type} /></td>
                        <td className="cell-num">{s.memberCount.toLocaleString('en-IN')}</td>
                        <td className="cell-num cell-dim small">{formatRelative(s.lastSyncedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Recent syncs</h2>
            <Link href="/syncs" className="btn btn-sm" data-variant="ghost">View all →</Link>
          </div>
          <div className="panel-body flush">
            {runs.length === 0 ? (
              <div className="empty"><div className="empty-mark">⟲</div>No syncs yet.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>When</th><th>Status</th><th>Leads</th></tr></thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r._id}>
                        <td className="cell-num small">{formatRelative(r.queuedAt)}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td className="cell-num">
                          {r.stats.leadsSeen}
                          {r.stats.newLeads > 0 && (
                            <span style={{ color: 'var(--accent)' }}> +{r.stats.newLeads}</span>
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
      </div>
    </Shell>
  );
}
