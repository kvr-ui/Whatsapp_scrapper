import type { SyncStatus } from '@/lib/types';

const STATUS_TONE: Record<SyncStatus, string> = {
  success: 'accent',
  running: 'info',
  queued: 'amber',
  failed: 'danger',
};

export function StatusBadge({ status }: { status: SyncStatus }) {
  return (
    <span className="badge" data-tone={STATUS_TONE[status]}>
      <span className="dot" aria-hidden />
      {status}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  if (role === 'Member') return <span className="badge">member</span>;
  return (
    <span className="badge" data-tone={role === 'Super Admin' ? 'amber' : 'accent'}>
      {role.toLowerCase()}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const tone =
    type === 'community' ? 'accent'
    : type === 'broadcast' ? 'info'
    : type === 'channel' ? 'amber'
    : type === 'contact' ? 'accent'
    : undefined;
  return <span className="badge" data-tone={tone}>{type}</span>;
}
