// Activate / Deactivate confirmation (a real modal, never window.confirm). Deactivating
// signs the user out of every session on the server.
import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import type { User } from '../../types';
import { updateUser, VERSION_CONFLICT_MESSAGE } from './usersApi';

interface Props {
  user: User;
  onClose: () => void;
  onSaved: (user: User) => void;
}

export function StatusConfirmModal({ user, onClose, onSaved }: Props) {
  const deactivate = user.status === 'ACTIVE';
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const confirm = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      const saved = await updateUser(user.id, user.version, {
        status: deactivate ? 'INACTIVE' : 'ACTIVE',
      });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === 'VERSION_CONFLICT' ? VERSION_CONFLICT_MESSAGE : err.message);
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
      title={deactivate ? 'Deactivate User' : 'Activate User'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={deactivate ? 'btn danger' : 'btn success'}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? 'Saving…' : deactivate ? 'Deactivate' : 'Activate'}
          </button>
        </>
      }
    >
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <p className="confirm-text">
        {deactivate
          ? `Deactivate ${user.name} (${user.loginId})? They will be signed out of every device and cannot sign in until reactivated.`
          : `Activate ${user.name} (${user.loginId})? They will be able to sign in again.`}
      </p>
    </Modal>
  );
}
