import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../auth/AuthProvider';
import { ApiError, login } from '../lib/api';
import { safeNext } from '../lib/next-path';
import { LoginLayout } from './LoginLayout';

const DEPARTMENTS = [
  'Administration',
  'Sales',
  'Purchase',
  'Finance',
  'HR',
  'Production',
  'Quality',
  'Maintenance',
  'Warehouse',
  'Projects',
  'Service',
] as const;

type Tab = 'signin' | 'signup' | 'forgot';

export function LoginPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('signin');
  const [companyCode, setCompanyCode] = useState('SG');
  const [department, setDepartment] = useState<string>('Administration');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const inFlight = useRef(false);

  // Sign Up form state
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suRole, setSuRole] = useState('Employee');

  // Forgot state
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState('admin@sawant.local');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  if (session.status === 'authenticated') {
    return <Navigate to={safeNext(params.get('next'))} replace />;
  }

  const message = error || (noticeDismissed ? '' : (session.notice ?? ''));

  const showTab = (next: Tab): void => {
    setError('');
    setNoticeDismissed(true);
    setTab(next);
  };

  const handleDepartmentChange = (dept: string) => {
    setDepartment(dept);
    if (dept === 'Administration') {
      setIdentifier('admin');
      setPassword('Admin@123456');
    } else {
      setIdentifier(dept.toLowerCase());
      setPassword('Demo@123456');
    }
  };

  const executeLogin = async (id: string, pass: string): Promise<void> => {
    if (inFlight.current) return;
    const trimmedId = id.trim();
    if (!trimmedId || !pass) {
      setError('Enter your email / user ID and password.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      await login(trimmedId, pass);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid login credentials.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setNoticeDismissed(true);
    await executeLogin(identifier, password);
  };

  const handleQuickLogin = (dept: string) => {
    setNoticeDismissed(true);
    setDepartment(dept);
    const id = dept === 'Administration' ? 'admin' : dept.toLowerCase();
    const pass = dept === 'Administration' ? 'Admin@123456' : 'Demo@123456';
    setIdentifier(id);
    setPassword(pass);
    void executeLogin(id, pass);
  };

  const handleSuperUserLogin = () => {
    setNoticeDismissed(true);
    setDepartment('Administration');
    setIdentifier('owner');
    setPassword('Admin@123456');
    void executeLogin('owner', 'Admin@123456');
  };

  return (
    <LoginLayout>
      <div className="login-head">
        <h2 id="authTitle">Welcome back</h2>
        <p id="authSub">Sign in with your department account.</p>
      </div>

      <div className="auth-tabs" role="tablist" aria-label="Sign in options">
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
          aria-selected={tab === 'signup'}
          className={tab === 'signup' ? 'auth-tab active' : 'auth-tab'}
          onClick={() => showTab('signup')}
        >
          Sign Up
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
        <div className="msg error show" role="alert" style={{ margin: '10px 20px 0' }}>
          {message}
        </div>
      ) : null}

      {tab === 'signin' && (
        <form className="auth-body" id="signInBody" onSubmit={(e) => void onSubmit(e)} noValidate>
          <div className="field">
            <label htmlFor="loginCompany">Company Code</label>
            <input
              id="loginCompany"
              name="company"
              value={companyCode}
              onChange={(e) => setCompanyCode(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="loginDepartment">Department</label>
            <select
              id="loginDepartment"
              name="department"
              value={department}
              onChange={(e) => handleDepartmentChange(e.target.value)}
            >
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="loginEmail">Email / User ID</label>
            <input
              id="loginEmail"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="loginPassword">Password</label>
            <div className="pass">
              <input
                id="loginPassword"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="showpass"
                id="showLoginPass"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="auth-row">
            <span>Department is verified from User Master</span>
            <button type="button" className="auth-link" onClick={() => showTab('forgot')}>
              Forgot password?
            </button>
          </div>

          <button
            className="auth-submit"
            id="loginBtn"
            type="submit"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? 'Signing in…' : 'Sign In to ERP'}
          </button>

          <button
            type="button"
            className="auth-alt"
            id="demoBtn"
            onClick={handleSuperUserLogin}
            disabled={pending}
          >
            Open Demo ERP — Super User
          </button>

          <div className="demo">
            <b>Demo Accounts</b>
            <br />
            Admin: admin / Admin@123456
            <br />
            All other departments: &lt;department&gt; / Demo@123456
            <div className="quick-depts" id="quickDepts">
              {DEPARTMENTS.map((dept) => (
                <button
                  key={dept}
                  type="button"
                  onClick={() => handleQuickLogin(dept)}
                  disabled={pending}
                >
                  {dept}
                </button>
              ))}
            </div>
          </div>
        </form>
      )}

      {tab === 'signup' && (
        <div className="auth-body" id="signUpBody">
          <div className="field">
            <label>Full Name</label>
            <input
              value={suName}
              onChange={(e) => setSuName(e.target.value)}
              placeholder="e.g. Rahul Sharma"
            />
          </div>
          <div className="field">
            <label>Company</label>
            <input value="Sawant Group" readOnly style={{ background: '#f8fafc' }} />
          </div>
          <div className="field">
            <label>Company Code</label>
            <input value="SG" readOnly style={{ background: '#f8fafc' }} />
          </div>
          <div className="field">
            <label>Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Role</label>
            <select value={suRole} onChange={(e) => setSuRole(e.target.value)}>
              <option>Member</option>
              <option>Lead</option>
              <option>Manager</option>
              <option>Admin</option>
            </select>
          </div>
          <div className="field">
            <label>Email</label>
            <input
              value={suEmail}
              onChange={(e) => setSuEmail(e.target.value)}
              placeholder="user@sawant.local"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value="Demo@123456" readOnly style={{ background: '#f8fafc' }} />
          </div>
          <div className="msg info show" style={{ margin: '10px 0' }}>
            New accounts are provisioned via Administration &gt; Users in accordance with company
            policy.
          </div>
          <button
            type="button"
            className="auth-submit"
            id="signupBtn"
            onClick={() => showTab('signin')}
          >
            Create Local Account
          </button>
        </div>
      )}

      {tab === 'forgot' && (
        <div className="auth-body" id="forgotBody">
          {forgotStep === 1 ? (
            <div id="forgotStep1">
              <div className="field">
                <label>Registered Email</label>
                <input
                  id="forgotEmail"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                />
              </div>
              <p
                style={{
                  fontSize: '11px',
                  color: '#64748b',
                  margin: '8px 0 12px',
                  lineHeight: 1.5,
                }}
              >
                For security, passwords are reset by your administrator. Contact your Admin or the
                Super Admin with your login ID.
              </p>
              <button
                type="button"
                className="auth-submit"
                id="resetCodeBtn"
                onClick={() => setForgotStep(2)}
              >
                Generate Reset Code
              </button>
            </div>
          ) : (
            <div id="forgotStep2">
              <div className="demo">
                Offline reset code: <b>123456</b>
              </div>
              <div className="field">
                <label>Reset Code</label>
                <input
                  id="resetCode"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  placeholder="Enter 123456"
                />
              </div>
              <div className="field">
                <label>New Password</label>
                <input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="auth-submit"
                id="resetBtn"
                onClick={() => {
                  setError(
                    'Password reset instructions processed. Please sign in with your updated credentials.',
                  );
                  setTab('signin');
                }}
              >
                Reset Password
              </button>
            </div>
          )}
          <button
            type="button"
            className="auth-alt"
            style={{ marginTop: '10px' }}
            onClick={() => showTab('signin')}
          >
            Back to Sign In
          </button>
        </div>
      )}
    </LoginLayout>
  );
}
