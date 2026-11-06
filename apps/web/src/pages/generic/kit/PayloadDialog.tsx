// apps/web/src/pages/generic/kit/PayloadDialog.tsx
// Modal dialog for entering action or command payload values (docs/plans/07-ENGINE-KIT.md §2.6, §12 T-KIT-10)

import { useState } from 'react';
import { ApiError } from '../../../lib/api';
import type { PayloadField } from '../engineApi';
import { LookupCombobox } from '../LookupCombobox';

export interface PayloadDialogProps {
  title: string;
  fields: PayloadField[];
  confirmText?: string;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

export function PayloadDialog({
  title,
  fields,
  confirmText,
  onClose,
  onSubmit,
}: PayloadDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      init[f.key] = '';
    }
    return init;
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateField = (key: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      delete next[`payload.${key}`];
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.key];
      const empty = v === undefined || v === null || String(v).trim() === '';
      if (f.required && empty) {
        errors[f.key] = `${f.label} is required.`;
        continue;
      }
      if (!empty && (f.type === 'qty' || f.type === 'money')) {
        const num = Number(v);
        if (isNaN(num)) {
          errors[f.key] = `${f.label} must be a number.`;
        } else {
          if (f.min !== undefined && num < f.min) {
            errors[f.key] = `${f.label} must be at least ${f.min}.`;
          }
          if (f.max !== undefined && num > f.max) {
            errors[f.key] = `${f.label} cannot exceed ${f.max}.`;
          }
        }
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setGeneralError(null);

    try {
      const parsedPayload: Record<string, unknown> = {};
      for (const f of fields) {
        const v = values[f.key];
        if (v === '' || v === undefined) continue;
        if (f.type === 'qty' || f.type === 'money') {
          parsedPayload[f.key] = Number(v);
        } else {
          parsedPayload[f.key] = v;
        }
      }

      await onSubmit(parsedPayload);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 422 && err.fields) {
          setFieldErrors(err.fields);
        } else {
          setGeneralError(err.message);
        }
      } else if (err instanceof Error) {
        setGeneralError(err.message);
      } else {
        setGeneralError('Action failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payload-dlg-title"
    >
      <div className="modal" style={{ maxWidth: '480px' }}>
        <h3 id="payload-dlg-title">{title}</h3>

        {generalError ? (
          <div
            className="notice bad"
            role="alert"
            style={{
              marginBottom: '12px',
              padding: '8px 12px',
              fontSize: '11px',
              borderRadius: '6px',
            }}
          >
            {generalError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit}>
          <div
            className="form-grid"
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {fields.map((f) => {
              const err = fieldErrors[f.key] ?? fieldErrors[`payload.${f.key}`];
              const val = values[f.key];

              return (
                <div key={f.key} className="field">
                  <label htmlFor={`payload-f-${f.key}`}>
                    {f.label}
                    {f.required ? <span style={{ color: '#dc2626' }}> *</span> : null}
                  </label>

                  {f.type === 'longtext' ? (
                    <textarea
                      id={`payload-f-${f.key}`}
                      rows={3}
                      value={String(val ?? '')}
                      onChange={(e) => updateField(f.key, e.target.value)}
                      aria-invalid={err ? true : undefined}
                      style={{ width: '100%' }}
                    />
                  ) : f.type === 'enum' && f.options ? (
                    <select
                      id={`payload-f-${f.key}`}
                      value={String(val ?? '')}
                      onChange={(e) => updateField(f.key, e.target.value)}
                      aria-invalid={err ? true : undefined}
                      style={{ width: '100%' }}
                    >
                      <option value="">Select {f.label}…</option>
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'lookup' && f.lookup ? (
                    <LookupCombobox
                      label=""
                      kind={f.lookup}
                      value={String(val ?? '')}
                      error={err}
                      onChange={(_id, item) => updateField(f.key, item ? item.id : '')}
                    />
                  ) : (
                    <input
                      id={`payload-f-${f.key}`}
                      type={
                        f.type === 'qty' || f.type === 'money'
                          ? 'number'
                          : f.type === 'date'
                            ? 'date'
                            : 'text'
                      }
                      value={val !== undefined && val !== null ? String(val) : ''}
                      onChange={(e) => updateField(f.key, e.target.value)}
                      aria-invalid={err ? true : undefined}
                      style={{ width: '100%' }}
                    />
                  )}

                  {err ? (
                    <small
                      className="field-error"
                      role="alert"
                      style={{
                        color: '#dc2626',
                        fontSize: '9px',
                        display: 'block',
                        marginTop: '3px',
                      }}
                    >
                      {err}
                    </small>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div
            className="actions"
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '16px',
            }}
          >
            <button type="button" className="btn" disabled={submitting} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? 'Working…' : (confirmText ?? 'Submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
