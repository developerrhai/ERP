// Authenticated frame (prototype .app grid: 304px sidebar + 66px top bar + main) that every
// signed-in route renders inside; owns working context, locale sync, Help drawer, and DPDP privacy notice.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { BroadcastBannerHost } from '../components/BroadcastBannerHost';
import { HelpDrawer } from '../components/HelpDrawer';
import { PrivacyNoticeModal } from '../components/PrivacyNoticeModal';
import { setAppLocale } from '../i18n';
import { loadContext, resetContext, useAppContext } from '../lib/context';
import { hardeningApi } from '../lib/hardeningApi';
import { startRealtimeClient, stopRealtimeClient } from '../lib/realtime';
import type { User } from '../types';
import { AccountDrawer } from './AccountDrawer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ user }: { user: User }) {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const { epoch } = useAppContext();

  useEffect(() => {
    void loadContext();
    const stopRt = startRealtimeClient();
    hardeningApi
      .getLocale()
      .then((res) => setAppLocale(res.locale))
      .catch(() => {
        // Fallback to localStorage preference
      });
    return () => {
      stopRt();
      stopRealtimeClient();
      resetContext();
    };
  }, [user.id]);

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        {t('app.skipToMain')}
      </a>
      <Sidebar user={user} open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <Topbar
        user={user}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenAccount={() => setAccountOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <main className="main" id="main" tabIndex={-1}>
        <BroadcastBannerHost />
        <Outlet key={epoch} />
        <footer
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--muted)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{t('app.brandName')}</span>
          <button
            type="button"
            className="btn"
            style={{ padding: '2px 8px', fontSize: 12 }}
            onClick={() => setPrivacyOpen(true)}
          >
            {t('dpdp.privacyLink')}
          </button>
        </footer>
      </main>
      {accountOpen ? <AccountDrawer user={user} onClose={() => setAccountOpen(false)} /> : null}
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      <PrivacyNoticeModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} forceOnUnaccepted />
    </div>
  );
}
