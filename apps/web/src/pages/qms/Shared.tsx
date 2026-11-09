// Shared pieces of the Phase 12 quality screens: tabs, a searchable picker for items / customers / suppliers / instruments,
// and the form renderer that draws any template's fields (one engine, many forms: R-17).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { lookupRef } from '../../lib/qmsApi';
import type { FieldDef, Option } from '../../lib/qmsApi';

export const s = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v as string);

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: [T, string][];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          className={value === k ? 'tab active' : 'tab'}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Type to search, then pick. `label` is the name already known for the current value. */
export function RefPicker({
  id,
  kind,
  value,
  label,
  disabled,
  onChange,
}: {
  id: string;
  kind: 'item' | 'customer' | 'supplier' | 'instrument';
  value: string;
  label?: string | undefined;
  disabled?: boolean | undefined;
  onChange: (id: string, label: string) => void;
}) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<Option[]>([]);
  useEffect(() => {
    if (disabled) return;
    let alive = true;
    const t = setTimeout(() => {
      lookupRef(kind, q)
        .then((o) => {
          if (alive) setOpts(o);
        })
        .catch(() => {
          if (alive) setOpts([]);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kind, q, disabled]);
  if (disabled) return <input id={id} value={label || value} disabled readOnly />;
  const known = opts.some((o) => o.id === value);
  return (
    <div className="ref-picker">
      <input
        aria-label={`Search ${kind}`}
        placeholder="Type to search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const o = opts.find((x) => x.id === e.target.value);
          onChange(e.target.value, o?.label ?? '');
        }}
      >
        <option value="">— choose —</option>
        {value && !known ? <option value={value}>{label || 'Selected'}</option> : null}
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Draws the fields of a template. Values are strings; errors come from the API by field key. */
export function DynamicFields({
  fields,
  values,
  labels,
  errors,
  readOnly,
  idPrefix,
  onChange,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  labels?: Record<string, string> | undefined;
  errors?: Record<string, string> | undefined;
  readOnly?: boolean | undefined;
  idPrefix: string;
  onChange: (key: string, value: string, label?: string) => void;
}) {
  return (
    <div className="form-grid">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const v = s(values[f.key]);
        const err = errors?.[f.key];
        const wide = f.type === 'textarea';
        let input: ReactNode;
        if (f.type === 'textarea')
          input = (
            <textarea
              id={id}
              rows={3}
              value={v}
              disabled={readOnly}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          );
        else if (f.type === 'select')
          input = (
            <select
              id={id}
              value={v}
              disabled={readOnly}
              onChange={(e) => onChange(f.key, e.target.value)}
            >
              <option value="">— choose —</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        else if (
          f.type === 'item' ||
          f.type === 'customer' ||
          f.type === 'supplier' ||
          f.type === 'instrument'
        )
          input = (
            <RefPicker
              id={id}
              kind={f.type}
              value={v}
              label={labels?.[f.key]}
              disabled={readOnly}
              onChange={(nid, nl) => onChange(f.key, nid, nl)}
            />
          );
        else
          input = (
            <input
              id={id}
              type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
              value={v}
              disabled={readOnly}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          );
        return (
          <div className="field" key={f.key} style={wide ? { gridColumn: '1 / -1' } : undefined}>
            <label htmlFor={id}>
              {f.label}
              {f.required ? ' *' : ''}
            </label>
            {input}
            {err ? (
              <div className="field-error" role="alert">
                {err}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export const STATUS_TONE: Record<string, string> = {
  Draft: 'draft',
  Submitted: 'pending',
  Decided: 'approved',
  Open: 'pending',
  Closed: 'approved',
  Cancelled: 'cancelled',
  ACCEPTED: 'approved',
  REJECTED: 'rejected',
  CONDITIONAL: 'pending',
};
