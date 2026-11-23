// Credit Notes (fin-creditnote, to a customer) and Debit Notes (fin-debitnote, to a supplier): corrections that
// involve no goods - discounts, finance charges, rate corrections. Goods returns come from Sales / Purchase.
import { FinV40 } from './FinV40';
import { useLayoutEffect, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError, toUiMessage, type UiError } from '../../lib/errors';
import {
  allocateNote,
  cancelNote,
  createNote,
  deleteNote,
  getNote,
  listAccounts,
  listCustomers,
  listNotes,
  noteSettlement,
  type NoteSettlement,
  listSuppliers,
  postNote,
  submitNote,
  type Note,
} from '../../lib/financeApi';
import { useAppContext } from '../../lib/context';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from './shared';
import type { FinRow } from './finV40Api';

export function NotesPage({ kind, actions }: { kind: 'CREDIT' | 'DEBIT'; actions: ActionSet }) {
  const toast = useToast();
  const credit = kind === 'CREDIT';
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useLoad(() => listNotes(kind, page), [kind, page]);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Note | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0); // bumps the V40 register after a change made here
  const [allocating, setAllocating] = useState<string | null>(null); // note id (or its open item id) being settled
  // the top bar's "＋ Add New" opens this page's own note form (a layout effect, so it runs before the frame's handler)
  const pageId = kind === 'CREDIT' ? 'fin-creditnote' : 'fin-debitnote';
  useLayoutEffect(() => {
    const onAdd = (e: Event) => {
      const ce = e as CustomEvent<{ pageId?: string; handled?: boolean }>;
      if (ce.detail?.pageId !== pageId || ce.detail.handled || !actions.add) return;
      ce.detail.handled = true;
      setAdding(true);
    };
    window.addEventListener('v40-add-record', onAdd);
    return () => window.removeEventListener('v40-add-record', onAdd);
  }, [pageId, actions.add]);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      if (msg) toast(msg);
      reload();
    } catch (e) {
      setErr(toUiMessage(e));
    }
  };
  /** The row buttons of the V40 register (TC-39): Submit, Post, Delete, Cancel note on the row the table shows. */
  const rowButtons = (r: FinRow, reloadRegister: () => void) => {
    const st = r.status;
    const withNote = (fn: (n: Note) => Promise<unknown>, msg: string) => () =>
      void act(async () => {
        await fn(await getNote(kind, r.id));
        reloadRegister();
      }, msg);
    return (
      <>
        {(st === 'Draft' || st === 'Rejected') && actions.submit ? (
          <button
            type="button"
            className="btn sm"
            title="Check the note and send it for approval if it is large"
            onClick={withNote(async (n) => {
              const out = await submitNote(kind, n.id, n.version);
              toast(out.needsApproval ? 'Sent for approval.' : 'Checked. Ready to post.');
            }, '')}
          >
            Submit
          </button>
        ) : null}
        {(st === 'Draft' || st === 'Approved') && actions.post ? (
          <button
            type="button"
            className="btn sm primary"
            title="Write this note to the books"
            onClick={withNote((n) => postNote(kind, n.id, n.version), 'Note posted.')}
          >
            Post
          </button>
        ) : null}
        {st === 'Draft' && actions.delete ? (
          <button
            type="button"
            className="btn sm danger"
            aria-label={`Delete note ${r.number}`}
            onClick={withNote((n) => deleteNote(kind, n.id), 'Draft deleted.')}
          >
            Delete
          </button>
        ) : null}
        {st === 'Posted' && actions.edit ? (
          <button
            type="button"
            className="btn sm"
            title="Set this note against a bill of the same party"
            onClick={() => setAllocating(r.id)}
          >
            Allocate
          </button>
        ) : null}
        {st === 'Posted' && actions.cancel ? (
          <button
            type="button"
            className="btn sm danger"
            onClick={() => void act(async () => setCancelling(await getNote(kind, r.id)), '')}
          >
            Cancel note
          </button>
        ) : null}
      </>
    );
  };
  return (
    <>
      <PageHead
        title={credit ? 'Credit Notes' : 'Debit Notes'}
        sub={
          credit
            ? 'Reduce (or add to) what a customer owes without a goods return: discounts, finance charges.'
            : 'Reduce (or add to) what you owe a supplier without a goods return: rate corrections, interest.'
        }
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            ＋ New {credit ? 'Credit' : 'Debit'} Note
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error || err} />
      <FinV40
        pageId={kind === 'CREDIT' ? 'fin-creditnote' : 'fin-debitnote'}
        actions={actions}
        reloadKey={tick}
        rowExtra={rowButtons}
        onAllocate={(docId) => setAllocating(docId)}
        fallback={
          <>
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Date</th>
                    <th scope="col">{credit ? 'Customer' : 'Supplier'}</th>
                    <th scope="col">Effect</th>
                    <th scope="col">Reason</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Amount
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((n) => (
                    <tr key={n.id}>
                      <td>
                        <strong>{n.code}</strong>
                      </td>
                      <td>{dmy(n.docDate)}</td>
                      <td>{n.partyName ?? '—'}</td>
                      <td>
                        {n.effect === 'REDUCE' ? 'Reduces the balance' : 'Adds to the balance'}
                      </td>
                      <td>{n.reason}</td>
                      <td style={{ textAlign: 'right' }}>{inr(n.amount)}</td>
                      <td>
                        <Pill>{n.status}</Pill>
                      </td>
                      <td>
                        <div className="actions">
                          {(n.status === 'Draft' || n.status === 'Rejected') && actions.submit ? (
                            <button
                              type="button"
                              className="btn sm"
                              title="Check the note and send it for approval if it is large"
                              onClick={() =>
                                void act(async () => {
                                  const r = await submitNote(kind, n.id, n.version);
                                  toast(
                                    r.needsApproval
                                      ? 'Sent for approval.'
                                      : 'Checked. Ready to post.',
                                  );
                                }, '')
                              }
                            >
                              Submit
                            </button>
                          ) : null}
                          {(n.status === 'Draft' || n.status === 'Approved') && actions.post ? (
                            <button
                              type="button"
                              className="btn sm primary"
                              title="Write this note to the books"
                              onClick={() =>
                                void act(() => postNote(kind, n.id, n.version), 'Note posted.')
                              }
                            >
                              Post
                            </button>
                          ) : null}
                          {n.status === 'Draft' && actions.delete ? (
                            <button
                              type="button"
                              className="btn sm danger"
                              aria-label={`Delete note ${n.code}`}
                              onClick={() =>
                                void act(() => deleteNote(kind, n.id), 'Draft deleted.')
                              }
                            >
                              Delete
                            </button>
                          ) : null}
                          {n.status === 'Posted' && actions.cancel ? (
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={() => setCancelling(n)}
                            >
                              Cancel note
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {loading && !data ? <Empty cols={8}>Loading…</Empty> : null}
                  {data && data.rows.length === 0 ? (
                    <Empty cols={8}>
                      No notes yet. Click ＋ New {credit ? 'Credit' : 'Debit'} Note.
                    </Empty>
                  ) : null}
                </tbody>
              </table>
            </div>
            {data ? <Pager page={page} size={20} total={data.meta.total} onPage={setPage} /> : null}
          </>
        }
      />
      {/* outside the FinV40 fallback: the V40 register does not draw the fallback, so the header button and the
          row buttons opened nothing (V40 40-case report TC-39) */}
      {adding ? (
        <NoteForm
          kind={kind}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
            setTick((n) => n + 1);
            toast('Note saved as Draft. Post it when it is right.');
          }}
        />
      ) : null}
      {allocating ? (
        <AllocateModal
          id={allocating}
          credit={credit}
          onClose={() => setAllocating(null)}
          onDone={() => {
            setAllocating(null);
            setTick((n) => n + 1);
            toast('Allocated.');
          }}
        />
      ) : null}
      {cancelling ? (
        <CancelModal
          note={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
            setTick((n) => n + 1);
            toast('Note cancelled.');
          }}
          kind={kind}
        />
      ) : null}
    </>
  );
}

