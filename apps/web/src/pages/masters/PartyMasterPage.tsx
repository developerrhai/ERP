// Customer Master (crm-customer360) and Supplier Master (scm-suppliers), docs/phases/PHASE-06.md §7.
// Type the name and the GSTIN: leaving the GSTIN field decodes it OFFLINE (state, PAN, type) with the chip
// "GSTIN format OK — not checked on portal". Possible duplicates show inline; "This is a different party"
// must be ticked to continue past a warning. A new supplier is "Pending approval" until it is submitted and
// approved; a credit-limit increase goes to approval, a decrease applies at once.
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { hasV40Register, V40Register } from '../sales/V40Register';
import { useFrame } from '../frame/V40TabFrame';
import { V40Body } from '../procurement/V40Body';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError, toUiMessage } from '../../lib/errors';
import { inr } from '../../lib/approvalsApi';
import {
  addBankAccount,
  checkDuplicates,
  createCustomer,
  createSupplier,
  decodeGstin,
  getCustomer,
  listCustomers,
  listSuppliers,
  requestCreditChange,
  submitSupplier,
  updateCustomer,
  verifyBankAccount,
  type Customer,
  type DupHit,
  type GstinDecode,
  type Paged,
  type RegType,
  type Supplier,
} from '../../lib/mastersApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';

type Kind = 'CUSTOMER' | 'SUPPLIER';
const REG_TYPES: { value: RegType; label: string }[] = [
  { value: 'REGULAR', label: 'Regular' },
  { value: 'COMPOSITION', label: 'Composition' },
  { value: 'SEZ', label: 'SEZ' },
  { value: 'UNREGISTERED', label: 'Unregistered' },
  { value: 'OVERSEAS', label: 'Overseas' },
];

