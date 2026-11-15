// One cell of a V40 tab table (shared by InvTabView and by the working registers that take their columns from the V40 layout).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useToast } from '../../../components/Toast';
import { toUiError } from '../../../lib/errors';
import { formatDate, formatDateTime } from '../../../lib/format';
import { formatMoney, formatQty } from '../../generic/fieldModel';
import { allocateStock } from './v40Api';
import type { V40Column, V40TabRow } from './v40Api';

export const isEmptyCell = (v: unknown): boolean => v === null || v === undefined || v === '';
export const NUMERIC_FORMATS: ReadonlySet<string> = new Set(['qty', 'money', 'days']);

/** Text of one cell; null = print a dash. */
export function cellText(col: V40Column, value: unknown): string | null {
  if (isEmptyCell(value)) return null;
  switch (col.format) {
    case 'qty':
      return formatQty(Number(value));
    case 'money':
      return formatMoney(Number(value));
    case 'days':
      return String(value);
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}

/** Allocate / Reallocate of one row (runs the stock allocator for its item and warehouse). */
export function AllocateCell({
  row,
  canEdit,
  onDone,
}: {
  row: V40TabRow;
  canEdit: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!row.alloc) return <span className="muted">—</span>;
  const alloc = row.alloc;
  async function run(verb: string): Promise<void> {
    setBusy(true);
    try {
      const r = await allocateStock(alloc.itemId, alloc.warehouseId);
      toast(
        r.allocated > 0
          ? `${verb}: ${formatQty(r.allocated)} reserved for waiting demand (reserved ${formatQty(r.reservedBefore)} to ${formatQty(r.reservedAfter)}).`
          : r.waiting > 0
            ? `${verb}: nothing could be reserved, there is no free stock for ${r.waiting} waiting reservation${r.waiting === 1 ? '' : 's'}.`
            : `${verb}: there is no waiting demand for this item.`,
      );
      onDone();
    } catch (e) {
      toast(toUiError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const why = canEdit ? undefined : 'You need edit access to Stock Reservation';
  return (
    <div className="inv-v40-row-actions">
      <button type="button" className="btn sm primary" disabled={!canEdit || busy} title={why ?? 'Reserve free stock for the waiting demand of this item'} onClick={() => void run('Allocate')}>
        Allocate
      </button>
      <button type="button" className="btn sm" disabled={!canEdit || busy} title={why ?? 'Run the allocation again in priority order'} onClick={() => void run('Reallocate')}>
        Reallocate
      </button>
    </div>
  );
}

/** A data cell (any format except the row-actions column, which every page draws itself). */
export function V40Value({
  col,
  row,
  canEdit,
  onChanged,
}: {
  col: V40Column;
  row: V40TabRow;
  canEdit: boolean;
  onChanged: () => void;
}): ReactNode {
  if (col.format === 'allocate') return <AllocateCell row={row} canEdit={canEdit} onDone={onChanged} />;
  const value = row.cells[col.key];
  if (col.format === 'status' && !isEmptyCell(value)) {
    return <span className={`status ${String(value).toLowerCase().replace(/\s+/g, '-')}`}>{String(value)}</span>;
  }
  return cellText(col, value) ?? '—';
}

/** className of the cell: right aligned numbers, a muted dash. */
export function cellClass(col: V40Column, row: V40TabRow | undefined): string | undefined {
  const dash = !!row && col.format !== 'allocate' && col.format !== 'open' && col.format !== 'status' && cellText(col, row.cells[col.key]) === null;
  return [NUMERIC_FORMATS.has(col.format) ? 'num' : '', dash ? 'dash' : ''].join(' ').trim() || undefined;
}
