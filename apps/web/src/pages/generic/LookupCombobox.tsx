// Searchable combobox for ref fields that point to a real typed master (items, warehouses): types to
// search GET /lookups/<kind>?q=, picks one result and keeps its id as the field value.
import { useEffect, useId, useRef, useState } from 'react';
import { lookup, type LookupItem } from './engineApi';

interface Props {
  label: string;
  kind: 'items' | 'warehouses';
  /** Selected id ('' = none). */
  value: string;
  /** Label to show for the selected id (from the record's resolved refs). */
  selectedLabel?: string;
  unitId?: string | null;
  required?: boolean;
  disabled?: boolean;
  error?: string | undefined;
  onChange: (id: string, item: LookupItem | null) => void;
}

const text = (i: LookupItem): string => `${i.code} — ${i.name}`;

export function LookupCombobox({
  label,
  kind,
  value,
  selectedLabel,
  unitId,
  required,
  disabled,
  error,
  onChange,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const errId = `${id}-err`;
  const [query, setQuery] = useState(selectedLabel ?? '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<LookupItem[]>([]);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      lookup(kind, query.trim(), unitId)
        .then((r) => {
          if (mine === seq.current) {
            setResults(r);
            setActive(0);
          }
        })
        .catch(() => {
          if (mine === seq.current) setResults([]);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [open, query, kind, unitId]);

  const pick = (item: LookupItem): void => {
    setQuery(text(item));
    setOpen(false);
    onChange(item.id, item);
  };

  return (
    <div className="field lookup">
      <label htmlFor={id} className={required ? 'is-required' : undefined}>
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={`Search ${kind}…`}
        value={query}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange('', null); // typing again drops the previous pick
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && results[active]) {
            e.preventDefault();
            pick(results[active]);
          }
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="user-picker-list lookup-list">
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
            >
              {text(r)}
              {r.uom ? <small> · {r.uom}</small> : null}
            </li>
          ))}
          {results.length === 0 ? <li className="user-picker-empty">No matches</li> : null}
        </ul>
      ) : null}
      {error ? (
        <span className="field-error" id={errId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
