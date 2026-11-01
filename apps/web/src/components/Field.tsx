// Labelled form controls in the prototype .field/.pass style, wiring label, aria-invalid and
// the error text under the field (422 field errors) in one place.
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | undefined;
}

export function Field({ label, error, ...input }: FieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        {...input}
      />
      {error ? (
        <span className="field-error" id={errId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  disabled?: boolean;
  children: ReactNode;
}

export function SelectField({
  label,
  value,
  onChange,
  error,
  disabled,
  children,
}: SelectFieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
      >
        {children}
      </select>
      {error ? (
        <span className="field-error" id={errId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  error?: string | undefined;
}

export function PasswordField({ label, error, ...input }: PasswordFieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pass">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          {...input}
        />
        <button
          type="button"
          className="showpass"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <span className="field-error" id={errId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
