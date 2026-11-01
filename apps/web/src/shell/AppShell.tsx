// Authenticated frame (prototype .app grid: 304px sidebar + 66px top bar + main) that every
// signed-in route renders inside.
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { User } from '../types';
import { AccountDrawer } from './AccountDrawer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ user }: { user: User }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
        <Outlet />
      </main>
      {accountOpen ? <AccountDrawer user={user} onClose={() => setAccountOpen(false)} /> : null}
    </div>
  );
}
