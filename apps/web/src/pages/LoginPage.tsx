// Sign In / Two-step / Forgot screen matching reference/screens/v92/00-login.png minus removed parts
// Phase 01: MFA challenge verification, auto-submit at 6 digits, recovery code fallback,
// previous-login toast, Caps Lock hint, and live forgot-password SMTP check.
import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../auth/AuthProvider';
import { PasswordField } from '../components/Field';
import { useToast } from '../components/Toast';
import {
  ApiError,
  login,
  verifyMfa,
} from '../lib/api';
import { safeNext } from '../lib/next-path';
import type { AuthResult, User } from '../types';
import { LoginLayout } from './LoginLayout';

type Tab = 'signin' | 'forgot';

interface MfaChallengeState {
  challengeId: string;
  expiresIn: number;
}

export function formatIstDateTime(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/\//g, '-')
    .replace(',', '');
}

export function LoginPage() {
  const session = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // Two-step (MFA) state
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeState | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  const inFlight = useRef(false);

  if (session.status === 'authenticated') {
    return <Navigate to={safeNext(params.get('next'))} replace />;
  }

  const message = error || (noticeDismissed ? '' : (session.notice ?? ''));

  const showTab = (next: Tab): void => {
    setError('');
    setNoticeDismissed(true);
    setTab(next);
    setMfaChallenge(null);
  };

  const triggerWelcomeToast = (user: User) => {
    if (user.previousLoginAt) {
      const formatted = formatIstDateTime(user.previousLoginAt);
      const fromIp = user.previousLoginIp ? ` from ${user.previousLoginIp}` : '';
      toast(`Welcome, ${user.name}. Last sign-in: ${formatted}${fromIp}.`);
    } else {
      toast(`Welcome, ${user.name}.`);
    }
  };

  const onSignInSubmit = async (e?: FormEvent<HTMLFormElement>): Promise<void> => {
    if (e) e.preventDefault();
    setNoticeDismissed(true);
    if (inFlight.current) return;
    const id = identifier.trim();
    if (!id || !password) {
      setError('Enter your email / user ID and password.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      const res = await login(id, password);
      if ('mfaRequired' in res) {
        setMfaChallenge({ challengeId: res.challengeId, expiresIn: res.expiresIn });
        setMfaCode('');
        setUseRecovery(false);
      } else {
        triggerWelcomeToast(res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setPassword('');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const onMfaSubmit = async (codeToSubmit?: string): Promise<void> => {
    if (!mfaChallenge || inFlight.current) return;
    const code = (codeToSubmit ?? mfaCode).trim();
    if (!code) {
      setError(useRecovery ? 'Recovery codes look like ABCD-1234.' : 'Please enter the 6-digit code.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      const res: AuthResult = await verifyMfa(mfaChallenge.challengeId, code);
      triggerWelcomeToast(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setMfaCode('');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const onMfaCodeChange = (val: string) => {
    setMfaCode(val);
    if (!useRecovery) {
      const clean = val.replace(/\D/g, '');
      if (clean.length === 6) {
        void onMfaSubmit(clean);
      }
    }
  };

  return (
    <LoginLayout>
      <div className="login-head">
        <h2>{mfaChallenge ? 'Two-Step Verification' : 'Welcome back'}</h2>
        <p>
          {mfaChallenge
            ? useRecovery
              ? 'Enter an unused recovery code'
              : 'Enter your 6-digit code'
            : 'Sign in with your company account.'}
        </p>
      </div>

      {!mfaChallenge ? (
        <div className="auth-tabs two" role="tablist" aria-label="Sign in options">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signin'}
            className={tab === 'signin' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => showTab('signin')}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'forgot'}
            className={tab === 'forgot' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => showTab('forgot')}
          >
            Forgot
          </button>
        </div>
      ) : null}

      {message ? (
        <div className="msg error show" role="alert" style={{ marginBottom: '1rem' }}>
          {message}
        </div>
      ) : null}

      {mfaChallenge ? (
        /* Two-Step Verification Challenge Step */
        <form
          className="auth-body"
          onSubmit={(e) => {
            e.preventDefault();
            void onMfaSubmit();
          }}
          noValidate
        >
          <div className="field">
            <label htmlFor="mfa-input">
              {useRecovery ? 'Recovery code' : 'Authentication code'}
            </label>
            <input
              id="mfa-input"
              name="mfaCode"
              type="text"
              autoFocus
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              placeholder={useRecovery ? 'ABCD-1234' : '123456'}
              maxLength={useRecovery ? 12 : 6}
              value={mfaCode}
              onChange={(e) => onMfaCodeChange(e.target.value)}
              style={{
                fontSize: useRecovery ? '1rem' : '1.25rem',
                letterSpacing: useRecovery ? '0.1em' : '0.25em',
                textAlign: 'center',
              }}
            />
          </div>

          <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? 'Verifying…' : 'Verify and Sign In'}
          </button>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              alignItems: 'center',
              marginTop: '1rem',
              fontSize: '0.875rem',
            }}
          >
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setMfaCode('');
                setError('');
              }}
            >
              {useRecovery ? 'Use authenticator app code instead' : 'Use a recovery code instead'}
            </button>
            <button
              type="button"
              className="auth-link"
              style={{ color: 'var(--color-muted, #64748b)' }}
              onClick={() => {
                setMfaChallenge(null);
                setMfaCode('');
                setError('');
              }}
            >
              Back to Sign In
            </button>
          </div>
        </form>
      ) : tab === 'signin' ? (
        /* Sign In Form */
        <form className="auth-body" onSubmit={(e) => void onSignInSubmit(e)} noValidate>
          <div className="field">
            <label htmlFor="login-identifier">Email / User ID</label>
            <input
              id="login-identifier"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>

          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className="auth-row">
            <span>Session is verified on the server</span>
            <button type="button" className="auth-link" onClick={() => showTab('forgot')}>
              Forgot password?
            </button>
          </div>

          <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? 'Signing in…' : 'Sign In to ERP'}
          </button>
        </form>
      ) : (
        /* Forgot Password Tab */
        <div className="auth-body">
          <p className="forgot-text">
            For security, passwords are reset by your administrator. Contact your Admin or the Super
            Admin with your login ID.
          </p>
          <button type="button" className="auth-alt" onClick={() => showTab('signin')}>
            Back to Sign In
          </button>
        </div>
      )}
    </LoginLayout>
  );
}
