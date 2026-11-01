// Admin "Reset Password" modal: sets a policy-compliant temporary password for another user
// (POST /users/:id/reset-password); the user must change it at next sign-in.
import { useRef, useState, type FormEvent } from 'react';
import { PasswordField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PasswordHints } from '../../components/PasswordHints';
import { ApiError } from '../../lib/api';
import { checkPassword } from '../../lib/password-policy';
import type { User } from '../../types';
import { resetUserPassword } from './usersApi';

interface Props {
  user: User;
  onClose: () => void;
  onDone: () => void;
}

export function ResetPasswordModal({ user, onClose, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const checks = checkPassword(password, user.loginId, user.email);
  const ok = checks.every((c) => c.ok);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (inFlight.current || !ok) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    setFieldError(undefined);
    try {
      await resetUserPassword(user.id, password);
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldError(err.fields.temporaryPassword);
      } else {
        setError('Something went wrong.');
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      size="sm"
      title="Reset Password"
      sub={`${user.name} (${user.loginId}) will be signed out everywhere and must set a new password.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="reset-pw-form"
            className="btn primary"
            disabled={!ok || pending}
          >
            {pending ? 'Saving…' : 'Reset Password'}
          </button>
        </>
      }
    >
      <form id="reset-pw-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {error ? (
          <div className="msg error show static" role="alert">
            {error}
          </div>
        ) : null}
        <PasswordField
          label="Temporary Password"
          value={password}
          autoComplete="new-password"
          error={fieldError}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordHints checks={checks} />
      </form>
    </Modal>
  );
}
