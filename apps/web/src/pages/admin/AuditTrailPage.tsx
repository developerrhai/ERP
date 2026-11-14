// Audit Trail (admin-audit): read-only, newest-first audit log with date/action/user/text
// filters, pagination and a details drawer that shows `detail` readably (before/after side by side).
import { useEffect, useState } from 'react';
import { Drawer } from '../../components/Drawer';
import { Pager } from '../../components/Pager';
import { UserPicker, type PickedUser } from '../../components/UserPicker';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import type { AuditLog } from '../../types';
import { AUDIT_ACTIONS, listAuditActions, listAuditLogs } from './adminApi';
import { DateField } from '../../ui/components';

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function humanAction(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function actorLabel(row: AuditLog): string {
  if (row.actorName && row.actorLoginId) return `${row.actorName} (${row.actorLoginId})`;
  return row.actorName ?? row.actorLoginId ?? (row.actorId ? row.actorId : 'System');
}

function targetLabel(row: AuditLog): string {
  if (!row.targetType) return '—';
  return row.targetId ? `${row.targetType} · ${row.targetId}` : row.targetType;
}

export function AuditTrailPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState<PickedUser | null>(null);
  const actorId = actor?.id ?? '';
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [preset, setPreset] = useState<'all' | 'login_events'>('all');
  const [selected, setSelected] = useState<AuditLog | null>(null);
  // From GET /audit-logs/actions; the static list covers a 404 or any load failure.
  const actionList = useLoad(listAuditActions, []);
  const actions: readonly string[] = actionList.data ?? AUDIT_ACTIONS;
  const { data, loading, error } = useLoad(
    () =>
      listAuditLogs({
        from,
        to,
        action,
        preset: preset === 'login_events' ? 'login_events' : undefined,
        actorId,
        q,
        page,
        size: PAGE_SIZE,
      }),
    [from, to, action, preset, actorId, q, page],
  );
  const reset =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit Trail</h1>
          <p>Every sign-in and administrative change, newest first. Read-only.</p>
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <div className="card">
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem 0' }}>
          <button
            type="button"
            className={`btn sm ${preset === 'all' ? 'primary' : ''}`}
            onClick={() => {
              setPreset('all');
              setPage(1);
            }}
          >
            All Events
          </button>
          <button
            type="button"
            className={`btn sm ${preset === 'login_events' ? 'primary' : ''}`}
            onClick={() => {
              setPreset('login_events');
              setPage(1);
            }}
          >
            Login Events
          </button>
        </div>
        <div className="v8-table-toolbar">
          <label className="audit-date">
            From
            <DateField
              value={from}
              max={to || undefined}
              onChange={(e) => reset(setFrom)(e.target.value)}
            />
          </label>
          <label className="audit-date">
            To
            <DateField
              value={to}
              min={from || undefined}
              onChange={(e) => reset(setTo)(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by action"
            value={action}
            onChange={(e) => reset(setAction)(e.target.value)}
          >
            <option value="">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {humanAction(a)}
              </option>
            ))}
          </select>
          <UserPicker value={actor} onChange={reset(setActor)} />
          <input
            type="search"
            placeholder="Search action, target or details…"
            aria-label="Search action, target or details"
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
          />
          <span className="v8-spacer" />
          <span className="v8-sub" aria-live="polite">
            {loading ? 'Loading…' : `${data?.meta.total ?? 0} entries`}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Date Time</th>
                <th scope="col">User</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">IP</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.at)}</td>
                  <td>{actorLabel(row)}</td>
                  <td>
                    <span className="chip">{humanAction(row.action)}</span>
                  </td>
                  <td>{targetLabel(row)}</td>
                  <td>{row.ip ?? '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Details of ${humanAction(row.action)} at ${formatDateTime(row.at)}`}
                      onClick={() => setSelected(row)}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && data && data.rows.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={6}>No audit entries match these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pager page={page} size={PAGE_SIZE} total={data?.meta.total ?? 0} onPage={setPage} />
      </div>
      {selected ? <AuditDetailsDrawer row={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v || '""';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export interface DetailView {
  pairs: [string, string][];
  changes: { field: string; before: string; after: string; changed: boolean }[];
}

/** Splits `detail` into plain key/values and a before/after comparison (when both are objects). */
export function describeDetail(detail: unknown): DetailView {
  const rec = asRecord(detail);
  if (!rec)
    return {
      pairs: detail === null || detail === undefined ? [] : [['detail', formatValue(detail)]],
      changes: [],
    };
  const before = asRecord(rec.before);
  const after = asRecord(rec.after);
  const pairs: [string, string][] = [];
  for (const [k, v] of Object.entries(rec)) {
    if ((k === 'before' && before) || (k === 'after' && after)) continue;
    pairs.push([k, formatValue(v)]);
  }
  const changes: DetailView['changes'] = [];
  if (before || after) {
    const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
    for (const field of keys) {
      const b = formatValue(before?.[field]);
      const a = formatValue(after?.[field]);
      changes.push({ field, before: b, after: a, changed: b !== a });
    }
  }
  return { pairs, changes };
}

function AuditDetailsDrawer({ row, onClose }: { row: AuditLog; onClose: () => void }) {
  const view = describeDetail(row.detail);
  const meta: [string, string][] = [
    ['Date Time', formatDateTime(row.at)],
    ['User', actorLabel(row)],
    ['Action', humanAction(row.action)],
    ['Target', targetLabel(row)],
    ['IP', row.ip ?? '—'],
    ['User agent', row.userAgent ?? '—'],
  ];
  return (
    <Drawer title={`${humanAction(row.action)} — details`} onClose={onClose}>
      <div className="detail-grid audit-meta">
        {meta.map(([k, v]) => (
          <div className="detail" key={k}>
            <small>{k}</small>
            <b>{v}</b>
          </div>
        ))}
      </div>
      {view.pairs.length ? (
        <section className="drawer-section" aria-labelledby="audit-detail-title">
          <h3 id="audit-detail-title">Detail</h3>
          <dl className="audit-kv">
            {view.pairs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {view.changes.length ? (
        <section className="drawer-section" aria-labelledby="audit-changes-title">
          <h3 id="audit-changes-title">Changes</h3>
          <div className="table-wrap">
            <table className="audit-changes">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {view.changes.map((c) => (
                  <tr key={c.field} className={c.changed ? 'changed' : undefined}>
                    <td>{c.field}</td>
                    <td>{c.before}</td>
                    <td>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {!view.pairs.length && !view.changes.length ? (
        <p className="v8-sub">No additional detail was recorded.</p>
      ) : null}
    </Drawer>
  );
}
