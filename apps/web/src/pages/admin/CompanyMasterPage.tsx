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

type FormKey = 'legalName' | 'tradeName' | 'gstin' | 'pan' | 'cin' | 'address';
type Form = Record<FormKey, string>;
const KEYS: readonly FormKey[] = ['legalName', 'tradeName', 'gstin', 'pan', 'cin', 'address'];
const OPTIONAL: ReadonlySet<FormKey> = new Set(['gstin', 'pan', 'cin', 'address']);
const UPPER: ReadonlySet<FormKey> = new Set(['gstin', 'pan', 'cin']);

const LABELS: Record<FormKey, string> = {
  legalName: 'Legal Name',
  tradeName: 'Trade Name',
  gstin: 'GSTIN',
  pan: 'PAN',
  cin: 'CIN',
  address: 'Registered Address',
};
const MAX: Record<FormKey, number> = {
  legalName: 300,
  tradeName: 120,
  gstin: 15,
  pan: 10,
  cin: 21,
  address: 300,
};

function toForm(c: Company): Form {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName,
    gstin: c.gstin ?? '',
    pan: c.pan ?? '',
    cin: c.cin ?? '',
    address: c.address ?? '',
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
    </>
  );
}
