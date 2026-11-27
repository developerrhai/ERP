// Small building blocks shared by the BI and AI dashboards: KPI card, chart card, data table, empty state, "how computed" note.
import type { ReactNode } from 'react';
import { useFrame } from '../frame/V40TabFrame';
import { fmt, type Cell, type Col } from './analyticsModel';
import './bi-dashboards.css';

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="card kpi">
      <small>{label}</small>
      <b>{value}</b>
      {hint ? <span className={`good${tone ? ` ${tone}` : ''}`}>{hint}</span> : null}
    </div>
  );
}

export function ChartCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="card panel">
      <h3>{title}</h3>
      {sub ? <div className="bi-sub">{sub}</div> : null}
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="bi-empty" role="status">
      {children}
    </div>
  );
}

export function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <details className="bi-note">
      <summary>How these numbers are computed</summary>
      <ul>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

const BADGE = /^(high|medium|low|ok|shortage|overstock|within plan|off plan)$/i;
function badgeClass(v: string): string {
  const k = v.toLowerCase();
  return k === 'within plan' ? 'within' : k === 'off plan' ? 'off' : k;
}

export function DataTable({
  title,
  columns,
  rows,
  empty,
  aside,
  wrapKeys = [],
  showRowActions = true,
  onRowAction,
}: {
  title: string;
  columns: Col[];
  rows: Array<Record<string, Cell>>;
  empty: string;
  aside?: ReactNode;
  wrapKeys?: string[];
  showRowActions?: boolean;
  onRowAction?: (action: string, row: Record<string, Cell>) => void;
}) {
  const handleAction = (action: string, row: Record<string, Cell>) => {
    if (onRowAction) {
      onRowAction(action, row);
      return;
    }
    const label = String(row.name || row.code || row.title || row.id || 'record');
    if (action === 'PDF' || action === 'Word') {
      window.print();
    } else {
      alert(`${action}: ${label}`);
    }
  };

  return (
    <div className="card table-wrap bi-table-card">
      <div className="toolbar x-d-flex x-jc-space-between x-ai-center x-p-10px-14px x-bb-1px-solid-line">
        <b className="x-fs-14px x-c-text">{title}</b>
        {aside}
      </div>
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.type === 'inr' || c.type === 'int' || c.type === 'num' || c.type === 'pct' ? 'num' : undefined}>
                  {c.label}
                </th>
              ))}
              {showRowActions ? <th scope="col" style={{ width: 180, textAlign: 'center' }}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => {
                  const text = fmt(r[c.key], c.type);
                  const isNum = c.type === 'inr' || c.type === 'int' || c.type === 'num' || c.type === 'pct';
                  const cls = [isNum ? 'num' : '', wrapKeys.includes(c.key) ? 'wrap' : ''].filter(Boolean).join(' ') || undefined;
                  return (
                    <td key={c.key} className={cls}>
                      {c.type === 'text' && BADGE.test(text) ? <span className={`bi-badge ${badgeClass(text)}`}>{text}</span> : text}
                    </td>
                  );
                })}
                {showRowActions ? (
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        onClick={() => handleAction('View', r)}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        onClick={() => handleAction('Edit', r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        onClick={() => handleAction('Docs', r)}
                      >
                        Docs
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        onClick={() => handleAction('PDF', r)}
                      >
                        PDF
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (showRowActions ? 1 : 0)}>{empty}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Which V40 tab is open (name + index); 0 when the page is shown without the tab frame. */
export function useOpenTab(tabs: string[]): { name: string; index: number } {
  const frame = useFrame();
  if (!frame) return { name: tabs[0] ?? '', index: 0 };
  return { name: frame.tabName || tabs[frame.index] || '', index: frame.index };
}
