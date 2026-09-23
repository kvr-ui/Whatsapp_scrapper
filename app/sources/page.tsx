import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { TypeBadge } from '@/components/Badge';
import { listSources } from '@/lib/repo';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const sources = await listSources();

  return (
    <Shell title="Sources">
      <section className="panel reveal">
        <div className="panel-head">
          <div>
            <h2>{sources.length} source{sources.length === 1 ? '' : 's'}</h2>
            <div className="eyebrow" style={{ marginTop: 3 }}>
              Communities, standalone groups, broadcast lists, channels and saved contacts
            </div>
          </div>
        </div>

        <div className="panel-body flush">
          {sources.length === 0 ? (
            <div className="empty">
              <div className="empty-mark">⬡</div>
              Nothing extracted yet. Run a sync from the Overview page.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Type</th>
                    <th>Members</th>
                    <th>Admins</th>
                    <th>Unresolved</th>
                    <th>Subgroups</th>
                    <th>Last synced</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s._id}>
                      <td className="cell-name" style={{ maxWidth: 260 }}>
                        {s.label}
                        <div className="eyebrow" style={{ marginTop: 3, textTransform: 'none', letterSpacing: 0 }}>
                          {s._id}
                        </div>
                      </td>
                      <td><TypeBadge type={s.type} /></td>
                      <td className="cell-num">{s.memberCount.toLocaleString('en-IN')}</td>
                      <td className="cell-num cell-dim">{s.adminCount}</td>
                      <td className="cell-num">
                        {s.unresolvedCount > 0
                          ? <span style={{ color: 'var(--amber)' }}>{s.unresolvedCount}</span>
                          : <span className="faint">0</span>}
                      </td>
                      <td>
                        <span className="cell-num cell-dim">{s.subgroups.length}</span>
                        <div className="cell-clamp" title={s.subgroups.map((g) => g.name).join(', ')}>
                          {s.subgroups.map((g) => g.name).join(' · ')}
                        </div>
                      </td>
                      <td className="cell-num cell-dim small">{formatRelative(s.lastSyncedAt)}</td>
                      <td>
                        <Link className="btn btn-sm" href={`/leads?sourceId=${encodeURIComponent(s._id)}`}>
                          Leads →
                        </Link>
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
