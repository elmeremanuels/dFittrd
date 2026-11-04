import { LayoutDashboard, Shirt, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useApp } from '@/store';

/**
 * Phone frame (max-w-md) with real routes in the bottom nav, 100dvh + safe-area insets, and the
 * mirror slot sized by the available height (audit: mobile layout overflows). The dev-only
 * Customer/Merchant switcher exists only in `import.meta.env.DEV` builds.
 */
export function AppShell(): ReactNode {
  const outboxPending = useApp((s) => s.outboxPending);
  const location = useLocation();
  const hideNav = location.pathname.startsWith('/onboarding');
  return (
    <div className="flex min-h-dvh w-full justify-center bg-cream-deep">
      {import.meta.env.DEV ? <DevSwitcher /> : null}
      <main className="relative flex h-dvh w-full max-w-md flex-col bg-cream shadow-2xl shadow-ink/10">
        <div className="safe-top min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
        {hideNav ? null : (
          <nav className="safe-bottom flex items-center justify-around border-t border-ink/10 bg-white/90 px-6 pt-2 backdrop-blur-xl" aria-label="Primary">
            <NavItem to="/deck" label="Rail" icon={<Shirt className="h-5 w-5" aria-hidden />} />
            <NavItem to="/wardrobe" label="Wardrobe" icon={<LayoutDashboard className="h-5 w-5" aria-hidden />} />
            <NavItem to="/profile" label="Profile" icon={<User className="h-5 w-5" aria-hidden />} badge={outboxPending > 0 ? `${outboxPending} to sync` : undefined} />
          </nav>
        )}
      </main>
    </div>
  );
}

function NavItem({ to, label, icon, badge }: { to: string; label: string; icon: ReactNode; badge?: string }): ReactNode {
  return (
    <NavLink to={to} aria-label={label} className={({ isActive }) => `flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-4 py-1 text-xs font-medium ${isActive ? 'text-coral' : 'text-ink-soft hover:text-ink'}`}>
      {({ isActive }) => (
        <>
          <span className={`rounded-full p-1.5 ${isActive ? 'bg-coral/10' : ''}`}>{icon}</span>
          <span>{label}</span>
          {badge ? <span className="sr-only">{badge}</span> : null}
        </>
      )}
    </NavLink>
  );
}

function DevSwitcher(): ReactNode {
  const location = useLocation();
  const merchant = location.pathname.startsWith('/merchant');
  return (
    <div className="fixed right-3 bottom-3 z-50 flex rounded-full border border-ink/10 bg-white/80 p-1 text-xs font-semibold uppercase tracking-wider shadow backdrop-blur" aria-label="Development view switcher">
      <Link to="/deck" className={`rounded-full px-3 py-1 ${!merchant ? 'bg-ink text-white' : 'text-ink-soft'}`}>
        Customer
      </Link>
      <Link to="/merchant" className={`rounded-full px-3 py-1 ${merchant ? 'bg-ink text-white' : 'text-ink-soft'}`}>
        Merchant
      </Link>
    </div>
  );
}

export function RequireOnboarded({ children }: { children: ReactNode }): ReactNode {
  const onboarded = useApp((s) => s.settings.onboarded);
  const hydrated = useApp((s) => s.hydrated);
  if (!hydrated) return <Splash />;
  if (!onboarded) return <RedirectTo to="/onboarding" />;
  return children;
}

export function Splash(): ReactNode {
  return (
    <div className="flex h-full min-h-[50dvh] items-center justify-center" role="status" aria-live="polite">
      <p className="font-display text-xl text-ink-soft">Paskamer</p>
    </div>
  );
}

import { Navigate } from 'react-router';
export function RedirectTo({ to }: { to: string }): ReactNode {
  return <Navigate to={to} replace />;
}

export function IndexRoute(): ReactNode {
  const onboarded = useApp((s) => s.settings.onboarded);
  const hydrated = useApp((s) => s.hydrated);
  if (!hydrated) return <Splash />;
  return <Navigate to={onboarded ? '/deck' : '/onboarding'} replace />;
}
