// One V40 tab of an Inventory page: the columns V40 shows on that tab, filled with the real rows of the unit
// (GET /inventory/v40/:pageId?tab=...). Search, status filter, paging, selection with Export Selected, Move Forward and Open
// on rows that are real documents, Allocate / Reallocate on rows that name an item. A column without a source prints a dash.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { tableToCsv } from '../../../components/ActionBar';
import { ErrorMessage } from '../../../components/ErrorMessage';
import { MoveForwardDialog } from '../../../components/MoveForward';
import { Pager } from '../../../components/Pager';
import { useToast } from '../../../components/Toast';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { formatMoney, formatQty } from '../../generic/fieldModel';
import '../inventory-v40.css';
import { cellClass, V40Value } from './V40Cell';
import { getV40Tab } from './v40Api';
import type { V40Column, V40TabRow } from './v40Api';

const SIZES = [10, 20, 25, 50] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function InvTabView({
  pageId,
  tab,
  perms,
  extra,
  heading,
  rowAction,
  refresh = 0,
  period,
}: {
  pageId: string;
  tab: string;
  perms?: Pick<ActionSet, 'edit'> | undefined;
  /** Rendered under the table (Audit Trail / Approvals panels). */
  extra?: ReactNode;
  heading?: string;
  /** The page's own buttons for a row (replaces the plain Open link in the Actions column). */
  rowAction?: (row: V40TabRow, reload: () => void) => ReactNode;
  /** Change this number to load the rows again (the page did something that changes them). */
  refresh?: number;
  /** Valuation: the period the rows are for. */
  period?: { from: string; to: string };
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(10);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [moving, setMoving] = useState<V40TabRow | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { data, loading, error, reload } = useLoad(
    () => getV40Tab(pageId, tab, { q, status, page, size, ...(period ?? {}) }),
    [pageId, tab, q, status, page, size, refresh, period?.from, period?.to],
  );

  // a different tab starts at the top again
  useEffect(() => {
    setPage(1);
    setStatus('');
    setSelected(new Set());
  }, [pageId, tab]);
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const cols = data?.columns ?? [];
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const isReport = /^reports?$/i.test(tab.trim());
  const toggle = (i: number, on: boolean): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });
  const allOn = rows.length > 0 && rows.every((_, i) => selected.has(i));

  function csv(onlySelected: boolean): void {
    const table = box.current?.querySelector('table');
    if (!table) return;
    const clean = table.cloneNode(true) as HTMLTableElement;
    clean.querySelectorAll('input, button, a, .inv-v40-row-actions').forEach((n) => n.remove());
    clean.querySelectorAll('th:first-child, td:first-child').forEach((n) => n.remove());
    if (onlySelected) {
      [...clean.querySelectorAll('tbody tr')].forEach((tr, i) => {
        if (!selected.has(i)) tr.remove();
      });
    }
    const blob = new Blob(['﻿' + tableToCsv(clean)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pageId}-${tab.replace(/[^a-z0-9]+/gi, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function pdf(): void {
    const table = box.current?.querySelector('table');
    if (!table) return;
    const clean = table.cloneNode(true) as HTMLTableElement;
    clean.querySelectorAll('input, button, a').forEach((n) => n.remove());
    const w = window.open('', '_blank');
    if (!w) {
      toast('Allow pop-ups to save this report as PDF.');
      return;
    }
    w.document.write(`<html><head><meta charset="utf-8"><title>${pageId} ${tab}</title></head><body><h2>${tab}</h2>${clean.outerHTML}</body></html>`);
    w.document.close();
    w.print();
  }

  function cell(col: V40Column, row: V40TabRow): ReactNode {
    if (col.format === 'open') {
      const owner = row.page ?? pageId;
      return (
        <div className="inv-v40-row-actions">
          {rowAction ? (
            rowAction(row, reload)
          ) : (
            <Link className="btn sm" to={`/m/${owner}`} aria-label={`Open ${owner}`}>
              Open
            </Link>
          )}
          {row.id && UUID.test(row.id) ? (
            <button type="button" className="btn sm primary" aria-label="Move Forward" title="Move this record to the next department" onClick={() => setMoving(row)}>
              Move Forward
            </button>
          ) : null}
        </div>
      );
    }
    return <V40Value col={col} row={row} canEdit={perms?.edit !== false} onChanged={reload} />;
  }

  return (
    <div className="inv-v40" data-testid="inv-v40">
      {heading ? <h3 className="inv-v40-sub">{heading}</h3> : null}
      <div className="inv-v40-bar">
        <input type="search" aria-label={`Search ${tab}`} placeholder={`Search ${tab}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        {data && data.statuses.length > 0 ? (
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Status</option>
            {data.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label="Rows per page"
          value={size}
          onChange={(e) => {
            setSize(Number(e.target.value));
            setPage(1);
          }}
        >
          {SIZES.map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </select>
        <span className="inv-v40-spacer" />
        <span className="chip" aria-live="polite">
          {selected.size} selected
        </span>
        {selected.size > 0 ? (
          <button type="button" className="btn sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        ) : null}
        <button type="button" className="btn" disabled={selected.size === 0} onClick={() => csv(true)}>
          Export Selected
        </button>
        {isReport ? (
          <>
            <button type="button" className="btn" onClick={() => csv(false)}>
              Download Excel
            </button>
            <button type="button" className="btn" onClick={pdf}>
              Download Letterhead PDF
            </button>
          </>
        ) : null}
      </div>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <div className="table-wrap" ref={box}>
        <table className="register-table inv-v40-table">
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  className="v8-checkbox"
                  aria-label="Select all rows on this page"
                  checked={allOn}
                  disabled={rows.length === 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((_, i) => i)) : new Set())}
                />
              </th>
              {cols.map((c, ci) => (
                <th key={`${c.key}-${ci}`} scope="col" className={c.format === 'qty' || c.format === 'money' || c.format === 'days' ? 'num' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id ?? 'row'}-${i}`}>
                <td>
                  <input type="checkbox" className="v8-checkbox" aria-label={`Select row ${i + 1}`} checked={selected.has(i)} onChange={(e) => toggle(i, e.target.checked)} />
                </td>
                {cols.map((c, ci) => (
                  <td key={`${c.key}-${ci}`} className={cellClass(c, r)}>
                    {cell(c, r)}
                  </td>
                ))}
              </tr>
            ))}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={cols.length + 1}>Loading…</td>
              </tr>
            ) : null}
            {data && rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={cols.length + 1}>{q || status ? 'No records match these filters.' : 'No records yet.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {data && data.totals.length > 0 ? (
        <div className="inv-v40-totals" aria-label="Totals">
          {data.totals.map((t) => (
            <span key={t.label}>
              <small>{t.label}</small>
              <b>{t.format === 'money' ? formatMoney(t.value) : formatQty(t.value)}</b>
            </span>
          ))}
        </div>
      ) : null}
      <Pager page={page} size={size} total={total} onPage={setPage} />
      {extra}
      {moving && moving.id ? (
        <MoveForwardDialog
          docType={moving.page ?? pageId}
          docId={moving.id}
          docNo={Object.values(moving.cells).find((v): v is string => typeof v === 'string' && v !== '') ?? ''}
          onClose={() => setMoving(null)}
          onMoved={() => setMoving(null)}
        />
      ) : null}
    </div>
  );
}