const approvalLabel: Record<string, string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export function PartyMasterPage({ kind, actions }: { kind: Kind; actions: ActionSet }) {
  const toast = useToast();
  const { pageId: routePage = '' } = useParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<
    'add' | { credit: Customer } | { bank: Supplier } | { view: Customer } | { edit: Customer } | null
  >(null);
  const [rowError, setRowError] = useState('');
  /** View / Edit of a register row: the row of this page, else the record by id. */
  const openCustomer = (id: string, mode: 'view' | 'edit'): void => {
    setRowError('');
    const hit = rows.find((x) => x.id === id) as Customer | undefined;
    const done = (c: Customer): void => setDialog(mode === 'view' ? { view: c } : { edit: c });
    if (hit && mode === 'view') return done(hit);
    getCustomer(id).then(done, (e: unknown) => setRowError(toUiMessage(e)));
  };
  const isCustomer = kind === 'CUSTOMER';
  // Supplier Master inside the V40 tab frame: the V40 tabs and columns (procurement/V40Body.tsx)
  const inFrame = Boolean(useFrame());
  const v40Suppliers = inFrame && !isCustomer;
  // inside the V40 frame the register below has its own search box, which is the one that filters it
  const ownSearch = !(v40Suppliers || (inFrame && isCustomer && hasV40Register(routePage)));
  const load = useLoad<Paged<Customer | Supplier>>(
    () => (isCustomer ? listCustomers({ q, page }) : listSuppliers({ q, page })),
    [kind, q, page],
  );
  const rows = load.data?.rows ?? [];
  // Customer 360° and Customer Master share this screen; the heading follows the page that was opened
  const title = isCustomer ? (routePage === 'crm-customer360' ? 'Customer 360°' : 'Customer Master') : 'Supplier Master';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>
            {isCustomer
              ? 'Customers with GSTIN, state, payment terms and credit limit.'
              : 'Material suppliers and contractors with GSTIN, MSME details and bank accounts.'}
          </p>
        </div>
        <div className="actions">
          {actions.add ? (
            <button type="button" className="btn primary" onClick={() => setDialog('add')}>
              ＋ Add {isCustomer ? 'Customer' : 'Supplier'}
            </button>
          ) : null}
        </div>
      </div>
      {ownSearch ? (
        <div className="recordbar">
          <input
            type="search"
            placeholder="Search by name, code or GSTIN…"
            aria-label={`Search ${title}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
      ) : null}
      {load.error ? <ErrorMessage onReload={load.reload}>{load.error}</ErrorMessage> : null}
      {rowError ? <ErrorMessage onReload={() => setRowError('')}>{rowError}</ErrorMessage> : null}
      {v40Suppliers ? (
        <V40Body
          pageId="scm-suppliers"
          actions={actions}
          reloadKey={load.data}
          onChanged={load.reload}
          extraActions={(r) =>
            actions.edit ? (
              <button
                type="button"
                className="btn sm"
                aria-label={`Bank accounts of ${String(r.vendorId)}`}
                onClick={() =>
                  setDialog({
                    bank: {
                      id: String(r.id),
                      code: String(r.vendorId),
                      name: String(r.vendorName),
                    } as Supplier,
                  })
                }
              >
                Bank
              </button>
            ) : null
          }
        />
      ) : (
      <V40Register
        pageId={isCustomer ? routePage : ''}
        actions={actions}
        reloadKey={load.data}
        onChanged={load.reload}
        onOpen={isCustomer ? (id) => openCustomer(id, 'view') : undefined}
        onEdit={isCustomer && actions.edit ? (id) => openCustomer(id, 'edit') : undefined}
        canEditRow={() => true}
        rowExtra={(r) =>
          isCustomer && actions.edit ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const c = rows.find((x) => x.id === r.id);
                if (c) setDialog({ credit: c as Customer });
              }}
            >
              Credit
            </button>
          ) : null
        }
        fallback={
          <>
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">GSTIN</th>
                    <th scope="col">Type</th>
                    {isCustomer ? <th scope="col">Credit limit</th> : <th scope="col">Kind</th>}
                    <th scope="col">Approval</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.code}</strong>
                      </td>
                      <td>{r.name}</td>
                      <td>{r.gstin ?? '—'}</td>
                      <td>{REG_TYPES.find((t) => t.value === r.gstRegistrationType)?.label}</td>
                      <td>
                        {isCustomer
                          ? (r as Customer).creditLimit === null
                            ? 'No limit'
                            : inr((r as Customer).creditLimit)
                          : (r as Supplier).supplierType === 'CONTRACTOR'
                            ? 'Contractor'
                            : 'Material'}
                      </td>
                      <td>
                        <span
                          className={`status ${r.approvalStatus === 'APPROVED' ? 'approved' : r.approvalStatus === 'REJECTED' ? 'rejected' : 'pending'}`}
                        >
                          {approvalLabel[r.approvalStatus]}
                        </span>
                      </td>
                      <td>
                        <div className="actions">
                          {isCustomer && actions.edit ? (
                            <button
                              type="button"
                              className="btn sm"
                              aria-label={`Change credit of ${r.code}`}
                              onClick={() => setDialog({ credit: r as Customer })}
                            >
                              Credit
                            </button>
                          ) : null}
                          {!isCustomer && actions.edit ? (
                            <button
                              type="button"
                              className="btn sm"
                              aria-label={`Bank accounts of ${r.code}`}
                              onClick={() => setDialog({ bank: r as Supplier })}
                            >
                              Bank
                            </button>
                          ) : null}
                          {!isCustomer && actions.submit && r.approvalStatus !== 'APPROVED' ? (
                            <button
                              type="button"
                              className="btn sm primary"
                              aria-label={`Submit ${r.code} for approval`}
                              onClick={() => {
                                submitSupplier(r.id)
                                  .then(() => {
                                    toast(`${r.code} sent for approval.`);
                                    load.reload();
                                  })
                                  .catch((err: unknown) => toast(toUiMessage(err)));
                              }}
                            >
                              Submit for Approval
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {load.loading && !load.data ? (
                    <tr className="empty-row">
                      <td colSpan={7}>Loading…</td>
                    </tr>
                  ) : null}
                  {load.data && rows.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={7}>
                        No {isCustomer ? 'customers' : 'suppliers'} yet. Click ＋ Add to create the
                        first one.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {load.data ? (
              <Pager
                page={load.data.meta.page}
                size={load.data.meta.size}
                total={load.data.meta.total}
                onPage={setPage}
              />
            ) : null}
          </>
        }
      />
      )}
      {dialog === 'add' ? (
        <PartyForm
          kind={kind}
          onClose={() => setDialog(null)}
          onSaved={(code) => {
            setDialog(null);
            load.reload();
            toast(`${code} saved.`);
          }}
        />
      ) : null}
      {dialog && typeof dialog === 'object' && 'credit' in dialog ? (
        <CreditDialog
          customer={dialog.credit}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null);
            load.reload();
            toast(msg);
          }}
        />
      ) : null}
      {dialog && typeof dialog === 'object' && 'view' in dialog ? (
        <CustomerViewDialog customer={dialog.view} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' && 'edit' in dialog ? (
        <CustomerEditDialog
          customer={dialog.edit}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null);
            load.reload();
            toast(msg);
          }}
        />
      ) : null}
      {dialog && typeof dialog === 'object' && 'bank' in dialog ? (
        <BankDialog
          supplier={dialog.bank}
          onClose={() => setDialog(null)}
          onChanged={(m) => toast(m)}
        />
      ) : null}
    </>
  );
}

function CustomerViewDialog({ customer: c, onClose }: { customer: Customer; onClose: () => void }) {
  const row = (label: string, value: string | number | null | undefined) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </div>
  );
  return (
    <Modal
      title={`${c.code} · ${c.name}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <dl className="kv">
        {row('Customer code', c.code)}
        {row('Name', c.name)}
        {row('Legal name', c.legalName)}
        {row('GST registration', REG_TYPES.find((t) => t.value === c.gstRegistrationType)?.label)}
        {row('GSTIN', c.gstin)}
        {row('PAN', c.pan)}
        {row('State code', c.stateCode)}
        {row('Currency', c.currencyCode)}
        {row('Credit limit', c.creditLimit === null ? 'No limit' : inr(c.creditLimit))}
        {row('Credit days', c.creditDays)}
        {row('Tier', c.tier)}
        {row('Approval', approvalLabel[c.approvalStatus])}
        {row('Status', c.status)}
      </dl>
    </Modal>
  );
}

function CustomerEditDialog({
  customer: c,
  onClose,
  onDone,
}: {
  customer: Customer;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [name, setName] = useState(c.name);
  const [legalName, setLegalName] = useState(c.legalName ?? '');
  const [tier, setTier] = useState<Customer['tier']>(c.tier);
  const [status, setStatus] = useState<Customer['status']>(c.status);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = (): void => {
    setError('');
    if (name.trim().length < 2) return setError('Enter the customer name (at least 2 letters).');
    setBusy(true);
    updateCustomer(c.id, c.version, { name: name.trim(), legalName: legalName.trim() || null, tier, status })
      .then(() => onDone(`${c.code} saved.`))
      .catch((e: unknown) => setError(toUiMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title={`Edit ${c.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ce-name">Name *</label>
          <input id="ce-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ce-legal">Legal name</label>
          <input id="ce-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ce-tier">Tier</label>
          <select id="ce-tier" value={tier} onChange={(e) => setTier(e.target.value as Customer['tier'])}>
            {(['A', 'B', 'C', 'D'] as const).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ce-status">Status</label>
          <select id="ce-status" value={status} onChange={(e) => setStatus(e.target.value as Customer['status'])}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>
      <p className="muted">GSTIN, PAN and the credit limit are changed through their own controlled steps (Credit button).</p>
    </Modal>
  );
}

function PartyForm({
  kind,
  onClose,
  onSaved,
}: {
  kind: Kind;
  onClose: () => void;
  onSaved: (code: string) => void;
}) {
  const isCustomer = kind === 'CUSTOMER';
  const [name, setName] = useState('');
  const [regType, setRegType] = useState<RegType>('REGULAR');
  const [gstin, setGstin] = useState('');
  const [decoded, setDecoded] = useState<GstinDecode | null>(null);
  const [city, setCity] = useState('');
  const [mobile, setMobile] = useState('');
  const [udyam, setUdyam] = useState('');
  const [msmeCategory, setMsmeCategory] = useState('');
  const [supplierType, setSupplierType] = useState<'MATERIAL' | 'CONTRACTOR'>('MATERIAL');
  const [dups, setDups] = useState<DupHit[]>([]);
  const [different, setDifferent] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const needsGstin = regType === 'REGULAR' || regType === 'COMPOSITION' || regType === 'SEZ';

  const onGstinBlur = async (): Promise<void> => {
    const value = gstin.replace(/\s+/g, '').toUpperCase();
    setGstin(value);
    if (!value) {
      setDecoded(null);
      return;
    }
    try {
      setDecoded(await decodeGstin(value));
    } catch {
      setDecoded(null);
    }
    await refreshDups(value);
  };

  const refreshDups = async (g = gstin): Promise<void> => {
    try {
      setDups(
        await checkDuplicates({
          kind,
          gstin: g || null,
          name: name || null,
          city: city || null,
          mobile: mobile || null,
        }),
      );
    } catch {
      setDups([]);
    }
  };

  const blocked = dups.some((d) => d.level === 'BLOCK');
  const warned = dups.some((d) => d.level === 'WARN');

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setFields({});
    setPending(true);
    const base = {
      name,
      gstRegistrationType: regType,
      gstin: needsGstin && gstin ? gstin : null,
      city: city || null,
      mobile: mobile || null,
      stateCode: decoded && decoded.ok ? decoded.stateCode : null,
      differentParty: different,
    };
    try {
      const saved = isCustomer
        ? await createCustomer(base)
        : await createSupplier({
            ...base,
            supplierType,
            msmeUdyamNo: udyam || null,
            msmeCategory: (msmeCategory || null) as 'MICRO' | 'SMALL' | 'MEDIUM' | null,
          });
      onSaved(saved.code);
    } catch (err) {
      const ui = toUiError(err);
      setError(ui.message);
      setFields(ui.fields);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={isCustomer ? 'Add Customer' : 'Add Supplier'}
      sub={
        isCustomer
          ? undefined
          : 'A new supplier needs approval before it can be used on purchase documents.'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="submit"
            form="party-form"
            className="btn primary"
            disabled={pending || blocked || (warned && !different)}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="party-form" onSubmit={(e) => void save(e)} noValidate>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pf-name">Name *</label>
            <input
              id="pf-name"
              value={name}
              maxLength={150}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void refreshDups()}
            />
            {fields.name ? <span className="field-error">{fields.name}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="pf-reg">Registration type *</label>
            <select
              id="pf-reg"
              value={regType}
              onChange={(e) => setRegType(e.target.value as RegType)}
            >
              {REG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {needsGstin ? (
            <div className="field">
              <label htmlFor="pf-gstin">GSTIN *</label>
              <input
                id="pf-gstin"
                value={gstin}
                maxLength={20}
                onChange={(e) => setGstin(e.target.value)}
                onBlur={() => void onGstinBlur()}
                aria-invalid={fields.gstin ? true : undefined}
              />
              {decoded?.ok ? (
                <span className="chip" role="status">
                  {decoded.note}: {decoded.state} • PAN {decoded.pan}
                </span>
              ) : null}
              {decoded && !decoded.ok ? (
                <span className="field-error" role="alert">
                  {decoded.message}
                </span>
              ) : null}
              {fields.gstin ? <span className="field-error">{fields.gstin}</span> : null}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="pf-city">City</label>
            <input
              id="pf-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => void refreshDups()}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-mobile">Mobile</label>
            <input
              id="pf-mobile"
              value={mobile}
              maxLength={15}
              onChange={(e) => setMobile(e.target.value)}
              onBlur={() => void refreshDups()}
            />
          </div>
          {!isCustomer ? (
            <>
              <div className="field">
                <label htmlFor="pf-type">Supplier kind</label>
                <select
                  id="pf-type"
                  value={supplierType}
                  onChange={(e) => setSupplierType(e.target.value as 'MATERIAL' | 'CONTRACTOR')}
                >
                  <option value="MATERIAL">Material vendor</option>
                  <option value="CONTRACTOR">Contractor</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pf-udyam">Udyam number</label>
                <input
                  id="pf-udyam"
                  value={udyam}
                  placeholder="UDYAM-MH-26-0012345"
                  onChange={(e) => setUdyam(e.target.value.toUpperCase())}
                />
                {fields.msmeUdyamNo ? (
                  <span className="field-error">{fields.msmeUdyamNo}</span>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="pf-msme">MSME category</label>
                <select
                  id="pf-msme"
                  value={msmeCategory}
                  onChange={(e) => setMsmeCategory(e.target.value)}
                >
                  <option value="">Not an MSME</option>
                  <option value="MICRO">Micro</option>
                  <option value="SMALL">Small</option>
                  <option value="MEDIUM">Medium</option>
                </select>
              </div>
            </>
          ) : null}
        </div>
        {!isCustomer && (msmeCategory === 'MICRO' || msmeCategory === 'SMALL') ? (
          <div className="notice" role="note">
            MSME Micro/Small — must be paid within the agreed days (maximum 45).
          </div>
        ) : null}
        {dups.length > 0 ? (
          <ul className="dup-list" aria-label="Possible duplicates">
            {dups.map((d, i) => (
              <li
                key={`${d.matchId}-${i}`}
                className={d.level === 'BLOCK' ? 'field-error' : 'v8-sub'}
              >
                {d.level === 'BLOCK' ? '⛔ ' : d.level === 'WARN' ? '⚠ ' : 'ℹ '}
                {d.message}
              </li>
            ))}
          </ul>
        ) : null}
        {warned ? (
          <label className="check">
            <input
              type="checkbox"
              checked={different}
              onChange={(e) => setDifferent(e.target.checked)}
            />{' '}
            This is a different party
          </label>
        ) : null}
      </form>
    </Modal>
  );
}

function CreditDialog({
  customer,
  onClose,
  onDone,
}: {
  customer: Customer;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [limit, setLimit] = useState(customer.creditLimit ?? '');
  const [days, setDays] = useState(customer.creditDays === null ? '' : String(customer.creditDays));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const save = async (): Promise<void> => {
    setPending(true);
    setError('');
    try {
      const out = await requestCreditChange(customer.id, {
        newLimit: limit === '' ? null : Number(limit),
        newDays: days === '' ? null : Number(days),
        reason,
      });
      onDone(
        out.applied
          ? 'Credit limit lowered.'
          : 'Credit change sent for approval. The limit stays the same until it is approved.',
      );
    } catch (err) {
      setError(toUiMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={`Credit of ${customer.code}`}
      sub={`Current limit: ${customer.creditLimit === null ? 'No limit' : inr(customer.creditLimit)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() => void save()}
          >
            {pending ? 'Saving…' : 'Request change'}
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <div className="field">
        <label htmlFor="cr-limit">New credit limit (₹, empty = no limit)</label>
        <input
          id="cr-limit"
          type="number"
          min={0}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cr-days">Credit days</label>
        <input
          id="cr-days"
          type="number"
          min={0}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cr-reason">Reason *</label>
        <textarea
          id="cr-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="v8-sub">
          Raising the limit needs approval; lowering it applies at once.
        </span>
      </div>
    </Modal>
  );
}

function BankDialog({
  supplier,
  onClose,
  onChanged,
}: {
  supplier: Supplier;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [ifsc, setIfsc] = useState('');
  const [holder, setHolder] = useState(supplier.name);
  const [acct, setAcct] = useState('');
  const [acct2, setAcct2] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ id: string; accountNo: string; verified: boolean }[]>([]);
  const save = async (): Promise<void> => {
    setError('');
    if (acct !== acct2) {
      setError('The two account numbers do not match.');
      return;
    }
    try {
      const b = await addBankAccount(supplier.id, {
        ifsc: ifsc.toUpperCase(),
        holderName: holder,
        accountNo: acct,
        accountNoConfirm: acct2,
      });
      setAdded((a) => [...a, b]);
      setAcct('');
      setAcct2('');
      onChanged('Bank account added. Another user must verify it before it is used for payment.');
    } catch (err) {
      setError(toUiMessage(err));
    }
  };
  return (
    <Modal
      size="sm"
      title={`Bank accounts of ${supplier.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={() => void save()}>
            Add account
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <div className="field">
        <label htmlFor="bk-ifsc">IFSC *</label>
        <input
          id="bk-ifsc"
          value={ifsc}
          maxLength={11}
          onChange={(e) => setIfsc(e.target.value.toUpperCase())}
        />
      </div>
      <div className="field">
        <label htmlFor="bk-holder">Account holder *</label>
        <input id="bk-holder" value={holder} onChange={(e) => setHolder(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="bk-acct">Account number *</label>
        <input
          id="bk-acct"
          value={acct}
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setAcct(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="bk-acct2">Type the account number again *</label>
        <input
          id="bk-acct2"
          value={acct2}
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setAcct2(e.target.value)}
        />
      </div>
      {added.map((b) => (
        <div key={b.id} className="v8-sub">
          {b.accountNo} — {b.verified ? 'Verified' : 'Awaiting second-person verification'}{' '}
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              verifyBankAccount(supplier.id, b.id)
                .then(() => {
                  setAdded((a) => a.map((x) => (x.id === b.id ? { ...x, verified: true } : x)));
                  onChanged('Bank account verified.');
                })
                .catch((err: unknown) => setError(toUiMessage(err)));
            }}
          >
            Verify
          </button>
        </div>
      ))}
    </Modal>
  );
}
