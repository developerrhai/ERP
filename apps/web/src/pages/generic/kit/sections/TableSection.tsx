// apps/web/src/pages/generic/kit/sections/TableSection.tsx
// Table section using existing table-wrap, paging, totals, and row actions (docs/plans/07-ENGINE-KIT.md §2.3)

import type { Column, PanelAction, PanelCall, Row } from '../panelTypes';
import { formatValue } from '../formatValue';
import { InlineCell } from './InlineCell';

export interface TableSectionProps {
  title?: string;
  columns: Column[];
  rows: Row[];
  empty?: string;
  meta?: { page: number; size: number; total: number };
  totals?: Record<string, number>;
  rowActions?: PanelAction[];
  headerActions?: PanelAction[];
  onAction?: (action: PanelAction, row?: Row) => void;
  onPageChange?: (page: number) => void;
  onCall?: (call: PanelCall, opts?: { payload?: Record<string, unknown> }) => Promise<unknown>;
}

export function TableSection({
  title,
  columns,
  rows,
  empty,
  meta,
  totals,
  rowActions,
  headerActions,
  onAction,
  onPageChange,
  onCall,
}: TableSectionProps) {
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.size)) : 1;

  return (
    <div className="v9-section table-section">
      <div
        className="table-header-bar"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        {title ? <h3>{title}</h3> : <span />}
        {headerActions && headerActions.length > 0 ? (
          <div className="actions">
            {headerActions.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`btn ${a.variant ?? ''}`}
                onClick={() => onAction?.(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col) => {
                const align =
                  col.align ??
                  (col.format === 'qty' || col.format === 'money' || col.format === 'number'
                    ? 'right'
                    : 'left');
                return (
                  <th key={col.key} style={{ textAlign: align }}>
                    {col.label}
                  </th>
                );
              })}
              {rowActions && rowActions.length > 0 ? (
                <th style={{ textAlign: 'right' }}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (rowActions && rowActions.length > 0 ? 1 : 0)}
                  className="empty"
                  style={{ textAlign: 'center', padding: '24px' }}
                >
                  {empty ?? 'No records found.'}
                </td>
              </tr>
            ) : (
              rows.map((row, rIdx) => (
                <tr key={row.id ?? String(rIdx)}>
                  {columns.map((col) => {
                    const align =
                      col.align ??
                      (col.format === 'qty' || col.format === 'money' || col.format === 'number'
                        ? 'right'
                        : 'left');
                    return (
                      <td key={col.key} style={{ textAlign: align }}>
                        {col.editable ? (
                          <InlineCell
                            rowId={String(row.id ?? rIdx)}
                            initialValue={row[col.key]}
                            editable={col.editable}
                            onCall={onCall}
                          />
                        ) : (
                          formatValue(row[col.key], col.format)
                        )}
                      </td>
                    );
                  })}
                  {rowActions && rowActions.length > 0 ? (
                    <td style={{ textAlign: 'right' }}>
                      <div className="actions" style={{ display: 'inline-flex', gap: '4px' }}>
                        {rowActions.map((a) => (
                          <button
                            key={a.key}
                            type="button"
                            className={`btn small ${a.variant ?? ''}`}
                            onClick={() => onAction?.(a, row)}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
          {totals && Object.keys(totals).length > 0 ? (
            <tfoot>
              <tr>
                {columns.map((col, idx) => {
                  const align =
                    col.align ??
                    (col.format === 'qty' || col.format === 'money' || col.format === 'number'
                      ? 'right'
                      : 'left');
                  const val = totals[col.key];
                  return (
                    <td key={col.key} style={{ textAlign: align, fontWeight: 'bold' }}>
                      {idx === 0 && val === undefined
                        ? 'Total'
                        : val !== undefined
                          ? formatValue(val, col.format)
                          : ''}
                    </td>
                  );
                })}
                {rowActions && rowActions.length > 0 ? <td /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {meta && totalPages > 1 ? (
        <div
          className="pagination"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '10px',
          }}
        >
          <span className="muted" style={{ fontSize: '11px' }}>
            Page {meta.page} of {totalPages} ({meta.total} rows)
          </span>
          <div className="actions" style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="btn small"
              disabled={meta.page <= 1}
              onClick={() => onPageChange?.(meta.page - 1)}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn small"
              disabled={meta.page >= totalPages}
              onClick={() => onPageChange?.(meta.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
