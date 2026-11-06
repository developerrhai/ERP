// Reset Password page per Phase 01 §5 & §7:
// Receives token in URL fragment (#token=...), applies password policy with live checklist,
// and submits to POST /auth/password-reset/confirm.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { ApiError, confirmPasswordReset } from '../lib/api';
import { LoginLayout } from './LoginLayout';

export function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Read from fragment #token=...
    const hash = window.location.hash;
    const match = /(?:#|&)token=([^&]+)/.exec(hash);
    if (match?.[1]) {
      setToken(decodeURIComponent(match[1]));
    } else {
      // Fallback: check query param if any
      const searchParams = new URLSearchParams(window.location.search);
      const queryToken = searchParams.get('token');
      if (queryToken) setToken(queryToken);
    }
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) {
      setError('This reset link has expired or was already used. Ask for a new one.');
      return;
    }
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (newPassword.length > 128) {
      setError('Password must be at most 128 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    setError('');
    try {
      await confirmPasswordReset(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  };

  return (
    <LoginLayout>
      <div className="login-head">
        <h2>Reset Your Password</h2>
        <p>Set a new, secure password for your account.</p>
      </div>

      {error ? (
        <div className="msg error show" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      {!token ? (
        <div className="auth-body">
          <p style={{ color: 'var(--color-danger, #dc2626)', marginBottom: '1.25rem' }}>
            This reset link has expired or was already used. Ask for a new one.
          </p>
          <Link to="/login" className="btn primary" style={{ display: 'block', textAlign: 'center' }}>
            Back to Sign In
          </Link>
        </div>
      ) : success ? (
        <div className="auth-body">
          <div style={{ color: 'var(--color-success, #16a34a)', marginBottom: '1.25rem', fontWeight: 500 }}>
            ✓ Password changed successfully. You can now sign in with your new password.
          </div>
          <Link to="/login" className="btn primary" style={{ display: 'block', textAlign: 'center' }}>
            Sign In to ERP
          </Link>
        </div>
      ) : (
        <form className="auth-body" onSubmit={(e) => void onSubmit(e)} noValidate>
          <div className="field">
            <label htmlFor="reset-new-password">New Password</label>
            <input
              id="reset-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="reset-confirm-password">Confirm New Password</label>
            <input
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <PasswordChecklist password={newPassword} confirmPassword={confirmPassword} />

          <button
            className="auth-submit"
            type="submit"
            disabled={pending || newPassword.length < 12 || newPassword !== confirmPassword}
            aria-busy={pending}
            style={{ marginTop: '1.25rem' }}
          >
            {pending ? 'Saving…' : 'Set New Password'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link to="/login" className="auth-link" style={{ fontSize: '0.875rem' }}>
              Back to Sign In
            </Link>
          </div>
        </form>
      )}
    </LoginLayout>
  );
}
