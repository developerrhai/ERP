// The V40 tab content of the Manufacturing, Quality and Maintenance pages: for the open V40 tab it shows the columns V40 shows there,
// with the values the API reads from the real tables (GET /mfg|qms|maint/v40/:pageId), the selection bar (Load / Export Selected),
// Previous / Next, the page's side panel and the audit entries. The page's own body (create forms, job card start / complete,
// inspection decisions, breakdown acknowledge ...) stays reachable under "Classic view" in the frame and is shown alone outside it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { HolderNote, useHolders } from '../../components/HolderNote';
import { Modal } from '../../components/Modal';
import { MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { docsMailApi, saveFile, type PrintKind } from '../../lib/docsMailApi';
import { toUiError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { listPageAudit } from '../generic/engineApi';
import { DocumentsPanel } from '../generic/DocumentsPanel';
import type { PageSchema } from '../generic/engineApi';
import { ClassicViewSwitch, useClassic } from '../frame/ClassicView';
import { TabInsights, insightKind } from '../frame/TabInsights';
import { useFrame, v40TabsFor } from '../frame/V40TabFrame';
import { dmy, ErrorBox, inr, Pill } from '../finance/shared';
import type { V40Column, V40Panel, V40Row } from '../sales/salesV40Api';
import { PLANT_V40_IDS, getPlantV40 } from './plantV40Api';
import './plant-v40.css';
import { auditRecord } from '../../lib/auditRecord';

const PAGE_SIZE = 20;
/** A row id the ERP stores (a computed line has none): only those print, move and take documents. */
const SAVED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  if (col.type === 'date') return <td className="cell-date">{dmy(v)}</td>;
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
                <td>{auditRecord(r.detail, r.targetId)}</td>
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
  return (
    <ClassicViewSwitch pageId={props.pageId} fallback={props.fallback} host>
      <Body {...props} tabName={frame.tabName} first={frame.index === 0} claim={frame.claim} />
    </ClassicViewSwitch>
  );
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
  fallback: _fallback,
  tabName,
  first,
  claim,
}: PlantV40Props & { tabName: string; first: boolean; claim: () => void }) {
  const noun = NOUN[pageId] ?? 'Records';
  const classic = useClassic();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [detail, setDetail] = useState<V40Row | null>(null);
  const [emailing, setEmailing] = useState<V40Row | null>(null);
  const [moving, setMoving] = useState<V40Row | null>(null);
  const [tick, setTick] = useState(0);
  const [hostTick, setHostTick] = useState(0);
  const holders = useHolders(pageId);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
    [pageId, tabName, first, q, status, page, tick],
  );
  const data = load.data;
  const rows: V40Row[] = useMemo(() => data?.rows ?? [], [data]);
  // Analytics / Calendar / Reports work from a larger slice of the same register
  const insight = insightKind(tabName);
  const wide = useLoad(
    () => (insight ? getPlantV40(pageId, { tab: tabName, first, q, status, page: 1, size: 100 }) : Promise.resolve(null)),
    [pageId, tabName, first, q, status, insight, tick],
  );
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
  const openDocs = (id: string): void => {
    if (docsTab < 0) return;
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', String(docsTab));
      n.set('doc', id);
      return n;
    });
  };
  const showDocs = /^documents$/i.test(tabName);
  const docRow = rows.find((r) => r.id === params.get('doc')) ?? selectedRows[0] ?? rows[0];

  // The page's own screen is mounted (hidden) behind this register: its row buttons and record dialogs do the work.
  // It loads after the register, so look again a few times.
  useEffect(() => {
    setHostTick(0);
    const t = setInterval(() => setHostTick((n) => (n >= 6 ? n : n + 1)), 500);
    return () => clearInterval(t);
  }, [rows, tick]);
  void hostTick;
  // a dialog of the page changed a record: when the last dialog closes the register reloads
  useEffect(() => {
    let openDialogs = document.querySelectorAll('.modal-bg').length;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = new MutationObserver(() => {
      const now = document.querySelectorAll('.modal-bg').length;
      if (openDialogs > 0 && now === 0) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setTick((n) => n + 1), 450);
      }
      openDialogs = now;
    });
    watch.observe(document.body, { childList: true });
    return () => {
      watch.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // tell the page toolbar (Word, Industry PDF, Send Email ...) which record is ticked
  const activeId = selectedRows[0]?.id ?? '';
  const activeNo = selectedRows[0]?.number ?? '';
  useEffect(() => {
    const announce = (): void => {
      window.dispatchEvent(new CustomEvent('v40-active-record', { detail: { pageId, recordId: SAVED.test(activeId) ? activeId : '', docNo: activeNo } }));
    };
    announce();
    const onRequest = (e: Event): void => {
      const ce = e as CustomEvent<{ pageId?: string }>;
      if (!ce.detail?.pageId || ce.detail.pageId === pageId) announce();
    };
    window.addEventListener('v40-request-active-record', onRequest);
    return () => window.removeEventListener('v40-request-active-record', onRequest);
  }, [pageId, activeId, activeNo]);

  const print = async (r: V40Row, kind: PrintKind, ext: string): Promise<void> => {
    try {
      saveFile(await docsMailApi.print(pageId, r.id, kind), `${r.number || 'record'}.${ext}`);
    } catch (e) {
      toast(toUiError(e).message);
    }
  };
  /** The record's own screen: it carries the workflow steps (start, decide, release, close ...). */
  const openRecord = (r: V40Row): void => {
    if (!classic?.open(r.number)) toast(`${r.number} has no entry screen of its own here: its figures come from the documents behind it.`);
  };
  const offered = (r: V40Row): string[] => classic?.actionsOf(r.number) ?? [];
  const recordButtons = (r: V40Row, where: 'row' | 'view'): ReactNode => {
    const saved = SAVED.test(r.id);
    const own = offered(r);
    const press = (label: string): void => {
      if (!classic?.press(r.number, label)) toast(`${label} is not available for ${r.number} right now.`);
      // a button that acts at once opens no pop-up, so the register looks again after the server had time to answer
      else for (const wait of [1500, 4000]) setTimeout(() => setTick((n) => n + 1), wait);
    };
    const canEdit = own.includes('Edit') || own.includes(r.number) || own.some((l) => /^(view|open|details)$/i.test(l));
    const edit = (): void => {
      if (own.includes('Edit')) press('Edit');
      else if (canEdit) openRecord(r);
      else
        toast(
          own.length
            ? `${r.number} is not edited after it is recorded. Use ${own.join(' / ')}.`
            : `${r.number} is a summary line: its figures come from the documents behind it.`,
        );
    };
    const remove = (): void =>
      own.includes('Delete')
        ? press('Delete')
        : toast(`${r.number} cannot be deleted: ${noun.toLowerCase()} are kept for the audit trail. Open it to cancel or close it.`);
    const submit = (): void => {
      const label = own.find((l) => /^(submit|send for approval|release|post)/i.test(l));
      if (label) press(label);
      else openRecord(r);
    };
    const extras = own.filter((l) => !/^(view|open|edit|delete|details)$/i.test(l) && !/^(submit|send for approval|release|post)/i.test(l) && l !== r.number);
    const canDelete = own.includes('Delete');
    return (
      <>
        {where === 'row' ? (
          <button type="button" className="btn sm" onClick={() => setDetail(r)}>
            View
          </button>
        ) : null}
        {actions?.edit !== false ? (
          <button type="button" className={`btn sm${canEdit ? '' : ' off'}`} title={canEdit ? undefined : 'Press to see why it cannot be edited'} onClick={edit}>
            Edit
          </button>
        ) : null}
        {saved ? (
          <>
            <button type="button" className="btn sm" onClick={() => setEmailing(r)}>
              Email
            </button>
            <button type="button" className="btn sm" onClick={() => void print(r, 'word', 'docx')}>
              Word
            </button>
            <button type="button" className="btn sm" onClick={() => void print(r, 'excel', 'xlsx')}>
              Excel
            </button>
            <button type="button" className="btn sm" onClick={() => void print(r, 'standard', 'pdf')}>
              PDF
            </button>
          </>
        ) : null}
        {actions?.submit !== false ? (
          <button type="button" className="btn sm" onClick={submit} title="Submit / release this record (opens it when the step is taken there)">
            Submit
          </button>
        ) : null}
        {extras.map((l) => (
          <button key={l} type="button" className="btn sm" onClick={() => press(l)}>
            {l}
          </button>
        ))}
        {actions?.delete !== false ? (
          <button type="button" className={`btn sm ${canDelete ? 'danger' : 'off'}`} title={canDelete ? undefined : 'Press to see why it cannot be deleted'} onClick={remove}>
            Delete
          </button>
        ) : null}
        {saved ? (
          <button type="button" className="btn sm primary" onClick={() => setMoving(r)}>
            Move Forward
          </button>
        ) : null}
        {saved && docsTab >= 0 ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setDetail(null);
              openDocs(r.id);
            }}
          >
            Docs
          </button>
        ) : null}
      </>
    );
  };
  const value = (c: V40Column, r: V40Row): string => {
    const v = r[c.key] ?? null;
    if (c.type === 'inr') return inr(v);
    if (c.type === 'num') return num(v);
    if (c.type === 'date') return dmy(v);
    return v === null || v === '' ? '—' : v;
  };
  const ownAdd = (classic?.addLabel() ?? '').replace(/^[＋+]\s*/, '');
  const away = ownAdd ? null : (classic?.elsewhere() ?? null);
  // "+ New plan" / "+ Record rejection" / "+ Report a breakdown" all read "＋ Add ..." here
  const addWhat = ownAdd ? ownAdd.replace(/^(new|add|record|report)\s+(a\s+|an\s+)?/i, '') : (away ?? '');
  const docSchema = useMemo(() => ({ pageId }) as unknown as PageSchema, [pageId]);

  return (
    <section className="pv40" aria-label={`${tabName || noun} (V40 view)`}>
      <ErrorBox message={load.error} />
      {addWhat && actions?.add !== false ? (
        <div className="pv40-head-add">
          <button
            type="button"
            className="btn primary"
            data-add-proxy=""
            title={away ? `Records here come from a ${away}: this opens its entry screen` : undefined}
            onClick={() => {
              if (ownAdd) classic?.pressAdd();
              else window.dispatchEvent(new CustomEvent('v40-add-record', { detail: { pageId, handled: false } }));
            }}
          >
            {`＋ Add ${addWhat}`}
          </button>
        </div>
      ) : null}
      {insight ? (
        <TabInsights
          kind={insight}
          title={noun}
          fileName={pageId}
          columns={wide.data?.columns ?? []}
          rows={wide.data?.rows ?? []}
          total={wide.data?.total ?? 0}
          loading={wide.loading}
        />
      ) : null}
      <div className="toolbar pv40-toolbar">
        <select
          aria-label="Select record"
          value=""
          onChange={(e) => {
            if (e.target.value) setQ(e.target.value);
          }}
        >
          <option value="">{`Select ${noun}`}</option>
          {rows.map((r, i) => (
            <option key={`${r.id}-${i}`} value={r.number}>
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
        <button
          type="button"
          className="btn sm"
          disabled={picked.size === 0 || !classic}
          title={picked.size === 0 ? 'Tick a record in the table first.' : undefined}
          onClick={() => selectedRows[0] && setDetail(selectedRows[0])}
        >
          Load Selected
        </button>
        <button type="button" className="btn sm" disabled={rows.length === 0} title={rows.length === 0 ? 'There is nothing to export on this tab.' : undefined} onClick={exportSelected}>
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
                <th key={c.key} className={c.type === 'actions' ? 'row-actions-head' : undefined} title={c.source ? undefined : 'No source for this column in the database yet'}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id}-${i}`} className={picked.has(r.id) ? 'selected' : undefined}>
                <td>
                  <input type="checkbox" aria-label={`Select ${r.number}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                {columns.map((c) => {
                  if (c.type === 'actions')
                    return (
                      <td key={c.key} className="row-actions">
                        <div className="pv40-wrap">
                          <HolderNote holder={holders.get(r.id)} />
                          {recordButtons(r, 'row')}
                        </div>
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
        <button type="button" className="btn sm" disabled={page <= 1} title={page <= 1 ? 'This is the first page.' : undefined} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button type="button" className="btn sm" disabled={page >= pages} title={page >= pages ? 'This is the last page.' : undefined} onClick={() => setPage((p) => p + 1)}>
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
            onChanged={() => setTick((n) => n + 1)}
          />
        ) : (
          <p className="v8-sub">There is no record yet to add documents to.</p>
        )
      ) : null}
      {detail ? (
        <Modal
          title={detail.number || noun}
          sub="Record details"
          onClose={() => setDetail(null)}
          footer={
            <>
              {recordButtons(rows.find((x) => x.id === detail.id) ?? detail, 'view')}
              <button type="button" className="btn sm" onClick={() => openRecord(detail)}>
                Open record
              </button>
              <button type="button" className="btn sm" onClick={() => setDetail(null)}>
                Close
              </button>
            </>
          }
        >
          <div className="drawer-grid">
            {columns
              .filter((c) => c.type !== 'actions' && c.type !== 'docs')
              .map((c) => [c, rows.find((x) => x.id === detail.id) ?? detail] as const)
              .map(([c, now]) => (
                <div className="v8-mini" key={c.key}>
                  <small>{c.label}</small>
                  <b>{c.type === 'pill' && now[c.key] ? <Pill>{now[c.key]}</Pill> : value(c, now)}</b>
                </div>
              ))}
          </div>
        </Modal>
      ) : null}
      {emailing ? <EmailDocDialog docType={pageId} docId={emailing.id} onClose={() => setEmailing(null)} /> : null}
      {moving ? (
        <MoveForwardDialog
          docType={pageId}
          docId={moving.id}
          docNo={moving.number}
          onClose={() => setMoving(null)}
          onMoved={() => {
            toast(`${moving.number} moved forward.`);
            setMoving(null);
            setTick((n) => n + 1);
          }}
        />
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
    </section>
  );
}
