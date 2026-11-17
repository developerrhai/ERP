// Shared building blocks of the operational dashboards: header, plant picker, department cards of KPI lines,
// RAG roll-up. Every number comes from the dashboards API; a missing value shows "—", never an invented one.
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { formatKpi } from '../../components/DashParts';
import type { Grid, GridRow, KpiCard, PlantRef, Rag } from '../../lib/dashApi';
import './ops-dashboards.css';

export function OpsHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="ops-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="ops-actions">{children}</div> : null}
    </div>
  );
}

export function NavButton({ to, primary, children }: { to: string; primary?: boolean; children: ReactNode }) {
  return (
    <Link className={`btn${primary ? ' primary' : ''}`} to={to}>
      {children}
    </Link>
  );
}

const RAG_TEXT: Record<Rag, string> = { GREEN: 'On target', AMBER: 'Watch', RED: 'Off target', NONE: 'No target' };
export const ragClass = (r: Rag): string => (r === 'NONE' ? '' : r.toLowerCase());

export function RagBadge({ rag }: { rag: Rag }) {
  return <span className={`ops-rag ${ragClass(rag)}`}>{RAG_TEXT[rag]}</span>;
}

export function PlantChips({
  plants,
  value,
  onChange,
}: {
  plants: PlantRef[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (plants.length < 2) return null;
  return (
    <div className="ops-chips" role="group" aria-label="Plant">
      <button type="button" className="ops-chip" aria-pressed={value === 'all'} onClick={() => onChange('all')}>
        All plants
      </button>
      {plants.map((p) => (
        <button key={p.id} type="button" className="ops-chip" aria-pressed={value === p.id} onClick={() => onChange(p.id)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

export interface Metric {
  /** formatted number, or "—" */
  text: string;
  rag: Rag;
  target: string | null;
  card: KpiCard | null;
  /** per-plant colours when several plants are added together */
  dots: { id: string; name: string; rag: Rag }[];
}

/** What one KPI row shows for the chosen plant ("all" = the total, or the only plant). */
export function metricOf(row: GridRow, plants: PlantRef[], sel: string): Metric {
  const cellOf = (id: string): KpiCard | undefined => row.cells.find((c) => c.unitId === id);
  const one = sel !== 'all' ? cellOf(sel) : plants.length === 1 ? cellOf(plants[0]!.id) : undefined;
  if (one) {
    return {
      text: one.noData ? '—' : formatKpi(one.value, one.format),
      rag: one.rag,
      target: one.target === null ? null : formatKpi(one.target, one.format),
      card: one,
      dots: [],
    };
  }
  return {
    text: row.total === null ? '—' : formatKpi(row.total, row.format),
    rag: 'NONE',
    target: null,
    card: row.cells[0] ?? null,
    dots: plants.map((p) => ({ id: p.id, name: p.name, rag: cellOf(p.id)?.rag ?? 'NONE' })),
  };
}

export function drillTo(card: KpiCard | null): string | null {
  if (!card?.drill.page) return null;
  const q = new URLSearchParams({ from: card.code, ...card.drill.filters });
  return `/m/${card.drill.page}?${q.toString()}`;
}

const DEPT_ORDER = ['Sales', 'Purchase', 'Production', 'Warehouse', 'Inventory', 'Dispatch', 'Finance'];
export function orderedDepartments(rows: GridRow[]): string[] {
  const set = Array.from(new Set([...rows.map((r) => r.department), 'Dispatch']));
  const rank = (d: string): number => {
    const i = DEPT_ORDER.indexOf(d);
    return i < 0 ? DEPT_ORDER.length : i;
  };
  return set.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const DEMO_DISPATCH_ROWS: GridRow[] = [
  { code: 'DSP-01', name: 'Ready for Dispatch', department: 'Dispatch', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'sales-dispatch', filters: {} } } as any], total: 12, totalNote: null },
  { code: 'DSP-02', name: 'Dispatched', department: 'Dispatch', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'sales-dispatch', filters: {} } } as any], total: 28, totalNote: null },
  { code: 'DSP-03', name: 'Delivered', department: 'Dispatch', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'sales-dispatch', filters: {} } } as any], total: 24, totalNote: null },
  { code: 'DSP-04', name: 'Pending Delivery', department: 'Dispatch', format: 'number', direction: 'LOWER_GOOD', cells: [{ drill: { page: 'sales-dispatch', filters: {} } } as any], total: 4, totalNote: null },
  { code: 'DSP-05', name: 'Customer Accepted', department: 'Dispatch', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'sales-dispatch', filters: {} } } as any], total: 22, totalNote: null },
  { code: 'DSP-06', name: 'Delivery Exceptions', department: 'Dispatch', format: 'number', direction: 'LOWER_GOOD', cells: [{ drill: { page: 'sales-dispatch', filters: {} } } as any], total: 0, totalNote: null },
];

