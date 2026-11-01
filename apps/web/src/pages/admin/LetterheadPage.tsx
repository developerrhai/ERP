// Letterhead & PDF Settings (/m/admin-settings/letterhead): the prototype's 11-field form with
// human labels, validation per CONTRACT §2.3, If-Match save, and a live letterhead preview.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, Letterhead } from '../../types';
import { getLetterhead, LETTERHEAD_KEYS, saveLetterhead } from './adminApi';

export const LETTERHEAD_LABELS: Record<keyof Letterhead, string> = {
  companyName: 'Company Name',
  legalName: 'Legal Name',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  gstin: 'GSTIN',
  pan: 'PAN',
  cin: 'CIN',
  footer: 'Footer',
  signatory: 'Signatory',
};

const MAX: Partial<Record<keyof Letterhead, number>> = {
  companyName: 120,
  legalName: 300,
  address: 300,
  phone: 30,
  footer: 200,
  signatory: 100,
};

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Client mirror of the server rules, for immediate feedback (the server re-validates). */
export function validateLetterhead(v: Letterhead): Partial<Record<keyof Letterhead, string>> {
  const e: Partial<Record<keyof Letterhead, string>> = {};
  if (!v.companyName.trim()) e.companyName = 'Company name is required.';
  for (const [k, max] of Object.entries(MAX) as [keyof Letterhead, number][]) {
    if (!e[k] && v[k].length > max) e[k] = `At most ${max} characters.`;
  }
  if (v.email && !EMAIL_RE.test(v.email))
    e.email = 'Enter a valid email address or leave it empty.';
  if (v.website && !isUrl(v.website)) e.website = 'Enter a full URL (https://…) or leave it empty.';
  if (v.gstin && !GSTIN_RE.test(v.gstin))
    e.gstin = 'GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5.';
  if (v.pan && !PAN_RE.test(v.pan)) e.pan = 'PAN must look like ABCDE1234F.';
  if (v.cin && !CIN_RE.test(v.cin))
    e.cin = 'CIN must be 21 characters, e.g. U12345MH2020PTC123456.';
  return e;
}

const UPPER: ReadonlySet<keyof Letterhead> = new Set(['gstin', 'pan', 'cin']);

export function LetterheadPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error } = useLoad(getLetterhead, []);
  const [value, setValue] = useState<Letterhead | null>(null);
  const [version, setVersion] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const canEdit = actions.controls;

  useEffect(() => {
    if (data) {
      setValue(data.value);
      setVersion(data.version);
    }
  }, [data]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!value || inFlight.current || !canEdit) return;
    const local = validateLetterhead(value);
    setFieldErrors(local as Record<string, string>);
    setFormError('');
    if (Object.keys(local).length) return;
    inFlight.current = true;
    setPending(true);
    try {
      const saved = await saveLetterhead(version, value);
      setValue(saved.value);
      setVersion(saved.version);
      toast('Letterhead saved.');
    } catch (err) {
      const ui = toUiError(err);
      setFieldErrors(ui.fields);
      setFormError(ui.message);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Letterhead &amp; PDF Settings</h1>
          <p>Used by PDFs in every ERP module.</p>
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
      {loading && !value ? (
        <p className="v8-sub" role="status">
          Loading…
        </p>
      ) : null}
      {value ? (
        <>
          <form className="card panel" onSubmit={(e) => void onSubmit(e)} noValidate>
            {formError ? (
              <div className="msg error show static" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="form-grid">
              {LETTERHEAD_KEYS.map((k) => (
                <Field
                  key={k}
                  label={LETTERHEAD_LABELS[k]}
                  name={k}
                  value={value[k]}
                  readOnly={!canEdit}
                  type={k === 'email' ? 'email' : k === 'website' ? 'url' : 'text'}
                  autoComplete="off"
                  error={fieldErrors[k]}
                  onChange={(e) => {
                    const v = UPPER.has(k) ? e.target.value.toUpperCase() : e.target.value;
                    setValue({ ...value, [k]: v });
                  }}
                />
              ))}
            </div>
            <div className="actions letterhead-actions">
              {canEdit ? (
                <button type="submit" className="btn primary" disabled={pending}>
                  {pending ? 'Saving…' : 'Save Letterhead'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled
                title="PDF generation arrives in Phase 4"
              >
                Test PDF
              </button>
            </div>
          </form>
          <LetterheadPreview value={value} />
        </>
      ) : null}
    </>
  );
}

export function LetterheadPreview({ value }: { value: Letterhead }) {
  const ids = [
    value.gstin && `GSTIN: ${value.gstin}`,
    value.pan && `PAN: ${value.pan}`,
    value.cin && `CIN: ${value.cin}`,
  ].filter(Boolean);
  const contact = [value.phone, value.email, value.website].filter(Boolean);
  return (
    <section className="v8-section letterhead-preview-wrap" aria-labelledby="lh-preview-title">
      <div className="v8-titlebar">
        <h3 id="lh-preview-title">Live preview</h3>
        <span className="v8-sub">How the header and footer will look on generated PDFs.</span>
      </div>
      <div className="v92-payslip-preview letterhead-preview" data-testid="letterhead-preview">
        <div className="ph">
          <h2>{value.companyName || 'Company Name'}</h2>
          {value.legalName ? <small className="lh-line">{value.legalName}</small> : null}
          <small className="lh-line">{value.address || 'Registered address'}</small>
          {contact.length ? <small className="lh-line">{contact.join(' • ')}</small> : null}
          {ids.length ? <small className="lh-line lh-ids">{ids.join(' | ')}</small> : null}
        </div>
        <div className="body">
          <p className="v8-sub">Document content appears here.</p>
        </div>
        <div className="net">
          <span>{value.footer}</span>
          <b className="lh-sign">{value.signatory}</b>
        </div>
      </div>
    </section>
  );
}
