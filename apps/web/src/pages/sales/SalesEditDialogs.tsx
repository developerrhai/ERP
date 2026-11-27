// The "Edit" pop-ups of the Sales pages whose records are not a header + lines form (sales comparison report):
// stock reservation, delivery promise, posted receipt, draft invoice, and the customer's credit profile.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { listReservations, type Reservation } from '../../lib/inventoryApi';
import { requestCreditChange } from '../../lib/mastersApi';
import { getDoc, getJson, lookupCustomers, updateDoc, type Doc, type Option, type Row } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import { api } from '../../lib/api';
import { dmy, ErrorBox, inr, Pill } from '../finance/shared';
import { LookupCombo } from '../procurement/DocPage';

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v as string | number | boolean));

/** One pop-up frame: Cancel and a Save button that says why it is switched off. */
function EditModal(p: {
  title: string;
  sub?: string;
  error: string;
  blocked?: string | undefined;
  busy: boolean;
  saveLabel?: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
  size?: 'sm';
}) {
  return (
    <Modal
      title={p.title}
      {...(p.sub ? { sub: p.sub } : {})}
      {...(p.size ? { size: p.size } : {})}
      onClose={p.onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={p.onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={p.busy || Boolean(p.blocked)} title={p.blocked} onClick={p.onSave}>
            {p.busy ? 'Saving…' : (p.saveLabel ?? 'Save')}
          </button>
        </>
      }
    >
      <ErrorBox message={p.error} />
      {p.children}
    </Modal>
  );
}

/** Runs a save: field errors under the fields, anything else in the banner. */
function useSave(done: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = (work: () => Promise<string>): void => {
    setBusy(true);
    setError('');
    setFields({});
    work()
      .then((message) => {
        toast(message);
        done();
      })
      .catch((e: unknown) => {
        const u = toUiError(e);
        setFields(u.fields);
        setError(Object.values(u.fields).filter(Boolean).join(' ') || u.message);
      })
      .finally(() => setBusy(false));
  };
  return { busy, error, fields, run };
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | undefined; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <small className="muted">{hint}</small> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
const Fixed = ({ id, label, value }: { id: string; label: string; value: string }) => (
  <Field id={id} label={label}>
    <input id={id} value={value} readOnly disabled />
  </Field>
);

// ------------------------------------------------------------------------------------------ stock reservation
export function ReservationEdit({ code, id, onClose, onSaved }: { code: string; id: string; onClose: () => void; onSaved: () => void }) {
  const found = useLoad(async () => (await listReservations({ q: code, page: 1 })).rows.find((r) => r.id === id) ?? null, [code, id]);
  const [qty, setQty] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [until, setUntil] = useState('');
  const cur: Reservation | null | undefined = found.data;
  useEffect(() => {
    if (!cur) return;
    setQty(String(cur.requiredQty));
    setPriority(cur.priority);
    setUntil(cur.reservedUntil ?? '');
  }, [cur]);
  const { busy, error, fields, run } = useSave(onSaved);
  return (
    <EditModal
      title={`Edit ${code}`}
      sub="Change how much is needed, how urgent it is and how long the stock is kept."
      error={error || found.error || (cur === null ? 'This reservation could not be read.' : '')}
      busy={busy}
      blocked={!cur ? 'Loading the reservation…' : !(Number(qty) > 0) ? 'Type the quantity needed.' : undefined}
      onClose={onClose}
      onSave={() =>
        run(async () => {
          if (!cur) return '';
          await updateDoc('/inventory/reservations', id, cur.version, { requiredQty: Number(qty), priority, ...(until ? { reservedUntil: until } : {}) });
          return `Reservation ${code} saved.`;
        })
      }
    >
      <div className="form-grid">
        <Fixed id="re-item" label="Item" value={cur ? [cur.itemCode, cur.itemName].filter(Boolean).join(' · ') : ''} />
        <Fixed id="re-demand" label="Demand reference" value={s(cur?.demandRef)} />
        <Fixed id="re-reserved" label="Reserved now" value={cur ? String(cur.reservedQty) : ''} />
        <Fixed id="re-issued" label="Already issued" value={cur ? String(cur.fulfilledQty) : ''} />
        <Field id="re-qty" label="Required quantity *" error={fields.requiredQty} hint="Needing less gives the extra back to free stock.">
          <input id="re-qty" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field id="re-pri" label="Priority">
          <select id="re-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {['Critical', 'High', 'Medium', 'Low'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field id="re-until" label="Reserved until" error={fields.reservedUntil}>
          <input id="re-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      </div>
    </EditModal>
  );
}

// ------------------------------------------------------------------------------------------ delivery promise
interface DeliveryDoc {
  id: string;
  number: string;
  status: string;
  orderDate: string | null;
  deliveryDate: string | null;
  shipTo: string;
  version: number;
}
export function DeliveryEdit({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const found = useLoad(() => getJson<DeliveryDoc>(`/sales/delivery/${id}`), [id]);
  const cur = found.data;
  const [date, setDate] = useState('');
  const [shipTo, setShipTo] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!cur) return;
    setDate(cur.deliveryDate ?? '');
    setShipTo(cur.shipTo);
  }, [cur]);
  const { busy, error, fields, run } = useSave(onSaved);
  return (
    <EditModal
      title={cur ? `Edit delivery of ${cur.number}` : 'Edit delivery'}
      sub="Move the promise date or change the address. Quantities and prices stay on the sales order."
      error={error || found.error || ''}
      busy={busy}
      blocked={!cur ? 'Loading the order…' : !date ? 'Choose the promise date.' : reason.trim().length < 5 ? 'Write why it changes (at least 5 letters).' : undefined}
      onClose={onClose}
      onSave={() =>
        run(async () => {
          if (!cur) return '';
          await updateDoc('/sales/delivery', id, cur.version, { deliveryDate: date, shipTo: shipTo.trim(), reason: reason.trim() });
          return `Delivery of ${cur.number} saved.`;
        })
      }
    >
      <div className="form-grid">
        <Fixed id="dl-so" label="Sales order" value={cur?.number ?? ''} />
        <Fixed id="dl-od" label="Order date" value={cur?.orderDate ? dmy(cur.orderDate) : ''} />
        <Field id="dl-date" label="Promise date *" error={fields.deliveryDate}>
          <input id="dl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="dl-ship" label="Ship to">
          <input id="dl-ship" maxLength={300} value={shipTo} onChange={(e) => setShipTo(e.target.value)} />
        </Field>
        <Field id="dl-why" label="Reason for the change *" error={fields.reason} hint="Kept in the audit trail.">
          <input id="dl-why" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </EditModal>
  );
}

