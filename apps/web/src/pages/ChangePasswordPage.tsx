// Forced "Set a new password" screen shown while user.mustChangePassword is true; the router
// renders nothing else until it succeeds (the API also blocks other endpoints, CONTRACT §6).
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useToast } from '../components/Toast';
import { logout } from '../lib/api';
import type { User } from '../types';
import { LoginLayout } from './LoginLayout';

export function ChangePasswordPage({ user }: { user: User }) {
  const toast = useToast();
  return (
    <LoginLayout>
      <div className="login-head">
        <h2>Set a new password</h2>
        <p>
          Signed in as <b>{user.loginId}</b>. Your password was issued by an administrator; choose
          your own to continue.
        </p>
      </div>
      <div className="auth-body">
        <ChangePasswordForm
          user={user}
          submitLabel="Save New Password"
          submitClassName="auth-submit"
          onDone={() => toast('Password changed. Other sessions were signed out.')}
        />
        <button type="button" className="auth-alt" onClick={() => void logout(toast)}>
          Sign Out
        </button>
      </div>
    </LoginLayout>
  );
}
