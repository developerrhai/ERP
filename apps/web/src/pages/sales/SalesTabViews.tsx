// The Analytics & Graphs, Calendar & Schedule and Reports tabs of the CRM / Sales pages. Every figure comes from the
// page's own records: whole-set counts from GET /sales/v40/:pageId/summary, dates and rows from the V40 register view.
// Nothing here is a sample number; an empty page shows empty states.
import { useMemo, useState } from 'react';
import { saveFile } from '../../lib/docsMailApi';
import { useLoad } from '../../lib/useLoad';
import { dmy } from '../finance/shared';
import { getSalesV40, getSalesV40Summary, type V40Row } from './salesV40Api';

const EMPTY = <p className="v8-sub">Nothing to show here yet.</p>;
const BIG = 100;

export const isAnalyticsTab = (n: string): boolean => /^analytics/i.test(n.trim());
export const isCalendarTab = (n: string): boolean => /^calendar/i.test(n.trim());
export const isReportsTab = (n: string): boolean => /^reports?$/i.test(n.trim());

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Counts by status and by month for the whole page (not just the visible 20 rows). */
export function SalesAnalyticsView({ pageId, noun }: { pageId: string; noun: string }) {
  const { data, loading, error } = useLoad(() => getSalesV40Summary(pageId), [pageId]);
  if (error) return <p role="alert">{error}</p>;
  if (loading && !data) return <p className="muted">Loading…</p>;
  if (!data || data.total === 0) return EMPTY;
  const maxS = Math.max(1, ...data.byStatus.map((s) => s.count));
  const maxM = Math.max(1, ...data.byMonth.map((m) => m.count));
  return (
    <section className="sv40-panel" aria-label="Analytics">
      <div className="v8-table-summary" role="group" aria-label="Totals">
        <div className="v8-mini">
          <small>All {noun}</small>
          <b>{data.total}</b>
        </div>
        {data.byStatus.slice(0, 4).map((s) => (
          <div className="v8-mini" key={s.status}>
            <small>{s.status}</small>
            <b>{s.count}</b>
          </div>
        ))}
      </div>
      <h3>By status</h3>
      <div role="list" aria-label="Records by status">
        {data.byStatus.map((s) => (
          <div
            role="listitem"
            key={s.status}
            style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}
          >
            <span style={{ width: 130, fontSize: 12 }}>{s.status}</span>
            <span style={{ flex: 1, background: '#e2e8f0', borderRadius: 4, height: 14 }}>
              <span
                style={{
                  display: 'block',
                  width: `${(s.count / maxS) * 100}%`,
                  background: '#2563eb',
                  height: 14,
                  borderRadius: 4,
                }}
              />
            </span>
            <b style={{ width: 36, textAlign: 'right', fontSize: 12 }}>{s.count}</b>
          </div>
        ))}
      </div>
      {data.byMonth.length > 0 ? (
        <>
          <h3>Created per month</h3>
          <div
            style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120 }}
            role="list"
            aria-label="Records per month"
          >
            {data.byMonth.map((m) => (
              <div
                role="listitem"
                key={m.month}
                style={{ flex: '1 1 0', maxWidth: 90, textAlign: 'center', fontSize: 11 }}
              >
                <b>{m.count}</b>
                <div
                  style={{
                    background: '#16a34a',
                    height: `${Math.max(4, (m.count / maxM) * 80)}px`,
                    borderRadius: 4,
                    margin: '2px 0',
                  }}
                />
                {m.month}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** A month grid with every dated record of the page (delivery, follow-up, valid-until ... whatever date columns the page has). */
export function SalesCalendarView({ pageId, tabName }: { pageId: string; tabName: string }) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const { data, loading, error } = useLoad(
    () => getSalesV40(pageId, { tab: '', first: true, q: '', status: '', page: 1, size: BIG }),
    [pageId],
  );
  const events = useMemo(() => {
    const out = new Map<string, { id: string; label: string; what: string }[]>();
    if (!data) return out;
    const dateCols = data.columns.filter((c) => c.type === 'date');
    for (const r of data.rows) {
      for (const c of dateCols) {
        const m = ISO.exec(r[c.key] ?? '');
        if (!m) continue;
        const k = `${m[1]}-${m[2]}-${m[3]}`;
        const list = out.get(k) ?? [];
        list.push({ id: `${r.id}:${c.key}`, label: r.number, what: c.label });
        out.set(k, list);
      }
    }
    return out;
  }, [data]);
  if (error) return <p role="alert">{error}</p>;
  const y = cursor.getFullYear();
  const mo = cursor.getMonth();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday first
  const days = new Date(y, mo + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const key = (d: number): string =>
    `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const total = cells.reduce<number>((n, d) => n + (d ? (events.get(key(d))?.length ?? 0) : 0), 0);
  return (
    <section className="sv40-panel" aria-label={tabName}>
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>
          {cursor.toLocaleString('en-IN', { month: 'long', year: 'numeric' })} · {total} dated{' '}
          {total === 1 ? 'item' : 'items'}
        </h3>
        <span>
          <button
            type="button"
            className="btn sm"
            onClick={() => setCursor(new Date(y, mo - 1, 1))}
          >
            ← Prev
          </button>{' '}
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const n = new Date();
              setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
            }}
          >
            Today
          </button>{' '}
          <button
            type="button"
            className="btn sm"
            onClick={() => setCursor(new Date(y, mo + 1, 1))}
          >
            Next →
          </button>
        </span>
      </div>
      {loading && !data ? <p className="muted">Loading…</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 8 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div
            key={d}
            style={{
              textAlign: 'center',
              fontWeight: 700,
              fontSize: 11,
              padding: '4px 0',
              background: '#f1f5f9',
              borderRadius: 4,
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div
            key={i}
            style={{
              minHeight: 70,
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              padding: 4,
              background: d ? '#fff' : '#f8fafc',
            }}
          >
            {d ? <div style={{ fontSize: 11, fontWeight: 700 }}>{d}</div> : null}
            {d
              ? (events.get(key(d)) ?? []).slice(0, 3).map((e) => (
                  <div
                    key={e.id}
                    title={`${e.label} · ${e.what}`}
                    style={{
                      background: '#dbeafe',
                      color: '#1e40af',
                      fontSize: 10,
                      padding: '2px 4px',
                      borderRadius: 3,
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {e.label} · {e.what}
                  </div>
                ))
              : null}
            {d && (events.get(key(d))?.length ?? 0) > 3 ? (
              <small>+{(events.get(key(d))?.length ?? 0) - 3} more</small>
            ) : null}
          </div>
        ))}
      </div>
      {!loading && data && events.size === 0 ? (
        <p className="v8-sub">No record on this page has a date to show yet.</p>
      ) : null}
    </section>
  );
}

/** Status summary plus a CSV of the records (every column of the register, up to 100 newest). */
export function SalesReportsView({ pageId, noun }: { pageId: string; noun: string }) {
  const sum = useLoad(() => getSalesV40Summary(pageId), [pageId]);
  const reg = useLoad(
    () => getSalesV40(pageId, { tab: '', first: true, q: '', status: '', page: 1, size: BIG }),
    [pageId],
  );
  const err = sum.error || reg.error;
  const rows: V40Row[] = reg.data?.rows ?? [];
  const cols = (reg.data?.columns ?? []).filter((c) => c.type !== 'actions' && c.type !== 'docs');
  function exportCsv(): void {
    const lines = [cols.map((c) => csvCell(c.label)).join(',')];
    for (const r of rows) lines.push(cols.map((c) => csvCell(r[c.key] ?? '')).join(','));
    saveFile(
      {
        blob: new Blob([lines.join('\n')], { type: 'text/csv' }),
        filename: `${pageId}-report.csv`,
      },
      `${pageId}-report.csv`,
    );
  }
  return (
    <section className="sv40-panel" aria-label="Reports">
      {err ? <p role="alert">{err}</p> : null}
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{noun} report</h3>
        <span>
          <button type="button" className="btn sm" disabled={rows.length === 0} onClick={exportCsv}>
            Export CSV
          </button>{' '}
          <button type="button" className="btn sm" onClick={() => window.print()}>
            Print
          </button>
        </span>
      </div>
      {sum.data ? (
        <div className="table-wrap">
          <table className="register-table">
            <thead>
              <tr>
                <th>Status</th>
                <th className="num">Records</th>
                <th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {sum.data.byStatus.map((s) => (
                <tr key={s.status}>
                  <td>{s.status}</td>
                  <td className="num">{s.count}</td>
                  <td className="num">
                    {sum.data && sum.data.total ? Math.round((s.count / sum.data.total) * 100) : 0}%
                  </td>
                </tr>
              ))}
              <tr>
                <th>Total</th>
                <th className="num">{sum.data.total}</th>
                <th />
              </tr>
              {sum.data.total === 0 ? (
                <tr>
                  <td colSpan={3}>Nothing to report yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Loading…</p>
      )}
      {rows.length > 0 ? (
        <>
          <h3>Latest {rows.length} records</h3>
          <div className="table-wrap">
            <table className="register-table">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {cols.map((c) => (
                      <td key={c.key}>
                        {c.type === 'date' ? dmy(r[c.key] ?? null) : (r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