// ------------------------------------------------------------------------------------------ receipt
interface ReceiptDoc {
  number: string;
  amount: string;
  mode: string;
  reference: string;
  version: number;
}
export function ReceiptEdit({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const found = useLoad(() => getJson<ReceiptDoc>(`/sales/receipts/${id}`), [id]);
  const cur = found.data;
  const [mode, setMode] = useState('');
  const [reference, setReference] = useState('');
  useEffect(() => {
    if (!cur) return;
    setMode(cur.mode);
    setReference(cur.reference);
  }, [cur]);
  const { busy, error, fields, run } = useSave(onSaved);
  const cash = cur?.mode === 'Cash';
  return (
    <EditModal
      title={cur ? `Edit receipt ${cur.number}` : 'Edit receipt'}
      sub="The money is already booked, so only the payment mode and the reference can be corrected. For a wrong amount or customer, cancel the receipt in Cash or Bank Book and enter it again."
      error={error || found.error || ''}
      busy={busy}
      blocked={!cur ? 'Loading the receipt…' : undefined}
      onClose={onClose}
      onSave={() =>
        run(async () => {
          if (!cur) return '';
          await updateDoc('/sales/receipts', id, cur.version, { mode, reference: reference.trim() });
          return `Receipt ${cur.number} saved.`;
        })
      }
    >
      <div className="form-grid">
        <Fixed id="rc-amt" label="Amount received" value={cur ? inr(cur.amount) : ''} />
        <Field id="rc-mode" label="Payment mode" error={fields.mode} {...(cash ? { hint: 'A cash receipt stays cash.' } : {})}>
          <select id="rc-mode" value={mode} disabled={cash} onChange={(e) => setMode(e.target.value)}>
            {(cash ? ['Cash'] : ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque']).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field id="rc-ref" label="Bank / cash reference" error={fields.reference}>
          <input id="rc-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </EditModal>
  );
}

// ------------------------------------------------------------------------------------------ draft invoice
export function InvoiceEdit({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const found = useLoad(async () => {
    const doc = await getDoc('/sales/invoices', id);
    const open = await getJson<{ lines: Row[] }>(`/sales/invoices/from-dispatch/${s(doc.dispatchId)}`);
    return { doc, open: open.lines };
  }, [id]);
  const doc: Doc | undefined = found.data?.doc;
  const [date, setDate] = useState('');
  const [freight, setFreight] = useState('');
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!doc) return;
    setDate(s(doc.invoiceDate).slice(0, 10));
    setFreight(Number(doc.freight) > 0 ? String(Number(doc.freight)) : '');
    setNotes(s(doc.notes));
    setQty(Object.fromEntries(((doc.lines ?? []) as Row[]).map((l) => [s(l.dispatchLineId), String(Number(l.qty))])));
  }, [doc]);
  const { busy, error, run } = useSave(onSaved);
  const lines = (doc?.lines ?? []) as Row[];
  const most = (dispatchLineId: string): string => s(found.data?.open.find((l) => s(l.id) === dispatchLineId)?.openQty);
  const billed = Object.entries(qty).filter(([, v]) => Number(v) > 0);
  return (
    <EditModal
      title={doc ? `Edit invoice ${s(doc.number)}` : 'Edit invoice'}
      sub="Change the date, freight, notes or the quantity billed of this draft. Rates come from the sales order."
      error={error || found.error || ''}
      busy={busy}
      saveLabel="Save draft"
      blocked={!doc ? 'Loading the invoice…' : billed.length === 0 ? 'Bill a quantity on at least one line.' : undefined}
      onClose={onClose}
      onSave={() =>
        run(async () => {
          if (!doc) return '';
          await updateDoc('/sales/invoices', id, doc.version, {
            dispatchId: s(doc.dispatchId),
            ...(date ? { invoiceDate: date } : {}),
            freight: Number(freight) > 0 ? freight : null,
            notes: notes.trim() || null,
            lines: billed.map(([dispatchLineId, v]) => ({ dispatchLineId, qty: v })),
          });
          return `Invoice ${s(doc.number)} saved.`;
        })
      }
    >
      <div className="form-grid">
        <Field id="ie-date" label="Invoice date">
          <input id="ie-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="ie-freight" label="Freight (₹)">
          <input id="ie-freight" type="number" min={0} step="any" value={freight} onChange={(e) => setFreight(e.target.value)} />
        </Field>
        <div className="field field-wide">
          <label htmlFor="ie-notes">Notes on the invoice</label>
          <textarea id="ie-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Can be billed</th>
              <th>Bill now</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const key = s(l.dispatchLineId);
              const label = [s(l.itemCode), s(l.itemName)].filter(Boolean).join(' · ');
              return (
                <tr key={s(l.id)}>
                  <td>{label}</td>
                  <td>{most(key) ? Number(most(key)) : '—'}</td>
                  <td>
                    <input aria-label={`Bill ${label}`} type="number" min={0} step="any" value={qty[key] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [key]: e.target.value }))} />
                  </td>
                  <td>{inr(s(l.rate))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </EditModal>
  );
}

