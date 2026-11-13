// Top bar (prototype .top): menu toggle, global search shortcut, Unit/FY selects, health pill,
// Hindi/English language switcher (saved to profile), Help (?) button, and account button.
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { setAppLocale, type SupportedLocale } from '../i18n';
import { initials, roleLine } from '../lib/format';
import { hardeningApi } from '../lib/hardeningApi';
import type { User } from '../types';
import { ContextSelectors } from './ContextSelectors';
import { HealthPill } from './HealthPill';
import { NotificationBell } from './NotificationBell';

const LATER = 'Available in a later phase';

interface TopbarProps {
  user: User;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenAccount: () => void;
  onOpenHelp?: () => void;
}

export function Topbar({ user, sidebarOpen, onToggleSidebar, onOpenAccount, onOpenHelp }: TopbarProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentLang: SupportedLocale = i18n.language === 'hi' ? 'hi' : 'en';

  const switchLang = async (next: SupportedLocale) => {
    await setAppLocale(next);
    hardeningApi.setLocale(next).catch(() => {
      // Ignore if test harness mocks auth without /me/locale
    });
  };

  return (
    <header className="top">
      <button
        type="button"
        className="menu-toggle"
        aria-controls="sidebar"
        aria-expanded={sidebarOpen}
        onClick={onToggleSidebar}
      >
        ☰ {t('app.menu')}
      </button>
      <button type="button" className="btn" onClick={() => navigate('/menu')}>
        ⊞ Menu
      </button>
      <div className="global">
        <input
          placeholder={t('app.searchPlaceholder')}
          aria-label={t('app.searchPlaceholder')}
          onFocus={() => navigate('/m/global-search')}
          readOnly
        />
      </div>
      <ContextSelectors />
      <div className="top-actions">
        <HealthPill />
        <button
          type="button"
          className="btn"
          aria-label={`${t('app.language')}: ${currentLang === 'en' ? 'English' : 'हिन्दी'}`}
          onClick={() => void switchLang(currentLang === 'en' ? 'hi' : 'en')}
          style={{ padding: '4px 8px' }}
        >
          {currentLang === 'en' ? 'EN / हिं' : 'हिं / EN'}
        </button>
        {onOpenHelp ? (
          <button
            type="button"
            className="icon"
            aria-label={t('app.help')}
            title={t('app.help')}
            onClick={onOpenHelp}
          >
            ?
          </button>
        ) : (
          <button type="button" className="icon" aria-label="Quick add" title={LATER} disabled>
            ＋
          </button>
        )}
        <NotificationBell />
        <button
          type="button"
          className="user"
          aria-label={`Account: ${user.name}`}
          aria-haspopup="dialog"
          onClick={onOpenAccount}
        >
          <span className="avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span>
            <b>{user.name}</b>
            <small className="user-role">{roleLine(user)}</small>
          </span>
        </button>
      </div>
    </header>
  );
}
