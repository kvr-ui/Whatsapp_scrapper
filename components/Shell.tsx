import Link from 'next/link';
import { NavLink } from './NavLink';
import { LogoutButton } from './LogoutButton';
import { authEnabled } from '@/lib/auth';

const NAV = [
  { href: '/',            label: 'Overview',  icon: '◈' },
  { href: '/leads',       label: 'Leads',     icon: '☰' },
  { href: '/sources',     label: 'Sources',   icon: '⬡' },
  { href: '/syncs',       label: 'Sync log',  icon: '⟲' },
  { href: '/setup',       label: 'Setup',     icon: '⚙' },
];

export function Shell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link href="/" className="brand-mark">
            <span className="brand-dot" aria-hidden />
            FOCAS Leads
          </Link>
          <div className="eyebrow brand-sub">WhatsApp Console</div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
          ))}
        </nav>

        <div className="sidebar-foot">
          {authEnabled() && <LogoutButton />}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 style={{ fontSize: 16 }}>{title}</h1>
          <div className="row">{actions}</div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
