// Journal Entries (fin-journal): Draft -> Submit -> Post -> Reverse. A Draft can be saved unbalanced; the
// footer shows the difference live. Posted journals are never edited: use Reverse.
import { useRef, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import {
  createJournal,
  deleteJournal,
  getJournal,
  listAccounts,
  listDimension,
  fxRateOn,
  listFxRates,
  listJournals,
  postJournal,
  reverseJournal,
  submitJournal,
  updateJournal,
  type Account,
  type Dimension,
  type Journal,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { FxModal, RecurringModal } from './JournalExtras';
import { amt, dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from './shared';

const VOUCHERS = [
  'Journal',
  'Adjustment',
  'Provision',
  'Depreciation',
  'Bank Charges',
  'Opening',
  'Other',
] as const;
type Dialog =
  | { kind: 'form'; id?: string }
  | { kind: 'view'; id: string }
  | { kind: 'reverse'; item: Journal }
  | { kind: 'recurring' }
  | { kind: 'fx' }
  | null;

export function JournalsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useLoad(
    () =>
      listJournals({
        page,
        size: 20,
        ...(status ? { status } : {}),
        ...(search.trim() ? { q: search.trim() } : {}),
      }),
    [page, status, search],
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const done = (msg: string) => {
    setDialog(null);
    reload();
    toast(msg);
  };
  return (
    <>
      <PageHead
        title="Journal Entries"
        sub="Record a transaction that no other screen creates. Draft first; the number is given when you post."
      >
        <button type="button" className="btn" onClick={() => setDialog({ kind: 'fx' })}>
          Exchange rates
        </button>
        <button type="button" className="btn" onClick={() => setDialog({ kind: 'recurring' })}>
          Recurring
        </button>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'form' })}>
            ＋ New Journal
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error} />
      <div className="recordbar" style={{ marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search number, narration, reference…"
          aria-label="Search journals"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="Draft">Draft</option>
          <option value="Posted">Posted</option>
          <option value="Cancelled">Cancelled (reversed)</option>
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Date</th>
              <th scope="col">Type</th>
              <th scope="col">Narration</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount
              </th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((j) => (
              <tr key={j.id}>
                <td>
                  <strong>{j.code}</strong>
                </td>
                <td>{dmy(j.docDate)}</td>
                <td>{j.voucherType}</td>
                <td>{j.narration ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{inr(j.totalDebit)}</td>
                <td>
                  <Pill tone={j.status === 'Draft' ? j.postingStatus : j.status}>
                    {j.status === 'Draft'
                      ? j.postingStatus === 'Not Posted'
                        ? 'Draft'
                        : j.postingStatus
                      : j.status === 'Cancelled'
                        ? 'Reversed'
                        : j.status}
                  </Pill>
                </td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Open ${j.code}`}
                      onClick={() => setDialog({ kind: 'view', id: j.id })}
                    >
                      Open
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {loading && !data ? <Empty cols={7}>Loading…</Empty> : null}
            {data && data.rows.length === 0 ? (
              <Empty cols={7}>No journals yet. Click ＋ New Journal.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      {data ? <Pager page={page} size={20} total={data.meta.total} onPage={setPage} /> : null}
      {dialog?.kind === 'form' ? (
        <JournalForm
          {...(dialog.id ? { id: dialog.id } : {})}
          onClose={() => setDialog(null)}
          onSaved={(j) => done(`Journal saved as ${j.code}.`)}
        />
      ) : null}
      {dialog?.kind === 'view' ? (
        <JournalView
          id={dialog.id}
          actions={actions}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'form', id: dialog.id })}
          onChanged={(msg) => done(msg)}
          onReverse={(j) => setDialog({ kind: 'reverse', item: j })}
        />
      ) : null}
      {dialog?.kind === 'recurring' ? (
        <RecurringModal
          actions={actions}
          onClose={() => {
            setDialog(null);
            reload();
          }}
        />
      ) : null}
      {dialog?.kind === 'fx' ? (
        <FxModal canEdit={actions.edit} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'reverse' ? (
        <ReverseModal
          item={dialog.item}
          onClose={() => setDialog(null)}
          onDone={(c) => done(`Reversed with ${c}.`)}
        />
      ) : null}
    </>
  );
}

interface FormLine {
  accountId: string;
  debit: string;
  credit: string;
  costCenterId: string;
  narration: string;
  /** foreign currency (INR = the normal case) */
  cur: string;
  fc: string;
  rate: string;
  side: 'DR' | 'CR';
}

/** INR value of a foreign line, rounded half up to paise (the server does the same). */
const foreignBase = (l: FormLine): number =>
  Math.round(((Number(l.fc) || 0) * (Number(l.rate) || 0) + Number.EPSILON) * 100) / 100;
const debitOf = (l: FormLine): number =>
  l.cur !== 'INR' ? (l.side === 'DR' ? foreignBase(l) : 0) : Number(l.debit) || 0;
const creditOf = (l: FormLine): number =>
  l.cur !== 'INR' ? (l.side === 'CR' ? foreignBase(l) : 0) : Number(l.credit) || 0;
const blank = (): FormLine => ({
  accountId: '',
  debit: '',
  credit: '',
  costCenterId: '',
  narration: '',
  cur: 'INR',
  fc: '',
  rate: '',
  side: 'DR',
});

function JournalForm({
  id,
  onClose,
  onSaved,
}: {
  id?: string;
  onClose: () => void;
  onSaved: (j: Journal) => void;
}) {
  const ctx = useAppContext().data;
  const accounts = useLoad(() => listAccounts({ postable: true, size: 200 }), []);
  const centers = useLoad(() => listDimension('cost'), []);
  const existing = useLoad(() => (id ? getJournal(id) : Promise.resolve(null)), [id]);
  const fxRates = useLoad(listFxRates, []);
  const [docDate, setDocDate] = useState(todayIso());
  const [voucherType, setVoucherType] = useState<string>('Journal');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<FormLine[]>([blank(), blank()]);
  const [seeded, setSeeded] = useState(false);
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  if (existing.data && !seeded) {
    setSeeded(true);
    setDocDate(existing.data.docDate);
    setVoucherType(existing.data.voucherType);
    setNarration(existing.data.narration ?? '');
    setLines(
      existing.data.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.currencyCode && l.currencyCode !== 'INR' ? '' : Number(l.debit) ? l.debit : '',
        credit: l.currencyCode && l.currencyCode !== 'INR' ? '' : Number(l.credit) ? l.credit : '',
        costCenterId: l.costCenterId ?? '',
        narration: l.narration ?? '',
        cur: l.currencyCode ?? 'INR',
        fc: l.amountFc ?? '',
        rate:
          l.fxRate && l.currencyCode && l.currencyCode !== 'INR' ? String(Number(l.fxRate)) : '',
        side: Number(l.credit) > 0 ? 'CR' : 'DR',
      })),
    );
  }
  const dr = lines.reduce((s, l) => s + debitOf(l), 0);
  const cr = lines.reduce((s, l) => s + creditOf(l), 0);
  const currencies = Array.from(new Set((fxRates.data?.rows ?? []).map((r) => r.currencyCode)));
  const pickCurrency = (i: number, cur: string) => {
    setLine(i, { cur, ...(cur === 'INR' ? { fc: '', rate: '' } : {}) });
    if (cur !== 'INR') {
      void fxRateOn(cur, docDate).then((r) => {
        if (r) setLine(i, { rate: String(Number(r.rate)) });
      });
    }
  };
  const diff = Math.round((dr - cr) * 100) / 100;
  const setLine = (i: number, patch: Partial<FormLine>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const unitId = ctx?.current.unitId ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const f: Record<string, string> = {};
    if (!unitId) f.unitId = 'Choose a unit at the top of the screen first.';
    const used = lines.filter((l) => l.accountId || l.debit || l.credit || l.fc);
    used.forEach((l, i) => {
      if (!l.accountId) f[`lines.${i}.accountId`] = 'Choose an account.';
      if (l.cur !== 'INR') {
        if (!(Number(l.fc) > 0) || !(Number(l.rate) > 0))
          f[`lines.${i}.debit`] = 'Enter the foreign amount and the rate.';
      } else if (!(Number(l.debit) > 0) && !(Number(l.credit) > 0))
        f[`lines.${i}.debit`] = 'Enter a debit or a credit amount.';
      if (Number(l.debit) > 0 && Number(l.credit) > 0)
        f[`lines.${i}.debit`] = 'Use either Debit or Credit on a line, not both.';
    });
    if (used.length < 1) f.lines = 'Add at least one line.';
    if (Object.keys(f).length) {
      setErr({
        message: f.unitId ?? 'Please fix the highlighted lines.',
        fields: f,
        code: 'LOCAL',
      });
      return;
    }
    const body = {
      unitId,
      docDate,
      voucherType,
      ...(narration.trim() ? { narration: narration.trim() } : {}),
      lines: used.map((l) => ({
        accountId: l.accountId,
        debit: l.cur !== 'INR' ? '0' : l.debit || '0',
        credit: l.cur !== 'INR' ? '0' : l.credit || '0',
        ...(l.cur !== 'INR'
          ? { currencyCode: l.cur, amountFc: l.fc, fxRate: l.rate, side: l.side }
          : {}),
        ...(l.costCenterId ? { costCenterId: l.costCenterId } : {}),
        ...(l.narration.trim() ? { narration: l.narration.trim() } : {}),
      })),
    };
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      onSaved(
        id && existing.data
          ? await updateJournal(id, existing.data.version, body)
          : await createJournal(body),
      );
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const acct = (a: Account) => `${a.code} · ${a.name}`;
  const cc = (d: Dimension) => `${d.code} · ${d.name}`;
  return (
    <Modal
      title={id ? 'Edit journal' : 'New journal'}
      sub="Total debit must equal total credit before you can post."
      onClose={onClose}
      footer={
        <>
          <span className={Math.abs(diff) < 0.005 ? 'v8-sub' : 'field-error'} role="status">
            Debit {inr(dr)} · Credit {inr(cr)} ·{' '}
            {Math.abs(diff) < 0.005 ? 'Balanced' : `Difference ${inr(Math.abs(diff))}`}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="journal-form" className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save Draft'}
          </button>
        </>
      }
    >
      <form id="journal-form" onSubmit={(e) => void submit(e)} noValidate>
        <ErrorBox message={err?.message ?? ''} />
        <div className="grid2">
          <Field
            label="Date *"
            type="date"
            value={docDate}
            onChange={(e) => setDocDate(e.target.value)}
            error={err?.fields.docDate}
          />
          <SelectField label="Type" value={voucherType} onChange={setVoucherType}>
            {VOUCHERS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </SelectField>
        </div>
        <Field
          label="Narration"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          placeholder="Why this entry?"
        />
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Account *</th>
                <th scope="col">Cost centre</th>
                <th scope="col">Currency</th>
                <th scope="col">Debit</th>
                <th scope="col">Credit</th>
                <th scope="col" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select
                      aria-label={`Line ${i + 1} account`}
                      value={l.accountId}
                      onChange={(e) => setLine(i, { accountId: e.target.value })}
                      aria-invalid={err?.fields[`lines.${i}.accountId`] ? true : undefined}
                    >
                      <option value="">Choose…</option>
                      {(accounts.data?.rows ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {acct(a)}
                        </option>
                      ))}
                    </select>
                    {err?.fields[`lines.${i}.accountId`] ? (
                      <span className="field-error">{err.fields[`lines.${i}.accountId`]}</span>
                    ) : null}
                  </td>
                  <td>
                    <select
                      aria-label={`Line ${i + 1} cost centre`}
                      value={l.costCenterId}
                      onChange={(e) => setLine(i, { costCenterId: e.target.value })}
                    >
                      <option value="">—</option>
                      {(centers.data?.rows ?? [])
                        .filter((d) => !d.isGroup)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {cc(d)}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Line ${i + 1} currency`}
                      value={l.cur}
                      onChange={(e) => pickCurrency(i, e.target.value)}
                    >
                      <option value="INR">INR</option>
                      {currencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {l.cur !== 'INR' ? (
                      <div>
                        <input
                          aria-label={`Line ${i + 1} foreign amount`}
                          inputMode="decimal"
                          placeholder={`${l.cur} amount`}
                          value={l.fc}
                          onChange={(e) => setLine(i, { fc: e.target.value })}
                          style={{ width: 110 }}
                        />
                        <input
                          aria-label={`Line ${i + 1} rate`}
                          inputMode="decimal"
                          placeholder="Rate"
                          value={l.rate}
                          onChange={(e) => setLine(i, { rate: e.target.value })}
                          style={{ width: 80 }}
                        />
                        <select
                          aria-label={`Line ${i + 1} side`}
                          value={l.side}
                          onChange={(e) => setLine(i, { side: e.target.value as 'DR' | 'CR' })}
                        >
                          <option value="DR">Debit</option>
                          <option value="CR">Credit</option>
                        </select>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <input
                      aria-label={`Line ${i + 1} debit`}
                      inputMode="decimal"
                      readOnly={l.cur !== 'INR'}
                      value={l.cur !== 'INR' ? (debitOf(l) ? debitOf(l).toFixed(2) : '') : l.debit}
                      onChange={(e) =>
                        setLine(i, {
                          debit: e.target.value,
                          credit: e.target.value ? '' : l.credit,
                        })
                      }
                      style={{ textAlign: 'right' }}
                    />
                    {err?.fields[`lines.${i}.debit`] ? (
                      <span className="field-error">{err.fields[`lines.${i}.debit`]}</span>
                    ) : null}
                  </td>
                  <td>
                    <input
                      aria-label={`Line ${i + 1} credit`}
                      inputMode="decimal"
                      readOnly={l.cur !== 'INR'}
                      value={
                        l.cur !== 'INR' ? (creditOf(l) ? creditOf(l).toFixed(2) : '') : l.credit
                      }
                      onChange={(e) =>
                        setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })
                      }
                      style={{ textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    {lines.length > 2 ? (
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, blank()])}>
          ＋ Add line
        </button>
        <p className="v8-sub">
          Party accounts (customers, suppliers) need a bill number: enter those from the Accounts
          Receivable / Payable screens or ask Finance.
        </p>
      </form>
    </Modal>
  );
}

function JournalView({
  id,
  actions,
  onClose,
  onEdit,
  onChanged,
  onReverse,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (msg: string) => void;
  onReverse: (j: Journal) => void;
}) {
  const { data: j, loading, error, reload } = useLoad(() => getJournal(id), [id]);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const act = async (run: () => Promise<string>) => {
    setPending(true);
    setErr('');
    try {
      onChanged(await run());
    } catch (e) {
      setErr(toUiError(e).message);
      reload();
      setPending(false);
    }
  };
  const draft = j?.status === 'Draft';
  const canEdit = draft && ['Not Posted', 'Rejected'].includes(j?.postingStatus ?? '');
  return (
    <Modal
      title={j ? `Journal ${j.code}` : 'Journal'}
      sub={j ? `${dmy(j.docDate)} · ${j.voucherType}` : ''}
      onClose={onClose}
      footer={
        <>
          {canEdit && actions.delete ? (
            <button
              type="button"
              className="btn danger"
              disabled={pending}
              title="Delete this draft"
              onClick={() =>
                void act(async () => {
                  await deleteJournal(id);
                  return 'Draft deleted.';
                })
              }
            >
              Delete draft
            </button>
          ) : null}
          {canEdit && actions.edit ? (
            <button type="button" className="btn" disabled={pending} onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {canEdit && actions.submit && j ? (
            <button
              type="button"
              className="btn"
              disabled={pending}
              title="Check the journal and send it for approval if it is large"
              onClick={() =>
                void act(async () => {
                  const r = await submitJournal(id, j.version);
                  return r.needsApproval ? 'Sent for approval.' : 'Checked. Ready to post.';
                })
              }
            >
              Submit
            </button>
          ) : null}
          {canEdit && actions.post && j ? (
            <button
              type="button"
              className="btn primary"
              disabled={pending}
              title="Write this journal to the ledger"
              onClick={() =>
                void act(async () => {
                  const r = await postJournal(id, j.version);
                  return `Posted as ${r.code}.`;
                })
              }
            >
              Post
            </button>
          ) : null}
          {j?.status === 'Posted' && !j.reversalOfId && actions.cancel ? (
            <button
              type="button"
              className="btn danger"
              disabled={pending}
              onClick={() => onReverse(j)}
            >
              Reverse
            </button>
          ) : null}
          {j && !canEdit && j.status === 'Draft' ? (
            <span className="v8-sub">Waiting for approval — it posts when approved.</span>
          ) : null}
        </>
      }
    >
      <ErrorBox message={error || err} />
      {loading && !j ? <p className="v8-sub">Loading…</p> : null}
      {j ? (
        <>
          <p>{j.narration ?? 'No narration.'}</p>
          {j.warnings.length ? (
            <div className="notice" role="note">
              {j.warnings.map((w) => w.message).join(' ')}
            </div>
          ) : null}
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Debit
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Credit
                  </th>
                </tr>
              </thead>
              <tbody>
                {j.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.accountCode} · {l.accountName}
                    </td>
                    <td style={{ textAlign: 'right' }}>{amt(l.debit)}</td>
                    <td style={{ textAlign: 'right' }}>{amt(l.credit)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{inr(j.lines.reduce((s, l) => s + Number(l.debit), 0))}</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{inr(j.lines.reduce((s, l) => s + Number(l.credit), 0))}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function ReverseModal({
  item,
  onClose,
  onDone,
}: {
  item: Journal;
  onClose: () => void;
  onDone: (code: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal
      title={`Reverse ${item.code}`}
      sub="A mirror journal is posted. The original stays visible as Reversed."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending}
            onClick={() =>
              void (async () => {
                if (reason.trim().length < 5) {
                  setErr('Enter a reason of 5 to 300 characters.');
                  return;
                }
                setPending(true);
                try {
                  onDone((await reverseJournal(item.id, reason.trim())).code);
                } catch (e) {
                  setErr(toUiError(e).message);
                  setPending(false);
                }
              })()
            }
          >
            Reverse
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <Field
        label="Reason *"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this being reversed?"
      />
    </Modal>
  );
}
