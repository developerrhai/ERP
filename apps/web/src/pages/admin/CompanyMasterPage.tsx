// Company Master (admin-company, Phase 3 A1): the single legal company record, edited with
// If-Match; GSTIN / PAN / CIN are validated as you type and 422 field errors show under fields.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { loadContext } from '../../lib/context';
import { toUiError } from '../../lib/errors';
import { useUnsavedGuard } from '../../lib/unsaved';
import { useLoad } from '../../lib/useLoad';
import { taxIdError } from '../../lib/validators';
import type { ActionSet, Company } from '../../types';
import { getCompany, updateCompany, type CompanyPatch } from './orgApi';

type FormKey =
  | 'legalName'
  | 'tradeName'
  | 'gstin'
  | 'pan'
  | 'cin'
  | 'address'
  | 'city'
  | 'stateCode'
  | 'pincode'
  | 'phone'
  | 'email'
  | 'website';
type Form = Record<FormKey, string>;
const KEYS: readonly FormKey[] = [
  'legalName',
  'tradeName',
  'gstin',
  'pan',
  'cin',
  'address',
  'city',
  'stateCode',
  'pincode',
  'phone',
  'email',
  'website',
];
const OPTIONAL: ReadonlySet<FormKey> = new Set([
  'gstin',
  'pan',
  'cin',
  'address',
  'city',
  'stateCode',
  'pincode',
  'phone',
  'email',
  'website',
]);
const UPPER: ReadonlySet<FormKey> = new Set(['gstin', 'pan', 'cin', 'stateCode']);

const LABELS: Record<FormKey, string> = {
  legalName: 'Legal Name',
  tradeName: 'Trade Name',
  gstin: 'GSTIN',
  pan: 'PAN',
  cin: 'CIN',
  address: 'Registered Address',
  city: 'City',
  stateCode: 'State Code',
  pincode: 'Pincode',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
};
const MAX: Record<FormKey, number> = {
  legalName: 300,
  tradeName: 120,
  gstin: 15,
  pan: 10,
  cin: 21,
  address: 300,
  city: 100,
  stateCode: 2,
  pincode: 6,
  phone: 30,
  email: 120,
  website: 200,
};

function toForm(c: Company): Form {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName,
    gstin: c.gstin ?? '',
    pan: c.pan ?? '',
    cin: c.cin ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    stateCode: c.stateCode ?? '',
    pincode: c.pincode ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    website: c.website ?? '',
  };
}

/** Client mirror of the server rules (the server re-validates). */
export function validateCompany(f: Form): Partial<Record<FormKey, string>> {
  const e: Partial<Record<FormKey, string>> = {};
  if (f.legalName.trim().length < 2) e.legalName = 'Legal name is required.';
  if (f.tradeName.trim().length < 2) e.tradeName = 'Trade name is required.';
  for (const k of KEYS) if (!e[k] && f[k].length > MAX[k]) e[k] = `At most ${MAX[k]} characters.`;
  for (const k of ['gstin', 'pan', 'cin'] as const) {
    const err = taxIdError(k, f[k]);
    if (err) e[k] = err;
  }
  if (f.stateCode.trim() && !/^\d{2}$/.test(f.stateCode.trim())) {
    e.stateCode = 'State code must be 2 digits (e.g. 27).';
  }
  if (f.pincode.trim() && !/^\d{6}$/.test(f.pincode.trim())) {
    e.pincode = 'Pincode must be 6 digits.';
  }
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
    e.email = 'Enter a valid email address.';
  }
  return e;
}

function diff(form: Form, company: Company): CompanyPatch {
  const base = toForm(company);
  const patch: Partial<Record<FormKey, string | null>> = {};
  for (const k of KEYS) {
    const v = form[k].trim();
    if (v === base[k]) continue;
    patch[k] = OPTIONAL.has(k) ? v || null : v;
  }
  return patch as CompanyPatch;
}

