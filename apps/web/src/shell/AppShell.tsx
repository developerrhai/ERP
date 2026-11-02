// Authenticated frame (prototype .app grid: 304px sidebar + 66px top bar + main) that every
// signed-in route renders inside; it owns the working context (unit / FY) for the session.
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { loadContext, resetContext, useAppContext } from '../lib/context';
import type { User } from '../types';
import { AccountDrawer } from './AccountDrawer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ user }: { user: User }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { epoch } = useAppContext();
  // GET /me/context on sign-in / session restore; dropped again on sign-out.
  useEffect(() => {
    void loadContext();
    return () => resetContext();
  }, [user.id]);
  return (
    <div className="app">
      <Sidebar user={user} open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <Topbar
        user={user}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenAccount={() => setAccountOpen(true)}
      />
      <main className="main" id="main">
        {/* A unit / FY switch bumps the epoch: remounting refetches the current page's data. */}
        <Outlet key={epoch} />
      </main>
      {accountOpen ? <AccountDrawer user={user} onClose={() => setAccountOpen(false)} /> : null}
    </div>
  );
}
