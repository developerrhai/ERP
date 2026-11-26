// What the "Analytics & Graphs", "Calendar & Schedule" and "Reports" tabs of a V40 register add above its table: charts,
// a date-wise list and a downloadable report, all worked out from the register's own rows (nothing invented).
import { saveFile } from '../../lib/docsMailApi';
import { dmy } from '../finance/shared';
import './tab-insights.css';

export type InsightKind = 'analytics' | 'calendar' | 'reports';

export function insightKind(tabName: string): InsightKind | null {
  const n = tabName.trim();
  if (/analytics|graphs?$|\btrends?\b|\bkpi\b/i.test(n)) return 'analytics';
  if (/^calendar/i.test(n)) return 'calendar';
  if (/^reports?$/i.test(n)) return 'reports';
  return null;
}

export interface InsightColumn {
  key: string;
  label: string;
  type: string;
}
type Row = Record<string, string | null> & { id: string; number?: string | null; status?: string | null };
interface Count {
  label: string;
  value: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
const real = (v: string | null | undefined): v is string => v !== null && v !== undefined && v !== '' && v !== '—';

function tally(values: (string | null | undefined)[], top = 8): Count[] {
  const m = new Map<string, number>();
  for (const v of values) if (real(v)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, top);
}

const dateColumn = (columns: InsightColumn[], rows: Row[]): InsightColumn | null =>
  columns.find((c) => (c.type === 'date' || c.type === 'text') && rows.some((r) => ISO.test(r[c.key] ?? ''))) ?? null;

/** Text columns whose values repeat: the ones worth counting (vendor, machine, reason ...). */
const groupColumns = (columns: InsightColumn[], rows: Row[]): InsightColumn[] =>
  columns
    .filter((c) => c.type === 'text' && !/status|actions|docs|description|note|remark|narration/i.test(c.label))
    .filter((c) => {
      const values = rows.map((r) => r[c.key]).filter(real);
      const distinct = new Set(values).size;
      return distinct > 1 && distinct <= Math.max(2, values.length * 0.7) && !values.some((v) => ISO.test(v));
    })
    .slice(0, 3);

function Bars({ title, items }: { title: string; items: Count[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <section className="ti-card" aria-label={title}>
      <h3>{title}</h3>
      {items.length === 0 ? <p className="muted">Nothing to count yet.</p> : null}
      <ul className="ti-bars">
        {items.map((i) => (
          <li key={i.label}>
            <span className="ti-label" title={i.label}>
              {i.label}
            </span>
            <span className="ti-track">
              <span className="ti-fill" style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }} />
            </span>
            <b>{i.value}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TabInsights({
  kind,
  title,
  fileName,
  columns,
  rows,
  total,
  loading,
}: {
  kind: InsightKind;
  title: string;
  fileName: string;
  columns: InsightColumn[];
  rows: Row[];
  total: number;
  loading: boolean;
}) {
  if (loading) return <p role="status">Preparing…</p>;
  const shown = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs');
  const statusKey = columns.find((c) => /^status$/i.test(c.label))?.key;
  const statuses = tally(rows.map((r) => (statusKey ? r[statusKey] : r.status)));
  const scope = total > rows.length ? `Worked out from the latest ${rows.length} of ${total} records.` : `Worked out from all ${rows.length} records.`;
  const day = dateColumn(shown, rows);

  if (kind === 'calendar') {
    const days = new Map<string, Row[]>();
    if (day) {
      for (const r of rows) {
        const v = r[day.key] ?? '';
        if (!ISO.test(v)) continue;
        const k = v.slice(0, 10);
        days.set(k, [...(days.get(k) ?? []), r]);
      }
    }
    const ordered = [...days].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 24);
    return (
      <div className="ti">
        <p className="muted">{day ? `Records placed by ${day.label}, newest first. ${scope}` : 'The records of this register carry no date, so there is nothing to place on a calendar.'}</p>
        <div className="ti-days">
          {ordered.map(([date, list]) => (
            <section className="ti-card" key={date} aria-label={date}>
              <h3>
                {dmy(date)} <small>{`${list.length} record${list.length === 1 ? '' : 's'}`}</small>
              </h3>
              <ul className="ti-list">
                {list.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <b>{r.number || r[shown[0]?.key ?? ''] || '—'}</b>
                    <span>{(statusKey ? r[statusKey] : r.status) ?? ''}</span>
                  </li>
                ))}
                {list.length > 6 ? <li>{`and ${list.length - 6} more`}</li> : null}
              </ul>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const sums = shown
    .filter((c) => c.type === 'num' || c.type === 'inr')
    .map((c) => ({ label: c.label, type: c.type, value: rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0), used: rows.some((r) => real(r[c.key])) }))
    .filter((s) => s.used)
    .slice(0, 4);
  const cards = (
    <div className="ti-kpis">
      <div className="ti-kpi">
        <small>Records</small>
        <b>{total}</b>
      </div>
      {sums.map((s) => (
        <div className="ti-kpi" key={s.label}>
          <small>{`Total ${s.label}`}</small>
          <b>{`${s.type === 'inr' ? '₹ ' : ''}${s.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}</b>
        </div>
      ))}
    </div>
  );

  if (kind === 'reports') {
    const download = (): void => {
      const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const lines = [shown.map((c) => cell(c.label)).join(','), ...rows.map((r) => shown.map((c) => cell(r[c.key] ?? '')).join(','))];
      saveFile({ blob: new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename: null }, `${fileName}-report.csv`);
    };
    return (
      <div className="ti">
        <div className="ti-report-head">
          <div>
            <h3>{`${title} report`}</h3>
            <p className="muted">{scope}</p>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" disabled={rows.length === 0} onClick={download}>
              ⇩ Download report (CSV)
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
        {cards}
        <div className="ti-grid">
          <Bars title="Records by status" items={statuses} />
        </div>
      </div>
    );
  }

  const months = day
    ? tally(
        rows.map((r) => (ISO.test(r[day.key] ?? '') ? (r[day.key] ?? '').slice(0, 7) : null)),
        12,
      ).sort((a, b) => a.label.localeCompare(b.label))
    : [];
  return (
    <div className="ti">
      <p className="muted">{scope}</p>
      {cards}
      <div className="ti-grid">
        <Bars title="Records by status" items={statuses} />
        {groupColumns(shown, rows).map((c) => (
          <Bars key={c.key} title={`Records by ${c.label}`} items={tally(rows.map((r) => r[c.key]))} />
        ))}
        {day && months.length > 0 ? <Bars title={`Records by month (${day.label})`} items={months} /> : null}
      </div>
    </div>
  );
}
