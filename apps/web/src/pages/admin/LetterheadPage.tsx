// Letterhead & PDF Settings (/m/admin-settings/letterhead): the prototype's 11-field form with
// human labels, validation per CONTRACT §2.3, If-Match save, and a live letterhead preview.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { useUnsavedGuard } from '../../lib/unsaved';
import { useLoad } from '../../lib/useLoad';
import {
  CIN_MESSAGE,
  CIN_RE,
  GSTIN_MESSAGE,
  GSTIN_RE,
  PAN_MESSAGE,
  PAN_RE,
} from '../../lib/validators';
import type { ActionSet, Letterhead } from '../../types';
import {
  downloadLetterheadTestPdf,
  getLetterhead,
  LETTERHEAD_KEYS,
  saveLetterhead,
  uploadFile,
} from './adminApi';

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
  version: 'Version',
  logoFileId: 'Logo File',
  headerHeightMm: 'Header Height (mm)',
  footerHeightMm: 'Footer Height (mm)',
  primaryColor: 'Primary Color',
  showGstin: 'Show GSTIN',
  showPan: 'Show PAN',
  showCin: 'Show CIN',
};

const MAX: Partial<Record<keyof Letterhead, number>> = {
  companyName: 120,
  legalName: 300,
  address: 300,
  phone: 30,
  footer: 200,
  signatory: 100,
};

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
    if (!e[k] && v[k] && typeof v[k] === 'string' && v[k].length > max) e[k] = `At most ${max} characters.`;
  }
  if (v.email && !EMAIL_RE.test(v.email))
    e.email = 'Enter a valid email address or leave it empty.';
  if (v.website && !isUrl(v.website)) e.website = 'Enter a full URL (https://…) or leave it empty.';
  if (v.gstin && !GSTIN_RE.test(v.gstin)) e.gstin = GSTIN_MESSAGE;
  if (v.pan && !PAN_RE.test(v.pan)) e.pan = PAN_MESSAGE;
  if (v.cin && !CIN_RE.test(v.cin)) e.cin = CIN_MESSAGE;
  return e;
}

const UPPER: ReadonlySet<keyof Letterhead> = new Set(['gstin', 'pan', 'cin']);

