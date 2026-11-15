// The V40 tab content of the Manufacturing, Quality and Maintenance pages: for the open V40 tab it shows the columns V40 shows there,
// with the values the API reads from the real tables (GET /mfg|qms|maint/v40/:pageId), the selection bar (Load / Export Selected),
// Previous / Next, the page's side panel and the audit entries. The page's own body (create forms, job card start / complete,
// inspection decisions, breakdown acknowledge ...) stays reachable under "Classic view" in the frame and is shown alone outside it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { saveFile } from '../../lib/docsMailApi';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { listPageAudit } from '../generic/engineApi';
import { DocumentsPanel } from '../generic/DocumentsPanel';
import type { PageSchema } from '../generic/engineApi';
import { useFrame, v40TabsFor } from '../frame/V40TabFrame';
import { dmy, ErrorBox, inr, Pill } from '../finance/shared';
import type { V40Column, V40Panel, V40Row } from '../sales/salesV40Api';
import { PLANT_V40_IDS, getPlantV40 } from './plantV40Api';
import './plant-v40.css';

const PAGE_SIZE = 20;
const NOUN: Record<string, string> = {
  'mfg-orders': 'Production Orders',
  'mfg-plan': 'Production Plans',
  'mfg-mrp': 'MRP Lines',
  'mfg-material-issue': 'Material Issues',
  'mfg-wip': 'WIP',
  'mfg-fg': 'FG Receipts',
  'mfg-scrap': 'Scrap',
  'mfg-rework': 'Rework',
  'mfg-costing': 'Cost Sheets',
  'mfg-workorders': 'Work Orders',
  'qms-incoming': 'Incoming Inspections',
  'qms-process': 'In-process Inspections',
  'qms-final': 'Final Inspections',
  'qms-inspections': 'Inspections',
  'qms-supplier': 'Suppliers',
  'qms-ncr': 'NCRs',
  'qms-capa': 'CAPAs',
  'qms-5why': '5 Why Cases',
  'qms-calibration': 'Instruments',
  'qms-plans': 'Inspection Plans',
  'maint-machines': 'Machines',
  'maint-equipment': 'Equipment',
  'maint-preventive': 'PM Plans',
  'maint-schedule': 'PM Schedule',
  'maint-breakdown': 'Breakdowns',
  'maint-workorders': 'Maintenance Work Orders',
  'maint-downtime': 'Downtime',
  'maint-mtbf': 'Machines',
  'maint-spares': 'Spares',
  'maint-alerts': 'Alerts',
};

