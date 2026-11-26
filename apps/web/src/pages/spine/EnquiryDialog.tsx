// SE-05: the record opened by View / Load Selected on the Sales Enquiries register: its details, Edit (while New or
// Qualified) and Move Forward to another department. Nothing moves by itself; each button is a person's decision.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { MoveForwardDialog } from '../../components/MoveForward';
import { RecordActions } from '../../components/workspace/RecordActions';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { lookupCustomers, lookupSalespeople } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import { Combobox } from '../../ui/components';
import { spineApi, type Enquiry } from '../../lib/spineApi';

const EDITABLE = ['New', 'Qualified'];

const dateOnly = (v?: string | null): string => (v ? v.slice(0, 10) : '');
/** dd-mm-yyyy, as the registers show dates */
const shownDate = (v?: string | null): string => dateOnly(v).split('-').reverse().join('-');

export function EnquiryDialog({
  id,
  canEdit,
  onClose,
  onChanged,
}: {
  id: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [e, setE] = useState<Enquiry | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    prospectName: '',
    contact: '',
    product: '',
    application: '',
    qty: '',
    requiredDate: '',
    source: '',
    assignedToId: '',
    priceDiscussion: '',
    nextFollowUp: '',
    remarks: '',
  });
  const people = useLoad(() => lookupSalespeople(), []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // the customer this enquiry is linked to; a prospect has none until one is picked (BUG-02)
  const [customer, setCustomer] = useState<{ value: string; label: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void spineApi.enquiry(id).then(
      (r) => {
        if (!alive) return;
        setE(r);
        setCustomer(r.customer_id ? { value: r.customer_id, label: r.customer_name ?? 'Linked customer' } : null);
        setForm({
          prospectName: r.prospect_name ?? '',
          contact: r.contact ?? '',
          product: r.product,
          application: r.application ?? '',
          qty: r.qty ?? '',
          requiredDate: dateOnly(r.required_date),
          source: r.source ?? '',
          assignedToId: r.assigned_to_id ?? '',
          priceDiscussion: r.price_discussion ?? '',
          nextFollowUp: dateOnly(r.next_follow_up),
          remarks: r.remarks ?? '',
        });
      },
      (err: unknown) => alive && setError(err instanceof ApiError ? err.message : 'Could not load the enquiry.'),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  async function save(): Promise<void> {
    if (!e) return;
    const qty = form.qty.trim() === '' ? null : Number(form.qty);
    if (qty !== null && (Number.isNaN(qty) || qty < 0)) {
      setFieldErrors({ qty: 'Enter the quantity as a number.' });
      return;
    }
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      const r = await spineApi.updateEnquiry(e.id, e.version, {
        ...(customer && customer.value !== e.customer_id ? { customerId: customer.value } : {}),
        prospectName: form.prospectName.trim() || null,
        contact: form.contact.trim() || null,
        product: form.product.trim(),
        application: form.application.trim() || null,
        qty,
        requiredDate: form.requiredDate || null,
        source: form.source.trim() || null,
        assignedToId: form.assignedToId || null,
        priceDiscussion: form.priceDiscussion.trim() || null,
        nextFollowUp: form.nextFollowUp || null,
        remarks: form.remarks.trim() || null,
      });
      setE({ ...e, ...r });
      setEditing(false);
      toast('Enquiry saved.');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) setFieldErrors(err.fields);
      setError(err instanceof ApiError ? err.message : 'Could not save the enquiry.');
    } finally {
      setBusy(false);
    }
  }

  const editable = !!e && EDITABLE.includes(e.status) && canEdit;
  const field = (key: keyof typeof form, label: string, extra: Record<string, string> = {}) => (
    <div className="field">
      <label htmlFor={`enq-${key}`}>{label}</label>
      <input
        id={`enq-${key}`}
        value={form[key]}
        onChange={(ev) => setForm({ ...form, [key]: ev.target.value })}
        aria-invalid={fieldErrors[key] ? true : undefined}
        {...extra}
      />
      {fieldErrors[key] ? <span className="field-error">{fieldErrors[key]}</span> : null}
    </div>
  );

  return (
    <>
      <Modal
        title={e ? `Enquiry ${e.number}` : 'Enquiry'}
        sub={e ? `${e.status}${e.lost_reason ? ` · ${e.lost_reason}` : ''}` : undefined}
        onClose={onClose}
        footer={
          editing ? (
            <>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
                Save
              </button>
            </>
          ) : (
            <>
              {e ? <RecordActions docType="sales-enquiries" id={e.id} number={e.number} status={e.status} onChanged={onChanged} move={false} withPrint /> : null}
              {editable ? (
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
              ) : null}
              {e && canEdit && e.status !== 'Lost' ? (
                <button type="button" className="btn primary" onClick={() => setMoving(true)}>
                  Move Forward
                </button>
              ) : null}
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </>
          )
        }
      >
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : null}
        {!e && !error ? <p className="muted">Loading…</p> : null}
        {e && editing ? (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="enq-customer">Customer</label>
              <Combobox
                id="enq-customer"
                value={customer}
                placeholder="Search customer"
                search={async (q) => (await lookupCustomers(q)).map((c) => ({ value: c.id, label: c.label }))}
                onPick={setCustomer}
              />
              {fieldErrors.customerId ? <span className="field-error">{fieldErrors.customerId}</span> : null}
            </div>
            {field('prospectName', 'Customer or prospect name')}
            {field('contact', 'Contact')}
            {field('product', 'Product *')}
            {field('application', 'Application')}
            {field('qty', 'Quantity', { inputMode: 'decimal' })}
            {field('requiredDate', 'Required date', { type: 'date' })}
            {field('source', 'Source')}
            <div className="field">
              <label htmlFor="enq-assignedToId">Sales person</label>
              <select id="enq-assignedToId" value={form.assignedToId} onChange={(ev) => setForm({ ...form, assignedToId: ev.target.value })}>
                <option value="">Not assigned</option>
                {(people.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {field('priceDiscussion', 'Price discussion')}
            {field('nextFollowUp', 'Next follow-up', { type: 'date' })}
            {field('remarks', 'Remarks')}
          </div>
        ) : null}
        {e && !editing ? (
          <dl className="drawer-grid record-cards">
            {([
              ['Enquiry No', e.number],
              ['Enquiry date', shownDate(e.enq_date)],
              ['Status', e.status],
              ['Customer / prospect', e.customer_name ?? e.prospect_name],
              ['Contact', e.contact],
              ['Source', e.source],
              ['Product', e.product],
              ['Application', e.application],
              ['Quantity', e.qty],
              ['Required date', shownDate(e.required_date)],
              ['Sales person', (people.data ?? []).find((o) => o.id === e.assigned_to_id)?.label],
              ['Price discussion', e.price_discussion],
              ['Next follow-up', shownDate(e.next_follow_up)],
              ['Remarks', e.remarks],
              ...(e.lost_reason ? [['Lost because', e.lost_reason]] : []),
            ] as [string, string | null | undefined][]).map(([label, value]) => (
              <div className="v8-mini" key={label}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Modal>
      {moving && e ? (
        <MoveForwardDialog
          docType="sales-enquiries"
          docId={e.id}
          docNo={e.number}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setMoving(false);
            toast('Enquiry moved forward.');
            onChanged();
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
