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
        <div
          className="x-d-flex x-gap-0_5rem x-bb-1px-solid-line x-mb-1_25rem"
        >
          <button
            type="button"
            className={`auth-tab ${tab === 'auth' ? 'active' : ''}`}
            style={{
              padding: '0.5rem 1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderBottom: tab === 'auth' ? '2px solid var(--color-primary, #0284c7)' : 'none',
              fontWeight: 600,
            }}
            onClick={() => setTab('auth')}
          >
            Authentication
          </button>
          <button
            type="button"
            className={`auth-tab ${tab === 'sessions' ? 'active' : ''}`}
            style={{
              padding: '0.5rem 1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderBottom: tab === 'sessions' ? '2px solid var(--color-primary, #0284c7)' : 'none',
              fontWeight: 600,
            }}
            onClick={() => setTab('sessions')}
          >
            Session History
          </button>
        </div>

        {error ? (
          <div className="msg error show x-mb-1rem">
            {error}
          </div>
        ) : null}

        {tab === 'auth' ? (
          <div className="x-d-flex x-fd-column x-gap-1_25rem">
            {/* Lock State */}
            <div className="x-p-1rem x-bd-1px-solid-line x-r-6px">
              <div
                className="x-d-flex x-jc-space-between x-ai-center"
              >
                <div>
                  <b className="x-fs-14px">Account Lock State</b>
                  <div className="x-fs-13px x-c-muted x-mt-0_25rem">
                    {isLocked
                      ? 'Account is currently locked due to failed login attempts.'
                      : 'Account is active and not locked.'}
                  </div>
                </div>
                <span className={`status ${isLocked ? 'inactive' : 'active'}`}>
                  {isLocked ? 'Locked' : 'Unlocked'}
                </span>
              </div>
              <div className="x-mt-0_75rem">
                <button
                  type="button"
                  className="btn sm secondary"
                  disabled={isSelf || !isLocked}
                  onClick={() => void onUnlock()}
                >
                  Unlock
                </button>
                {isSelf ? (
                  <span className="x-fs-12px x-c-muted x-ml-0_5rem">
                    Use My Account → Security for your own account.
                  </span>
                ) : !isLocked ? (
                  <span className="x-fs-12px x-c-muted x-ml-0_5rem">
                    Account is not locked.
                  </span>
                ) : null}
              </div>
            </div>

            {/* MFA State */}
            <div className="x-p-1rem x-bd-1px-solid-line x-r-6px">
              <div
                className="x-d-flex x-jc-space-between x-ai-center"
              >
                <div>
                  <b className="x-fs-14px">Two-Step Verification</b>
                  <div className="x-fs-13px x-c-muted x-mt-0_25rem">
                    {user.mfaEnabled
                      ? 'Two-step verification is enabled.'
                      : 'Two-step verification is not enabled.'}
                  </div>
                </div>
                <span className={`status ${user.mfaEnabled ? 'active' : 'inactive'}`}>
                  {user.mfaEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="x-mt-0_75rem">
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={isSelf || !user.mfaEnabled || !canResetMfa}
                  onClick={() => void onResetMfa()}
                >
                  Reset Two-Step
                </button>
                {isSelf ? (
                  <span className="x-fs-12px x-c-muted x-ml-0_5rem">
                    Use My Account → Security for your own account.
                  </span>
                ) : !user.mfaEnabled ? (
                  <span className="x-fs-12px x-c-muted x-ml-0_5rem">
                    Two-step verification is not enabled.
                  </span>
                ) : !canResetMfa ? (
                  <span className="x-fs-12px x-c-muted x-ml-0_5rem">
                    Only SUPER_ADMIN can reset two-step verification for an administrator.
                  </span>
                ) : null}
              </div>
            </div>

            {/* Password Reset */}
            <div className="x-p-1rem x-bd-1px-solid-line x-r-6px">
              <b className="x-fs-14px">Password Management</b>
              <div className="x-fs-13px x-c-muted x-mt-0_25rem">
                Set a temporary password. The user will be required to change it upon sign-in.
              </div>
              <div className="x-mt-0_75rem">
                <button
                  type="button"
                  className="btn sm secondary"
                  disabled={isSelf}
                  onClick={() => setShowResetModal(true)}
                >
                  Reset Password
                </button>
                {isSelf ? (
                  <span className="x-fs-12px x-c-muted x-ml-0_5rem">
                    Use My Account → Security for your own account.
                  </span>
                ) : null}
              </div>
            </div>

            {/* Last Sign-in info */}
            <div
              className="x-p-1rem x-bgc-card2 x-r-6px x-fs-13px"
            >
              <div>
                Last Sign-In: <b>{formatIstDateTime(user.lastLoginAt) || 'Never'}</b>
              </div>
              {user.previousLoginAt ? (
                <div className="x-mt-0_25rem">
                  Previous Sign-In: <b>{formatIstDateTime(user.previousLoginAt)}</b>
                  {user.previousLoginIp ? ` from ${user.previousLoginIp}` : ''}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          /* Session History Tab */
          <div>
            <div
              className="x-d-flex x-jc-space-between x-ai-center x-mb-1rem"
            >
              <span className="x-fs-14px x-c-muted">
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
              <p className="x-fs-12px x-c-muted x-mb-0_5rem">
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
                        <div style={{ fontWeight: 500, fontSize: '0.8125rem' }}>
                          {s.userAgent ?? 'Unknown'}
                        </div>
                        {s.mfaVerified ? (
                          <span style={{ fontSize: '0.6875rem', color: '#15803d' }}>
                            ✓ 2FA Verified
                          </span>
                        ) : null}
                      </td>
                      <td>{s.ip ?? '—'}</td>
                      <td>{formatIstDateTime(s.lastUsedAt)}</td>
                      <td>
                        <span className={`status ${s.isLive ? 'active' : 'inactive'}`}>
                          {s.isLive
                            ? 'Live'
                            : s.revokedReason
                              ? `Revoked (${s.revokedReason})`
                              : 'Expired'}
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
