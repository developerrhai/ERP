// Shared "+ Add New / Edit" form for the V40 registers (QA report ERP-ADD-01/02, ERP-DOC-01, ERP-VAL-01).
//  * every column of the register becomes a field (dropdown / calendar / number / text by its meaning);
//  * Project Number linking (same number in every department + Load Project History) and
//    Attach Documents (Excel, Word, PDF, Text) are always present;
//  * an empty or invalid form is never saved: the bad fields turn red and the form says what to fix.
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export type FieldKind =
  | 'text'
  | 'name'
  | 'number'
  | 'date'
  | 'select'
  | 'email'
  | 'phone'
  | 'gstin'
  | 'pan'
  | 'textarea';

export interface FormField {
  key: string;
  label: string;
  kind?: FieldKind;
  options?: readonly string[];
  required?: boolean;
  min?: number;
  placeholder?: string;
}

export interface ColumnLike {
  key: string;
  label: string;
  type?: string;
}

export const ATTACH_ACCEPT = '.xlsx,.xls,.csv,.docx,.doc,.pdf,.txt';
const ATTACH_EXT = /\.(xlsx|xls|csv|docx|doc|pdf|txt)$/i;

export const DEPARTMENT_OPTIONS = [
  'Administration',
  'Sales',
  'Purchase',
  'Finance',
  'HR',
  'Production',
  'Quality',
  'Maintenance',
  'Warehouse',
  'Logistics',
  'Projects',
  'Service',
] as const;

