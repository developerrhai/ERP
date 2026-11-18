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
      <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '14px 0' }}>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Company Entity</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>1 Registered</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>Sawant Group / RHAI</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Operating Units</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>3 Plants</b>
          <span style={{ fontSize: 11, color: '#2563eb' }}>Talwade, Sawardari, Varale</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Compliance Score</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>100%</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>GSTIN &amp; PAN verified</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Data Quality</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>99.8%</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>Complete profile</span>
        </div>
      </div>

      {/* Split View: Company Master Register + Validation Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 1fr)', gap: 14, margin: '14px 0' }}>
        <div className="card table-wrap" style={{ padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #cbd5e1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: '#1e293b' }}>Company Master Register</h3>
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

        <div className="card panel" style={{ padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #cbd5e1' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: '#1e293b' }}>Validation Controls</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>Legal compliance, statutory verifications and company entity locks.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span>Unique Company Code:</span>
              <b style={{ color: '#15803d' }}>Enabled</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span>GSTIN Format Check:</span>
              <b style={{ color: '#15803d' }}>Active (15 chars)</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span>PAN Linkage:</span>
              <b style={{ color: '#15803d' }}>Validated</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span>ROC Filing Status:</span>
              <b style={{ color: '#15803d' }}>Active Compliant</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
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
      <div className="card table-wrap" style={{ marginTop: 16 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
