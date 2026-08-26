import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { authEnabled } from '@/lib/auth';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  if (!authEnabled()) redirect('/');

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="row" style={{ marginBottom: 4 }}>
          <span className="brand-dot" aria-hidden />
          <strong style={{ letterSpacing: '-0.02em' }}>FOCAS Leads</strong>
        </div>
        <div className="eyebrow" style={{ marginBottom: 22 }}>WhatsApp Console</div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