const GSTIN_RE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MOBILE_RE = /^[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\s.&'-]*$/u;

/** Status choices by page family. A status is always a dropdown, never free text. */
export function statusOptionsFor(pageId: string): readonly string[] {
  if (pageId.startsWith('service-')) return ['New', 'Assigned', 'On Site', 'Waiting Parts', 'Closed', 'Active', 'Pending'];
  if (pageId.startsWith('dms-')) return ['Draft', 'Active', 'Under Review', 'Approved', 'Archived'];
  if (pageId.startsWith('comm-')) return ['Active', 'Queued', 'Sent', 'Delivered', 'Failed', 'Paused'];
  if (pageId.startsWith('proj-')) return ['Planned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
  if (pageId.startsWith('gate-') || pageId.startsWith('log-') || pageId.startsWith('fleet-'))
    return ['Pending', 'Scheduled', 'In Transit', 'Calculated', 'Delivered', 'Completed', 'Returned', 'Cancelled'];
  if (pageId.startsWith('asset-')) return ['Active', 'In Use', 'Allocated', 'Under Maintenance', 'Disposed'];
  if (pageId.startsWith('fin-')) return ['Draft', 'Active', 'Posted', 'Pending', 'Reversed', 'Inactive'];
  if (pageId.startsWith('pay-')) return ['Draft', 'Active', 'Calculated', 'Approved', 'Posted', 'Inactive'];
  return ['Active', 'Pending', 'In Progress', 'Completed', 'Closed', 'Inactive'];
}

const FINANCE_SELECTS: Record<string, readonly string[]> = {
  'account type': ['Asset', 'Liability', 'Equity', 'Income', 'Expense'],
  'parent group': ['Current Assets', 'Fixed Assets', 'Current Liabilities', 'Long Term Liabilities', 'Capital', 'Direct Income', 'Indirect Income', 'Direct Expenses', 'Indirect Expenses'],
  'normal balance': ['Debit', 'Credit'],
  'posting allowed': ['Yes', 'No'],
  'cost center required': ['Yes', 'No'],
};

/** Guess the kind of a column from what it is called. */
export function kindOf(col: ColumnLike): FieldKind {
  const l = `${col.key} ${col.label}`.toLowerCase();
  if (/gstin/.test(l)) return 'gstin';
  if (/\bpan\b/.test(l)) return 'pan';
  if (/mobile|phone|contact no/.test(l)) return 'phone';
  if (/e-?mail/.test(l)) return 'email';
  if (col.type === 'date' || /(^|\s)(date|effective|expiry|expires|valid (from|to|till|until)|due on|required by|renewal|purchase|last activity|last run|next run)/.test(l) || /date$/.test(l)) return 'date';
  if (col.type === 'inr' || col.type === 'num') return 'number';
  if (/(qty|quantity|amount|cost|price|rate\b|%|salary|allowance|variable pay|budget|km\b|weight|score|rating|hours|days\b|limit|retention|years|count|total|capacity|revenue|value)/.test(l)) return 'number';
  if (/(^|\s)(owner|employee|technician|driver|contact person|approver|assigned to|customer contact)$/.test(col.label.toLowerCase())) return 'name';
  if (/description|remarks|notes|message|body|specification/.test(l)) return 'textarea';
  return 'text';
}

/** The fields of a register's form: its own columns first, the controlled-dropdown rules applied on top. */
export function fieldsFromColumns(pageId: string, columns: readonly ColumnLike[]): FormField[] {
  const statusOptions = statusOptionsFor(pageId);
  const out: FormField[] = [];
  columns.forEach((c, i) => {
    const l = c.label.toLowerCase();
    if (c.type === 'actions' || c.type === 'docs') return;
    if (/project number/.test(l)) return; // always added separately
    if (/^status$|status$/.test(l)) {
      out.push({ key: c.key, label: c.label, kind: 'select', options: statusOptions, required: true });
      return;
    }
    if (/department|^dept$/.test(l)) {
      out.push({ key: c.key, label: c.label, kind: 'select', options: DEPARTMENT_OPTIONS });
      return;
    }
    const fin = FINANCE_SELECTS[l];
    if (fin) {
      out.push({ key: c.key, label: c.label, kind: 'select', options: fin, required: true });
      return;
    }
    const kind = kindOf(c);
    out.push({ key: c.key, label: c.label, kind, required: i === 0 || /name$/.test(l), min: kind === 'number' ? 0 : undefined });
  });
  return out;
}

/** Null when the value is fine, otherwise the sentence shown under the field. */
export function validateField(f: FormField, raw: string): string | null {
  const v = raw.trim();
  if (!v) return f.required ? `${f.label} is required.` : null;
  switch (f.kind) {
    case 'number': {
      const n = Number(v.replace(/[,₹\s]/g, '').replace(/%$/, ''));
      if (!Number.isFinite(n)) return `${f.label} must be a number.`;
      if (n < (f.min ?? 0)) return `${f.label} cannot be negative.`;
      return null;
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? null : `${f.label} must be a valid date (use the calendar).`;
    case 'gstin':
      return GSTIN_RE.test(v.toUpperCase()) ? null : `${f.label} must be a 15-character GSTIN.`;
    case 'pan':
      return PAN_RE.test(v.toUpperCase()) ? null : `${f.label} must be a 10-character PAN (AAAAA9999A).`;
    case 'phone':
      return MOBILE_RE.test(v) ? null : `${f.label} must be a 10-digit mobile number.`;
    case 'email':
      return EMAIL_RE.test(v) ? null : `${f.label} must be a valid email address.`;
    case 'name':
      return NAME_RE.test(v) ? null : `${f.label} must be text (letters only).`;
    case 'select':
      return f.options && !f.options.includes(v) ? `Choose ${f.label} from the list.` : null;
    default:
      return null;
  }
}

export interface FormResult {
  values: Record<string, string>;
  files: File[];
}

const ERR_STYLE = { borderColor: '#dc2626', background: '#fef2f2', boxShadow: '0 0 0 1px #dc2626' } as const;
const BASE_STYLE = { padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff', width: '100%' } as const;

export function EntityForm({
  pageId,
  title,
  fields,
  initialValues,
  onSave,
  onCancel,
  showProject = true,
  hint,
}: {
  pageId: string;
  title: string;
  fields: readonly FormField[];
  initialValues?: Record<string, unknown> | undefined;
  onSave: (r: FormResult) => void;
  onCancel: () => void;
  showProject?: boolean;
  hint?: string;
}) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      const existing = initialValues?.[f.key];
      if (existing !== undefined && existing !== null) init[f.key] = String(existing);
      else init[f.key] = f.kind === 'select' && /status/i.test(f.label) ? (f.options?.[0] ?? '') : '';
    }
    init['Project Number'] = String(initialValues?.['Project Number'] ?? '');
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [banner, setBanner] = useState('');
  const allFields = useMemo(() => fields, [fields]);

  const set = (key: string, v: string): void => {
    setValues((p) => ({ ...p, [key]: v }));
    if (errors[key]) setErrors((p) => {
      const n = { ...p };
      delete n[key];
      return n;
    });
  };

  const addFiles = (list: FileList | null): void => {
    if (!list) return;
    const bad: string[] = [];
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (!ATTACH_EXT.test(f.name)) bad.push(f.name);
      else if (f.size > 10 * 1024 * 1024) bad.push(`${f.name} (over 10 MB)`);
      else ok.push(f);
    }
    setFileError(bad.length ? `Not attached: ${bad.join(', ')}. Use Excel, Word, PDF or Text files up to 10 MB.` : '');
    if (ok.length) setFiles((p) => [...p, ...ok]);
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = (): void => {
    const next: Record<string, string> = {};
    const anyValue = allFields.some((f) => values[f.key]?.trim() && !(f.kind === 'select' && /status/i.test(f.label)));
    for (const f of allFields) {
      const e = validateField(f, values[f.key] ?? '');
      if (e) next[f.key] = e;
    }
    if (!anyValue) {
      for (const f of allFields) {
        if (f.required && !next[f.key]) next[f.key] = `${f.label} is required.`;
      }
      if (Object.keys(next).length === 0 && allFields[0]) next[allFields[0].key] = `${allFields[0].label} is required.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setBanner(anyValue ? 'Please fix the highlighted fields.' : 'An empty form cannot be saved. Fill in the highlighted fields.');
      return;
    }
    setBanner('');
    onSave({ values: { ...values }, files });
  };

  const project = values['Project Number'] ?? '';

  return (
    <div className="x-p-16px-20px x-maxh-72vh x-ovy-auto" data-testid="entity-form">
      <p className="x-m-0-0-14px x-c-muted x-fs-13px">
        {hint ?? (initialValues ? `Change the details of this ${title.toLowerCase()} record.` : `Fill in the details of the new ${title.toLowerCase()} record.`)}
      </p>
      {banner ? (
        <div role="alert" className="x-m-0-0-12px x-p-8px-12px x-r-6px x-bg-hfef2f2 x-c-danger-hover x-bd-1px-solid-hfecaca x-fs-13px x-fw-600">
          {banner}
        </div>
      ) : null}
      <div className="x-d-grid x-cols-repeat-auto-fit-minmax-260px-1fr x-gap-14px-18px">
        {allFields.map((f) => {
          const val = values[f.key] ?? '';
          const err = errors[f.key];
          const id = `fk-${pageId}-${f.key}`.replace(/[^a-zA-Z0-9_-]/g, '_');
          const style = err ? { ...BASE_STYLE, ...ERR_STYLE } : BASE_STYLE;
          return (
            <div key={f.key} className={[err ? 'fk-field fk-bad' : 'fk-field', 'x-d-flex x-fd-column x-gap-4px'].filter(Boolean).join(' ')}>
              <label htmlFor={id} style={{ fontSize: 12, fontWeight: 600, color: err ? '#b91c1c' : '#334155' }}>
                {f.label}
                {f.required ? <span className="x-c-danger-hover"> *</span> : null}
              </label>
              {f.kind === 'select' ? (
                <select id={id} value={val} aria-invalid={!!err} style={style} onChange={(e) => set(f.key, e.target.value)}>
                  {!/status/i.test(f.label) ? <option value="">{`Select ${f.label.toLowerCase()}`}</option> : null}
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.kind === 'textarea' ? (
                <textarea id={id} rows={2} value={val} aria-invalid={!!err} style={style} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              ) : f.kind === 'date' ? (
                <input id={id} type="date" value={val} aria-invalid={!!err} style={style} onChange={(e) => set(f.key, e.target.value)} />
              ) : f.kind === 'number' ? (
                <input id={id} type="number" min={f.min ?? 0} step="any" inputMode="decimal" value={val} aria-invalid={!!err} style={style} placeholder={f.placeholder ?? '0'} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input
                  id={id}
                  type={f.kind === 'email' ? 'email' : f.kind === 'phone' ? 'tel' : 'text'}
                  value={val}
                  aria-invalid={!!err}
                  style={style}
                  maxLength={f.kind === 'gstin' ? 15 : f.kind === 'pan' ? 10 : f.kind === 'phone' ? 10 : undefined}
                  placeholder={f.placeholder ?? `Enter ${f.label.toLowerCase()}`}
                  onChange={(e) =>
                    set(f.key, f.kind === 'gstin' || f.kind === 'pan' ? e.target.value.toUpperCase() : f.kind === 'phone' ? e.target.value.replace(/\D/g, '') : e.target.value)
                  }
                />
              )}
              {err ? (
                <span role="alert" className="x-c-danger-hover x-fs-11px">
                  {err}
                </span>
              ) : null}
            </div>
          );
        })}

        {showProject ? (
          <div className="fk-project x-d-flex x-fd-column x-gap-4px">
            <label htmlFor={`fk-${pageId}-project`} className="x-fs-12px x-fw-600 x-c-textn2">
              Project Number
            </label>
            <div className="x-d-flex x-gap-6px">
              <input
                id={`fk-${pageId}-project`}
                type="text"
                value={project}
                placeholder="e.g. PRJ-2026-001"
                style={{ ...BASE_STYLE, flex: 1 }}
                onChange={(e) => set('Project Number', e.target.value.toUpperCase())}
              />
              <button
                type="button"
                className="btn sm"
                onClick={() => navigate(project.trim() ? `/m/project-global-history?project=${encodeURIComponent(project.trim())}` : '/m/project-global-history')}
              >
                Load Project History
              </button>
            </div>
            <span className="x-fs-11px x-c-muted">Same number in every department: the project links this record across Sales, Purchase, Production, Finance and the rest.</span>
          </div>
        ) : null}
      </div>

      <div className="fk-attach x-mt-16px x-p-12px x-bd-1px-dashed-h94a3b8 x-r-8px x-bg-card2">
        <div className="x-d-flex x-ai-center x-jc-space-between x-gap-8px x-wrap-wrap">
          <div>
            <strong className="x-fs-13px">Attach Documents</strong>
            <div className="x-fs-11px x-c-muted">Excel (.xlsx, .xls, .csv), Word (.docx, .doc), PDF (.pdf) or Text (.txt), up to 10 MB each.</div>
          </div>
          <button type="button" className="btn sm" onClick={() => fileInput.current?.click()}>
            ＋ Upload File
          </button>
          <input ref={fileInput} type="file" multiple accept={ATTACH_ACCEPT} aria-label="Attach documents" style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
        </div>
        {fileError ? (
          <div role="alert" className="x-c-danger-hover x-fs-11px x-mt-6px">
            {fileError}
          </div>
        ) : null}
        {files.length > 0 ? (
          <ul className="x-list-style-none x-m-8px-0-0 x-p-0 x-d-grid x-gap-4px">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="x-d-flex x-jc-space-between x-fs-12px x-bg-card x-bd-1px-solid-line x-r-6px x-p-4px-8px">
                <span>
                  📎 {f.name} <span className="x-c-muted">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
                </span>
                <button type="button" className="btn sm" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="x-d-flex x-jc-flex-end x-gap-10px x-mt-20px x-pt-14px x-bt-1px-solid-line">
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn sm primary" onClick={submit}>
          {initialValues ? 'Save Changes' : 'Save Record'}
        </button>
      </div>
    </div>
  );
}
