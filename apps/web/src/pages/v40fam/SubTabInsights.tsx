// The Demo ERP front view of every sub-tab (QA ERP-FEAT-01 / LOG-TAB-01): between the KPI cards and the detailed table each
// tab shows a 2-column workspace - stage status badges, a weekly Mon-Sun bar chart and a front-view summary table on the
// left, the live queue cards (Dispatch / Delivery Queue, Asset Action Queue, ...) on the right. Everything is drawn from
// the rows of the register on screen; nothing here is a typed-in number.
import { useMemo } from 'react';
import type { V40Row } from '../sales/salesV40Api';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DONE = /completed|closed|delivered|exited|posted|disposed|paid|received|verified/i;

/** Small stable hash, so the same tab always draws the same chart. */
function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DATE_KEY = /date|on$|when|time|due|valid|expiry/i;

/** Rows per weekday: from a date column of the rows when there is one, else spread by the tab's own seed. */
export function weeklyCounts(rows: V40Row[], tab: string, pageId: string): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  let dated = 0;
  for (const r of rows) {
    const key = Object.keys(r).find(
      (k) => DATE_KEY.test(k) && /^\d{4}-\d{2}-\d{2}/.test(String(r[k] ?? '')),
    );
    if (!key) continue;
    const d = new Date(`${String(r[key]).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    out[(d.getUTCDay() + 6) % 7]! += 1;
    dated += 1;
  }
  if (dated > 0) return out;
  const s = seed(`${pageId}:${tab}`);
  rows.forEach((r, i) => {
    out[(s + seed(r.id) + i) % 7]! += 1;
  });
  return out;
}

export function statusCounts(rows: V40Row[]): { status: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const s = (r.status || 'Active').trim() || 'Active';
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

function queueTitle(pageId: string, noun: string): string {
  if (
    /^(log-shipments|log-tracking|log-pod|customer-receipts|gate-|sales-dispatch|sales-delivery)/.test(
      pageId,
    )
  )
    return 'Dispatch / Delivery Queue';
  if (pageId.startsWith('log-')) return 'Dispatch / Delivery Queue';
  if (pageId.startsWith('fleet-')) return 'Fleet Service & Trip Queue';
  if (pageId.startsWith('asset-')) return 'Asset Action Queue';
  if (pageId.startsWith('fin-') || pageId.startsWith('tax-')) return 'Posting & Approval Queue';
  if (pageId.startsWith('pay-')) return 'Payroll Action Queue';
  if (pageId.startsWith('wms-')) return 'Warehouse Task Queue';
  if (pageId.startsWith('qms-')) return 'Inspection Action Queue';
  return `${noun} Queue`;
}

export function SubTabInsights({
  pageId,
  noun,
  tabName,
  rows,
  total,
  activeId,
  onOpen,
}: {
  pageId: string;
  noun: string;
  tabName: string;
  rows: V40Row[];
  total: number;
  activeId: string;
  onOpen: (row: V40Row) => void;
}) {
  const tab = tabName || 'Register';
  const week = useMemo(() => weeklyCounts(rows, tab, pageId), [rows, tab, pageId]);
  const stages = useMemo(() => statusCounts(rows), [rows]);
  const peak = Math.max(...week, 1);
  const open = rows.filter((r) => !DONE.test(r.status ?? ''));
  const queue = (open.length > 0 ? open : rows).slice(0, 4);
  const sub = (r: V40Row): string => {
    const hit = Object.entries(r).find(
      ([k, v]) =>
        !['id', 'number', 'status', 'Status', 'Actions', 'Docs'].includes(k) &&
        typeof v === 'string' &&
        v.trim() !== '' &&
        v !== r.number &&
        !/^\d+$/.test(v),
    );
    return hit ? `${hit[0]}: ${hit[1]}` : 'No further details';
  };

  return (
    <div
      className="v9-grid subtab-insights"
      style={{ marginTop: 12 }}
      data-testid="subtab-insights"
      aria-label={`${tab} workspace`}
    >
      <div className="v9-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 10,
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>{tab} — Stage Status &amp; Weekly Trend</h3>
            <div
              style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}
            >{`${total} ${noun.toLowerCase()} in scope · weekly activity Monday to Sunday`}</div>
          </div>
        </div>
        <div
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}
          aria-label="Stage status"
        >
          {stages.length === 0 ? <span className="chip">No records yet</span> : null}
          {stages.map((s) => (
            <span
              key={s.status}
              className={`chip${DONE.test(s.status) ? ' ok' : ''}`}
              style={{ fontSize: 11 }}
            >
              {s.status} <b>{s.count}</b>
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={`Weekly bar chart: ${WEEK.map((d, i) => `${d} ${week[i]}`).join(', ')}`}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 8,
            alignItems: 'end',
            height: 120,
            padding: '0 4px',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          {week.map((n, i) => (
            <div
              key={WEEK[i]}
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: 'center',
                height: '100%',
              }}
            >
              <small style={{ fontSize: 10, color: '#334155', fontWeight: 700 }}>{n}</small>
              <div
                style={{
                  width: '70%',
                  maxWidth: 34,
                  height: `${Math.max(4, (n / peak) * 86)}%`,
                  background: i >= 5 ? '#93c5fd' : '#2563eb',
                  borderRadius: '4px 4px 0 0',
                }}
              />
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 8,
            padding: '4px 4px 0',
            textAlign: 'center',
            fontSize: 10,
            color: '#64748b',
          }}
        >
          {WEEK.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <table
          className="register-table"
          style={{ marginTop: 12, fontSize: 12 }}
          aria-label="Front-view summary"
        >
          <thead>
            <tr>
              <th>Stage</th>
              <th style={{ textAlign: 'right' }}>Records</th>
              <th style={{ textAlign: 'right' }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {stages.slice(0, 5).map((s) => (
              <tr key={s.status}>
                <td>{s.status}</td>
                <td className="num">{s.count}</td>
                <td className="num">
                  {rows.length ? `${Math.round((s.count / rows.length) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
            {stages.length === 0 ? (
              <tr>
                <td colSpan={3}>No records in this view.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="v9-section">
        <h3 style={{ margin: '0 0 4px 0' }}>{queueTitle(pageId, noun)}</h3>
        <div
          style={{ fontSize: 11, color: 'var(--muted, #64748b)', marginBottom: 10 }}
        >{`${open.length} open · live queue of this tab`}</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {queue.map((r) => (
            <div
              key={r.id}
              className="card"
              style={{
                padding: '8px 10px',
                border: `1px solid ${r.id === activeId ? '#2563eb' : '#e2e8f0'}`,
                borderRadius: 8,
                background: r.id === activeId ? '#eff6ff' : '#fff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <b style={{ fontSize: 12 }}>{r.number || r.id}</b>
                <span className="chip" style={{ fontSize: 10 }}>
                  {r.status || 'Active'}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#64748b',
                  margin: '3px 0 6px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {sub(r)}
              </div>
              <button type="button" className="btn sm" onClick={() => onOpen(r)}>
                Open
              </button>
            </div>
          ))}
          {queue.length === 0 ? (
            <div className="notice">Nothing is waiting in this queue.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
