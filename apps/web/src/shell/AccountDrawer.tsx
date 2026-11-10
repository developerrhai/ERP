// Account drawer (prototype .drawer): who am I (avatar, name, login ID, department, role),
// change password, sign out of all devices, and Sign Out.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Drawer } from '../components/Drawer';
import { useToast } from '../components/Toast';
import { ApiError, logout, logoutAll } from '../lib/api';
import { clearPushAndSwOnLogout } from '../lib/pushClient';
import { initials } from '../lib/format';
import type { User } from '../types';

export function AccountDrawer({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <Drawer title="My Account" onClose={onClose}>
      <div className="drawer-profile">
        <div className="avatar" aria-hidden="true">
          {initials(user.name)}
        </div>
        <div>
          <b>{user.name}</b>
          <small>{user.loginId}</small>
        </div>
      </div>
      <div className="detail-grid account-details">
        <div className="detail">
          <small>Login ID</small>
          <b>{user.loginId}</b>
        </div>
        <div className="detail">
          <small>Department</small>
          <b>{user.department ?? '—'}</b>
        </div>
        <div className="detail">
          <small>Role</small>
          <b>{user.roleLabel}</b>
        </div>
      </div>
      <section className="drawer-section" aria-labelledby="acct-pw">
        <h3 id="acct-pw">Change Password</h3>
        <ChangePasswordForm
          user={user}
          submitLabel="Change Password"
          submitClassName="btn primary"
          onDone={() => toast('Password changed. Other sessions were signed out.')}
        />
      </section>
      {error ? (
        <div className="msg error show static drawer-section" role="alert">
          {error}
        </div>
      ) : null}
      <div className="drawer-actions">
        <a
          href="/account/security"
          className="btn"
          onClick={onClose}
          style={{ textAlign: 'center', textDecoration: 'none' }}
        >
          Security & Devices
        </a>
        {installPrompt ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              void installPrompt.prompt().finally(() => {
                setInstallPrompt(null);
              })
            }
          >
            Install App
          </button>
        ) : (
          <Link
            to="/install"
            className="btn"
            onClick={onClose}
            style={{ textAlign: 'center', textDecoration: 'none' }}
          >
            Install App
          </Link>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await clearPushAndSwOnLogout();
              await logoutAll();
            })
          }
        >
          Sign out of all devices
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() =>
            void (async () => {
              await clearPushAndSwOnLogout();
              await logout(toast);
            })()
          }
        >
          Sign Out
        </button>
      </div>
    </Drawer>
  );
}
