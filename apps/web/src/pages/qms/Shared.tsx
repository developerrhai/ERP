// Shared pieces of the Phase 12 quality screens: tabs, a searchable picker for items / customers / suppliers / instruments,
// and the form renderer that draws any template's fields (one engine, many forms: R-17).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { lookupRef } from '../../lib/qmsApi';
import type { FieldColumn, FieldDef, Option } from '../../lib/qmsApi';

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

/** A 'table' field's rows: attendees, action items and the like, each row shaped by the field's own columns. */
function TableField({
  idPrefix,
  columns,
  value,
  disabled,
  onChange,
}: {
  idPrefix: string;
  columns: FieldColumn[];
  value: Record<string, string>[];
  disabled?: boolean | undefined;
  onChange: (rows: Record<string, string>[]) => void;
}) {
  const rows = Array.isArray(value) ? value : [];
  const setCell = (i: number, key: string, v: string) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, [key]: v } : r)));
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {disabled ? null : <th />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1}>No rows yet.</td>
            </tr>
          ) : null}
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key}>
                  <input
                    aria-label={`${c.label} row ${i + 1}`}
                    id={`${idPrefix}-${i}-${c.key}`}
                    type={c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'}
                    value={s(r[c.key])}
                    disabled={disabled}
                    onChange={(e) => setCell(i, c.key, e.target.value)}
                  />
                </td>
              ))}
              {disabled ? null : (
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onChange(rows.filter((_, k) => k !== i))}
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {disabled ? null : (
        <button
          type="button"
          className="btn"
          onClick={() =>
            onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, '']))])
          }
        >
          + Add row
        </button>
      )}
    </div>
  );
}

/** Draws the fields of a template. Values are strings (or, for 'table', rows); errors come from the API by field key. */
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
  onChange: (key: string, value: unknown, label?: string) => void;
}) {
  return (
    <div className="form-grid">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const v = s(values[f.key]);
        const err = errors?.[f.key];
        const wide = f.type === 'textarea' || f.type === 'table';
        let input: ReactNode;
        if (f.type === 'table')
          input = (
            <TableField
              idPrefix={id}
              columns={f.columns ?? []}
              value={(values[f.key] as Record<string, string>[]) ?? []}
              disabled={readOnly}
              onChange={(rows) => onChange(f.key, rows)}
            />
          );
        else if (f.type === 'textarea')
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