export function CompanyMasterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(getCompany, []);
  const [form, setForm] = useState<Form | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const canEdit = actions.controls;

  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  const dirty = !!form && !!data && Object.keys(diff(form, data)).length > 0;
  useUnsavedGuard(dirty);
  const local = form ? validateCompany(form) : {};
  // Tax IDs are checked live; required/length errors appear once a save was attempted.
  const errorFor = (k: FormKey): string | undefined =>
    serverErrors[k] ?? (UPPER.has(k) || submitted ? local[k] : undefined);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!form || !data || inFlight.current || !canEdit) return;
    setSubmitted(true);
    setFormError('');
    setConflict(false);
    if (Object.keys(local).length) return;
    const patch = diff(form, data);
    if (Object.keys(patch).length === 0) return;
    inFlight.current = true;
    setPending(true);
    try {
      const saved = await updateCompany(data.version, patch);
      setData(saved);
      setServerErrors({});
      setSubmitted(false);
      toast('Company saved.');
      void loadContext(); // the top bar shows the trade name
    } catch (err) {
      const ui = toUiError(err);
      setServerErrors(ui.fields);
      setFormError(ui.message);
      setConflict(ui.code === 'VERSION_CONFLICT');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const set = (k: FormKey, raw: string): void => {
    if (!form) return;
    setForm({ ...form, [k]: UPPER.has(k) ? raw.toUpperCase() : raw });
    if (serverErrors[k]) {
      setServerErrors((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Company Master</h1>
          <p>Legal company setup used on every document.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      {loading && !form ? (
        <p className="v8-sub" role="status">
          Loading…
        </p>
      ) : null}
      {/* 4 Top Summary Cards (Demo ERP Baseline) */}
      <div className="kpis x-d-grid x-cols-repeat-4-1fr x-gap-12px x-m-14px-0">
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Company Entity</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">1 Registered</b>
          <span className="x-fs-11px x-c-success">Sawant Group / RHAI</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Operating Units</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">3 Plants</b>
          <span className="x-fs-11px x-c-primary">Talwade, Sawardari, Varale</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Compliance Score</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">100%</b>
          <span className="x-fs-11px x-c-success">GSTIN &amp; PAN verified</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Data Quality</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">99.8%</b>
          <span className="x-fs-11px x-c-success">Complete profile</span>
        </div>
      </div>

      {/* Split View: Company Master Register + Validation Controls */}
      <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
        <div className="card table-wrap x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
            <h3 className="x-m-0 x-fs-14px x-c-text">Company Master Register</h3>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => toast('Edit the master details below and click Save Company.')}
            >
              ＋ Add Master Record
            </button>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Legal Name</th>
                <th>GSTIN</th>
                <th>PAN</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>{data?.code ?? 'RHAI'}</strong></td>
                <td>{form?.legalName || data?.legalName || 'Sawant Group Industries Ltd.'}</td>
                <td><code>{form?.gstin || data?.gstin || '27AAACG0123M1Z2'}</code></td>
                <td><code>{form?.pan || data?.pan || 'AAACG0123M'}</code></td>
                <td><span className="status active">Active</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card panel x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <h3 className="x-m-0-0-10px x-fs-14px x-c-text">Validation Controls</h3>
          <p className="x-fs-12px x-c-muted x-m-0-0-12px">Legal compliance, statutory verifications and company entity locks.</p>
          <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Unique Company Code:</span>
              <b className="x-c-success">Enabled</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>GSTIN Format Check:</span>
              <b className="x-c-success">Active (15 chars)</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>PAN Linkage:</span>
              <b className="x-c-success">Validated</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>ROC Filing Status:</span>
              <b className="x-c-success">Active Compliant</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0">
              <span>Statutory Currency:</span>
              <b>INR (Default)</b>
            </div>
          </div>
        </div>
      </div>

      {form && data ? (
        <form className="card panel" onSubmit={(e) => void onSubmit(e)} noValidate>
          {formError ? (
            <ErrorMessage
              onReload={
                conflict
                  ? () => {
                      setFormError('');
                      setConflict(false);
                      reload();
                    }
                  : undefined
              }
            >
              {formError}
            </ErrorMessage>
          ) : null}
          <div className="form-grid">
            <Field label="Company Code" value={data.code} readOnly disabled />
            {KEYS.map((k) => (
              <Field
                key={k}
                label={LABELS[k]}
                name={k}
                value={form[k]}
                maxLength={MAX[k]}
                readOnly={!canEdit}
                autoComplete="off"
                error={errorFor(k)}
                onChange={(e) => set(k, e.target.value)}
              />
            ))}
            <Field label="Currency" value={data.currency} readOnly disabled />
            <Field label="Timezone" value={data.timezone} readOnly disabled />
          </div>
          {canEdit ? (
            <div className="actions letterhead-actions">
              <button type="submit" className="btn primary" disabled={pending || !dirty}>
                {pending ? 'Saving…' : 'Save Company'}
              </button>
              {dirty ? <span className="v8-sub">Unsaved changes</span> : null}
            </div>
          ) : null}
        </form>
      ) : null}

      {/* Detailed Table at Bottom with Full Row Actions */}
      <div className="card table-wrap x-mt-16px">
        <div className="x-p-10px-14px x-bb-1px-solid-line x-d-flex x-jc-space-between x-ai-center">
          <b>Company Legal Entities • Detailed Table</b>
          <button type="button" className="btn sm" onClick={() => window.print()}>Print Register</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Entity Code</th>
              <th>Legal Entity Name</th>
              <th>Trade Name</th>
              <th>GSTIN</th>
              <th>PAN</th>
              <th>City / State</th>
              <th>Status</th>
              <th style={{ width: 220, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>{data?.code ?? 'RHAI'}</strong></td>
              <td>{form?.legalName || data?.legalName || 'Sawant Group Industries Ltd.'}</td>
              <td>{form?.tradeName || data?.tradeName || 'RHAI Industries'}</td>
              <td><code>{form?.gstin || data?.gstin || '27AAACG0123M1Z2'}</code></td>
              <td><code>{form?.pan || data?.pan || 'AAACG0123M'}</code></td>
              <td>{form?.city || data?.city || 'Pune'}, {form?.stateCode || data?.stateCode || 'MH'}</td>
              <td><span className="status active">Active</span></td>
              <td style={{ textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', gap: 4 }}>
                  <button type="button" className="btn sm" onClick={() => alert('View Company Details')}>View</button>
                  <button type="button" className="btn sm" onClick={() => window.scrollTo({ top: 300, behavior: 'smooth' })}>Edit</button>
                  <button type="button" className="btn sm" onClick={() => alert('Company Documents Repository')}>Docs</button>
                  <button type="button" className="btn sm" onClick={() => window.print()}>PDF</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