// ------------------------------------------------------------------------------------------ credit profile
export interface CreditProfile {
  customerId: string;
  code: string;
  name: string;
  creditLimit: number | null;
  creditDays: number | null;
  usedLimit: number;
  availableLimit: number | null;
  overdue: number;
  oldestDueDays: number | null;
  status: string;
  holdStatus: string;
  lastOverride: string;
  pendingRequest: boolean;
  riskGrade: string;
  reviewDate: string | null;
  projectNumber: string;
}
export const creditProfile = (id: string): Promise<CreditProfile> => getJson<CreditProfile>(`/sales/credit/${id}`);
const rupees = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : inr(String(v)));

/** The read-only figures of a customer's credit, as the form and the View pop-up show them. */
function creditFigures(p: CreditProfile | null | undefined): [string, string][] {
  return [
    ['Customer code', p?.code ?? ''],
    ['Used limit', p ? rupees(p.usedLimit) : ''],
    ['Available limit', p ? rupees(p.availableLimit) : ''],
    ['Overdue', p ? rupees(p.overdue) : ''],
    ['Oldest due days', p ? s(p.oldestDueDays) || '—' : ''],
    ['Status', p?.status ?? ''],
    ['Hold status', p?.holdStatus ?? ''],
    ['Last credit override', p ? p.lastOverride || 'None' : ''],
  ];
}