export function LetterheadPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(getLetterhead, []);
  const [value, setValue] = useState<Letterhead | null>(null);
  // Last server copy, to know whether the form holds unsaved edits.
  const [baseline, setBaseline] = useState<Letterhead | null>(null);
  const [version, setVersion] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const inFlight = useRef(false);
  const canEdit = actions.controls;

  useEffect(() => {
    if (data) {
      setValue(data.value);
      setBaseline(data.value);
      setVersion(data.version);
    }
  }, [data]);

  const isDirty = (): boolean => {
    if (!value || !baseline) return false;
    if (LETTERHEAD_KEYS.some((k) => value[k] !== baseline[k])) return true;
    if (value.logoFileId !== baseline.logoFileId) return true;
    if (value.primaryColor !== baseline.primaryColor) return true;
    if (value.showGstin !== baseline.showGstin) return true;
    if (value.showPan !== baseline.showPan) return true;
    if (value.showCin !== baseline.showCin) return true;
    return false;
  };

  useUnsavedGuard(isDirty());

  const onLogoSelected = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || !value) return;
    setUploadingLogo(true);
    try {
      const res = await uploadFile(file);
      setValue({ ...value, logoFileId: res.id });
      toast(`Logo uploaded: ${file.name}`);
    } catch {
      toast('Failed to upload logo.');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const onRemoveLogo = (): void => {
    if (!value) return;
    setValue({ ...value, logoFileId: null });
  };

  const onTestPdf = async (): Promise<void> => {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const blob = await downloadLetterheadTestPdf();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      toast('Test PDF generated.');
    } catch {
      toast('Failed to generate test PDF.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!value || inFlight.current || !canEdit) return;
    const local = validateLetterhead(value);
    setFieldErrors(local as Record<string, string>);
    setFormError('');
    setConflict(false);
    if (Object.keys(local).length) return;
    inFlight.current = true;
    setPending(true);
    try {
      const saved = await saveLetterhead(version, value);
      setValue(saved.value);
      setBaseline(saved.value);
      setVersion(saved.version);
      toast('Letterhead saved.');
    } catch (err) {
      const ui = toUiError(err);
      setFieldErrors(ui.fields);
      setFormError(ui.message);
      setConflict(ui.code === 'VERSION_CONFLICT');
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
              <ErrorMessage
                onReload={
                  conflict
                    ? () => {
                        // Take the saved letterhead (and its new version) from the server.
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
              <div className="field">
                <label htmlFor="logo-upload">Company Logo</label>
                {value.logoFileId ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                    <img
                      src={`/api/v1/files/${value.logoFileId}`}
                      alt="Logo preview"
                      style={{ height: 44, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 6, padding: 4 }}
                    />
                    {canEdit ? (
                      <button type="button" className="btn sm danger" onClick={onRemoveLogo}>
                        Remove Logo
                      </button>
                    ) : null}
                  </div>
                ) : canEdit ? (
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    disabled={uploadingLogo}
                    onChange={(e) => void onLogoSelected(e)}
                  />
                ) : (
                  <span className="v8-sub">No logo configured</span>
                )}
                {uploadingLogo ? <small>Uploading logo…</small> : null}
              </div>
              <div className="field">
                <label htmlFor="primary-color">Primary Accent Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input
                    id="primary-color"
                    type="color"
                    value={value.primaryColor || '#1B365D'}
                    disabled={!canEdit}
                    style={{ width: 44, height: 36, padding: 2, cursor: canEdit ? 'pointer' : 'default', border: '1px solid var(--line)', borderRadius: 6 }}
                    onChange={(e) => setValue({ ...value, primaryColor: e.target.value })}
                  />
                  <input
                    type="text"
                    value={value.primaryColor || '#1B365D'}
                    maxLength={7}
                    readOnly={!canEdit}
                    style={{ width: 100 }}
                    onChange={(e) => setValue({ ...value, primaryColor: e.target.value })}
                  />
                </div>
              </div>
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
              <div className="field" style={{ gridColumn: '1 / -1', display: 'flex', gap: 24, marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={value.showGstin !== false}
                    disabled={!canEdit}
                    onChange={(e) => setValue({ ...value, showGstin: e.target.checked })}
                  />
                  Show GSTIN
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={value.showPan !== false}
                    disabled={!canEdit}
                    onChange={(e) => setValue({ ...value, showPan: e.target.checked })}
                  />
                  Show PAN
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={value.showCin !== false}
                    disabled={!canEdit}
                    onChange={(e) => setValue({ ...value, showCin: e.target.checked })}
                  />
                  Show CIN
                </label>
              </div>
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
                disabled={generatingPdf}
                onClick={() => void onTestPdf()}
              >
                {generatingPdf ? 'Generating…' : 'Test PDF'}
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
    value.showGstin !== false && value.gstin && `GSTIN: ${value.gstin}`,
    value.showPan !== false && value.pan && `PAN: ${value.pan}`,
    value.showCin !== false && value.cin && `CIN: ${value.cin}`,
  ].filter(Boolean);
  const contact = [value.phone, value.email, value.website].filter(Boolean);
  return (
    <section className="v8-section letterhead-preview-wrap" aria-labelledby="lh-preview-title">
      <div className="v8-titlebar">
        <h3 id="lh-preview-title">Live preview</h3>
        <span className="v8-sub">How the header and footer will look on generated PDFs.</span>
      </div>
      <div className="v92-payslip-preview letterhead-preview" data-testid="letterhead-preview">
        <div className="ph" style={{ borderTop: `4px solid ${value.primaryColor || '#1B365D'}` }}>
          {value.logoFileId ? (
            <img
              src={`/api/v1/files/${value.logoFileId}`}
              alt="Letterhead Logo"
              style={{ maxHeight: 44, objectFit: 'contain', marginBottom: 8 }}
            />
          ) : null}
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
