// Phase 36 shared UI kit: one look for every page (V36 table-first, V39 horizontal action row).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatDMY, formatINR, parseDMY, parseINR, statusInfo } from './format';

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'ghost';

/** `reason` greys the button with "Not available yet: {reason}" - a V40 button is never hidden. */
export function Button({
  variant = 'default',
  reason,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; reason?: string }) {
  const unavailable = reason !== undefined;
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || unavailable}
      title={unavailable ? `Not available yet: ${reason}` : rest.title}
      className={`ui-btn ui-btn-${variant} ${className ?? ''}`.trim()}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = statusInfo(status);
  return <span className={`ui-badge ui-badge-${s.tone}`}>{s.label}</span>;
}

export interface ActionDef {
  key: string;
  label: string;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'success' | 'danger';
  reason?: string;
}

/** V39 horizontal action row. `max` buttons stay visible; the rest fold into "More" in the same order. */
export function ActionRow({
  actions,
  max = 6,
  label = 'Actions',
}: {
  actions: ActionDef[];
  max?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const fold = actions.length > max;
  const shown = fold ? actions.slice(0, max - 1) : actions;
  const rest = fold ? actions.slice(max - 1) : [];
  return (
    <div className="ui-actionrow" role="toolbar" aria-label={label}>
      {shown.map((a) => (
        <Button key={a.key} variant={a.variant ?? 'default'} reason={a.reason} onClick={a.onClick}>
          {a.label}
        </Button>
      ))}
      {rest.length ? (
        <span className="ui-more">
          <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            ⋯ More
          </Button>
          {open ? (
            <div className="ui-more-menu" role="menu">
              {rest.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  disabled={a.reason !== undefined}
                  title={a.reason !== undefined ? `Not available yet: ${a.reason}` : undefined}
                  onClick={() => {
                    setOpen(false);
                    a.onClick?.();
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  onReturn,
  actions,
}: {
  title: string;
  subtitle?: string;
  onReturn?: () => void;
  actions?: ActionDef[];
}) {
  return (
    <header className="ui-pagehead">
      <div className="ui-pagehead-title">
        {onReturn ? (
          <Button variant="ghost" onClick={onReturn}>
            ← Return
          </Button>
        ) : null}
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {actions?.length ? <ActionRow actions={actions} /> : null}
    </header>
  );
}

export function EmptyState({ things, onAdd }: { things: string; onAdd?: () => void }) {
  return (
    <div className="ui-empty" role="status">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="10" y="14" width="44" height="36" rx="5" />
        <path d="M10 26h44M22 38h20" strokeLinecap="round" />
      </svg>
      <p>No {things} yet. Press ＋ Add to create the first one.</p>
      {onAdd ? (
        <Button variant="primary" onClick={onAdd}>
          ＋ Add
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="ui-skel" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="ui-skel-row" data-w={95 - ((i * 7) % 30)} />
      ))}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  const isNum = typeof value === 'number';
  const [shown, setShown] = useState<number | string>(isNum ? 0 : value);
  useEffect(() => {
    if (typeof value !== 'number') {
      setShown(value);
      return undefined;
    }
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShown(value);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      setShown(Math.round(value * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div className="ui-kpi">
      <small>{label}</small>
      <b>{typeof shown === 'number' ? formatINR(shown, 0) : shown}</b>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

export function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const eid = `${id}-err`;
  return (
    <div className="ui-field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children(id, error ? eid : undefined)}
      {error ? (
        <small id={eid} role="alert" className="ui-field-err">
          {error}
        </small>
      ) : null}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

export function MoneyInput({
  value,
  onChange,
  ...rest
}: { value: number | null; onChange: (v: number | null) => void } & InputProps) {
  const [text, setText] = useState(value === null ? '' : formatINR(value));
  return (
    <span className="ui-money">
      <i aria-hidden="true">₹</i>
      <input
        {...rest}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseINR(e.target.value));
        }}
        onBlur={() => {
          const v = parseINR(text);
          setText(v === null ? '' : formatINR(v));
        }}
      />
    </span>
  );
}

/** Text box in dd-mm-yyyy; reports ISO yyyy-mm-dd, or null while the text is not a real date. */
export function DateInput({
  value,
  onChange,
  ...rest
}: { value: string | null; onChange: (iso: string | null) => void } & InputProps) {
  const first = formatDMY(value);
  const [text, setText] = useState(first === '—' ? '' : first);
  return (
    <input
      {...rest}
      placeholder="dd-mm-yyyy"
      inputMode="numeric"
      value={text}
      aria-invalid={text !== '' && parseDMY(text) === null}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseDMY(e.target.value));
      }}
    />
  );
}

/**
 * Drop-in replacement for `<input type="date">` (Phase 37 C8): the person always types and sees dd-mm-yyyy,
 * whatever the browser language is. `value` is ISO yyyy-mm-dd or ''. onChange gets an event-shaped
 * `{ target: { value } }` with ISO (or '' while the text is not a real date), so existing handlers keep working.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  ...rest
}: {
  value: string | null | undefined;
  onChange?: (e: { target: { value: string } }) => void;
  /** ISO yyyy-mm-dd bounds; a date outside them is flagged invalid and reported as ''. */
  min?: string;
  max?: string;
} & Omit<InputProps, 'min' | 'max'>) {
  const shown = (v: string | null | undefined): string => {
    const t = formatDMY(v ?? null);
    return t === '—' ? '' : t;
  };
  const [text, setText] = useState(shown(value));
  const inRange = (iso: string | null): boolean => iso !== null && (!min || iso >= min) && (!max || iso <= max);
  useEffect(() => {
    // The parent changed the value from outside (reset, load): show it. What the person typed is left alone.
    const typed = inRange(parseDMY(text)) ? parseDMY(text) : '';
    if ((value ?? '') !== (typed ?? '')) setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parsed = parseDMY(text);
  return (
    <input
      {...rest}
      type="text"
      placeholder="dd-mm-yyyy"
      inputMode="numeric"
      maxLength={10}
      value={text}
      aria-invalid={text !== '' && !inRange(parsed)}
      onChange={(e) => {
        setText(e.target.value);
        const iso = parseDMY(e.target.value);
        onChange?.({ target: { value: iso !== null && inRange(iso) ? iso : '' } });
      }}
    />
  );
}

export interface Option {
  value: string;
  label: string;
}

/** Type-ahead picker; `search` may be server-backed and is debounced 250 ms. */
export function Combobox({
  id,
  value,
  onPick,
  search,
  placeholder = 'Type to search…',
}: {
  id?: string;
  value: Option | null;
  onPick: (o: Option | null) => void;
  search: (q: string) => Promise<Option[]>;
  placeholder?: string;
}) {
  const [q, setQ] = useState(value?.label ?? '');
  const [opts, setOpts] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const lid = useId();
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return undefined;
    const n = ++seq.current;
    const h = setTimeout(() => {
      search(q)
        .then((r) => {
          if (n === seq.current) {
            setOpts(r);
            setHi(0);
          }
        })
        .catch(() => {
          if (n === seq.current) setOpts([]);
        });
    }, 250);
    return () => clearTimeout(h);
  }, [q, open, search]);
  const pick = (o: Option) => {
    onPick(o);
    setQ(o.label);
    setOpen(false);
  };
  return (
    <div className="ui-combo">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={lid}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (value) onPick(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(opts.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter' && open && opts[hi]) {
            e.preventDefault();
            pick(opts[hi]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open ? (
        <ul id={lid} role="listbox">
          {opts.length === 0 ? (
            <li className="ui-combo-none">No match</li>
          ) : (
            opts.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={i === hi}
                className={i === hi ? 'on' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (k: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => ref.current?.scrollBy?.({ left: d * 160, behavior: 'smooth' });
  return (
    <div className="ui-tabs-wrap">
      <button
        type="button"
        className="ui-tabs-arrow"
        aria-label="Scroll tabs left"
        onClick={() => scroll(-1)}
      >
        ‹
      </button>
      <div className="ui-tabs" role="tablist" ref={ref}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            className={t.key === active ? 'on' : ''}
            onClick={() => onChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ui-tabs-arrow"
        aria-label="Scroll tabs right"
        onClick={() => scroll(1)}
      >
        ›
      </button>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'right';
}

/** V36 register table: own scroll box, sticky header + first column, row-action cell, pager "1–25 of N". */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowActions,
  page = 1,
  size = 25,
  total,
  onPage,
  things = 'records',
  loading,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  rowActions?: (r: T) => ActionDef[];
  page?: number;
  size?: number;
  total?: number;
  onPage?: (p: number) => void;
  things?: string;
  loading?: boolean;
}) {
  const n = total ?? rows.length;
  const from = n === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(n, page * size);
  const pages = Math.max(1, Math.ceil(n / size));
  if (loading) return <Skeleton />;
  if (n === 0) return <EmptyState things={things} />;
  return (
    <div className="ui-table-card">
      <div className="ui-table-scroll" tabIndex={0} role="region" aria-label={`${things} table`}>
        <table className="ui-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.align === 'right' ? 'r' : undefined}>
                  {c.header}
                </th>
              ))}
              {rowActions ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'r' : undefined}>
                    {c.render(r)}
                  </td>
                ))}
                {rowActions ? (
                  <td className="ui-rowact">
                    {rowActions(r).map((a) => (
                      <Button key={a.key} reason={a.reason} onClick={a.onClick} variant={a.variant}>
                        {a.label}
                      </Button>
                    ))}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="ui-pager" aria-label="Pagination">
        <span>
          {from}–{to} of {n}
        </span>
        <span>
          <Button disabled={page <= 1} onClick={() => onPage?.(page - 1)}>
            Prev
          </Button>{' '}
          <Button disabled={page >= pages} onClick={() => onPage?.(page + 1)}>
            Next
          </Button>
        </span>
      </nav>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  docNumber,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  docNumber: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-confirm">
        <h2>{title}</h2>
        <p>
          Type <b>{docNumber}</b> to delete.
        </p>
        <input
          aria-label="Document number"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <div className="ui-confirm-actions">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" disabled={typed !== docNumber} onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
