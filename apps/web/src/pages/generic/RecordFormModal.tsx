// Add / Edit modal generated from the page schema (prototype .modal .form-grid): typed inputs,
// required stars, live GSTIN/PAN checks, 422 messages under the fields, a read-only code,
// server-computed read-only fields (preview) and a "Discard unsaved changes?" guard.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { toUiError, type UiError } from '../../lib/errors';
import { useUnsavedGuard } from '../../lib/unsaved';
import {
  createRecord,
  getPreview,
  getRecord,
  lookupKind,
  updateRecord,
  type FieldMeta,
  type PageSchema,
  type RecordRow,
} from './engineApi';
import {
  changedPayload,
  computeReadOnly,
  displayValue,
  serverValue,
  str,
  toFormValues,
  toPayload,
  UPPERCASE_TYPES,
  validateField,
} from './fieldModel';
import { LookupCombobox } from './LookupCombobox';

interface Props {
  schema: PageSchema;
  /** The record being edited; absent for Add. */
  row?: RecordRow;
  /** Context unit, used to narrow warehouse lookups. */
  unitId: string | null;
  onClose: () => void;
  onSaved: (row: RecordRow) => void;
}

function Control({
  label,
  required,
  error,
  children,
  htmlFor,
  wide,
}: {
  label: string;
  required?: boolean;
  error?: string | undefined;
  children: (ids: { id: string; errId: string }) => ReactNode;
  htmlFor?: string;
  wide?: boolean;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={wide ? 'field field-wide' : 'field'}>
      <label htmlFor={htmlFor ?? id} className={required ? 'is-required' : undefined}>
        {label}
      </label>
      {children({ id, errId })}
      {error ? (
        <span className="field-error" id={errId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Prototype seed lists offered as suggestions when the server sends no options (B1). */
const DEFAULT_SUGGESTIONS: Record<string, string[]> = {
  Priority: ['Low', 'Medium', 'High', 'Critical'],
  Stage: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
  Source: ['Website', 'Referral', 'WhatsApp', 'Campaign', 'Existing Customer', 'Walk-in'],
  UOM: ['Nos', 'Set', 'Kg', 'Meter', 'Box', 'Litre'],
};

/** Transfer destination warehouses may belong to any unit, so their lookup is not unit-scoped. */
function isDestination(f: FieldMeta): boolean {
  return /dest/i.test(`${f.key} ${f.label}`);
}

const AFFIX: Record<string, string> = { money: '₹', pct: '%' };

export function RecordFormModal({ schema, row: initialRow, unitId, onClose, onSaved }: Props) {
  const [row, setRow] = useState<RecordRow | undefined>(initialRow);
  const editable = useMemo(
    () => schema.fields.filter((f) => !f.readOnly && f.type !== 'code' && f.type !== 'status'),
    [schema.fields],
  );
  const initial = useMemo(() => toFormValues(schema.fields, row), [schema.fields, row]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown>>({});
  const inFlight = useRef(false);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  useUnsavedGuard(dirty);
  const requestClose = (): void => (dirty ? setConfirmDiscard(true) : onClose());

  // Server-computed read-only fields (typed pages): ask the preview endpoint when the lookups change.
  const itemField = schema.fields.find((f) => lookupKind(f.refPage) === 'items');
  const whFields = schema.fields.filter((f) => lookupKind(f.refPage) === 'warehouses');
  // The preview asks about the source warehouse; a destination may be in any unit.
  const whField = whFields.find((f) => !isDestination(f)) ?? whFields[0];
  const itemId = itemField ? str(values[itemField.key]) : '';
  const warehouseId = whField ? str(values[whField.key]) : '';
  const hasComputed = schema.fields.some(
    (f) => f.readOnly && f.type !== 'code' && f.type !== 'status',
  );
  useEffect(() => {
    if (schema.kind !== 'typed' || !hasComputed || (!itemId && !warehouseId)) return undefined;
    let alive = true;
    const params: Record<string, string> = {};
    if (itemId) params.itemId = itemId;
    if (warehouseId) params.warehouseId = warehouseId;
    const timer = setTimeout(() => {
      getPreview(schema.pageId, params)
        .then((p) => {
          if (alive) setPreview(p);
        })
        .catch(() => {
          if (alive) setPreview({});
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [schema.kind, schema.pageId, hasComputed, itemId, warehouseId]);

  const set = (key: string, v: unknown): void => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (err?.fields[key]) {
      setErr({
        ...err,
        fields: Object.fromEntries(Object.entries(err.fields).filter(([k]) => k !== key)),
      });
    }
  };

  const localErrors = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const f of editable) {
      const m = validateField(f, values[f.key]);
      if (m) out[f.key] = m;
    }
    return out;
  };
  const live = localErrors();
  // Required / format errors show after the field was touched or a save was attempted; the
  // GSTIN / PAN checks are live from the first keystroke.
  const errorFor = (f: FieldMeta): string | undefined =>
    err?.fields[f.key] ??
    (submitted || touched.has(f.key) || f.type === 'gstin' || f.type === 'pan'
      ? live[f.key]
      : undefined);

  const reloadRecord = async (): Promise<void> => {
    if (!row) return;
    const fresh = await getRecord(schema.pageId, row.id);
    setRow(fresh);
    setValues(toFormValues(schema.fields, fresh));
    setErr(null);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (inFlight.current) return;
    setSubmitted(true);
    if (Object.keys(live).length) {
      setErr(null);
      return;
    }
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!row) {
        onSaved(await createRecord(schema.pageId, toPayload(schema.fields, values)));
        return;
      }
      const patch = changedPayload(schema.fields, values, row);
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      onSaved(await updateRecord(schema.pageId, row, patch));
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const renderInput = (f: FieldMeta): ReactNode => {
    const common = (ids: { id: string; errId: string }, error: string | undefined) => ({
      id: ids.id,
      name: f.key,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? ids.errId : undefined,
      onBlur: () => setTouched((t) => new Set(t).add(f.key)),
    });
    const error = errorFor(f);
    const text = str(values[f.key]);
    const lk = f.lookup ?? lookupKind(f.refPage);
    if (lk && (schema.kind === 'typed' || f.lookup)) {
      return (
        <LookupCombobox
          key={f.key}
          label={f.label}
          kind={lk}
          value={text}
          selectedLabel={
            labels[f.key] ??
            (row?.refs?.[f.key]
              ? [row.refs[f.key]?.code, row.refs[f.key]?.name].filter(Boolean).join(' — ')
              : undefined)
          }
          unitId={isDestination(f) ? null : unitId}
          required={f.required}
          error={error}
          onChange={(id, item) => {
            set(f.key, id);
            if (item) setLabels((l) => ({ ...l, [f.key]: `${item.code} — ${item.name}` }));
          }}
        />
      );
    }
    return (
      <Control
        key={f.key}
        label={f.label}
        required={f.required}
        error={error}
        wide={f.type === 'longtext'}
      >
        {(ids) => {
          const c = common(ids, error);
          switch (f.type) {
            case 'bool':
              return (
                <input
                  {...c}
                  type="checkbox"
                  className="v8-checkbox"
                  checked={values[f.key] === true}
                  onChange={(e) => set(f.key, e.target.checked)}
                />
              );
            case 'enum':
              // An enum without a configured list is free text with suggestions, never an empty select.
              if (!f.options?.length) {
                const listId = `${ids.id}-opts`;
                return (
                  <>
                    <input
                      {...c}
                      type="text"
                      list={listId}
                      autoComplete="off"
                      maxLength={f.maxLength}
                      value={text}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                    <datalist id={listId}>
                      {(DEFAULT_SUGGESTIONS[f.label] ?? []).map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                  </>
                );
              }
              return (
                <select {...c} value={text} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">{f.required ? 'Select…' : '—'}</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              );
            case 'longtext':
              return (
                <textarea
                  {...c}
                  rows={3}
                  maxLength={f.maxLength}
                  value={text}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
            case 'money':
            case 'pct':
            case 'qty':
              return (
                <div className="input-affix">
                  {AFFIX[f.type] ? <span aria-hidden="true">{AFFIX[f.type]}</span> : null}
                  <input
                    {...c}
                    type="number"
                    inputMode="decimal"
                    step={f.type === 'qty' ? '0.001' : '0.01'}
                    min={f.min}
                    max={f.max}
                    value={text}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                </div>
              );
            case 'date':
              return (
                <input
                  {...c}
                  type="date"
                  value={text}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
            case 'datetime':
              return (
                <input
                  {...c}
                  type="datetime-local"
                  value={text}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
            default: {
              const inputEl = (
                <input
                  {...c}
                  type={f.type === 'email' ? 'email' : 'text'}
                  autoComplete="off"
                  maxLength={f.maxLength}
                  value={text}
                  onChange={(e) =>
                    set(
                      f.key,
                      UPPERCASE_TYPES.has(f.type) ? e.target.value.toUpperCase() : e.target.value,
                    )
                  }
                />
              );
              return f.suffix ? (
                <div
                  className="input-affix"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {inputEl}
                  <span className="suffix" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {f.suffix}
                  </span>
                </div>
              ) : (
                inputEl
              );
            }
          }
        }}
      </Control>
    );
  };

  const computed = computeReadOnly(schema, values, row, preview);
  const editing = !row || dirty;
  const readOnlyValue = (f: FieldMeta): string => {
    const show = (v: unknown): string =>
      displayValue({ ...(row ?? blankRow), data: { ...(row?.data ?? {}), [f.key]: v } }, f);
    // Saved values come from the server; while editing, the live preview and client maths fill in.
    if (editing) {
      const sv = serverValue(f, preview);
      if (sv !== undefined && sv !== null) return show(sv);
      if (f.key in computed) return show(computed[f.key]);
    }
    return row
      ? displayValue(row, f)
      : f.type === 'code'
        ? 'Auto-generated'
        : 'Computed by the server';
  };

  const formId = row ? 'record-edit-form' : 'record-add-form';
  const shown = schema.fields.filter((f) => (f.type === 'status' ? !!row : true));
  return (
    <>
      <Modal
        title={row ? `Edit ${schema.title}` : `Add ${schema.title}`}
        sub={row ? row.code : 'Department-controlled CRUD form'}
        onClose={requestClose}
        footer={
          <>
            <button type="button" className="btn" onClick={requestClose}>
              Cancel
            </button>
            <button type="submit" form={formId} className="btn primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save Record'}
            </button>
          </>
        }
      >
        <form id={formId} onSubmit={(e) => void onSubmit(e)} noValidate>
          {err?.message ? (
            <ErrorMessage
              onReload={
                err.code === 'VERSION_CONFLICT' && row ? () => void reloadRecord() : undefined
              }
            >
              {err.message}
            </ErrorMessage>
          ) : null}
          <div className="form-grid">
            {shown.map((f) =>
              f.readOnly || f.type === 'code' || f.type === 'status' ? (
                <Control key={f.key} label={f.label}>
                  {(ids) =>
                    f.type === 'ref' ? (
                      <span id={ids.id} className="chip ref-chip" role="status">
                        {row ? readOnlyValue(f) : 'Set from the current unit'}
                      </span>
                    ) : (
                      <input id={ids.id} type="text" readOnly disabled value={readOnlyValue(f)} />
                    )
                  }
                </Control>
              ) : (
                renderInput(f)
              ),
            )}
          </div>
        </form>
      </Modal>
      {confirmDiscard ? (
        <Modal
          size="sm"
          title="Discard unsaved changes?"
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
              <button type="button" className="btn danger" onClick={onClose}>
                Discard
              </button>
            </>
          }
        >
          <p className="confirm-text">Your changes to this record have not been saved.</p>
        </Modal>
      ) : null}
    </>
  );
}

const blankRow: RecordRow = {
  id: '',
  code: '',
  status: '',
  unitId: null,
  fyId: null,
  department: null,
  data: {},
  version: 0,
  createdAt: '',
};