export function CreditView({ id, canEdit, onEdit, onClose }: { id: string; canEdit: boolean; onEdit: () => void; onClose: () => void }) {
  const found = useLoad(() => creditProfile(id), [id]);
  const p = found.data;
  const all: [string, string][] = p
    ? [
        ['Customer', p.name],
        ['Credit limit', p.creditLimit === null ? 'No limit' : rupees(p.creditLimit)],
        ['Credit days', s(p.creditDays) || '—'],
        ...creditFigures(p),
        ['Risk grade', p.riskGrade || '—'],
        ['Review date', p.reviewDate ? dmy(p.reviewDate) : '—'],
        ['Project Number', p.projectNumber || '—'],
        ['Limit request', p.pendingRequest ? 'Waiting for approval' : 'None'],
      ]
    : [];
  return (
    <Modal
      title={p ? `Credit profile ${p.code}` : 'Credit profile'}
      {...(p ? { sub: p.name } : {})}
      onClose={onClose}
      footer={
        <>
          {canEdit ? (
            <button type="button" className="btn" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <ErrorBox message={found.error} />
      {p ? (
        <p>
          <Pill>{p.status}</Pill>
        </p>
      ) : null}
      <dl className="kv">
        {all.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

/** "New Credit Limit" and "Edit": limit and days keep their approval route; the notes are saved at once. */
export function CreditForm({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState(id ?? '');
  const found = useLoad<CreditProfile | null>(() => (customerId ? creditProfile(customerId) : Promise.resolve(null)), [customerId]);
  const p = found.data && found.data.customerId === customerId ? found.data : null;
  const [limit, setLimit] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [risk, setRisk] = useState('');
  const [review, setReview] = useState('');
  const [project, setProject] = useState('');
  useEffect(() => {
    // an edit starts from what is stored; a new entry leaves limit and days to be typed
    setLimit(id && p?.creditLimit !== null && p?.creditLimit !== undefined ? String(p.creditLimit) : '');
    setDays(id && p?.creditDays !== null && p?.creditDays !== undefined ? String(p.creditDays) : '');
    setRisk(p?.riskGrade ?? '');
    setReview(p?.reviewDate ?? '');
    setProject(p?.projectNumber ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.customerId]);
  const limitChanged = limit !== '' && (!p || Number(limit) !== p.creditLimit);
  const daysChanged = days !== '' && (!p || Number(days) !== p.creditDays);
  const money = limitChanged || daysChanged;
  const notes = Boolean(p) && (risk !== (p?.riskGrade ?? '') || review !== (p?.reviewDate ?? '') || project.trim() !== (p?.projectNumber ?? ''));
  const { busy, error, fields, run } = useSave(onSaved);
  const blocked = !customerId
    ? 'Choose the customer first.'
    : !money && !notes
      ? 'Type or change a credit limit, credit days, risk grade, review date or project number.'
      : money && reason.trim().length < 10
        ? 'Write a reason of at least 10 characters.'
        : undefined;
  return (
    <EditModal
      title={id ? `Edit credit limit${p ? ` of ${p.name}` : ''}` : 'New Credit Limit'}
      sub="Set the credit limit and days for a customer. A higher limit goes to approval; a lower one applies at once."
      error={error || found.error || ''}
      busy={busy}
      blocked={blocked}
      onClose={onClose}
      onSave={() =>
        run(async () => {
          const done: string[] = [];
          if (notes || (!money && p)) {
            await api(`/sales/credit/${customerId}/profile`, { method: 'PUT', body: { riskGrade: risk, reviewDate: review, projectNumber: project.trim() } });
            done.push('Credit details saved.');
          }
          if (money) {
            const r = await requestCreditChange(customerId, {
              ...(limitChanged ? { newLimit: Number(limit) } : {}),
              ...(daysChanged ? { newDays: Number(days) } : {}),
              reason: reason.trim(),
            });
            done.unshift(r.applied ? 'Credit limit updated.' : 'Sent for approval.');
          }
          return done.join(' ');
        })
      }
    >
      <div className="form-grid">
        {id ? (
          <Fixed id="cl-cust" label="Customer" value={p?.name ?? ''} />
        ) : (
          <Field id="cl-cust" label="Customer *">
            <LookupCombo<Option> id="cl-cust" value={customerId} search={lookupCustomers} label={(o) => o.label} onPick={(o) => setCustomerId(o?.id ?? '')} />
          </Field>
        )}
        <Field id="cl-limit" label="Credit limit (₹)" error={fields.newLimit ?? fields.creditLimit}>
          <input id="cl-limit" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field id="cl-days" label="Credit days" error={fields.newDays}>
          <input id="cl-days" type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field id="cl-reason" label="Reason *" error={fields.reason} hint="At least 10 characters. Needed when the limit or days change.">
          <input id="cl-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the limit set or changed?" />
        </Field>
        <Field id="cl-risk" label="Risk grade" error={fields.riskGrade}>
          <select id="cl-risk" value={risk} disabled={!p} onChange={(e) => setRisk(e.target.value)}>
            <option value="">Not graded</option>
            {['Low', 'Medium', 'High'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field id="cl-review" label="Review date" error={fields.reviewDate}>
          <input id="cl-review" type="date" value={review} disabled={!p} onChange={(e) => setReview(e.target.value)} />
        </Field>
        <Field id="cl-project" label="Project Number" error={fields.projectNumber} hint="Same number in every department.">
          <div className="doc-project-row">
            <input id="cl-project" value={project} disabled={!p} placeholder="e.g. PRJ-2026-001" onChange={(e) => setProject(e.target.value.toUpperCase())} />
            <button
              type="button"
              className="btn sm"
              onClick={() => navigate(project.trim() ? `/m/project-global-history?project=${encodeURIComponent(project.trim())}` : '/m/project-global-history')}
            >
              Load Project History
            </button>
          </div>
        </Field>
        {creditFigures(p).map(([label, value]) => (
          <Fixed key={label} id={`cl-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`} label={label} value={value} />
        ))}
      </div>
      {p?.pendingRequest ? <p className="muted">A higher limit for this customer is already waiting for approval.</p> : null}
    </EditModal>
  );
}
