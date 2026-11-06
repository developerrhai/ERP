// The non-register tabs of a module page: Module Dashboard (4 KPIs + 20 recent), Data Quality
// (field completeness), Activity Timeline / Audit Trail (real audit rows) and Reports (Excel + Print),
// plus the honest "built in Phase N" notice for tabs whose data does not exist yet. No invented numbers.
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Pager } from '../../components/Pager';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import {
  exportXlsx,
  listPageAudit,
  listRecords,
  type PageSchema,
  type RecordQuery,
  type RecordRow,
} from './engineApi';
import { baseFilters, displayValue, isEmptyValue, listFields, valueOf } from './fieldModel';
import { statusClass } from './RegisterTab';
import { PhaseMap, ReportExtras } from './Phase4Tabs';
import { getSummary } from './phase4Api';

export function PhaseNotice({ tab, phase }: { tab: string; phase: number }) {
  return (
    <div className="notice" role="note">
      <b>{tab}</b> <span>This view is built in Phase {phase}.</span>
      <details className="phase-details">
        <summary>Phase map</summary>
        <PhaseMap highlight={phase} />
      </details>
    </div>
  );
}

const sumStatuses = async (
  pageId: string,
  wanted: string[],
  available: string[],
  filters?: Record<string, string>,
): Promise<number | null> => {
  const use = wanted.filter((s) => available.includes(s));
  if (use.length === 0) return null;
  const counts = await Promise.all(
    use.map((status) =>
      listRecords(pageId, { status, size: 1, ...(filters ? { filters } : {}) }).then(
        (r) => r.meta.total,
      ),
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
};

function sameMonth(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

interface DashData {
  total: number;
  recent: RecordRow[];
  draftOpen: number | null;
  activeDone: number | null;
  thisMonth: number;
  monthCapped: boolean;
}

export function DashboardTab({
  schema,
  reloadToken,
  onView,
}: {
  schema: PageSchema;
  reloadToken: number;
  onView: (row: RecordRow) => void;
}) {
  const { data, loading, error } = useLoad<DashData>(async () => {
    if (schema.kind === 'generic') {
      // Counts are computed on the server over every record, never from a browser sample.
      const [summary, recent] = await Promise.all([
        getSummary(schema.pageId),
        listRecords(schema.pageId, { sort: '-createdAt', size: 20 }),
      ]);
      const sum = (wanted: string[]): number | null => {
        const use = wanted.filter((s) => schema.statuses.includes(s));
        if (use.length === 0) return null;
        return use.reduce(
          (n, s) => n + (summary.byStatus.find((b) => b.status === s)?.count ?? 0),
          0,
        );
      };
      return {
        total: summary.total,
        recent: recent.rows,
        draftOpen: sum(['Draft', 'Open']),
        activeDone: sum(['Active', 'Completed']),
        thisMonth: summary.createdThisMonth,
        monthCapped: false,
      };
    }
    const base = baseFilters(schema);
    const recent = await listRecords(schema.pageId, {
      sort: '-createdAt',
      size: 100,
      ...(base ? { filters: base } : {}),
    });
    const [draftOpen, activeDone] = await Promise.all([
      sumStatuses(schema.pageId, ['Draft', 'Open'], schema.statuses, base),
      sumStatuses(schema.pageId, ['Active', 'Completed'], schema.statuses, base),
    ]);
    const now = new Date();
    const month = recent.rows.filter((r) => sameMonth(r.createdAt, now)).length;
    return {
      total: recent.meta.total,
      recent: recent.rows.slice(0, 20),
      draftOpen,
      activeDone,
      thisMonth: month,
      // All 100 fetched rows are from this month and more exist: the true count is not known.
      monthCapped: month === recent.rows.length && recent.meta.total > recent.rows.length,
    };
  }, [schema.pageId, reloadToken]);
  const fields = listFields(schema)
    .filter((f) => f.type !== 'status')
    .slice(0, 3);
  const kpi = (label: string, value: string | number, note?: string) => (
    <div className="card kpi">
      <small>{label}</small>
      <b>{value}</b>
      {note ? <div className="v8-sub">{note}</div> : null}
    </div>
  );
  return (
    <>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <div className="kpis">
        {kpi('Records', data ? data.total : '…')}
        {kpi(
          'Draft / Open',
          data ? (data.draftOpen ?? '—') : '…',
          data && data.draftOpen === null ? 'This page has no Draft or Open status.' : undefined,
        )}
        {kpi(
          'Active / Completed',
          data ? (data.activeDone ?? '—') : '…',
          data && data.activeDone === null
            ? 'This page has no Active or Completed status.'
            : undefined,
        )}
        {kpi(
          'Created this month',
          data ? `${data.thisMonth}${data.monthCapped ? '+' : ''}` : '…',
          data?.monthCapped ? 'Counted over the 100 most recent records.' : undefined,
        )}
      </div>
      <div className="card table-wrap">
        <h3 className="table-title">20 Most Recent Records</h3>
        <table>
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f.key} scope="col">
                  {f.label}
                </th>
              ))}
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recent ?? []).map((r) => (
              <tr key={r.id}>
                {fields.map((f) => (
                  <td key={f.key}>{displayValue(r, f)}</td>
                ))}
                <td>
                  <span className={`status ${statusClass(r.status)}`}>{r.status}</span>
                </td>
                <td>{formatDateTime(r.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`View ${r.code}`}
                    onClick={() => onView(r)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={fields.length + 3}>Loading…</td>
              </tr>
            ) : null}
            {data && data.recent.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={fields.length + 3}>No records yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

const QUALITY_SAMPLE = 100;

export function DataQualityTab({
  schema,
  reloadToken,
}: {
  schema: PageSchema;
  reloadToken: number;
}) {
  const { data, loading, error } = useLoad(() => {
    const base = baseFilters(schema);
    return listRecords(schema.pageId, {
      sort: '-createdAt',
      size: QUALITY_SAMPLE,
      ...(base ? { filters: base } : {}),
    });
  }, [schema.pageId, reloadToken]);
  const fields = schema.fields.filter(
    (f) => !f.readOnly && f.type !== 'code' && f.type !== 'status',
  );
  const rows = data?.rows ?? [];
  return (
    <div className="card panel">
      <h3>Data Quality</h3>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {loading && !data ? <p className="v8-sub">Loading…</p> : null}
      {data && rows.length === 0 ? (
        <p className="v8-sub">No records yet, so there is nothing to measure.</p>
      ) : null}
      {data && rows.length > 0 ? (
        <>
          <p className="v8-sub">
            Completeness of each field across the {rows.length} most recent of {data.meta.total}{' '}
            records.
          </p>
          <table className="quality-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Filled</th>
                <th scope="col">Completeness</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const filled = rows.filter((r) => !isEmptyValue(valueOf(r, f))).length;
                const pct = Math.round((filled / rows.length) * 100);
                return (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    <td>
                      {filled} / {rows.length}
                    </td>
                    <td>
                      <span className="quality-bar" aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </span>{' '}
                      {pct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

function detailText(detail: unknown): string {
  if (detail === null || detail === undefined) return '';
  if (typeof detail === 'object') {
    const code = (detail as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

const humanAction = (a: string): string => a.replace(/_/g, ' ').toLowerCase();

export function AuditTab({
  schema,
  variant,
  reloadToken,
}: {
  schema: PageSchema;
  variant: 'timeline' | 'table';
  reloadToken: number;
}) {
  const [page, setPage] = useState(1);
  const size = 20;
  const { data, loading, error } = useLoad(
    () => listPageAudit(schema.pageId, page, size),
    [schema.pageId, page, reloadToken],
  );
  const rows = data?.rows ?? [];
  return (
    <div className="card">
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {variant === 'timeline' ? (
        <ol className="timeline" aria-label="Activity timeline">
          {rows.map((r) => (
            <li key={r.id}>
              <b>{humanAction(r.action)}</b>
              <span className="v8-sub">
                {' '}
                {r.actorName ?? 'System'} • {formatDateTime(r.at)}
                {detailText(r.detail) ? ` • ${detailText(r.detail)}` : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Date Time</th>
                <th scope="col">User</th>
                <th scope="col">Action</th>
                <th scope="col">Record</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.at)}</td>
                  <td>{r.actorName ?? 'System'}</td>
                  <td>
                    <span className="chip">{humanAction(r.action)}</span>
                  </td>
                  <td>{detailText(r.detail) || r.targetId || '—'}</td>
                  <td>{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && !data ? <p className="v8-sub">Loading…</p> : null}
      {data && rows.length === 0 ? (
        <p className="v8-sub panel">No activity has been recorded for this page yet.</p>
      ) : null}
      <Pager page={page} size={size} total={data?.meta.total ?? 0} onPage={setPage} />
    </div>
  );
}

const REPORT_ROWS = 100;

export function ReportsTab({
  schema,
  perms,
  query,
  reloadToken,
}: {
  schema: PageSchema;
  perms: ActionSet;
  query: RecordQuery;
  reloadToken: number;
}) {
  const filters: RecordQuery = {
    q: query.q,
    status: query.status,
    sort: query.sort,
    ...(query.filters ? { filters: query.filters } : {}),
  };
  const { data, loading, error } = useLoad(
    () => listRecords(schema.pageId, { ...filters, page: 1, size: REPORT_ROWS }),
    [schema.pageId, query.q, query.status, query.sort, JSON.stringify(query.filters), reloadToken],
  );
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const fields = listFields(schema);
  const rows = data?.rows ?? [];
  const active = [query.q && `search “${query.q}”`, query.status && `status ${query.status}`]
    .filter(Boolean)
    .join(', ');
  const download = async (): Promise<void> => {
    setBusy(true);
    setExportError('');
    try {
      await exportXlsx(schema.pageId, filters);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card report-card">
      <div className="v8-table-toolbar no-print">
        <b>{schema.title} Report</b>
        <span className="v8-sub">
          {active ? `Filters: ${active}.` : 'All records.'} Set filters on the Register tab.
        </span>
        <span className="v8-spacer" />
        {perms.export ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void download()}>
            Excel
          </button>
        ) : null}
        <button type="button" className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {exportError ? <ErrorMessage>{exportError}</ErrorMessage> : null}
      {schema.kind === 'generic' ? (
        <ReportExtras
          schema={schema}
          perms={perms}
          filters={{
            ...(query.q ? { q: query.q } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.sort ? { sort: query.sort } : {}),
          }}
          onImported={() => undefined}
        />
      ) : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <p className="v8-sub report-note">
        {data
          ? `${rows.length} of ${data.meta.total} matching records${data.meta.total > rows.length ? ' (first 100 shown; Excel has all)' : ''}.`
          : loading
            ? 'Loading…'
            : ''}
      </p>
      <div className="table-wrap report-table">
        <table>
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f.key} scope="col">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {fields.map((f) => (
                  <td key={f.key}>{displayValue(r, f)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
