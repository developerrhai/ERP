// Financial Years (admin-fy, Phase 3 A1): Indian FYs (1 Apr – 31 Mar) with Add next FY, and
// Set current / Close / Reopen behind confirm modals; the current year cannot be closed.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { loadContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, FinancialYear } from '../../types';
import {
  createFinancialYear,
  listFinancialYears,
  nextFinancialYear,
  runFyCommand,
  type FyCommand,
} from './orgApi';

type Dialog = { kind: 'add' } | { kind: FyCommand; fy: FinancialYear } | null;

export const CLOSE_CURRENT_TITLE = 'Set another year as current before closing this one.';

const COMMAND_TEXT: Record<
  FyCommand,
  { verb: string; button: string; done: string; text: (l: string) => string }
> = {
  'set-current': {
    verb: 'Set current',
    button: 'Set current',
    done: 'is now the current financial year.',
    text: (l) => `Make ${l} the current financial year? New documents default to it.`,
  },
  close: {
    verb: 'Close',
    button: 'Close year',
    done: 'is closed.',
    text: (l) => `Close ${l}? Postings into a closed year are blocked until it is reopened.`,
  },
  reopen: {
    verb: 'Reopen',
    button: 'Reopen year',
    done: 'is open again.',
    text: (l) => `Reopen ${l}? Postings into it become possible again.`,
  },
};

export function FinancialYearsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(listFinancialYears, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const canChange = actions.controls;
  const close = (): void => setDialog(null);
  const afterSave = (message: string): void => {
    close();
    reload();
    void loadContext(); // the top-bar FY select lists the years and their status
    toast(message);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Financial Years</h1>
          <p>Indian financial years (1 April – 31 March), the current year and year closing.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
          {canChange && data ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add Next FY
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">FY Code</th>
              <th scope="col">Financial Year</th>
              <th scope="col">Start Date</th>
              <th scope="col">End Date</th>
              <th scope="col">Current</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((fy) => {
              const open = fy.status === 'OPEN';
              return (
                <tr key={fy.id}>
                  <td>{fy.code}</td>
                  <td>{fy.label}</td>
                  <td>{formatDate(fy.startDate)}</td>
                  <td>{formatDate(fy.endDate)}</td>
                  <td>{fy.isCurrent ? <span className="chip">Current</span> : '—'}</td>
                  <td>
                    <span className={`status ${open ? 'active' : 'inactive'}`}>
                      {open ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td>
                    {canChange ? (
                      <div className="actions">
                        {!fy.isCurrent && open ? (
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={`Set ${fy.label} as current`}
                            onClick={() => setDialog({ kind: 'set-current', fy })}
                          >
                            Set current
                          </button>
                        ) : null}
                        {open ? (
                          <button
                            type="button"
                            className="btn sm danger"
                            aria-label={`Close ${fy.label}`}
                            disabled={fy.isCurrent}
                            title={fy.isCurrent ? CLOSE_CURRENT_TITLE : undefined}
                            onClick={() => setDialog({ kind: 'close', fy })}
                          >
                            Close
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn sm success"
                            aria-label={`Reopen ${fy.label}`}
                            onClick={() => setDialog({ kind: 'reopen', fy })}
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="v8-sub">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={7}>Loading…</td>
              </tr>
            ) : null}
            {data && data.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>No financial years yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'add' && data ? (
        <AddFyModal
          years={data}
          onClose={close}
          onSaved={(fy) => afterSave(`${fy.label} added.`)}
        />
      ) : null}
      {dialog && dialog.kind !== 'add' ? (
        <FyCommandModal
          fy={dialog.fy}
          command={dialog.kind}
          onClose={close}
          onReload={() => {
            close();
            reload();
          }}
          onDone={(fy) => afterSave(`${fy.label} ${COMMAND_TEXT[dialog.kind].done}`)}
        />
      ) : null}
    </>
  );
}

function AddFyModal({
  years,
  onClose,
  onSaved,
}: {
  years: FinancialYear[];
  onClose: () => void;
  onSaved: (fy: FinancialYear) => void;
}) {
  const next = nextFinancialYear(years);
  const [error, setError] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const save = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      onSaved(await createFinancialYear(next));
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const fieldErrors = error ? Object.values(error.fields).filter(Boolean) : [];
  return (
    <Modal
      size="sm"
      title="Add Next Financial Year"
      sub="Financial years follow each other without gaps: 1 April to 31 March."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() => void save()}
          >
            {pending ? 'Adding…' : `Add ${next.label}`}
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{[error.message, ...fieldErrors].join(' ')}</ErrorMessage> : null}
      <dl className="audit-kv">
        <div>
          <dt>FY Code</dt>
          <dd>{next.code}</dd>
        </div>
        <div>
          <dt>Financial Year</dt>
          <dd>{next.label}</dd>
        </div>
        <div>
          <dt>Start Date</dt>
          <dd>{formatDate(next.startDate)}</dd>
        </div>
        <div>
          <dt>End Date</dt>
          <dd>{formatDate(next.endDate)}</dd>
        </div>
      </dl>
    </Modal>
  );
}

function FyCommandModal({
  fy,
  command,
  onClose,
  onReload,
  onDone,
}: {
  fy: FinancialYear;
  command: FyCommand;
  onClose: () => void;
  onReload: () => void;
  onDone: (fy: FinancialYear) => void;
}) {
  const [error, setError] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const t = COMMAND_TEXT[command];

  const confirm = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      onDone(await runFyCommand(fy, command));
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
      title={`${t.verb} ${fy.label}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={command === 'close' ? 'btn danger' : 'btn primary'}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? 'Working…' : t.button}
          </button>
        </>
      }
    >
      {error ? (
        <ErrorMessage onReload={error.code === 'VERSION_CONFLICT' ? onReload : undefined}>
          {error.message}
        </ErrorMessage>
      ) : null}
      <p className="confirm-text">{t.text(fy.label)}</p>
    </Modal>
  );
}
