// Small helpers shared by the Phase 8 Inventory screens: Indian quantity / money format, item and warehouse pickers,
// and a status pill that also knows the stock statuses.
import { useEffect, useState } from 'react';
import {
  lookupItems,
  lookupWarehouses,
  lookupWarehousesAny,
  type Ref,
} from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';

import type { ReactNode } from 'react';
import { PageHead as BaseHead } from '../finance/shared';
import { Guide } from './guides';

export { dmy, Empty, ErrorBox, inr, Pill, todayIso } from '../finance/shared';

/** The page title block plus a "How this works: who does what" strip for the screen. */
export function PageHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: ReactNode;
}) {
  return (
    <>
      <BaseHead title={title} sub={sub}>
        {children}
      </BaseHead>
      <Guide title={title} />
    </>
  );
}

const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
/** 12500.5 -> "12,500.5" */
export const qty = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : QTY.format(v);

export const STATUS_LABEL: Record<string, string> = {
  UNRESTRICTED: 'Unrestricted',
  QUALITY_INSPECTION: 'Quality Inspection',
  BLOCKED: 'Blocked',
};

export function WarehouseSelect({
  value,
  onChange,
  label = 'Warehouse',
  any = false,
  error,
  exclude,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  any?: boolean;
  error?: string | undefined;
  exclude?: string;
}) {
  const { data } = useLoad(() => (any ? lookupWarehousesAny() : lookupWarehouses()), [any]);
  const list = (data ?? []).filter((w) => w.id !== exclude);
  return (
    <div className="field">
      <label>
        {label}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
        >
          <option value="">Choose…</option>
          {list.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {w.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

/** Type to search items, pick from the list. */
export function ItemPicker({
  value,
  label = 'Item',
  onPick,
  error,
}: {
  value: Ref | null;
  label?: string;
  onPick: (item: Ref | null) => void;
  error?: string | undefined;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Ref[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      lookupItems(q)
        .then((r) => {
          if (alive) setRows(r);
        })
        .catch(() => {
          if (alive) setRows([]);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open]);
  return (
    <div className="field">
      <label>
        {label}
        <input
          value={open ? q : value ? `${value.code} · ${value.name}` : ''}
          placeholder="Type a code or name"
          aria-invalid={error ? true : undefined}
          onFocus={() => {
            setOpen(true);
            setQ('');
          }}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </label>
      {open && rows.length > 0 ? (
        <ul className="pick-list" role="listbox">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === r.id}
                onMouseDown={() => {
                  onPick(r);
                  setOpen(false);
                }}
              >
                {r.code} · {r.name} <small>({r.uom})</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
