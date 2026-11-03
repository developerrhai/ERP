// Typed-page action buttons (Post / Cancel / Dispatch / Receive …) from schema.actions, shown only
// for the statuses the action allows, plus the confirm modal that runs one with an Idempotency-Key.
import { useRef, useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { toUiError, type UiError } from '../../lib/errors';
import {
  newIdempotencyKey,
  runAction,
  type PageAction,
  type PageSchema,
  type RecordRow,
} from './engineApi';
import { actionVisible, confirmText } from './fieldModel';
import { PayloadDialog } from './kit/PayloadDialog';

export function actionsFor(
  schema: PageSchema,
  row: RecordRow,
  perms: Record<string, boolean>,
): PageAction[] {
  return schema.actions.filter(
    (a) =>
      (!a.allowedFrom?.length || a.allowedFrom.includes(row.status)) &&
      actionVisible(a, row.status, perms),
  );
}

export const ACTION_ICONS: Record<string, string> = {
  post: '✔',
  cancel: '✖',
  dispatch: '➤',
  receive: '⬇',
};

export function variantClass(variant: string | undefined): string {
  if (variant === 'primary') return 'btn primary';
  if (variant === 'danger') return 'btn danger';
  if (variant === 'success') return 'btn success';
  return 'btn';
}

export function ActionButtons({
  schema,
  row,
  small,
  perms,
  onAction,
}: {
  schema: PageSchema;
  row: RecordRow;
  perms: Record<string, boolean>;
  small?: boolean;
  onAction: (row: RecordRow, action: PageAction) => void;
}) {
  return (
    <>
      {actionsFor(schema, row, perms).map((a) => (
        <button
          key={a.key}
          type="button"
          className={`${variantClass(a.variant)}${small ? ' sm' : ''}`}
          aria-label={`${a.label} ${row.code}`}
          onClick={() => onAction(row, a)}
        >
          {ACTION_ICONS[a.key] ? <span aria-hidden="true">{ACTION_ICONS[a.key]} </span> : null}
          {a.label}
        </button>
      ))}
    </>
  );
}

export function ActionConfirmModal({
  schema,
  row,
  action,
  onClose,
  onDone,
}: {
  schema: PageSchema;
  row: RecordRow;
  action: PageAction;
  onClose: () => void;
  onDone: (row: RecordRow) => void;
}) {
  const [error, setError] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  // One key per opened dialog: a retry after a network error replays the same request.
  const key = useRef(newIdempotencyKey());

  if (action.payloadFields && action.payloadFields.length > 0) {
    return (
      <PayloadDialog
        title={`${action.label} ${row.code}`}
        fields={action.payloadFields}
        confirmText={action.label}
        onClose={onClose}
        onSubmit={async (payload) => {
          const res = await runAction(schema.pageId, row.id, action.key, key.current, payload);
          onDone(res);
        }}
      />
    );
  }

  const run = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      onDone(await runAction(schema.pageId, row.id, action.key, key.current));
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      size="sm"
      title={`${action.label} ${row.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={variantClass(action.variant === 'danger' ? 'danger' : 'primary')}
            disabled={pending}
            onClick={() => void run()}
          >
            {pending ? 'Working…' : action.label}
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{error.message}</ErrorMessage> : null}
      <p className="confirm-text">
        {confirmText(action, row.code) ?? `${action.label} ${row.code}?`}
      </p>
    </Modal>
  );
}
