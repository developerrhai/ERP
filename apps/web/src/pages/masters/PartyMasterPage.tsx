// Customer Master (crm-customer360) and Supplier Master (scm-suppliers), docs/phases/PHASE-06.md §7.
// Type the name and the GSTIN: leaving the GSTIN field decodes it OFFLINE (state, PAN, type) with the chip
// "GSTIN format OK — not checked on portal". Possible duplicates show inline; "This is a different party"
// must be ticked to continue past a warning. A new supplier is "Pending approval" until it is submitted and
// approved; a credit-limit increase goes to approval, a decrease applies at once.
import { useState, type FormEvent } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { inr } from '../../lib/approvalsApi';
import {
  addBankAccount,
  checkDuplicates,
  createCustomer,
  createSupplier,
  decodeGstin,
  listCustomers,
  listSuppliers,
  requestCreditChange,
  submitSupplier,
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
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'add' | { credit: Customer } | { bank: Supplier } | null>(
    null,
  );
  const isCustomer = kind === 'CUSTOMER';
  const load = useLoad<Paged<Customer | Supplier>>(
    () => (isCustomer ? listCustomers({ q, page }) : listSuppliers({ q, page })),
    [kind, q, page],
  );
  const rows = load.data?.rows ?? [];
  const title = isCustomer ? 'Customer Master' : 'Supplier Master';

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
      {load.error ? <ErrorMessage onReload={load.reload}>{load.error}</ErrorMessage> : null}
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
                            .catch((err: unknown) => toast(toUiError(err).message));
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
                  No {isCustomer ? 'customers' : 'suppliers'} yet. Click ＋ Add to create the first
                  one.
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
      setError(toUiError(err).message);
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
      setError(toUiError(err).message);
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
                .catch((err: unknown) => setError(toUiError(err).message));
            }}
          >
            Verify
          </button>
        </div>
      ))}
    </Modal>
  );
}
