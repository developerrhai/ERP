// Sign In / Forgot screen matching reference/screens/v92/00-login.png minus the removed parts
// (company code, department, sign-up, demo box). One request per submit, errors from the API.
import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../auth/AuthProvider';
import { PasswordField } from '../components/Field';
import { ApiError, login } from '../lib/api';
import { safeNext } from '../lib/next-path';
import { LoginLayout } from './LoginLayout';

type Tab = 'signin' | 'forgot';

export function LoginPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  // Why we are signed out (server unreachable, session ended) until the user acts.
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const inFlight = useRef(false);

  if (session.status === 'authenticated') {
    return <Navigate to={safeNext(params.get('next'))} replace />;
  }

  const message = error || (noticeDismissed ? '' : (session.notice ?? ''));

  const showTab = (next: Tab): void => {
    setError('');
    setNoticeDismissed(true);
    setTab(next);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setNoticeDismissed(true);
    // A ref, not state: two clicks in the same tick must never send two requests.
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
      await login(id, password);
      // The session store flips to authenticated; <Navigate> above takes over.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setPassword('');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <LoginLayout>
      <div className="login-head">
        <h2>Welcome back</h2>
        <p>Sign in with your company account.</p>
      </div>
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
      {message ? (
        <div className="msg error show" role="alert">
          {message}
        </div>
      ) : null}
      {tab === 'signin' ? (
        <form className="auth-body" onSubmit={(e) => void onSubmit(e)} noValidate>
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
