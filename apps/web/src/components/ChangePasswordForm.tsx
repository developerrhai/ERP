// Change-password form (current / new / confirm + live policy hints) shared by the forced
// first-login screen and the account drawer, so both enforce the same rules.
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, changePassword } from '../lib/api';
import { checkPassword } from '../lib/password-policy';
import type { User } from '../types';
import { PasswordField } from './Field';
import { PasswordHints } from './PasswordHints';

interface Props {
  user: User;
  submitLabel: string;
  submitClassName: string;
  onDone: () => void;
}

export function ChangePasswordForm({ user, submitLabel, submitClassName, onDone }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);

  const checks = checkPassword(next, user.loginId, user.email);
  const confirmOk = confirm.length > 0 && confirm === next;
  const canSubmit = current.length > 0 && checks.every((c) => c.ok) && confirmOk && !pending;

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    setFieldErrors({});
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields);
      } else {
        setError('Something went wrong.');
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <PasswordField
        label="Current password"
        autoComplete="current-password"
        value={current}
        error={fieldErrors.currentPassword}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <PasswordField
        label="New password"
        autoComplete="new-password"
        value={next}
        error={fieldErrors.newPassword}
        onChange={(e) => setNext(e.target.value)}
      />
      <PasswordHints checks={checks} />
      <PasswordField
        label="Confirm new password"
        autoComplete="new-password"
        value={confirm}
        error={confirm.length > 0 && !confirmOk ? 'Passwords do not match.' : undefined}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <button className={submitClassName} type="submit" disabled={!canSubmit} aria-busy={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
