// Cash Book (fin-cashbook) and Bank Book (fin-bankbook): the ledger of one cash / bank account with a running
// balance, plus "New payment / receipt / transfer". A payment is posted at once; undo = Cancel (a mirror journal).
import { useRef, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import {
  createBankAccount,
  createPayment,
  getBook,
  listAccounts,
  listBankAccounts,
  type BankAccount,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { amt, dmy, Empty, ErrorBox, inr, PageHead, todayIso } from './shared';
import { DateField } from '../../ui/components';

export function CashBankPage({ cash, actions }: { cash: boolean; actions: ActionSet }) {
  const toast = useToast();
  const title = cash ? 'Cash Book' : 'Bank Book';
  const books = useLoad(listBankAccounts, []);
  const mine = (books.data ?? []).filter((b) => (cash ? b.kind !== 'BANK' : b.kind === 'BANK'));
  const [bookId, setBookId] = useState('');
  const [from, setFrom] = useState(() => `${todayIso().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIso());
  const active = bookId || mine[0]?.id || '';
  const book = useLoad(
    () => (active ? getBook(active, from, to) : Promise.resolve(null)),
    [active, from, to],
  );
  const [dialog, setDialog] = useState<'pay' | 'account' | null>(null);
  const done = (msg: string) => {
    setDialog(null);
    book.reload();
    books.reload();
    toast(msg);
  };
  return (
    <>
      <PageHead
        title={title}
        sub={
          cash
            ? 'Every rupee in and out of your cash accounts, with the balance after each entry.'
            : 'Every rupee in and out of your bank accounts, with the balance after each entry.'
        }
      >
        {actions.add && mine.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => setDialog('pay')}>
            ＋ New Entry
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={books.error || book.error} />
      {books.data && mine.length === 0 ? (
        <div className="notice" role="note">
          No {cash ? 'cash' : 'bank'} account is set up yet.{' '}
          {actions.add ? (
            <button type="button" className="btn sm" onClick={() => setDialog('account')}>
              Set one up
            </button>
          ) : null}
        </div>
      ) : null}
      {mine.length > 0 ? (
        <div className="recordbar" style={{ marginBottom: 16 }}>
          <select aria-label="Account" value={active} onChange={(e) => setBookId(e.target.value)}>
            {mine.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <DateField
            aria-label="From date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <DateField
            aria-label="To date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      ) : null}
      {book.data ? (
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Opening</small>
              <b>{inr(book.data.opening)}</b>
            </div>
            <div className="kpi">
              <small>Received</small>
              <b>{inr(book.data.totalReceipts)}</b>
            </div>
            <div className="kpi">
              <small>Paid</small>
              <b>{inr(book.data.totalPayments)}</b>
            </div>
            <div className="kpi">
              <small>Closing</small>
              <b>{inr(book.data.closing)}</b>
            </div>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Voucher</th>
                  <th scope="col">Details</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Received
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Paid
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {book.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dmy(r.date)}</td>
                    <td>{r.voucherNo}</td>
                    <td>{r.narration ?? r.voucherType}</td>
                    <td style={{ textAlign: 'right' }}>{amt(r.receipt)}</td>
                    <td style={{ textAlign: 'right' }}>{amt(r.payment)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(r.balance)}</td>
                  </tr>
                ))}
                {book.data.rows.length === 0 ? (
                  <Empty cols={6}>No entries in this period.</Empty>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {dialog === 'pay' ? (
        <EntryForm
          books={mine}
          defaultBook={active}
          onClose={() => setDialog(null)}
          onSaved={(m) => done(m)}
        />
      ) : null}
      {dialog === 'account' ? (
        <AccountSetup
          cash={cash}
          onClose={() => setDialog(null)}
          onSaved={() => done('Account set up.')}
        />
      ) : null}
    </>
  );
}

function EntryForm({
  books,
  defaultBook,
  onClose,
  onSaved,
}: {
  books: BankAccount[];
  defaultBook: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [kind, setKind] = useState<'RECEIPT' | 'PAYMENT' | 'TRANSFER'>('RECEIPT');
  const [bankAccountId, setBank] = useState(defaultBook);
  const [toBank, setToBank] = useState('');
  const [counter, setCounter] = useState('');
  const [docDate, setDocDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('NEFT');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const accounts = useLoad(() => listAccounts({ postable: true, size: 200 }), []);
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const sel = books.find((b) => b.id === bankAccountId);
  const isCashBook = sel ? sel.kind !== 'BANK' : false;
  const effectiveMode = isCashBook ? 'Cash' : mode === 'Cash' ? 'NEFT' : mode;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const f: Record<string, string> = {};
    if (!(Number(amount) > 0)) f.amount = 'Enter an amount greater than 0.';
    if (!bankAccountId) f.bankAccountId = 'Choose the account.';
    if (kind === 'TRANSFER' && !toBank) f.toBankAccountId = 'Choose the account to transfer to.';
    if (kind !== 'TRANSFER' && !counter)
      f.counterAccountId = 'Choose the account for the other side.';
    if (Object.keys(f).length) {
      setErr({ message: '', fields: f, code: 'LOCAL' });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      const r = await createPayment({
        kind,
        docDate,
        bankAccountId,
        amount,
        mode: effectiveMode,
        ...(kind === 'TRANSFER' ? { toBankAccountId: toBank } : { counterAccountId: counter }),
        ...(reference.trim() ? { referenceNo: reference.trim() } : {}),
        ...(narration.trim() ? { narration: narration.trim() } : {}),
      });
      onSaved(`${r.code} posted.${r.warnings?.length ? ` ${r.warnings[0]?.message ?? ''}` : ''}`);
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      title="New entry"
      sub="Posted straight to the books. To undo, cancel it from the register."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="entry-form" className="btn primary" disabled={pending}>
            {pending ? 'Posting…' : 'Post'}
          </button>
        </>
      }
    >
      <form id="entry-form" onSubmit={(e) => void submit(e)} noValidate>
        <ErrorBox message={err?.message ?? ''} />
        <SelectField
          label="What happened? *"
          value={kind}
          onChange={(v) => setKind(v as typeof kind)}
        >
          <option value="RECEIPT">Money received</option>
          <option value="PAYMENT">Money paid</option>
          <option value="TRANSFER">Transfer between my accounts</option>
        </SelectField>
        <SelectField
          label={kind === 'TRANSFER' ? 'From account *' : 'Account *'}
          value={bankAccountId}
          onChange={setBank}
          error={err?.fields.bankAccountId}
        >
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
        {kind === 'TRANSFER' ? (
          <SelectField
            label="To account *"
            value={toBank}
            onChange={setToBank}
            error={err?.fields.toBankAccountId}
          >
            <option value="">Choose…</option>
            {books
              .filter((b) => b.id !== bankAccountId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </SelectField>
        ) : (
          <SelectField
            label={
              kind === 'RECEIPT'
                ? 'Received for (income / other account) *'
                : 'Paid for (expense / other account) *'
            }
            value={counter}
            onChange={setCounter}
            error={err?.fields.counterAccountId}
          >
            <option value="">Choose…</option>
            {(accounts.data?.rows ?? [])
              .filter((a) => !a.partyRequired)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
          </SelectField>
        )}
        <div className="grid2">
          <Field
            label="Date *"
            type="date"
            value={docDate}
            onChange={(e) => setDocDate(e.target.value)}
          />
          <Field
            label="Amount *"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={err?.fields.amount}
          />
        </div>
        {!isCashBook ? (
          <SelectField label="How *" value={effectiveMode} onChange={setMode}>
            {['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </SelectField>
        ) : null}
        <Field
          label="Reference (UTR / cheque no.)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Field label="Narration" value={narration} onChange={(e) => setNarration(e.target.value)} />
        <p className="v8-sub">
          Customer receipts are entered in Sales; supplier payments against bills are entered from
          Accounts Payable.
        </p>
      </form>
    </Modal>
  );
}

function AccountSetup({
  cash,
  onClose,
  onSaved,
}: {
  cash: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useAppContext().data;
  const accounts = useLoad(() => listAccounts({ postable: true, size: 200 }), []);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const options = (accounts.data?.rows ?? []).filter((a) =>
    cash ? a.subType === 'Cash' : a.subType === 'Bank',
  );
  return (
    <Modal
      title={cash ? 'Set up a cash account' : 'Set up a bank account'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              void (async () => {
                if (!accountId || name.trim().length < 2) {
                  setErr('Choose the ledger account and enter a name.');
                  return;
                }
                try {
                  await createBankAccount({
                    unitId: ctx?.current.unitId,
                    accountId,
                    kind: cash ? 'CASH' : 'BANK',
                    name: name.trim(),
                  });
                  onSaved();
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })()
            }
          >
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <SelectField label="Ledger account *" value={accountId} onChange={setAccountId}>
        <option value="">Choose…</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} · {a.name}
          </option>
        ))}
      </SelectField>
      <Field
        label="Name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={cash ? 'Petty cash — Talwade' : 'HDFC current account'}
      />
    </Modal>
  );
}