const num = (v: string | null): string => {
  if (v === null || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? v : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
};
const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function Cell({ col, row }: { col: V40Column; row: Record<string, string | null> }) {
  const v = row[col.key] ?? null;
  if (col.type === 'inr') return <td className="num">{inr(v)}</td>;
  if (col.type === 'num') return <td className="num">{num(v)}</td>;
  if (col.type === 'date') return <td>{dmy(v)}</td>;
  if (col.type === 'pill') return <td>{v ? <Pill>{v}</Pill> : '—'}</td>;
  return <td>{v === null || v === '' ? '—' : v}</td>;
}

function PanelTable({ panel }: { panel: V40Panel }) {
  return (
    <section className="pv40-panel" aria-label={panel.title}>
      <h3>{panel.title}</h3>
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              {panel.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((r, i) => (
              <tr key={i}>
                {panel.columns.map((c) =>
                  c.type === 'actions' ? (
                    <td key={c.key}>{r[c.key] ? <span className="chip">{r[c.key]}</span> : '—'}</td>
                  ) : (
                    <Cell key={c.key} col={c} row={r} />
                  ),
                )}
              </tr>
            ))}
            {panel.rows.length === 0 ? (
              <tr>
                <td colSpan={panel.columns.length}>Nothing to show here yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuditEntries({ pageId }: { pageId: string }) {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useLoad(() => listPageAudit(pageId, page, 10), [pageId, page]);
  const rows = data?.rows ?? [];
  return (
    <section className="pv40-panel" aria-label="Audit entries">
      <h3>Audit entries</h3>
      {error ? <p role="alert">{error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Person</th>
              <th>Action</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.at)}</td>
                <td>{r.actorName ?? '—'}</td>
                <td>{r.action}</td>
                <td>{r.targetId ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={4}>No audit entries for this page yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button type="button" className="btn sm" disabled={rows.length < 10} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </section>
  );
}

export interface PlantV40Props {
  pageId: string;
  actions?: ActionSet | undefined;
  /** the page's own body: shown alone outside the tab frame, and under "Classic view" inside it */
  fallback: ReactNode;
}

/** `<PlantV40 pageId=… fallback={<OldPage/>} />` - the page body of a Manufacturing, Quality or Maintenance page. */
export function PlantV40(props: PlantV40Props) {
  const frame = useFrame();
  if (!frame || !PLANT_V40_IDS.has(props.pageId)) return <>{props.fallback}</>;
  return <Body {...props} tabName={frame.tabName} first={frame.index === 0} claim={frame.claim} />;
}

/** Wrap a page component so it gets the V40 tab content inside the frame. `pageId` may depend on the props (null = no V40 view). */
export function withPlantV40<P extends object>(
  pageId: string | ((props: P) => string | null),
  Page: ComponentType<P>,
): ComponentType<P> {
  return function PlantV40Page(props: P) {
    const id = typeof pageId === 'function' ? pageId(props) : pageId;
    if (!id) return <Page {...props} />;
    return <PlantV40 pageId={id} actions={(props as { actions?: ActionSet }).actions} fallback={<Page {...props} />} />;
  };
}

function Body({
  pageId,
  actions,
  fallback,
  tabName,
  first,
  claim,
}: PlantV40Props & { tabName: string; first: boolean; claim: () => void }) {
  const noun = NOUN[pageId] ?? 'Records';
  const [, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [classic, setClassic] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const claimRef = useRef(claim);
  claimRef.current = claim;
  useEffect(() => claimRef.current(), []);
  useEffect(() => {
    setPage(1);
    setPicked(new Set());
  }, [tabName, q, status]);

  const load = useLoad(
    () => getPlantV40(pageId, { tab: tabName, first, q, status, page, size: PAGE_SIZE }),
    [pageId, tabName, first, q, status, page],
  );
  const data = load.data;
  const rows: V40Row[] = useMemo(() => data?.rows ?? [], [data]);
  const columns = data?.columns ?? [];
  for (const r of rows) if (r.status) seen.current.add(r.status);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const docsTab = v40TabsFor(pageId).findIndex((t) => /^documents$/i.test(t));
  const selectedRows = rows.filter((r) => picked.has(r.id));
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: string): void =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const exportSelected = (): void => {
    const list = selectedRows.length > 0 ? selectedRows : rows;
    const cols = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs');
    const lines = [cols.map((c) => csvCell(c.label)).join(',')];
    for (const r of list) lines.push(cols.map((c) => csvCell(r[c.key] ?? '')).join(','));
    saveFile(
      { blob: new Blob([lines.join('\n')], { type: 'text/csv' }), filename: `${pageId}.csv` },
      `${pageId}.csv`,
    );
  };
  const openDocs = (): void => {
    if (docsTab < 0) return;
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', String(docsTab));
      return n;
    });
  };
  const showDocs = /^documents$/i.test(tabName);
  const docRow = selectedRows[0];
  const docSchema = useMemo(() => ({ pageId }) as unknown as PageSchema, [pageId]);

  return (
    <section className="pv40" aria-label={`${tabName || noun} (V40 view)`}>
      <ErrorBox message={load.error} />
      <div className="toolbar pv40-toolbar">
        <select
          aria-label="Select record"
          value=""
          onChange={(e) => {
            if (e.target.value) setQ(e.target.value);
          }}
        >
          <option value="">{`Select ${noun}`}</option>
          {rows.map((r) => (
            <option key={r.id} value={r.number}>
              {r.number}
            </option>
          ))}
        </select>
        <input aria-label={`Search ${noun}`} placeholder={`Search ${noun}...`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {[...seen.current].sort().map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="pv40-count">{total} records</span>
      </div>
      <div className="pv40-bulk" role="group" aria-label="Selected records">
        <span>{picked.size} selected</span>
        <button type="button" className="btn sm" disabled={picked.size === 0} onClick={() => setClassic(true)}>
          Load Selected
        </button>
        <button type="button" className="btn sm" disabled={rows.length === 0} onClick={exportSelected}>
          Export Selected
        </button>
      </div>
      <div className="card table-wrap">
        <table className="register-table pv40-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allOn}
                  onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              {columns.map((c) => (
                <th key={c.key} title={c.source ? undefined : 'No source for this column in the database yet'}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={picked.has(r.id) ? 'selected' : undefined}>
                <td>
                  <input type="checkbox" aria-label={`Select ${r.number}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                {columns.map((c) => {
                  if (c.type === 'actions')
                    return (
                      <td key={c.key} className="row-actions">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setQ(r.number);
                            setClassic(true);
                          }}
                        >
                          View
                        </button>
                        {docsTab >= 0 ? (
                          <button type="button" className="btn sm" onClick={openDocs}>
                            Docs
                          </button>
                        ) : null}
                      </td>
                    );
                  if (c.type === 'docs')
                    return (
                      <td key={c.key} className="num">
                        {r[c.key] ?? '—'}
                      </td>
                    );
                  return <Cell key={c.key} col={c} row={r} />;
                })}
              </tr>
            ))}
            {rows.length === 0 && !load.loading ? (
              <tr className="empty-row">
                <td colSpan={columns.length + 1}>Nothing here yet for this view.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="actions pv40-pager">
        <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
      {data?.panel ? <PanelTable panel={data.panel} /> : null}
      {showDocs ? (
        docRow ? (
          <DocumentsPanel
            schema={docSchema}
            row={{ id: docRow.id, code: docRow.number, status: docRow.status }}
            canEdit={actions?.edit ?? false}
            onChanged={() => undefined}
          />
        ) : (
          <p className="v8-sub">Tick a record to see and add its documents.</p>
        )
      ) : null}
      {data?.audit || /audit/i.test(tabName) ? <AuditEntries pageId={pageId} /> : null}
      {columns.some((c) => !c.source) ? (
        <p className="v8-sub pv40-nosource">
          No source in the database yet (shown as a dash):{' '}
          {columns
            .filter((c) => !c.source)
            .map((c) => c.label)
            .join(', ')}
          .
        </p>
      ) : null}
      <details className="pv40-classic" open={classic} onToggle={(e) => setClassic(e.currentTarget.open)}>
        <summary>Classic view: create, edit and action buttons</summary>
        {classic ? fallback : null}
      </details>
    </section>
  );
}
