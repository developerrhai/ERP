// Security Center (/m/admin-security): Phase 01 §2, §7, §8, §13.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { ApiError, getSecurityPolicy, getWhoAmI, putSecurityPolicy } from '../../lib/api';
import type { ActionSet, AuditLog, SecurityPolicy } from '../../types';
import { listAuditLogs } from './adminApi';
import { listUsers } from '../users/usersApi';
import { formatIstDateTime } from '../LoginPage';

interface Props {
  actions?: Pick<ActionSet, 'view' | 'edit'>;
}

type TabKey = 'password' | 'mfa' | 'sessions' | 'ip' | 'events';

export function SecurityCenterPage({ actions = { view: true, edit: true } }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('password');

  // Policy state
  const [policy, setPolicy] = useState<SecurityPolicy>({
    passwordMinLength: 12,
    maxFailedLogins: 10,
    lockoutMinutes: 15,
    idleMinutes: 30,
    absoluteHours: 12,
    maxSessionsPerUser: 10,
    mfaRequiredForAdmins: false,
  });
  const [policyVersion, setPolicyVersion] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Dashboard cards data
  const [adminsWithoutMfa, setAdminsWithoutMfa] = useState<number | null>(null);
  const [lockedAccountsCount, setLockedAccountsCount] = useState<number | null>(null);
  const [failedLoginsToday, setFailedLoginsToday] = useState<number | null>(null);
  const [whoAmI, setWhoAmI] = useState<{
    ip: string;
    forwardedFor: string | null;
    trustProxy: unknown;
    protocol: string;
  } | null>(null);

  // Security events preview
  const [recentEvents, setRecentEvents] = useState<AuditLog[]>([]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [policyRes, whoAmIRes, usersRes, auditRes] = await Promise.all([
        getSecurityPolicy(),
        getWhoAmI().catch(() => null),
        listUsers({ q: '', role: '', status: '', page: 1, size: 100 }).catch(() => null),
        listAuditLogs({
          from: '',
          to: '',
          actorId: '',
          action: '',
          preset: 'login_events',
          q: '',
          page: 1,
          size: 50,
        }).catch(() => null),
      ]);

      setPolicy(policyRes.value);
      setPolicyVersion(policyRes.version);
      setWhoAmI(whoAmIRes);

      if (usersRes) {
        const users = usersRes.users;
        const now = Date.now();
        const admins = users.filter((u) => u.role === 'SUPER_ADMIN' || u.role === 'ADMIN');
        setAdminsWithoutMfa(admins.filter((u) => !u.mfaEnabled).length);
        setLockedAccountsCount(
          users.filter((u) => u.lockedUntil && new Date(u.lockedUntil).getTime() > now).length,
        );
      }

      if (auditRes) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const todayFailed = auditRes.rows.filter(
          (r) =>
            new Date(r.at).getTime() >= startOfDay.getTime() &&
            (r.action === 'LOGIN_FAILED' || r.action === 'MFA_FAILED'),
        ).length;
        setFailedLoginsToday(todayFailed);
        setRecentEvents(auditRes.rows.slice(0, 10));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load security policy.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actions.edit) return;

    // Validation per §8 exact messages
    if (policy.passwordMinLength < 12 || policy.passwordMinLength > 128) {
      setError('Password must be between 12 and 128 characters.');
      return;
    }
    if (policy.maxFailedLogins < 3 || policy.maxFailedLogins > 20) {
      setError('Max failed logins must be between 3 and 20.');
      return;
    }
    if (policy.lockoutMinutes < 5 || policy.lockoutMinutes > 1440) {
      setError('Lockout duration must be between 5 and 1440 minutes.');
      return;
    }
    if (policy.idleMinutes < 5 || policy.idleMinutes > 240) {
      setError('Idle timeout must be between 5 and 240 minutes.');
      return;
    }
    if (policy.absoluteHours < 1 || policy.absoluteHours > 72) {
      setError('Absolute session limit must be between 1 and 72 hours.');
      return;
    }
    if (policy.maxSessionsPerUser < 1 || policy.maxSessionsPerUser > 50) {
      setError('Max sessions per user must be between 1 and 50.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const updated = await putSecurityPolicy(policy, policyVersion);
      setPolicy(updated.value);
      setPolicyVersion(updated.version);
      toast('Security policy updated.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setError(
          'Security policy was modified by another administrator. Please reload and try again.',
        );
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not update security policy.');
      }
    } finally {
      setSaving(false);
    }
  };

  const isProxySecure = whoAmI && whoAmI.ip !== '127.0.0.1';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security Center</h1>
          <p>Identity hardening, session controls, and authentication policy.</p>
        </div>
      </div>

      {error ? (
        <div className="msg error show static" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {/* Top Cards per §2, §7, §13 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ padding: 16 }}>
          <div className="v8-sub" style={{ fontSize: 13, marginBottom: 8 }}>
            Admins without Two-Step
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
            {adminsWithoutMfa !== null ? adminsWithoutMfa : '—'}
          </div>
          <div style={{ marginTop: 8 }}>
            <span
              className={`status ${adminsWithoutMfa === 0 ? 'active' : 'inactive'}`}
              style={{ fontSize: 11 }}
            >
              {adminsWithoutMfa === 0 ? 'Protected' : 'Action needed'}
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="v8-sub" style={{ fontSize: 13, marginBottom: 8 }}>
            Locked Accounts
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
            {lockedAccountsCount !== null ? lockedAccountsCount : '—'}
          </div>
          <div style={{ marginTop: 8 }}>
            <span
              className={`status ${lockedAccountsCount === 0 ? 'active' : 'inactive'}`}
              style={{ fontSize: 11 }}
            >
              {lockedAccountsCount === 0 ? 'All clear' : 'Locked'}
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="v8-sub" style={{ fontSize: 13, marginBottom: 8 }}>
            Failed Sign-Ins Today
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
            {failedLoginsToday !== null ? failedLoginsToday : '—'}
          </div>
          <div style={{ marginTop: 8 }}>
            <span className="status active" style={{ fontSize: 11 }}>
              Monitored
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="v8-sub" style={{ fontSize: 13, marginBottom: 8 }}>
            Proxy Check
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text)',
              fontFamily: 'monospace',
            }}
          >
            {whoAmI ? whoAmI.ip : '—'}
          </div>
          <div style={{ marginTop: 8 }}>
            <span
              className={`status ${isProxySecure ? 'active' : 'inactive'}`}
              style={{ fontSize: 11 }}
            >
              {isProxySecure ? 'Secure (Real IP forwarded)' : 'Warning: Loopback IP'}
            </span>
          </div>
          {whoAmI ? (
            <div className="v8-sub" style={{ fontSize: 11, marginTop: 4 }}>
              Proto: {whoAmI.protocol.toUpperCase()} · TrustProxy: {String(whoAmI.trustProxy)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="card" style={{ padding: 0 }}>
        <div
          className="tabs"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            padding: '0 16px',
            gap: 8,
          }}
        >
          <button
            type="button"
            className={`btn sm ${tab === 'password' ? 'primary' : ''}`}
            onClick={() => setTab('password')}
            style={{ margin: '8px 0' }}
          >
            Password Policy
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'mfa' ? 'primary' : ''}`}
            onClick={() => setTab('mfa')}
            style={{ margin: '8px 0' }}
          >
            MFA (Two-Step)
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'sessions' ? 'primary' : ''}`}
            onClick={() => setTab('sessions')}
            style={{ margin: '8px 0' }}
          >
            Session Controls
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'ip' ? 'primary' : ''}`}
            onClick={() => setTab('ip')}
            style={{ margin: '8px 0' }}
          >
            IP Restrictions
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'events' ? 'primary' : ''}`}
            onClick={() => setTab('events')}
            style={{ margin: '8px 0' }}
          >
            Security Events
          </button>
        </div>

        <form onSubmit={handleSave} style={{ padding: 24 }}>
          {tab === 'password' && (
            <div style={{ display: 'grid', gap: 16, maxWidth: 540 }}>
              <div className="field">
                <label htmlFor="sec-min-len">Minimum Password Length (12–128 characters)</label>
                <input
                  id="sec-min-len"
                  type="number"
                  min={12}
                  max={128}
                  value={policy.passwordMinLength}
                  disabled={!actions.edit}
                  onChange={(e) =>
                    setPolicy({ ...policy, passwordMinLength: Number(e.target.value) })
                  }
                  required
                />
                <span className="v8-sub" style={{ fontSize: 12 }}>
                  NIST SP 800-63B recommends at least 12 characters with no arbitrary character
                  classes.
                </span>
              </div>

              <div className="field">
                <label htmlFor="sec-max-failed">Max Failed Sign-Ins Before Lockout (3–20)</label>
                <input
                  id="sec-max-failed"
                  type="number"
                  min={3}
                  max={20}
                  value={policy.maxFailedLogins}
                  disabled={!actions.edit}
                  onChange={(e) =>
                    setPolicy({ ...policy, maxFailedLogins: Number(e.target.value) })
                  }
                  required
                />
                <span className="v8-sub" style={{ fontSize: 12 }}>
                  Consecutive failed password or MFA attempts before temporary account lockout.
                </span>
              </div>

              <div className="field">
                <label htmlFor="sec-lockout-min">Account Lockout Duration (5–1440 minutes)</label>
                <input
                  id="sec-lockout-min"
                  type="number"
                  min={5}
                  max={1440}
                  value={policy.lockoutMinutes}
                  disabled={!actions.edit}
                  onChange={(e) => setPolicy({ ...policy, lockoutMinutes: Number(e.target.value) })}
                  required
                />
                <span className="v8-sub" style={{ fontSize: 12 }}>
                  Minutes an account remains locked. An administrator can also unlock immediately.
                </span>
              </div>
            </div>
          )}

          {tab === 'mfa' && (
            <div style={{ display: 'grid', gap: 16, maxWidth: 540 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <input
                  id="sec-mfa-req"
                  type="checkbox"
                  style={{ width: 18, height: 18, marginTop: 2 }}
                  checked={policy.mfaRequiredForAdmins}
                  disabled={!actions.edit}
                  onChange={(e) => setPolicy({ ...policy, mfaRequiredForAdmins: e.target.checked })}
                />
                <div>
                  <label
                    htmlFor="sec-mfa-req"
                    style={{ fontWeight: 600, display: 'block', cursor: 'pointer' }}
                  >
                    Require two-step verification for Administrators
                  </label>
                  <span className="v8-sub" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                    When enabled, all Super Admin and Admin accounts must enroll an authenticator
                    app before accessing ERP modules. Users without two-step will be guided directly
                    to setup.
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === 'sessions' && (
            <div style={{ display: 'grid', gap: 16, maxWidth: 540 }}>
              <div className="field">
                <label htmlFor="sec-idle-min">Idle Timeout (5–240 minutes)</label>
                <input
                  id="sec-idle-min"
                  type="number"
                  min={5}
                  max={240}
                  value={policy.idleMinutes}
                  disabled={!actions.edit}
                  onChange={(e) => setPolicy({ ...policy, idleMinutes: Number(e.target.value) })}
                  required
                />
                <span className="v8-sub" style={{ fontSize: 12 }}>
                  Inactivity limit before automatic sign-out. A warning appears 2 minutes prior.
                </span>
              </div>

              <div className="field">
                <label htmlFor="sec-abs-hours">Absolute Session Limit (1–72 hours)</label>
                <input
                  id="sec-abs-hours"
                  type="number"
                  min={1}
                  max={72}
                  value={policy.absoluteHours}
                  disabled={!actions.edit}
                  onChange={(e) => setPolicy({ ...policy, absoluteHours: Number(e.target.value) })}
                  required
                />
                <span className="v8-sub" style={{ fontSize: 12 }}>
                  Maximum total lifetime of a session family before re-authentication is required.
                </span>
              </div>

              <div className="field">
                <label htmlFor="sec-max-sessions">Max Concurrent Sessions per User (1–50)</label>
                <input
                  id="sec-max-sessions"
                  type="number"
                  min={1}
                  max={50}
                  value={policy.maxSessionsPerUser}
                  disabled={!actions.edit}
                  onChange={(e) =>
                    setPolicy({ ...policy, maxSessionsPerUser: Number(e.target.value) })
                  }
                  required
                />
                <span className="v8-sub" style={{ fontSize: 12 }}>
                  When this limit is reached, the oldest session family is signed out automatically.
                </span>
              </div>
            </div>
          )}

          {tab === 'ip' && (
            <div style={{ padding: '24px 0', maxWidth: 600 }}>
              <div
                style={{
                  padding: 16,
                  borderRadius: 4,
                  background: 'var(--subtle-bg, #f8f9fa)',
                  border: '1px solid var(--border)',
                }}
              >
                <h4 style={{ margin: '0 0 8px 0', fontSize: 15 }}>IP Restrictions</h4>
                <p className="v8-sub" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                  IP allow-listing is scheduled for Phase 20. Access is currently controlled per
                  account and protected by rate limiting and lockout policies.
                </p>
              </div>
            </div>
          )}

          {tab === 'events' && (
            <div style={{ maxWidth: 900 }}>
              <div
                style={{
                  marginBottom: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span className="v8-sub">Recent login & identity events</span>
                <a href="/m/admin-audit?preset=login_events" className="btn sm">
                  View full audit trail →
                </a>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Action</th>
                      <th scope="col">User</th>
                      <th scope="col">IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.map((evt) => (
                      <tr key={evt.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatIstDateTime(evt.at)}</td>
                        <td>
                          <code>{evt.action}</code>
                        </td>
                        <td>{evt.actorLoginId ?? evt.actorName ?? '—'}</td>
                        <td style={{ fontFamily: 'monospace' }}>{evt.ip ?? '—'}</td>
                      </tr>
                    ))}
                    {recentEvents.length === 0 && (
                      <tr className="empty-row">
                        <td colSpan={4}>No login events recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab !== 'ip' && tab !== 'events' && actions.edit ? (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button type="submit" className="btn primary" disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save Security Policy'}
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </>
  );
}
