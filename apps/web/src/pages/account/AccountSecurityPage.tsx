// My Account → Security (/account/security) per Phase 01 §2, §7, §8:
// Change Password card, Two-step Verification wizard & status, and Devices table.
import { useEffect, useState, type FormEvent } from 'react';
import { PasswordChecklist } from '../../components/PasswordChecklist';
import { useToast } from '../../components/Toast';
import {
  ApiError,
  changePassword,
  disableMfa,
  enableMfa,
  getMfaStatus,
  getMySessions,
  regenerateRecoveryCodes,
  revokeMySession,
  revokeOtherSessions,
  setupMfa,
} from '../../lib/api';
import type { MfaStatus, SessionInfo, User } from '../../types';
import { formatIstDateTime } from '../LoginPage';

interface Props {
  user: User;
}

export function AccountSecurityPage({ user }: Props) {
  const toast = useToast();

  // Password Card state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwPending, setPwPending] = useState(false);
  const [pwError, setPwError] = useState('');

  // Two-Step Verification state
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaWizardStep, setMfaWizardStep] = useState<1 | 2 | 3 | null>(null);
  const [mfaCurrentPassword, setMfaCurrentPassword] = useState('');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedCodesChecked, setSavedCodesChecked] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaError, setMfaError] = useState('');

  // Disable / Regenerate modal state
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [actionPassword, setActionPassword] = useState('');
  const [actionCode, setActionCode] = useState('');
  const [actionError, setActionError] = useState('');

  // Devices Table state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const loadSessions = () => {
    setSessionsLoading(true);
    getMySessions()
      .then(setSessions)
      .catch(() => undefined)
      .finally(() => setSessionsLoading(false));
  };

  const loadStatus = () => {
    getMfaStatus()
      .then(setMfaStatus)
      .catch(() => undefined);
  };

  useEffect(() => {
    loadSessions();
    loadStatus();
  }, []);

  // Password Change handler
  const onPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 12) {
      setPwError('Password must be at least 12 characters.');
      return;
    }
    if (newPassword.length > 128) {
      setPwError('Password must be at most 128 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('The two passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setPwError('New password must be different from the current one.');
      return;
    }

    setPwPending(true);
    setPwError('');
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Password changed successfully.');
      loadSessions();
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Could not change password.');
    } finally {
      setPwPending(false);
    }
  };

  // Two-Step Wizard step 1: confirm password
  const onStartMfaSetup = async (e: FormEvent) => {
    e.preventDefault();
    setMfaPending(true);
    setMfaError('');
    try {
      const res = await setupMfa(mfaCurrentPassword);
      setQrCodeData(res.qrCode);
      setTotpSecret(res.secret);
      setMfaWizardStep(2);
    } catch (err) {
      setMfaError(err instanceof ApiError ? err.message : 'Current password is incorrect.');
    } finally {
      setMfaPending(false);
    }
  };

  // Two-Step Wizard step 2: verify 6-digit code
  const onVerifyMfaSetup = async (e: FormEvent) => {
    e.preventDefault();
    setMfaPending(true);
    setMfaError('');
    try {
      const res = await enableMfa(verifyCode);
      setRecoveryCodes(res.recoveryCodes);
      setMfaWizardStep(3);
      toast('Two-step verification turned on. Keep your recovery codes safe.');
      loadStatus();
      loadSessions();
    } catch (err) {
      setMfaError(err instanceof ApiError ? err.message : 'That code did not work. Check the time on your phone and try the newest code.');
    } finally {
      setMfaPending(false);
    }
  };

  // Download recovery codes as text file
  const downloadCodes = () => {
    const content = `Sawant Group ERP - Recovery Codes for ${user.loginId}\nGenerated on: ${new Date().toISOString()}\n\nEach code can be used once to sign in if you lose access to your authenticator app:\n\n${recoveryCodes.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `erp-recovery-codes-${user.loginId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Print recovery codes
  const printCodes = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html>
        <head><title>ERP Recovery Codes - ${user.loginId}</title></head>
        <body style="font-family: monospace; padding: 2rem;">
          <h2>Sawant Group ERP - Recovery Codes</h2>
          <p>Account: <b>${user.loginId}</b> (${user.name})</p>
          <p>Keep these 10 recovery codes in a safe place. Each code works once:</p>
          <pre style="font-size: 1.25rem; line-height: 2;">${recoveryCodes.join('\n')}</pre>
        </body>
      </html>
    `);
    win.document.close();
    win.print();
  };

  // Disable MFA
  const onDisableMfa = async (e: FormEvent) => {
    e.preventDefault();
    setActionError('');
    try {
      await disableMfa(actionPassword, actionCode);
      setShowDisableModal(false);
      setActionPassword('');
      setActionCode('');
      toast('Two-step verification has been turned off.');
      loadStatus();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not turn off two-step verification.');
    }
  };

  // Regenerate codes
  const onRegenCodes = async (e: FormEvent) => {
    e.preventDefault();
    setActionError('');
    try {
      const res = await regenerateRecoveryCodes(actionPassword, actionCode);
      setShowRegenModal(false);
      setActionPassword('');
      setActionCode('');
      setRecoveryCodes(res.recoveryCodes);
      setMfaWizardStep(3);
      toast('New recovery codes generated.');
      loadStatus();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not regenerate recovery codes.');
    }
  };

  // Sign out a single device
  const onSignOutDevice = async (familyId: string) => {
    try {
      await revokeMySession(familyId);
      toast('Device signed out.');
      loadSessions();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not sign out device.');
    }
  };

  // Sign out all other devices
  const onSignOutOthers = async () => {
    try {
      const res = await revokeOtherSessions();
      toast(`Signed out of ${res.revoked} other device${res.revoked === 1 ? '' : 's'}.`);
      loadSessions();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not sign out other devices.');
    }
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div className="page-head" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1>Account Security</h1>
          <p>Manage your password, two-step verification and signed-in devices.</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* CARD 1: Password */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Change Password</h2>
          <p style={{ color: 'var(--color-muted, #64748b)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            Choose a unique phrase of at least 12 characters that you do not use anywhere else.
          </p>

          {pwError ? (
            <div className="msg error show" role="alert" style={{ marginBottom: '1rem' }}>
              {pwError}
            </div>
          ) : null}

          <form onSubmit={(e) => void onPasswordSubmit(e)} style={{ maxWidth: '420px' }}>
            <div className="field">
              <label htmlFor="current-pw">Current Password</label>
              <input
                id="current-pw"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="new-pw">New Password</label>
              <input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-pw">Confirm New Password</label>
              <input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <PasswordChecklist
              password={newPassword}
              confirmPassword={confirmPassword}
              contextWords={[user.name, user.loginId, user.email ?? '']}
            />

            <button
              type="submit"
              className="btn primary"
              disabled={pwPending || newPassword.length < 12 || newPassword !== confirmPassword}
              style={{ marginTop: '1.25rem' }}
            >
              {pwPending ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>

        {/* CARD 2: Two-Step Verification */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Two-Step Verification (MFA)</h2>
              <p style={{ color: 'var(--color-muted, #64748b)', fontSize: '0.875rem' }}>
                Protect your account with a 6-digit code from Google Authenticator or Microsoft Authenticator.
              </p>
            </div>
            {mfaStatus?.enabled ? (
              <span
                style={{
                  backgroundColor: '#dcfce7',
                  color: '#15803d',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '9999px',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                }}
              >
                Active
              </span>
            ) : null}
          </div>

          {mfaStatus?.required ? (
            <div
              style={{
                backgroundColor: '#eff6ff',
                color: '#1d4ed8',
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                marginTop: '1rem',
                fontSize: '0.875rem',
              }}
            >
              ℹ Two-step verification is required for all administrators.
            </div>
          ) : null}

          {mfaWizardStep === null ? (
            /* Idle state: show status & actions */
            <div style={{ marginTop: '1.25rem' }}>
              {mfaStatus?.enabled ? (
                <div>
                  <p style={{ fontSize: '0.9375rem', marginBottom: '0.5rem' }}>
                    Recovery codes remaining: <b>{mfaStatus.recoveryCodesRemaining} of 10</b>
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setShowRegenModal(true)}
                    >
                      Regenerate Recovery Codes
                    </button>
                    {!mfaStatus.required ? (
                      <button
                        type="button"
                        className="btn danger"
                        onClick={() => setShowDisableModal(true)}
                      >
                        Turn Off Two-Step
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setMfaWizardStep(1)}
                >
                  Turn On Two-Step Verification
                </button>
              )}
            </div>
          ) : mfaWizardStep === 1 ? (
            /* Wizard Step 1: Confirm Password */
            <form onSubmit={(e) => void onStartMfaSetup(e)} style={{ maxWidth: '420px', marginTop: '1.25rem' }}>
              <p style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
                Step 1 of 3: Enter your current password to begin.
              </p>
              {mfaError ? <div className="msg error show" style={{ marginBottom: '1rem' }}>{mfaError}</div> : null}
              <div className="field">
                <label htmlFor="mfa-pw">Current Password</label>
                <input
                  id="mfa-pw"
                  type="password"
                  autoFocus
                  value={mfaCurrentPassword}
                  onChange={(e) => setMfaCurrentPassword(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="submit" className="btn primary" disabled={mfaPending || !mfaCurrentPassword}>
                  {mfaPending ? 'Checking…' : 'Continue'}
                </button>
                <button type="button" className="btn secondary" onClick={() => setMfaWizardStep(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : mfaWizardStep === 2 ? (
            /* Wizard Step 2: Scan QR & Enter 6-digit Code */
            <form onSubmit={(e) => void onVerifyMfaSetup(e)} style={{ maxWidth: '420px', marginTop: '1.25rem' }}>
              <p style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
                Step 2 of 3: Scan this QR code with your phone&apos;s Authenticator app, then enter the 6-digit code.
              </p>
              {mfaError ? <div className="msg error show" style={{ marginBottom: '1rem' }}>{mfaError}</div> : null}

              {qrCodeData ? (
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <img src={qrCodeData} alt="TOTP QR Code" style={{ width: '180px', height: '180px', border: '1px solid #e2e8f0', borderRadius: '4px' }} />
                  {totpSecret ? (
                    <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem', wordBreak: 'break-all' }}>
                      Secret key: <code>{totpSecret}</code>
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="field">
                <label htmlFor="mfa-code-input">6-Digit Code</label>
                <input
                  id="mfa-code-input"
                  type="text"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.25em' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="submit" className="btn primary" disabled={mfaPending || verifyCode.length !== 6}>
                  {mfaPending ? 'Verifying…' : 'Verify & Enable'}
                </button>
                <button type="button" className="btn secondary" onClick={() => setMfaWizardStep(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            /* Wizard Step 3: Save Recovery Codes */
            <div style={{ maxWidth: '480px', marginTop: '1.25rem' }}>
              <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: '#16a34a', fontWeight: 600 }}>
                ✓ Step 3 of 3: Save your 10 single-use recovery codes.
              </p>
              <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1rem' }}>
                If you ever lose access to your phone, each recovery code can be used once to sign in. Store them safely.
              </p>

              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '1rem',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                  fontFamily: 'monospace',
                  fontSize: '1rem',
                  marginBottom: '1rem',
                }}
              >
                {recoveryCodes.map((code) => (
                  <div key={code}>{code}</div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button type="button" className="btn secondary" onClick={downloadCodes}>
                  📥 Download
                </button>
                <button type="button" className="btn secondary" onClick={printCodes}>
                  🖨 Print
                </button>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={savedCodesChecked}
                  onChange={(e) => setSavedCodesChecked(e.target.checked)}
                />
                I have saved these recovery codes in a safe place.
              </label>

              <button
                type="button"
                className="btn primary"
                disabled={!savedCodesChecked}
                onClick={() => {
                  setMfaWizardStep(null);
                  setRecoveryCodes([]);
                  setSavedCodesChecked(false);
                }}
              >
                Finish
              </button>
            </div>
          )}
        </div>

        {/* CARD 3: Devices Table */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>My Signed-In Devices</h2>
              <p style={{ color: 'var(--color-muted, #64748b)', fontSize: '0.875rem' }}>
                All devices currently signed into your account.
              </p>
            </div>
            {sessions.length > 1 ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => void onSignOutOthers()}
              >
                Sign out all other devices
              </button>
            ) : null}
          </div>

          <div className="v8-table-wrap">
            <table className="v8-table">
              <thead>
                <tr>
                  <th scope="col">Device / Browser</th>
                  <th scope="col">IP Address</th>
                  <th scope="col">Last Active</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.userAgent ?? 'Unknown Browser'}</div>
                      {s.isCurrent ? (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            backgroundColor: '#e0f2fe',
                            color: '#0369a1',
                            padding: '0.125rem 0.5rem',
                            borderRadius: '9999px',
                            fontWeight: 600,
                          }}
                        >
                          This device
                        </span>
                      ) : null}
                    </td>
                    <td>{s.ip ?? '—'}</td>
                    <td>{formatIstDateTime(s.lastUsedAt)}</td>
                    <td>
                      <span className={`status ${s.isLive ? 'active' : 'inactive'}`}>
                        {s.isLive ? 'Active' : 'Expired / Revoked'}
                      </span>
                    </td>
                    <td>
                      {!s.isCurrent ? (
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => void onSignOutDevice(s.familyId)}
                        >
                          Sign out
                        </button>
                      ) : (
                        <span style={{ color: 'var(--color-muted, #64748b)', fontSize: '0.8125rem' }}>Current</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!sessionsLoading && sessions.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={5}>No active devices found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Disable Modal */}
      {showDisableModal ? (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="card" style={{ maxWidth: '420px', width: '90%', padding: '1.5rem' }}>
            <h2>Turn Off Two-Step Verification</h2>
            <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
              Confirm your password and enter a 6-digit code to turn off two-step verification.
            </p>
            {actionError ? <div className="msg error show" style={{ marginBottom: '1rem' }}>{actionError}</div> : null}
            <form onSubmit={(e) => void onDisableMfa(e)}>
              <div className="field">
                <label htmlFor="dis-pw">Password</label>
                <input id="dis-pw" type="password" value={actionPassword} onChange={(e) => setActionPassword(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="dis-code">6-Digit Code</label>
                <input id="dis-code" type="text" maxLength={6} value={actionCode} onChange={(e) => setActionCode(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="submit" className="btn danger" disabled={!actionPassword || actionCode.length !== 6}>
                  Turn Off
                </button>
                <button type="button" className="btn secondary" onClick={() => { setShowDisableModal(false); setActionError(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Regenerate Modal */}
      {showRegenModal ? (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="card" style={{ maxWidth: '420px', width: '90%', padding: '1.5rem' }}>
            <h2>Regenerate Recovery Codes</h2>
            <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
              Generating new recovery codes will invalidate all existing ones.
            </p>
            {actionError ? <div className="msg error show" style={{ marginBottom: '1rem' }}>{actionError}</div> : null}
            <form onSubmit={(e) => void onRegenCodes(e)}>
              <div className="field">
                <label htmlFor="reg-pw">Password</label>
                <input id="reg-pw" type="password" value={actionPassword} onChange={(e) => setActionPassword(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="reg-code">6-Digit Code</label>
                <input id="reg-code" type="text" maxLength={6} value={actionCode} onChange={(e) => setActionCode(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="submit" className="btn primary" disabled={!actionPassword || actionCode.length !== 6}>
                  Regenerate
                </button>
                <button type="button" className="btn secondary" onClick={() => { setShowRegenModal(false); setActionError(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
