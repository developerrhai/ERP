// The Add / Edit form of the V40 registers (Assets, Logistics, Finance, ...). Built from the register's own columns.
// QA ERP-VAL-01 / ERP-VAL-02: blank mandatory fields block Save Record and turn red, dates use the calendar picker,
// statuses / categories / departments are dropdown lists, numbers reject text and negatives, GSTIN / PAN / mobile are
// format-checked. QA ERP-DOC-01: every form carries the "Attach Documents (+ Upload File)" field.
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AttachDocs } from '../../components/AttachDocs';
import {
  ASSET_STATUS_OPTIONS,
  STATUS_OPTIONS,
  fieldRuleError,
  inferFieldKind,
  type FieldKind,
} from '../../lib/validators';
import { registry } from '../../lib/registry';
import type { V40Column } from '../sales/salesV40Api';

const FORM_DEPARTMENTS = [
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
];
export const ASSET_CATEGORIES = [
  'Plant & Machinery',
  'Quality Instruments',
  'Vehicles',
  'Computers & IT',
  'Furniture & Fixtures',
  'Office Equipment',
  'Tools & Dies',
  'Electrical Installations',
  'Buildings',
  'Land',
];

/** Columns whose value is always picked from a fixed list. */
const LISTS: { test: RegExp; options: readonly string[] }[] = [
  { test: /^priority$/i, options: ['Low', 'Medium', 'High', 'Critical'] },
  {
    test: /maintenance type|service type/i,
    options: ['Preventive', 'Breakdown', 'Predictive', 'Calibration'],
  },
  { test: /disposal method/i, options: ['Sale', 'Scrap', 'Donation', 'Write-off'] },
  { test: /^method\b/i, options: ['SLM', 'WDV'] },
  {
    test: /account type/i,
    options: ['Asset', 'Liability', 'Equity', 'Revenue', 'Income', 'Expense'],
  },
  { test: /normal balance/i, options: ['Debit', 'Credit'] },
  { test: /posting allowed|cost cent(er|re) required|is group/i, options: ['Yes', 'No'] },
  {
    test: /parent group/i,
    options: [
      'Root Asset',
      'Current Assets',
      'Inventories',
      'Duties & Taxes',
      'Fixed Assets',
      'Root Liability',
      'Current Liabilities',
      'Net Worth',
      'Income',
      'Direct Expenses',
      'Manufacturing Overhead',
      'Indirect Expenses',
    ],
  },
];

/** Fields that never have to be filled (the number is auto-generated; the rest are free notes and references). */
const OPTIONAL =
  /remark|note|comment|description|reference|^ref\b|attachment|docs?$|narration|address|gstin|^pan\b|e-?mail|mobile|phone|completed date|last verified/i;

export interface FormRule {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  list?: readonly string[];
}

export function buildRules(
  columns: V40Column[],
  pageId: string,
  initial?: Record<string, unknown>,
): FormRule[] {
  let effectiveCols = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs');
  if (effectiveCols.length === 0 && pageId) {
    const profileFields = registry.profiles[pageId]?.fields ?? [];
    if (profileFields.length > 0) {
      effectiveCols = profileFields.map((fld) => {
        const isNum = /amount|total|cost|price|gross|net|tax|gst|score|percent|%|qty|quantity|count|hours|rate|value/i.test(fld);
        const isDate = /date|due|valid|till|from|time|period|dob|doj/i.test(fld);
        const isPill = /status|stage|priority|type|mode|consent|level/i.test(fld);
        return {
          key: fld,
          label: fld,
          type: isNum ? 'num' : isDate ? 'date' : isPill ? 'pill' : 'text',
          source: true,
        };
      });
    }
  }
  const cols = effectiveCols;
  const statusList = pageId.startsWith('asset-') ? ASSET_STATUS_OPTIONS : STATUS_OPTIONS;
  const info = cols.map((c, i) => {
    const label = c.label;
    const isStatus = /status/i.test(c.key);
    const isDept = /dept|department/i.test(c.key);
    const isCategory = pageId.startsWith('asset-') && /^category$/i.test(c.key);
    let list: readonly string[] | undefined;
    if (isStatus) list = statusList;
    else if (isDept) list = FORM_DEPARTMENTS;
    else if (isCategory) list = ASSET_CATEGORIES;
    else list = LISTS.find((l) => l.test.test(c.key) || l.test.test(label))?.options;
    // an existing record may hold a value the list does not know yet: keep it selectable so Edit never blocks on it
    const current = initial?.[c.key] ? String(initial[c.key]) : '';
    if (list && current && !list.includes(current)) list = [...list, current];
    const kind: FieldKind = isStatus ? 'status' : inferFieldKind(label, c.type);
    const optional =
      i === 0 ||
      OPTIONAL.test(label) ||
      kind === 'gstin' ||
      kind === 'pan' ||
      kind === 'mobile' ||
      kind === 'email';
    return {
      c,
      label,
      isStatus,
      isDept,
      list,
      kind,
      optional,
      identity:
        !optional &&
        (kind === 'name' ||
          kind === 'date' ||
          /name|category|type|location|account|code|method/i.test(label)),
    };
  });
  // Status and department are always mandatory (they come pre-filled); of the rest the identity columns
  // (names, types, categories, dates, locations) are mandatory - the first column is the auto-generated record number.
  const identityKeys = new Set(
    info
      .filter((x) => x.identity && !x.isStatus && !x.isDept)
      .slice(0, 5)
      .map((x) => x.c.key),
  );
  if (identityKeys.size === 0)
    info
      .filter((x) => !x.optional && !x.isStatus && !x.isDept)
      .slice(0, 3)
      .forEach((x) => identityKeys.add(x.c.key));
  return info.map((x) => ({
    key: x.c.key,
    label: x.label,
    kind: x.kind,
    required: x.isStatus || x.isDept || identityKeys.has(x.c.key),
    ...(x.list ? { list: x.list } : {}),
  }));
}

