// User Drawer with Authentication and Session History tabs per Phase 01 §2, §7, §8.
import { useEffect, useState } from 'react';
import { Drawer } from '../../components/Drawer';
import { useToast } from '../../components/Toast';
import {
  ApiError,
  getUserSessions,
  resetUserMfa,
  revokeAllUserSessions,
  unlockUser,
} from '../../lib/api';
import type { SessionInfo, User } from '../../types';
import { formatIstDateTime } from '../LoginPage';
import { ResetPasswordModal } from './ResetPasswordModal';

interface Props {
  user: User;
  currentUser: User;
  onClose: () => void;
  onReload: () => void;
}

type DrawerTab = 'auth' | 'sessions';

export function UserDrawer({ user, currentUser, onClose, onReload }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<DrawerTab>('auth');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);

  const isSelf = user.id === currentUser.id;
  const isLocked = Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
  const canResetMfa =
    !(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') || currentUser.role === 'SUPER_ADMIN';

  const loadSessions = () => {
    setLoading(true);
    getUserSessions(user.id)
      .then(setSessions)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not load sessions.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab === 'sessions') {
      loadSessions();
    }
  }, [tab, user.id]);

  const onUnlock = async () => {
    try {
      await unlockUser(user.id);
      toast(`Account ${user.loginId} unlocked.`);
      onReload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not unlock account.');
    }
  };

  const onResetMfa = async () => {
    try {
      await resetUserMfa(user.id);
      toast('Two-step verification reset.');
      onReload();
      if (tab === 'sessions') loadSessions();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not reset two-step verification.');
    }
  };

  const onSignOutEverywhere = async () => {
    try {
      const res = await revokeAllUserSessions(user.id);
      toast(`Signed out of ${res.revoked} session${res.revoked === 1 ? '' : 's'}.`);
      loadSessions();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not sign out sessions.');
    }
  };

  return (
    <>
      <Drawer title={`User: ${user.name} (${user.loginId})`} onClose={onClose}>
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
          <button
            type="button"
            className={`auth-tab ${tab === 'auth' ? 'active' : ''}`}
            style={{ padding: '0.5rem 1rem', background: 'none', border: 'none', cursor: 'pointer', borderBottom: tab === 'auth' ? '2px solid var(--color-primary, #0284c7)' : 'none', fontWeight: 600 }}
            onClick={() => setTab('auth')}
          >
            Authentication
          </button>
          <button
            type="button"
            className={`auth-tab ${tab === 'sessions' ? 'active' : ''}`}
            style={{ padding: '0.5rem 1rem', background: 'none', border: 'none', cursor: 'pointer', borderBottom: tab === 'sessions' ? '2px solid var(--color-primary, #0284c7)' : 'none', fontWeight: 600 }}
            onClick={() => setTab('sessions')}
          >
            Session History
          </button>
        </div>

        {error ? <div className="msg error show" style={{ marginBottom: '1rem' }}>{error}</div> : null}

        {tab === 'auth' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Lock State */}
            <div style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <b style={{ fontSize: '0.9375rem' }}>Account Lock State</b>
                  <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.25rem' }}>
                    {isLocked ? 'Account is currently locked due to failed login attempts.' : 'Account is active and not locked.'}
                  </div>
                </div>
                <span className={`status ${isLocked ? 'inactive' : 'active'}`}>
                  {isLocked ? 'Locked' : 'Unlocked'}
                </span>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn sm secondary"
                  disabled={isSelf || !isLocked}
                  onClick={() => void onUnlock()}
                >
                  Unlock
                </button>
                {isSelf ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    Use My Account → Security for your own account.
                  </span>
                ) : !isLocked ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    Account is not locked.
                  </span>
                ) : null}
              </div>
            </div>

            {/* MFA State */}
            <div style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <b style={{ fontSize: '0.9375rem' }}>Two-Step Verification</b>
                  <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.25rem' }}>
                    {user.mfaEnabled ? 'Two-step verification is enabled.' : 'Two-step verification is not enabled.'}
                  </div>
                </div>
                <span className={`status ${user.mfaEnabled ? 'active' : 'inactive'}`}>
                  {user.mfaEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={isSelf || !user.mfaEnabled || !canResetMfa}
                  onClick={() => void onResetMfa()}
                >
                  Reset Two-Step
                </button>
                {isSelf ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    Use My Account → Security for your own account.
                  </span>
                ) : !user.mfaEnabled ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    Two-step verification is not enabled.
                  </span>
                ) : !canResetMfa ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    Only SUPER_ADMIN can reset two-step verification for an administrator.
                  </span>
                ) : null}
              </div>
            </div>

            {/* Password Reset */}
            <div style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <b style={{ fontSize: '0.9375rem' }}>Password Management</b>
              <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.25rem' }}>
                Set a temporary password. The user will be required to change it upon sign-in.
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn sm secondary"
                  disabled={isSelf}
                  onClick={() => setShowResetModal(true)}
                >
                  Reset Password
                </button>
                {isSelf ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    Use My Account → Security for your own account.
                  </span>
                ) : null}
              </div>
            </div>

            {/* Last Sign-in info */}
            <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.8125rem' }}>
              <div>Last Sign-In: <b>{formatIstDateTime(user.lastLoginAt) || 'Never'}</b></div>
              {user.previousLoginAt ? (
                <div style={{ marginTop: '0.25rem' }}>
                  Previous Sign-In: <b>{formatIstDateTime(user.previousLoginAt)}</b>
                  {user.previousLoginIp ? ` from ${user.previousLoginIp}` : ''}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          /* Session History Tab */
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                {sessions.length} recorded session{sessions.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="btn sm danger"
                disabled={isSelf || sessions.length === 0}
                onClick={() => void onSignOutEverywhere()}
              >
                Sign out everywhere
              </button>
            </div>
            {isSelf ? (
              <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>
                Use My Account → Security to manage your own sessions.
              </p>
            ) : null}

            <div className="v8-table-wrap">
              <table className="v8-table">
                <thead>
                  <tr>
                    <th scope="col">Browser / Device</th>
                    <th scope="col">IP Address</th>
                    <th scope="col">Last Active</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{s.userAgent ?? 'Unknown'}</div>
                        {s.mfaVerified ? (
                          <span style={{ fontSize: '0.6875rem', color: '#16a34a' }}>✓ 2FA Verified</span>
                        ) : null}
                      </td>
                      <td>{s.ip ?? '—'}</td>
                      <td>{formatIstDateTime(s.lastUsedAt)}</td>
                      <td>
                        <span className={`status ${s.isLive ? 'active' : 'inactive'}`}>
                          {s.isLive ? 'Live' : s.revokedReason ? `Revoked (${s.revokedReason})` : 'Expired'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!loading && sessions.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={4}>No sessions found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>

      {showResetModal ? (
        <ResetPasswordModal
          user={user}
          onClose={() => setShowResetModal(false)}
          onDone={() => {
            setShowResetModal(false);
            toast(`Temporary password set for ${user.loginId}.`);
            onReload();
          }}
        />
      ) : null}
    </>
  );
}