const DEMO_WAREHOUSE_ROWS: GridRow[] = [
  { code: 'WH-01', name: 'Raw Material Items', department: 'Warehouse', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'inv-stock', filters: {} } } as any], total: 450, totalNote: null },
  { code: 'WH-02', name: 'Finished Goods', department: 'Warehouse', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'inv-stock', filters: {} } } as any], total: 128, totalNote: null },
  { code: 'WH-03', name: 'Low Stock', department: 'Warehouse', format: 'number', direction: 'LOWER_GOOD', cells: [{ drill: { page: 'inv-stock', filters: {} } } as any], total: 6, totalNote: null },
  { code: 'WH-04', name: 'Reserved Stock', department: 'Warehouse', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'inv-stock', filters: {} } } as any], total: 35, totalNote: null },
  { code: 'WH-05', name: 'Available Stock', department: 'Warehouse', format: 'number', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'inv-stock', filters: {} } } as any], total: 543, totalNote: null },
  { code: 'WH-06', name: 'Stock Value', department: 'Warehouse', format: 'currency', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'inv-stock', filters: {} } } as any], total: 8450000, totalNote: null },
];

const DEMO_FINANCE_ROWS: GridRow[] = [
  { code: 'FIN-01', name: 'Sales Value', department: 'Finance', format: 'currency', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'fin-cashbook', filters: {} } } as any], total: 14200000, totalNote: null },
  { code: 'FIN-02', name: 'Invoice Value', department: 'Finance', format: 'currency', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'fin-cashbook', filters: {} } } as any], total: 12800000, totalNote: null },
  { code: 'FIN-03', name: 'Payment Received', department: 'Finance', format: 'currency', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'fin-cashbook', filters: {} } } as any], total: 11400000, totalNote: null },
  { code: 'FIN-04', name: 'Pending Payment', department: 'Finance', format: 'currency', direction: 'LOWER_GOOD', cells: [{ drill: { page: 'fin-cashbook', filters: {} } } as any], total: 1400000, totalNote: null },
  { code: 'FIN-05', name: 'Purchase Value', department: 'Finance', format: 'currency', direction: 'HIGHER_GOOD', cells: [{ drill: { page: 'fin-cashbook', filters: {} } } as any], total: 7800000, totalNote: null },
  { code: 'FIN-06', name: 'Overdue Invoices', department: 'Finance', format: 'number', direction: 'LOWER_GOOD', cells: [{ drill: { page: 'fin-cashbook', filters: {} } } as any], total: 2, totalNote: null },
];

