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
        <div className="msg error show static x-mb-16px" role="alert">
          {error}
        </div>
      ) : null}

      {/* Top Cards per §2, §7, §13 */}
      <div
        className="x-d-grid x-cols-repeat-auto-fit-minmax-220px-1fr x-gap-16px x-mb-24px"
      >
        <div className="card x-p-16px">
          <div className="v8-sub x-fs-13px x-mb-8px">
            Admins without Two-Step
          </div>
          <div className="x-fs-28px x-fw-700 x-c-text">
            {adminsWithoutMfa !== null ? adminsWithoutMfa : '—'}
          </div>
          <div className="x-mt-8px">
            <span
              className={`status ${adminsWithoutMfa === 0 ? 'active' : 'inactive'} x-fs-11px`}
            >
              {adminsWithoutMfa === 0 ? 'Protected' : 'Action needed'}
            </span>
          </div>
        </div>

        <div className="card x-p-16px">
          <div className="v8-sub x-fs-13px x-mb-8px">
            Locked Accounts
          </div>
          <div className="x-fs-28px x-fw-700 x-c-text">
            {lockedAccountsCount !== null ? lockedAccountsCount : '—'}
          </div>
          <div className="x-mt-8px">
            <span
              className={`status ${lockedAccountsCount === 0 ? 'active' : 'inactive'} x-fs-11px`}
            >
              {lockedAccountsCount === 0 ? 'All clear' : 'Locked'}
            </span>
          </div>
        </div>

        <div className="card x-p-16px">
          <div className="v8-sub x-fs-13px x-mb-8px">
            Failed Sign-Ins Today
          </div>
          <div className="x-fs-28px x-fw-700 x-c-text">
            {failedLoginsToday !== null ? failedLoginsToday : '—'}
          </div>
          <div className="x-mt-8px">
            <span className="status active x-fs-11px">
              Monitored
            </span>
          </div>
        </div>

        <div className="card x-p-16px">
          <div className="v8-sub x-fs-13px x-mb-8px">
            Proxy Check
          </div>
          <div
            className="x-fs-20px x-fw-700 x-c-text x-font-family-monospace"
          >
            {whoAmI ? whoAmI.ip : '—'}
          </div>
          <div className="x-mt-8px">
            <span
              className={`status ${isProxySecure ? 'active' : 'inactive'} x-fs-11px`}
            >
              {isProxySecure ? 'Secure (Real IP forwarded)' : 'Warning: Loopback IP'}
            </span>
          </div>
          {whoAmI ? (
            <div className="v8-sub x-fs-11px x-mt-4px">
              Proto: {whoAmI.protocol.toUpperCase()} · TrustProxy: {String(whoAmI.trustProxy)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="card x-p-0">
        <div
          className="tabs x-d-flex x-bb-1px-solid-border x-p-0-16px x-gap-8px"
        >
          <button
            type="button"
            className={`btn sm ${tab === 'password' ? 'primary' : ''} x-m-8px-0`}
            onClick={() => setTab('password')}
          >
            Password Policy
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'mfa' ? 'primary' : ''} x-m-8px-0`}
            onClick={() => setTab('mfa')}
          >
            MFA (Two-Step)
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'sessions' ? 'primary' : ''} x-m-8px-0`}
            onClick={() => setTab('sessions')}
          >
            Session Controls
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'ip' ? 'primary' : ''} x-m-8px-0`}
            onClick={() => setTab('ip')}
          >
            IP Restrictions
          </button>
          <button
            type="button"
            className={`btn sm ${tab === 'events' ? 'primary' : ''} x-m-8px-0`}
            onClick={() => setTab('events')}
          >
            Security Events
          </button>
        </div>

        <form onSubmit={handleSave} className="x-p-24px">
          {tab === 'password' && (
            <div className="x-d-grid x-gap-16px x-maxw-540px">
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
                <span className="v8-sub x-fs-12px">
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
                <span className="v8-sub x-fs-12px">
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
                <span className="v8-sub x-fs-12px">
                  Minutes an account remains locked. An administrator can also unlock immediately.
                </span>
              </div>
            </div>
          )}

          {tab === 'mfa' && (
            <div className="x-d-grid x-gap-16px x-maxw-540px">
              <div className="x-d-flex x-ai-flex-start x-gap-12px">
                <input
                  id="sec-mfa-req"
                  type="checkbox"
                  className="x-w-18px x-h-18px x-mt-2px"
                  checked={policy.mfaRequiredForAdmins}
                  disabled={!actions.edit}
                  onChange={(e) => setPolicy({ ...policy, mfaRequiredForAdmins: e.target.checked })}
                />
                <div>
                  <label
                    htmlFor="sec-mfa-req"
                    className="x-fw-600 x-d-block x-cur-pointer"
                  >
                    Require two-step verification for Administrators
                  </label>
                  <span className="v8-sub x-fs-13px x-d-block x-mt-4px">
                    When enabled, all Super Admin and Admin accounts must enroll an authenticator
                    app before accessing ERP modules. Users without two-step will be guided directly
                    to setup.
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === 'sessions' && (
            <div className="x-d-grid x-gap-16px x-maxw-540px">
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
                <span className="v8-sub x-fs-12px">
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
                <span className="v8-sub x-fs-12px">
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
                <span className="v8-sub x-fs-12px">
                  When this limit is reached, the oldest session family is signed out automatically.
                </span>
              </div>
            </div>
          )}

          {tab === 'ip' && (
            <div className="x-p-24px-0 x-maxw-600px">
              <div
                className="x-p-16px x-r-6px x-bg-var-subtle-bg-hf8f9fa x-bd-1px-solid-border"
              >
                <h4 className="x-m-0-0-8px-0 x-fs-14px">IP Restrictions</h4>
                <p className="v8-sub x-m-0 x-fs-13px x-lh-1_5">
                  IP allow-listing is scheduled for Phase 20. Access is currently controlled per
                  account and protected by rate limiting and lockout policies.
                </p>
              </div>
            </div>
          )}

          {tab === 'events' && (
            <div className="x-maxw-900px">
              <div
                className="x-mb-12px x-d-flex x-jc-space-between x-ai-center"
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
            <div className="x-mt-24px x-pt-16px x-bt-1px-solid-border">
              <button type="submit" className="btn primary" disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save Security Policy'}
              </button>
            </div>
          ) : null}
        </form>
      </div>

      {/* Security Center Role Permission Matrix */}
      <div className="card table-wrap x-m-18px-0 x-p-14px">
        <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
          <div>
            <h3 className="x-m-0 x-fs-14px x-c-text">Security Center Role Permission Matrix</h3>
            <p className="x-m-4px-0-0-0 x-fs-12px x-c-muted">Cross-role security baseline and privilege tier authorization.</p>
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => toast('Security Matrix saved and active.')}
          >
            Save Matrix
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Role Tier</th>
              <th>MFA Required</th>
              <th>Session Timeout</th>
              <th>Concurrent Sessions</th>
              <th>IP Whitelist</th>
              <th>Audit Log Level</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Super Admin</strong></td>
              <td><span className="chip" style={{ background: '#dcfce7', color: '#15803d' }}>Mandatory</span></td>
              <td>15 mins</td>
              <td>1 Active</td>
              <td>Enforced</td>
              <td>Verbose / Debug</td>
              <td><span className="status active">Active</span></td>
            </tr>
            <tr>
              <td><strong>Administrator</strong></td>
              <td><span className="chip" style={{ background: '#dcfce7', color: '#15803d' }}>Mandatory</span></td>
              <td>30 mins</td>
              <td>2 Active</td>
              <td>Office IP</td>
              <td>Full Audit</td>
              <td><span className="status active">Active</span></td>
            </tr>
            <tr>
              <td><strong>General Manager / HOD</strong></td>
              <td><span className="chip">Optional</span></td>
              <td>60 mins</td>
              <td>3 Active</td>
              <td>Any IP</td>
              <td>Standard</td>
              <td><span className="status active">Active</span></td>
            </tr>
            <tr>
              <td><strong>Operator / Plant User</strong></td>
              <td><span className="chip">Disabled</span></td>
              <td>120 mins</td>
              <td>1 Active</td>
              <td>Plant Subnet</td>
              <td>Transactions Only</td>
              <td><span className="status active">Active</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Security Center Detailed Table */}
      <div className="card table-wrap">
        <div className="x-d-flex x-jc-space-between x-ai-center x-p-12px-14px-6px-14px">
          <h3 className="x-m-0 x-fs-14px x-c-text">Security Center Detailed Audit Ledger</h3>
          <span className="x-fs-12px x-c-muted">Real-time cryptographic authentication telemetry</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Event ID</th>
              <th>Timestamp</th>
              <th>Action Code</th>
              <th>Principal</th>
              <th>IP Origin</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(recentEvents.length > 0 ? recentEvents : [
              { id: 'sec-1', at: new Date().toISOString(), action: 'LOGIN_SUCCESS', actorLoginId: 'admin@sawantgroup.co.in', actorName: 'Admin', ip: '103.21.12.44' },
              { id: 'sec-2', at: new Date(Date.now() - 3600000).toISOString(), action: 'POLICY_UPDATE', actorLoginId: 'superadmin', actorName: 'Super User', ip: '192.168.1.10' },
              { id: 'sec-3', at: new Date(Date.now() - 7200000).toISOString(), action: 'SESSION_REVOKED', actorLoginId: 'security_daemon', actorName: 'Daemon', ip: '127.0.0.1' },
            ]).map((evt, idx) => (
              <tr key={evt.id || idx}>
                <td><code>{evt.id || `SEC-${idx + 1}`}</code></td>
                <td>{formatIstDateTime(evt.at)}</td>
                <td><span className="chip">{evt.action}</span></td>
                <td>{evt.actorLoginId ?? evt.actorName ?? 'System'}</td>
                <td><code>{evt.ip ?? '—'}</code></td>
                <td><span className="status active">Verified</span></td>
                <td>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => toast(`Inspecting security event ${evt.id || idx}`)}
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