export function ruleError(rule: FormRule, value: string): string | undefined {
  if (rule.list && value.trim() && !rule.list.includes(value.trim()))
    return `${rule.label}: choose a value from the list.`;
  return fieldRuleError(
    {
      label: rule.label,
      kind: rule.list && rule.kind !== 'status' ? 'text' : rule.kind,
      required: rule.required,
      ...(rule.kind === 'status' && rule.list ? { options: rule.list } : {}),
    },
    value,
  );
}

/** Existing records may carry dd-mm-yyyy dates or "₹ 1,20,000" amounts: show them in the form the inputs accept. */
export function normalizeInitial(kind: FieldKind, v: string): string {
  if (kind === 'date') {
    const m = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(v);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : v.slice(0, 10);
  }
  if (kind === 'number' || kind === 'quantity') {
    const n = v.replace(/[₹,\s]/g, '');
    return /^-?\d+(\.\d+)?$/.test(n) ? n : v === '—' ? '' : v;
  }
  return v === '—' ? '' : v;
}

const base: CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  background: '#fff',
};
const bad: CSSProperties = {
  borderColor: '#dc2626',
  background: '#fef2f2',
  boxShadow: '0 0 0 1px #dc2626',
};

export function DynamicEntityForm({
  title,
  pageId,
  columns,
  initialValues,
  onSave,
  onCancel,
}: {
  title: string;
  pageId: string;
  columns: V40Column[];
  initialValues?: Record<string, unknown> | undefined;
  onSave: (values: Record<string, string>, files: File[]) => void;
  onCancel: () => void;
}) {
  const rules = useMemo(
    () => buildRules(columns, pageId, initialValues),
    [columns, pageId, initialValues],
  );
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const r of rules) {
      const v = initialValues?.[r.key];
      if (v !== undefined && v !== null) initial[r.key] = normalizeInitial(r.kind, typeof v === 'string' ? v : String(v as number));
      else if (r.kind === 'status') initial[r.key] = r.list?.[0] ?? 'Active';
      else if (/dept|department/i.test(r.key))
        initial[r.key] = pageId.startsWith('asset-')
          ? 'Maintenance'
          : pageId.startsWith('fin-') || pageId.startsWith('tax-')
            ? 'Finance'
            : 'Logistics';
      else initial[r.key] = '';
    }
    return initial;
  });
  const [files, setFiles] = useState<File[]>([]);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of rules) {
      const m = ruleError(r, values[r.key] ?? '');
      if (m) out[r.key] = m;
    }
    return out;
  }, [rules, values]);
  const errorCount = Object.keys(errors).length;
  const show = (key: string): string | undefined =>
    submitted || touched.has(key) ? errors[key] : undefined;
  const set = (key: string, v: string): void => setValues((p) => ({ ...p, [key]: v }));
  const touch = (key: string): void => setTouched((t) => new Set(t).add(key));

  const submit = (): void => {
    setSubmitted(true);
    if (errorCount > 0) {
      const first = rules.find((r) => errors[r.key]);
      if (first)
        formRef.current
          ?.querySelector<HTMLElement>(`[data-field="${CSS.escape(first.key)}"]`)
          ?.focus();
      return;
    }
    onSave(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])), files);
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="x-p-16px-20px x-maxh-70vh x-ovy-auto"
    >
      <p className="x-m-0-0-12px x-c-muted x-fs-13px">
        {initialValues
          ? 'Modify entity details for this record.'
          : `Enter entity specifications for new ${(!title || title === 'Records') && pageId ? (registry.profiles[pageId]?.title ?? pageId.replace(/^([a-z]+-)/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())) : title} record.`}{' '}
        Fields marked <span className="x-c-danger-hover">*</span> are mandatory.
      </p>
      {submitted && errorCount > 0 ? (
        <div
          role="alert"
          className="x-bg-hfef2f2 x-bd-1px-solid-hfecaca x-c-danger-hover x-p-8px-12px x-r-8px x-fs-12px x-mb-12px"
        >
          Cannot save: {errorCount} field{errorCount === 1 ? '' : 's'} need attention. Fill the
          fields highlighted in red.
        </div>
      ) : null}
      <div
        className="x-d-grid x-cols-repeat-auto-fit-minmax-280px-1fr x-gap-14px-18px"
      >
        {rules.map((r) => {
          const val = values[r.key] ?? '';
          const err = show(r.key);
          const common = {
            'data-field': r.key,
            id: `f-${pageId}-${r.key}`.replace(/[^A-Za-z0-9_-]/g, '_'),
            'aria-invalid': err ? true : undefined,
            'aria-required': r.required || undefined,
            onBlur: () => touch(r.key),
            style: { ...base, ...(err ? bad : null) },
          } as const;
          return (
            <div key={r.key} className="x-d-flex x-fd-column x-gap-4px">
              <label
                htmlFor={common.id}
                className="x-fs-12px x-fw-600 x-c-textn2"
              >
                {r.label}
                {r.required ? <span className="x-c-danger-hover"> *</span> : null}
              </label>
              {r.list ? (
                <select {...common} value={val} onChange={(e) => set(r.key, e.target.value)}>
                  {r.kind === 'status' ? null : (
                    <option value="">Select {r.label.toLowerCase()}…</option>
                  )}
                  {r.list.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : r.kind === 'date' ? (
                <input
                  {...common}
                  type="date"
                  value={val}
                  onChange={(e) => set(r.key, e.target.value)}
                />
              ) : r.kind === 'number' || r.kind === 'quantity' ? (
                <input
                  {...common}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="0"
                  value={val}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                  }}
                  onChange={(e) => set(r.key, e.target.value)}
                />
              ) : r.kind === 'mobile' ? (
                <input
                  {...common}
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  value={val}
                  onChange={(e) => set(r.key, e.target.value.replace(/\D/g, '').slice(0, 10))}
                />
              ) : r.kind === 'gstin' ? (
                <input
                  {...common}
                  type="text"
                  maxLength={15}
                  placeholder="22AAAAA0000A1Z5"
                  value={val}
                  onChange={(e) =>
                    set(r.key, e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                />
              ) : r.kind === 'pan' ? (
                <input
                  {...common}
                  type="text"
                  maxLength={10}
                  placeholder="ABCDE1234F"
                  value={val}
                  onChange={(e) =>
                    set(r.key, e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                />
              ) : r.kind === 'email' ? (
                <input
                  {...common}
                  type="email"
                  placeholder="name@company.com"
                  value={val}
                  onChange={(e) => set(r.key, e.target.value)}
                />
              ) : /project\s*(no|number)?/i.test(r.key) || /project\s*(no|number)?/i.test(r.label) ? (
                <>
                  <div className="x-d-flex x-gap-6px x-ai-center">
                    <input
                      {...common}
                      type="text"
                      placeholder="e.g. PRJ-2026-001"
                      value={val}
                      onChange={(e) => set(r.key, e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn sm x-ws-nowrap x-fs-11px x-p-4px-8px"
                      onClick={() => {
                        const pno = val || 'PRJ-2026-001';
                        window.open(`/m/project-global-history?project=${encodeURIComponent(pno)}`, '_blank');
                      }}
                    >
                      Load Project History
                    </button>
                  </div>
                  <small className="x-c-h0284c7 x-fs-11px x-d-block x-mt-2px">
                    Same number in every department
                  </small>
                </>
              ) : (
                <input
                  {...common}
                  type="text"
                  placeholder={
                    r.kind === 'place'
                      ? `${r.label} (letters only)`
                      : `Enter ${r.label.toLowerCase()}…`
                  }
                  value={val}
                  onChange={(e) =>
                    set(
                      r.key,
                      r.kind === 'place'
                        ? e.target.value.replace(/[^A-Za-z .'-]/g, '')
                        : e.target.value,
                    )
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
        <AttachDocs files={files} onChange={setFiles} />
      </div>
      <div
        className="x-d-flex x-jc-flex-end x-gap-10px x-mt-24px x-pt-14px x-bt-1px-solid-line"
      >
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn sm primary">
          {initialValues ? 'Save Changes' : 'Save Record'}
        </button>
      </div>
    </form>
  );
}
