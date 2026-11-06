// "Reassign" for Administrators: hands the level that is waiting right now to another person, with a
// written reason. Super User / Administrator do not approve; they only unstick a request.
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { UserPicker, type PickedUser } from '../../components/UserPicker';
import { toUiError } from '../../lib/errors';
import { reassignStep, type ApprovalRequest } from '../../lib/approvalsApi';

export function ReassignControl({
  request,
  onDone,
}: {
  request: ApprovalRequest;
  onDone: (updated: ApprovalRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<PickedUser | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const step = request.steps.find((s) => s.status === 'PENDING');
  if (!step) return null;

  const save = async (): Promise<void> => {
    if (!user) {
      setError('Choose the person who should decide this level.');
      return;
    }
    if (reason.trim().length < 10) {
      setError('Please write a reason (at least 10 characters).');
      return;
    }
    setPending(true);
    setError('');
    try {
      const updated = await reassignStep(step.id, user.id, reason.trim());
      setOpen(false);
      onDone(updated);
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Reassign level {step.level}
      </button>
      {open ? (
        <Modal
          size="sm"
          title={`Reassign level ${step.level}`}
          sub={`${request.docCode} • ${step.approver}`}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={pending}
                onClick={() => void save()}
              >
                {pending ? 'Saving…' : 'Reassign'}
              </button>
            </>
          }
        >
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
          <UserPicker label="New approver" value={user} onChange={setUser} />
          <div className="field">
            <label htmlFor="reassign-reason">Reason *</label>
            <textarea
              id="reassign-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