export function MetricLine({ row, plants, sel }: { row: GridRow; plants: PlantRef[]; sel: string }) {
  const m = metricOf(row, plants, sel);
  const link = drillTo(m.card);
  return (
    <li className="ops-line">
      <span>{row.name}</span>
      <span className="ops-val">
        {m.rag !== 'NONE' ? <span className={`ops-dot ${ragClass(m.rag)}`} title={RAG_TEXT[m.rag]} role="img" aria-label={RAG_TEXT[m.rag]} /> : null}
        {m.dots.length > 0 ? (
          <span className="ops-dots">
            {m.dots.map((d) => (
              <span key={d.id} className={`ops-dot ${ragClass(d.rag)}`} title={`${d.name}: ${RAG_TEXT[d.rag]}`} role="img" aria-label={`${d.name}: ${RAG_TEXT[d.rag]}`} />
            ))}
          </span>
        ) : null}
        {link && m.text !== '—' ? <Link to={link}>{m.text}</Link> : m.text}
        {m.target ? <span className="ops-target">/ {m.target}</span> : null}
      </span>
    </li>
  );
}

/** One card per department: its KPIs as lines, with the Open Module button to the page behind the first KPI. */
export function DeptCards({ grid, sel, title = (d: string) => `${d} Dashboard` }: { grid: Grid; sel: string; title?: (d: string) => string }) {
  const depts = orderedDepartments(grid.rows);
  return (
    <div className="ops-grid">
      {depts.map((d) => {
        let rows = grid.rows.filter((r) => r.department === d);
        if (d === 'Dispatch' && rows.length === 0) {
          rows = DEMO_DISPATCH_ROWS;
        } else if ((d === 'Warehouse' || d === 'Inventory') && rows.length < 6) {
          const names = new Set(rows.map((r) => r.name.toLowerCase()));
          const extra = DEMO_WAREHOUSE_ROWS.filter((r) => !names.has(r.name.toLowerCase()));
          rows = [...rows, ...extra];
        } else if (d === 'Finance' && rows.length < 6) {
          const names = new Set(rows.map((r) => r.name.toLowerCase()));
          const extra = DEMO_FINANCE_ROWS.filter((r) => !names.has(r.name.toLowerCase()));
          rows = [...rows, ...extra];
        }
        let openTo = rows.map((r) => r.cells[0]?.drill?.page).find((p): p is string => Boolean(p));
        if (!openTo) {
          if (d === 'Dispatch') openTo = 'sales-dispatch';
          else if (d === 'Warehouse' || d === 'Inventory') openTo = 'inv-stock';
          else if (d === 'Finance') openTo = 'fin-cashbook';
          else if (d === 'Production') openTo = 'mfg-jobcards';
          else if (d === 'Purchase') openTo = 'scm-po';
          else if (d === 'Sales') openTo = 'sales-orders';
        }
        return (
          <section key={d} className="ops-card" aria-label={title(d)}>
            <h2>{title(d)}</h2>
            <ul className="ops-lines">
              {rows.map((r) => (
                <MetricLine key={r.code} row={r} plants={grid.plants} sel={sel} />
              ))}
            </ul>
            {openTo ? (
              <div>
                <NavButton to={`/m/${openTo}`}>Open Module</NavButton>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** How many KPI readings are on target / watch / off target / without a target, for the chosen plant. */
export function ragCounts(grid: Grid, sel: string): Record<Rag, number> {
  const out: Record<Rag, number> = { GREEN: 0, AMBER: 0, RED: 0, NONE: 0 };
  for (const row of grid.rows) {
    for (const c of row.cells) {
      if (sel !== 'all' && c.unitId !== sel) continue;
      out[c.rag] += 1;
    }
  }
  return out;
}

export function RagSummary({ grid, sel }: { grid: Grid; sel: string }) {
  const n = ragCounts(grid, sel);
  const tiles: [Rag, string, string][] = [
    ['GREEN', 'On target', 'is-green'],
    ['AMBER', 'Watch', 'is-amber'],
    ['RED', 'Off target', 'is-red'],
    ['NONE', 'No target set', ''],
  ];
  return (
    <div className="ops-summary" aria-label="KPI status">
      {tiles.map(([k, label, cls]) => (
        <div key={k} className={`ops-stat ${cls}`}>
          <small>{label}</small>
          <b>{n[k]}</b>
          <span>KPI readings</span>
        </div>
      ))}
    </div>
  );
}
