// Small shared pieces of the Phase 13 manufacturing screens: a field-driven form dialog, option selects for warehouses and
// work centres, and the status colours. Business rules live on the server; the screens only collect and show.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { toUiError } from '../../lib/errors';
import { useToast } from '../../components/Toast';
import { lookupWarehouseOptions, lookupWorkCentreOptions, saveMfgFile } from '../../lib/mfgApi';
import type { Option } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import { ErrorBox } from '../finance/shared';
import { RefPicker } from '../qms/Shared';

export { s } from '../qms/Shared';

export const ORDER_TONE: Record<string, string> = {
  Planned: 'draft',
  'Pending Approval': 'pending',
  PENDING_APPROVAL: 'pending',
  RELEASED: 'approved',
  OBSOLETE: 'cancelled',
  SUBMITTED: 'pending',
  CLOSED: 'approved',
  QUEUED: 'pending',
  RUNNING: 'pending',
  DONE: 'approved',
  FAILED: 'cancelled',
  OPEN: 'pending',
  FIRMED: 'approved',
  CONVERTED: 'approved',
  IGNORED: 'cancelled',
  Paused: 'pending',
  Submitted: 'approved',
  Released: 'pending',
  'In Progress': 'pending',
  Completed: 'approved',
  Closed: 'approved',
  Cancelled: 'cancelled',
  Draft: 'draft',
  Applied: 'approved',
  ACTIVE: 'approved',
  DRAFT: 'draft',
  RETIRED: 'cancelled',
  INACTIVE: 'cancelled',
  Open: 'pending',
  Done: 'approved',
  Pending: 'draft',
  Recorded: 'approved',
  Closed_: 'approved',
};

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'month'
  | 'textarea'
  | 'select'
  | 'item'
  | 'customer'
  | 'supplier'
  | 'check';
export interface FormField {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: Option[] | string[];
  hint?: string;
}

export function useWarehouses() {
  return useLoad(() => lookupWarehouseOptions(), []);
}
export function useWorkCentres() {
  return useLoad(() => lookupWorkCentreOptions(), []);
}

export function OptionSelect({
  id,
  value,
  options,
  onChange,
  blank = '— choose —',
}: {
  id: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  blank?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{blank}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A dialog that draws its fields from a list and sends the values; the API's field errors are shown under each field. */
export function FormModal({
  title,
  sub,
  fields,
  initial = {},
  submitLabel = 'Save',
  size,
  onSubmit,
  onClose,
}: {
  title: string;
  sub?: string;
  fields: FormField[];
  initial?: Record<string, string | boolean>;
  submitLabel?: string;
  size?: 'sm' | 'lg';
  onSubmit: (v: Record<string, string>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [v, setV] = useState<Record<string, string | boolean>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: string | boolean) => setV((o) => ({ ...o, [k]: x }));
  const str = (k: string): string => {
    const x = v[k];
    return typeof x === 'string' ? x : '';
  };
  return (
    <Modal
      title={title}
      {...(sub ? { sub } : {})}
      {...(size ? { size } : {})}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => {
            setMsg('');
            setErrors({});
            setBusy(true);
            const out: Record<string, string> = {};
            for (const f of fields) {
              const x = v[f.key];
              if (f.type === 'check') out[f.key] = x === true ? 'true' : 'false';
              else if (typeof x === 'string' && x.trim() !== '') out[f.key] = x.trim();
            }
            onSubmit(out)
              .catch((e: unknown) => {
                const u = toUiError(e);
                setMsg(u.message);
                setErrors(u.fields);
              })
              .finally(() => setBusy(false));
          }}
        >
          {submitLabel}
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        {fields.map((f) => {
          const id = `mf-${f.key}`;
          let input;
          if (f.type === 'textarea')
            input = (
              <textarea
                id={id}
                rows={3}
                value={str(f.key)}
                onChange={(e) => set(f.key, e.target.value)}
              />
            );
          else if (f.type === 'select') {
            const opts = (f.options ?? []).map((o) =>
              typeof o === 'string' ? { id: o, label: o } : o,
            );
            input = (
              <OptionSelect
                id={id}
                value={str(f.key)}
                options={opts}
                onChange={(x) => set(f.key, x)}
              />
            );
          } else if (f.type === 'item' || f.type === 'customer' || f.type === 'supplier')
            input = (
              <RefPicker
                id={id}
                kind={f.type}
                value={str(f.key)}
                label={str(`${f.key}Label`)}
                onChange={(nid, nl) => {
                  set(f.key, nid);
                  set(`${f.key}Label`, nl);
                }}
              />
            );
          else if (f.type === 'check')
            input = (
              <input
                id={id}
                type="checkbox"
                checked={v[f.key] === true}
                onChange={(e) => set(f.key, e.target.checked)}
              />
            );
          else
            input = (
              <input
                id={id}
                type={
                  f.type === 'number'
                    ? 'number'
                    : f.type === 'date'
                      ? 'date'
                      : f.type === 'month'
                        ? 'month'
                        : 'text'
                }
                {...(f.type === 'number' ? { step: 'any', min: 0 } : {})}
                value={str(f.key)}
                onChange={(e) => set(f.key, e.target.value)}
              />
            );
          return (
            <div
              className="field"
              key={f.key}
              style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}
            >
              <label htmlFor={id}>
                {f.label}
                {f.required ? ' *' : ''}
              </label>
              {input}
              {f.hint ? <div className="hint">{f.hint}</div> : null}
              {errors[f.key] ? (
                <div className="field-error" role="alert">
                  {errors[f.key]}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** A button that downloads a file the server builds (Excel register or PDF). */
export function FileButton({ path, name, label }: { path: string; name: string; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        saveMfgFile(path, name)
          .catch((e: unknown) => toast(toUiError(e).message))
          .finally(() => setBusy(false));
      }}
    >
      {label}
    </button>
  );
}