function NoteForm({
  kind,
  onClose,
  onSaved,
}: {
  kind: 'CREDIT' | 'DEBIT';
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useAppContext().data;
  const credit = kind === 'CREDIT';
  const parties = useLoad(credit ? listCustomers : listSuppliers, [kind]);
  const accounts = useLoad(() => listAccounts({ postable: true }), []);
  const [partyId, setPartyId] = useState('');
  const [effect, setEffect] = useState<'REDUCE' | 'ADD'>('REDUCE');
  const [docDate, setDocDate] = useState(todayIso());
  const [counterAccountId, setCounter] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [against, setAgainst] = useState('');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (!ctx?.current.unitId) f.unitId = 'Choose a unit at the top of the screen first.';
    if (!partyId) f.partyId = credit ? 'Choose the customer.' : 'Choose the supplier.';
    if (!counterAccountId) f.counterAccountId = 'Choose the account.';
    if (!(Number(amount) > 0)) f.amount = 'Enter an amount greater than 0.';
    if (reason.trim().length < 5) f.reason = 'Give a reason of at least 5 characters.';
    if (Object.keys(f).length) {
      setErr({ message: f.unitId ?? '', fields: f, code: 'LOCAL' });
      return;
    }
    setPending(true);
    setErr(null);
    try {
      await createNote(kind, {
        effect,
        unitId: ctx?.current.unitId,
        partyId,
        docDate,
        counterAccountId,
        amount,
        reason: reason.trim(),
        ...(against.trim() ? { againstDocNo: against.trim() } : {}),
      });
      onSaved();
    } catch (caught) {
      setErr(toUiError(caught));
      setPending(false);
    }
  };
  return (
    <Modal
      title={`New ${credit ? 'credit' : 'debit'} note`}
      sub="Saved as a Draft first. Nothing reaches the books until you post it."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="note-form" className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save Draft'}
          </button>
        </>
      }
    >
      <form id="note-form" onSubmit={(e) => void submit(e)} noValidate>
        <ErrorBox message={err?.message ?? ''} />
        <SelectField
          label={`${credit ? 'Customer' : 'Supplier'} *`}
          value={partyId}
          onChange={setPartyId}
          error={err?.fields.partyId}
        >
          <option value="">Choose…</option>
          {(parties.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="What does this note do? *"
          value={effect}
          onChange={(v) => setEffect(v as 'REDUCE' | 'ADD')}
        >
          <option value="REDUCE">
            {credit
              ? 'Reduce what the customer owes (discount, allowance)'
              : 'Reduce what we owe the supplier (rate correction)'}
          </option>
          <option value="ADD">
            {credit
              ? 'Add to what the customer owes (finance charge, interest)'
              : 'Add to what we owe the supplier (interest charged)'}
          </option>
        </SelectField>
        <SelectField
          label="Other side of the entry *"
          value={counterAccountId}
          onChange={setCounter}
          error={err?.fields.counterAccountId}
        >
          <option value="">Choose an income or expense account…</option>
          {(accounts.data?.rows ?? [])
            .filter(
              (a) => !a.partyRequired && (a.rootType === 'Income' || a.rootType === 'Expense'),
            )
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
        </SelectField>
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
        <Field
          label="Reason *"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={err?.fields.reason}
          placeholder="Why is this note being raised?"
        />
        <Field
          label="Against invoice no."
          value={against}
          onChange={(e) => setAgainst(e.target.value)}
        />
      </form>
    </Modal>
  );
}

/** Set a posted credit / debit note against one open bill of the same party (V40 case TC-39: the Allocate button). */
function AllocateModal({
  id,
  credit,
  onClose,
  onDone,
}: {
  id: string;
  credit: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data, error } = useLoad<NoteSettlement>(() => noteSettlement(id), [id]);
  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const room = data?.creditItem ? Math.abs(Number(data.creditItem.outstanding)) : 0;
  const bill = data?.bills.find((b) => b.id === billId);
  const pick = (v: string) => {
    setBillId(v);
    const b = data?.bills.find((x) => x.id === v);
    if (b) setAmount(String(Math.min(room, Number(b.outstanding))));
  };
  const save = async () => {
    if (!data?.creditItem || !bill) return;
    if (!(Number(amount) > 0)) return setErr('Enter an amount greater than 0.');
    setPending(true);
    setErr('');
    try {
      await allocateNote({ sourceItemId: data.creditItem.id, targetItemId: bill.id, amount });
      onDone();
    } catch (e) {
      setErr(toUiMessage(e));
      setPending(false);
    }
  };
  return (
    <Modal
      title="Allocate note"
      sub={`Set this note against a ${credit ? 'customer invoice' : 'supplier bill'}.`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={pending || !bill} onClick={() => void save()}>
            Allocate
          </button>
        </>
      }
    >
      <ErrorBox message={error || err} />
      {!data && !error ? <p className="muted">Loading…</p> : null}
      {data && !data.creditItem ? (
        <p>This note has nothing open to allocate: it may add to the balance, or it is not posted yet.</p>
      ) : null}
      {data?.creditItem && Number(data.creditItem.outstanding) === 0 ? (
        <p>This note is fully allocated already.</p>
      ) : null}
      {data?.creditItem && room > 0 ? (
        <>
          <p>
            Open on this note: <b>{inr(String(room))}</b>
          </p>
          <SelectField label="Against bill *" value={billId} onChange={pick}>
            <option value="">{data.bills.length ? 'Choose a bill…' : 'No open bills for this party'}</option>
            {data.bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.docNo} · {dmy(b.dueDate ?? b.docDate)} · open {inr(b.outstanding)}
              </option>
            ))}
          </SelectField>
          <Field label="Amount *" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </>
      ) : null}
    </Modal>
  );
}

function CancelModal({
  note,
  kind,
  onClose,
  onDone,
}: {
  note: Note;
  kind: 'CREDIT' | 'DEBIT';
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal
      title={`Cancel ${note.code}`}
      sub="A mirror entry is posted; the note stays visible as Cancelled."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
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
                  await cancelNote(kind, note.id, note.version, reason.trim());
                  onDone();
                } catch (e) {
                  setErr(toUiError(e).message);
                  setPending(false);
                }
              })()
            }
          >
            Cancel note
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <Field label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
