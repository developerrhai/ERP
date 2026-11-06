// Approve / Reject / Return / Withdraw buttons for one request, drawn only for the people the
// server says can act (request.can). Reject and Return ask for a reason (10+ characters), Approve
// asks to confirm, and every click carries an Idempotency-Key that survives a retry.
import { useRef, useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { toUiError } from '../../lib/errors';
import { decideRequest, inr, type ApprovalRequest, type Verb } from '../../lib/approvalsApi';

const TITLE: Record<Verb, string> = {
  approve: 'Approve',
  reject: 'Reject',
  return: 'Return for changes',
  withdraw: 'Withdraw',
};

export const MIN_REASON = 10;

export function DecisionButtons({
  request,
  small,
  onDone,
}: {
  request: ApprovalRequest;
  small?: boolean;
  onDone: (updated: ApprovalRequest, verb: Verb) => void;
}) {
  const [verb, setVerb] = useState<Verb | null>(null);
  const cls = small ? ' sm' : '';
  const { can } = request;
  if (!can.approve && !can.reject && !can.return && !can.withdraw) return null;
  return (
    <>
      {can.approve ? (
        <button
          type="button"
          className={`btn success${cls}`}
          aria-label={`Approve ${request.docCode}`}
          onClick={() => setVerb('approve')}
        >
          Approve
        </button>
      ) : null}
      {can.reject ? (
        <button
          type="button"
          className={`btn danger${cls}`}
          aria-label={`Reject ${request.docCode}`}
          onClick={() => setVerb('reject')}
        >
          Reject
        </button>
      ) : null}
      {can.return ? (
        <button
          type="button"
          className={`btn${cls}`}
          aria-label={`Return ${request.docCode}`}
          onClick={() => setVerb('return')}
        >
          Return
        </button>
      ) : null}
      {can.withdraw ? (
        <button
          type="button"
          className={`btn${cls}`}
          aria-label={`Withdraw ${request.docCode}`}
          onClick={() => setVerb('withdraw')}
        >
          Withdraw
        </button>
      ) : null}
      {verb ? (
        <DecisionDialog
          request={request}
          verb={verb}
          onClose={() => setVerb(null)}
          onDone={(updated) => {
            setVerb(null);
            onDone(updated, verb);
          }}
        />
      ) : null}
    </>
  );
}

function DecisionDialog({
  request,
  verb,
  onClose,
  onDone,
}: {
  request: ApprovalRequest;
  verb: Verb;
  onClose: () => void;
  onDone: (updated: ApprovalRequest) => void;
}) {
  const needsReason = verb === 'reject' || verb === 'return';
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  // One key per opened dialog: a retry after a network error replays the same request.
  const key = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  );

  const submit = async (): Promise<void> => {
    if (inFlight.current) return;
    if (needsReason && comment.trim().length < MIN_REASON) {
      setError('Please write a reason (at least 10 characters).');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      onDone(await decideRequest(request, verb, comment.trim(), key.current));
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      size="sm"
      title={`${TITLE[verb]} ${request.docCode}`}
      sub={`${request.moduleTitle} • ${inr(request.amount)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={verb === 'reject' ? 'btn danger' : 'btn primary'}
            disabled={pending}
            onClick={() => void submit()}
          >
            {pending ? 'Working…' : TITLE[verb]}
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {needsReason ? (
        <div className="field">
          <label htmlFor="decision-comment">Reason *</label>
          <textarea
            id="decision-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
          />
          <span className="v8-sub">At least 10 characters. The requester will see this.</span>
        </div>
      ) : verb === 'approve' ? (
        <p className="confirm-text">
          Approve level {request.currentLevel} of {request.totalLevels} for {request.docCode} (
          {inr(request.amount)})?
        </p>
      ) : (
        <p className="confirm-text">
          Take {request.docCode} back? It returns to Draft and you can edit it.
        </p>
      )}
    </Modal>
  );
}
