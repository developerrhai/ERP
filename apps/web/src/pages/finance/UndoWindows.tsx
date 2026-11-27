// Taking back money entries from the screen: cancel a Cash / Bank Book entry, and undo an "Allocate" settlement.
// The buttons show only to people who hold the cancel right of that page; the server checks it again.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { toUiMessage } from '../../lib/errors';
import { cancelPayment, type BankAccount } from '../../lib/financeApi';
import { post } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import { usePagePermissions } from '../../lib/usePagePermissions';
import { dmy, ErrorBox, inrExact, Pill } from './shared';
import './finance-v40.css';

interface Allocated {
  id: string;
  date: string;
  party: string;
  creditNo: string;
  billNo: string;
  amount: string;
  madeBy: string;
}
interface BookEntry {
  id: string;
  number: string;
  version: number;
  kind: string;
  date: string;
  amount: string;
  mode: string;
  status: string;
  detail: string;
  apNumber: string | null;
  challanNo: string | null;
  allocated: Allocated[];
}

/** Asks why, then does it. One at a time: opening another one closes this. */
export function ReasonBox({ question, confirm, busy, onConfirm, onClose }: { question: string; confirm: string; busy: boolean; onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const short = reason.trim().length < 5;
  return (
    <section className="settle-box" aria-label={question}>
      <div className="field">
        <label htmlFor="undo-why">{question} *</label>
        <input id="undo-why" autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="actions">
        <button type="button" className="btn danger" disabled={busy || short} title={short ? 'Type a reason of at least 5 letters.' : undefined} onClick={() => onConfirm(reason.trim())}>
          {confirm}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Keep it
        </button>
      </div>
    </section>
  );
}

/** Runs one action at a time, shows what went wrong, and says what was done. */
function useAction(after: () => void) {
  const toast = useToast();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const run = (work: Promise<unknown>, done: string): void => {
    setMsg('');
    setBusy(true);
    work
      .then(() => {
        toast(done);
        after();
      })
      .catch((e: unknown) => setMsg(toUiMessage(e)))
      .finally(() => setBusy(false));
  };
  return { msg, busy, run, clear: () => setMsg('') };
}

const undo = (id: string, reason: string): Promise<unknown> => post(`/finance/allocations/${id}/undo`, { reason });

// ------------------------------------------------------------------------------------------------ allocations

export function UndoAllocationsButton({ side, onChanged }: { side: 'RECEIVABLE' | 'PAYABLE'; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const { actions } = usePagePermissions(side === 'RECEIVABLE' ? 'fin-ar' : 'fin-ap');
  if (!actions.cancel) return null;
  return (
    <>
      <button type="button" className="btn" title="Take back a settlement made with Allocate" onClick={() => setOpen(true)}>
        ↩ Undo an allocation
      </button>
      {open ? <AllocationsModal side={side} onClose={() => setOpen(false)} onChanged={onChanged} /> : null}
    </>
  );
}

function AllocationsModal({ side, onClose, onChanged }: { side: 'RECEIVABLE' | 'PAYABLE'; onClose: () => void; onChanged?: (() => void) | undefined }) {
  const data = useLoad(() => api<Allocated[]>(`/finance/allocations?side=${side}`), [side]);
  const [picked, setPicked] = useState<Allocated | null>(null);
  const action = useAction(() => {
    setPicked(null);
    data.reload();
    onChanged?.();
  });
  const rows = Array.isArray(data.data) ? data.data : [];
  return (
    <Modal
      title="Undo an allocation"
      sub="Settlements made with the Allocate button. Undoing one opens the bill and the advance or note again. Payments, receipts and set-offs are cancelled on their own."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={action.msg || data.error} />
      <div className="table-wrap proposal-list">
        <table aria-label="Allocations that can be undone">
          <thead>
            <tr>
              <th>Date</th>
              <th>Party</th>
              <th>Settled with</th>
              <th>On bill</th>
              <th className="num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {dmy(a.date)}
                  <br />
                  <small className="muted">{a.madeBy}</small>
                </td>
                <td>{a.party}</td>
                <td>{a.creditNo}</td>
                <td>{a.billNo}</td>
                <td className="num">{inrExact(a.amount)}</td>
                <td>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Undo ${a.creditNo} on ${a.billNo}`}
                    onClick={() => {
                      action.clear();
                      setPicked(a);
                    }}
                  >
                    Undo
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={6}>{data.loading ? 'Loading…' : 'No allocation to undo.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {picked ? (
        <ReasonBox
          key={picked.id}
          question={`Why undo ${inrExact(picked.amount)} on ${picked.billNo}?`}
          confirm="Undo allocation"
          busy={action.busy}
          onClose={() => setPicked(null)}
          onConfirm={(reason) => action.run(undo(picked.id, reason), `Allocation on ${picked.billNo} undone.`)}
        />
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ book entries

export function CancelEntriesButton({ cash, books, bookId, onChanged }: { cash: boolean; books: BankAccount[]; bookId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const bank = usePagePermissions('fin-bankbook').actions;
  const cashBook = usePagePermissions('fin-cashbook').actions;
  // the server asks for the Bank Book right on every entry, and the Cash Book right too on a cash one
  if (!bank.cancel || (cash && !cashBook.cancel) || books.length === 0) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        ✕ Cancel an entry
      </button>
      {open ? <EntriesModal books={books} bookId={bookId} onClose={() => setOpen(false)} onChanged={onChanged} /> : null}
    </>
  );
}

const KIND: Record<string, string> = { PAYMENT: 'Paid', RECEIPT: 'Received', TRANSFER: 'Transfer' };

function EntriesModal({ books, bookId, onClose, onChanged }: { books: BankAccount[]; bookId: string; onClose: () => void; onChanged: () => void }) {
  const [account, setAccount] = useState(bookId);
  const data = useLoad(() => api<BookEntry[]>(`/finance/payments/entries?bankAccountId=${account}`), [account]);
  // the allocation roles of the two ledgers: whether this person may also undo an "Allocate" listed here
  const payable = usePagePermissions('fin-ap').actions;
  const [cancelling, setCancelling] = useState<BookEntry | null>(null);
  const [undoing, setUndoing] = useState<Allocated | null>(null);
  const action = useAction(() => {
    setCancelling(null);
    setUndoing(null);
    data.reload();
    onChanged();
  });
  const rows = Array.isArray(data.data) ? data.data : [];
  const close = (): void => {
    setCancelling(null);
    setUndoing(null);
    action.clear();
  };
  return (
    <Modal
      title="Cancel an entry"
      sub="Cancelling posts the opposite entry in the books and opens the bills or expense claim it had paid. Receipts recorded against customer invoices are not listed here."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={action.msg || data.error} />
      <div className="field">
        <label htmlFor="ce-account">Account</label>
        <select
          id="ce-account"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            close();
          }}
        >
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap proposal-list">
        <table aria-label="Entries of this account">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Details</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.number}
                  <br />
                  <small className="muted">{dmy(p.date)}</small>
                </td>
                <td>
                  {KIND[p.kind] ?? p.kind} · {p.detail || '—'}
                  {p.allocated.map((a) => (
                    <div key={a.id}>
                      <small>
                        {inrExact(a.amount)} allocated to {a.billNo}
                      </small>{' '}
                      {payable.cancel ? (
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Undo ${a.creditNo} on ${a.billNo}`}
                          onClick={() => {
                            close();
                            setUndoing(a);
                          }}
                        >
                          Undo
                        </button>
                      ) : null}
                    </div>
                  ))}
                </td>
                <td className="num">{inrExact(p.amount)}</td>
                <td>
                  <Pill>{p.status}</Pill>
                </td>
                <td>
                  {p.status !== 'Posted' ? null : p.apNumber ? (
                    <small className="muted">Made in Accounts Payable ({p.apNumber}): cancel it there.</small>
                  ) : p.challanNo ? (
                    <small className="muted">Tax challan {p.challanNo}: it cannot be cancelled.</small>
                  ) : (
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={`Cancel ${p.number}`}
                      disabled={p.allocated.length > 0}
                      title={p.allocated.length > 0 ? 'Undo its allocations first.' : undefined}
                      onClick={() => {
                        close();
                        setCancelling(p);
                      }}
                    >
                      Cancel entry
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={5}>{data.loading ? 'Loading…' : 'No payment or transfer entry on this account.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {cancelling ? (
        <ReasonBox
          key={cancelling.id}
          question={`Why cancel ${cancelling.number} (${inrExact(cancelling.amount)})?`}
          confirm="Confirm cancel"
          busy={action.busy}
          onClose={close}
          onConfirm={(reason) => action.run(cancelPayment(cancelling.id, cancelling.version, reason), `${cancelling.number} cancelled.`)}
        />
      ) : null}
      {undoing ? (
        <ReasonBox
          key={undoing.id}
          question={`Why undo ${inrExact(undoing.amount)} on ${undoing.billNo}?`}
          confirm="Undo allocation"
          busy={action.busy}
          onClose={close}
          onConfirm={(reason) => action.run(undo(undoing.id, reason), `Allocation on ${undoing.billNo} undone.`)}
        />
      ) : null}
    </Modal>
  );
}
