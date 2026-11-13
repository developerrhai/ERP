// Phase 22: the one Add / Edit form of the screens (driven by GET /screens/:pageId/form).
// Labels are the V40 field labels; every input is found by its label; errors appear under the field in
// plain English; lookups are searchable lists, never a typed code.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import {
  createRow,
  getEditData,
  lookupOptions,
  updateRow,
  type FormDef,
  type FormFieldDef,
  type FormValues,
  type LookupOption,
} from '../../lib/screensApi';

type Errors = Record<string, string>;

function Lookup({
  pageId,
  def,
  label,
  value,
  parentValue,
  disabled,
  error,
  onChange,
}: {
  pageId: string;
  def: FormFieldDef;
  label: string;
  value: string;
  parentValue: string;
  disabled: boolean;
  error: string | undefined;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = def.lookup ?? '';

  // show the label of the value that is already chosen (Edit form)
  useEffect(() => {
    let alive = true;
    if (!value) {
      setText('');
      return;
    }
    lookupOptions(pageId, name, { id: value })
      .then((o) => alive && setText(o[0]?.label ?? ''))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pageId, name, value]);

  const search = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const p: { q?: string; parent?: string } = {};
        if (q) p.q = q;
        if (def.parent && parentValue) p.parent = parentValue;
        lookupOptions(pageId, name, p)
          .then(setOptions)
          .catch(() => setOptions([]));
      }, 150);
    },
    [pageId, name, def.parent, parentValue],
  );

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {def.required ? ' *' : ''}
      </label>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        value={text}
        placeholder={def.parent && !parentValue ? 'Choose the field above first' : 'Type to search…'}
        onFocus={() => {
          setOpen(true);
          search(text);
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (value) onChange('');
          setOpen(true);
          search(e.target.value);
        }}
        // close on blur, unless focus came straight back (a dialog's focus trap can bounce it)
        onBlur={() =>
          setTimeout(() => {
            if (document.activeElement !== inputRef.current) setOpen(false);
          }, 150)
        }
      />
      {open && options.length > 0 ? (
        <ul role="listbox" className="lookup-list">
          {options.map((o) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                setText(o.label);
                onChange(o.id);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

function Control({
  pageId,
  def,
  value,
  parentValue,
  editing,
  error,
  onChange,
}: {
  pageId: string;
  def: FormFieldDef;
  value: FormValues[string] | undefined;
  parentValue: string;
  editing: boolean;
  error: string | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const id = useId();
  const disabled = editing && !def.editable;
  const label = def.label;
  if (def.type === 'lookup') {
    return (
      <Lookup
        pageId={pageId}
        def={def}
        label={label}
        value={typeof value === 'string' ? value : ''}
        parentValue={parentValue}
        disabled={disabled}
        error={error}
        onChange={onChange}
      />
    );
  }
  if (def.type === 'bool') {
    return (
      <div className="field">
        <label htmlFor={id}>
          <input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />{' '}
          {label}
        </label>
      </div>
    );
  }
  const common = {
    id,
    disabled,
    'aria-invalid': error ? true : undefined,
  } as const;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {def.required ? ' *' : ''}
        {def.help ? <span className="v8-sub"> ({def.help})</span> : null}
      </label>
      {def.type === 'select' ? (
        <select {...common} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
          {def.required ? null : <option value="">—</option>}
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : def.type === 'textarea' ? (
        <textarea {...common} rows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          {...common}
          type={def.type === 'date' ? 'date' : def.type === 'number' || def.type === 'int' ? 'number' : 'text'}
          step={def.type === 'int' ? 1 : def.type === 'number' ? 'any' : undefined}
          min={def.min ?? undefined}
          maxLength={def.maxLength ?? undefined}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

interface Props {
  pageId: string;
  form: FormDef;
  /** Present = Edit this record; absent = Add. */
  editId?: string;
  onClose: () => void;
  onSaved: () => void;
}

function initial(fields: FormFieldDef[]): FormValues {
  const v: FormValues = {};
  for (const f of fields) {
    if (f.default !== null) v[f.key] = f.default;
    else if (f.type === 'bool') v[f.key] = false;
  }
  return v;
}

export function ScreenFormModal({ pageId, form, editId, onClose, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(() => initial(form.fields));
  const [lines, setLines] = useState<FormValues[]>(() =>
    form.lines ? Array.from({ length: Math.max(1, form.lines.min) }, () => initial(form.lines?.fields ?? [])) : [],
  );
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(editId));

  useEffect(() => {
    if (!editId) return;
    let alive = true;
    getEditData(pageId, editId)
      .then((d) => {
        if (!alive) return;
        setValues(d.values);
        if (form.lines) setLines(d.lines.length > 0 ? d.lines : [initial(form.lines.fields)]);
        setVersion(d.version);
      })
      .catch((e: unknown) => alive && setMessage(e instanceof ApiError ? e.message : 'Could not open this record.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pageId, editId, form.lines]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      const body = { values, ...(form.lines ? { lines } : {}) };
      if (editId) {
        await updateRow(pageId, editId, version, body);
        toast('Saved.');
      } else {
        const out = await createRow(pageId, body);
        toast(out.number ? `Saved. ${form.title} ${out.number}` : 'Saved.');
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(
          err.code === 'VERSION_CONFLICT'
            ? 'Someone else changed this record. Close and open it again.'
            : Object.keys(err.fields).length > 0
              ? 'Please fix the fields marked below.'
              : err.message,
        );
      } else setMessage('Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string) => (v: string | boolean) => setValues((cur) => ({ ...cur, [key]: v }));
  const parentOf = (f: FormFieldDef, src: FormValues) => (f.parent && typeof src[f.parent] === 'string' ? (src[f.parent] as string) : '');

  return (
    <Modal
      title={`${editId ? 'Edit' : 'Add'} ${form.title}`}
      sub={form.needsPlant && !editId ? 'The record is created in the plant chosen at the top.' : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="screen-form" className="btn primary" disabled={busy || loading}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="screen-form" onSubmit={(e) => void submit(e)} noValidate>
        {message ? (
          <div className="msg error show static" role="alert">
            {message}
          </div>
        ) : null}
        {loading ? <p role="status">Loading…</p> : null}
        <div className="grid2">
          {form.fields.map((f) => (
            <Control
              key={f.key}
              pageId={pageId}
              def={f}
              value={values[f.key]}
              parentValue={parentOf(f, values)}
              editing={Boolean(editId)}
              error={errors[f.key]}
              onChange={set(f.key)}
            />
          ))}
        </div>
        {form.lines ? (
          <fieldset className="lines">
            <legend>{form.lines.label}</legend>
            {lines.map((line, i) => (
              <div key={i} className="line-row grid2">
                {form.lines?.fields.map((f) => (
                  <Control
                    key={f.key}
                    pageId={pageId}
                    def={f}
                    value={line[f.key]}
                    parentValue={parentOf(f, values)}
                    editing={false}
                    error={errors[`lines.${i}.${f.key}`]}
                    onChange={(v) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, [f.key]: v } : l)))}
                  />
                ))}
                {lines.length > (form.lines?.min ?? 1) ? (
                  <button type="button" className="btn sm danger" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>
                    Remove line
                  </button>
                ) : null}
              </div>
            ))}
            {errors.lines ? <span className="field-error">{errors.lines}</span> : null}
            {lines.length < form.lines.max ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => setLines((cur) => [...cur, initial(form.lines?.fields ?? [])])}
              >
                ＋ Add Line
              </button>
            ) : null}
          </fieldset>
        ) : null}
      </form>
    </Modal>
  );
}
