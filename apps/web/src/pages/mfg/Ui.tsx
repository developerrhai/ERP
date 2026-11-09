// Shared pieces of the Phase 13 v2 screens: a plain table, an action button that calls the API and refreshes, and a details
// dialog shell. Business rules stay on the server; these only show what it returns and send what the person types.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import type { ReactNode } from 'react';

import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { Empty, ErrorBox } from '../finance/shared';

export interface Col<T> {
  h: string;
  r: (row: T) => ReactNode;
}

export function Grid<T>({
  cols,
  rows,
  loading,
  empty = 'No data yet.',
  rowKey,
}: {
  cols: Col<T>[];
  rows: T[];
  loading?: boolean;
  empty?: string;
  rowKey: (row: T) => string;
}) {
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.h}>{c.h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!loading && rows.length === 0 ? <Empty cols={cols.length}>{empty}</Empty> : null}
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {cols.map((c) => (
                <td key={c.h}>{c.r(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A button that runs one API call, says what happened, and refreshes the screen. A rule the server refuses is shown as is. */
export function Act({
  label,
  run,
  done,
  ok,
  primary,
  sure,
  disabled,
}: {
  label: string;
  run: () => Promise<unknown>;
  done?: () => void;
  ok?: string;
  primary?: boolean;
  sure?: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const go = () => {
    setAsking(false);
    setBusy(true);
    run()
      .then(() => {
        toast(ok ?? 'Done');
        done?.();
      })
      .catch((e: unknown) => toast(toUiError(e).message))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <button
        type="button"
        className={primary ? 'btn primary' : 'btn'}
        disabled={busy || disabled}
        onClick={() => (sure ? setAsking(true) : go())}
      >
        {label}
      </button>
      {asking ? (
        <Modal
          title="Please confirm"
          size="sm"
          onClose={() => setAsking(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAsking(false)}>
                No
              </button>
              <button type="button" className="btn primary" onClick={go}>
                Yes
              </button>
            </>
          }
        >
          <p>{sure}</p>
        </Modal>
      ) : null}
    </>
  );
}

/** A button that first asks for a reason in a small dialog, then runs the call with it. */
export function ReasonAct({
  label,
  question,
  run,
  done,
  ok,
}: {
  label: string;
  question: string;
  run: (reason: string) => Promise<unknown>;
  done?: () => void;
  ok?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <Modal
          title={label}
          size="sm"
          onClose={() => setOpen(false)}
          footer={
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => {
                if (!reason.trim()) {
                  setMsg('A reason is needed.');
                  return;
                }
                setBusy(true);
                setMsg('');
                run(reason.trim())
                  .then(() => {
                    toast(ok ?? 'Done');
                    setOpen(false);
                    setReason('');
                    done?.();
                  })
                  .catch((e: unknown) => setMsg(toUiError(e).message))
                  .finally(() => setBusy(false));
              }}
            >
              {label}
            </button>
          }
        >
          <ErrorBox message={msg} />
          <div className="field">
            <label htmlFor="reason-text">{question}</label>
            <textarea
              id="reason-text"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function Dialog({
  title,
  sub,
  onClose,
  error,
  children,
  footer,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  error?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal
      title={title}
      {...(sub ? { sub } : {})}
      onClose={onClose}
      footer={
        <>
          {footer}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <ErrorBox message={error ?? ''} />
      {children}
    </Modal>
  );
}

export const num = (v: unknown): string => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
};
export const hhmm = (iso: unknown): string =>
  typeof iso === 'string' && iso.length >= 16 ? iso.slice(0, 16).replace('T', ' ') : '—';
export const addDays = (iso: string, d: number): string => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};
