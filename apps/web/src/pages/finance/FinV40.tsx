// The V40 tab content of the Finance and Tax pages: for the open V40 tab it shows the columns V40 shows there, with the
// values the API reads from the real tables (GET /finance/v40/:pageId, /tax/v40/:pageId), the selection bar, Previous / Next,
// the tab's side panel (settlement, ledger, allocation, exceptions, validation), KPI cards and audit entries. Outside the tab
// frame (or for a page without V40 views) it shows `fallback`, the page's own table, unchanged.
import { AccountTree } from './AccountTree';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { Modal } from '../../components/Modal';
import { MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import type { PrintKind } from '../../lib/docsMailApi';
import { toUiMessage } from '../../lib/errors';
import { AllocateInvoiceDialog } from './AllocateInvoice';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { DocumentsPanel } from '../generic/DocumentsPanel';
import { HolderNote, useHolders } from '../../components/HolderNote';
import { TabInsights, insightKind } from '../frame/TabInsights';
import { listPageAudit } from '../generic/engineApi';
import type { PageSchema } from '../generic/engineApi';
import { ClassicViewSwitch, useClassic } from '../frame/ClassicView';
import { useFrame, v40TabsFor } from '../frame/V40TabFrame';
import { getFinV40, hasFinV40 } from './finV40Api';
import type { FinCard, FinColumn, FinPanel, FinRow } from './finV40Api';
import { dmy, ErrorBox, inr, Pill } from './shared';
import './finance-v40.css';
import '../tax/tax-v40.css';
import { auditRecord } from '../../lib/auditRecord';

const num = (v: string | null): string => {
  if (v === null || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? v : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
};
const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The record a register row stands for. The report pages (Trial Balance, P&L, Balance Sheet, Cash Flow) list ledger
 * accounts, so Email / Word / Excel / PDF / Docs / Move Forward act on the account; a summary line ("REV") is no record.
 */
const RECORD_PAGE: Record<string, string> = {
  'fin-trial': 'fin-coa',
  'fin-pnl': 'fin-coa',
  'fin-bs': 'fin-coa',
  'fin-cashflow': 'fin-coa',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Report pages have no entry form of their own: their Add button opens the entry that changes their figures. */
const ADD_LABEL: Record<string, string> = {
  'fin-gl': '＋ Add Journal Entry',
  'fin-trial': '＋ Add Journal Entry',
  'fin-pnl': '＋ Add Journal Entry',
  'fin-bs': '＋ Add Journal Entry',
  'fin-cashflow': '＋ Add Journal Entry',
  'fin-ar': '＋ Add Receipt',
  'fin-ageing': '＋ Add Receipt',
};
/** Registers that only show figures worked out from the books. */
const LEDGER_PAGES: ReadonlySet<string> = new Set(['fin-gl', 'fin-trial', 'fin-pnl', 'fin-bs', 'fin-cashflow', 'fin-ageing', 'fin-ap', 'fin-ar']);
/** The buttons the page's own row may offer that the register shows as one of its own fixed buttons (or never as a proxy). */
const FIXED = new Set(['View', 'Open', 'Details', 'Docs', 'Email', 'Word', 'Excel', 'PDF', 'Move Forward']);

function Cell({ col, row }: { col: FinColumn; row: Record<string, string | null> }) {
  const v = row[col.key] ?? null;
  if (col.type === 'inr') return <td className="num">{inr(v)}</td>;
  if (col.type === 'num') return <td className="num">{num(v)}</td>;
  if (col.type === 'date') return <td>{dmy(v)}</td>;
  if (col.type === 'pill') return <td>{v ? <Pill>{v}</Pill> : '—'}</td>;
  return <td>{v === null || v === '' ? '—' : v}</td>;
}

function Cards({ cards }: { cards: FinCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="fv40-cards" role="group" aria-label="Figures of this view">
      {cards.map((c) => (
        <div className="fv40-card" key={c.label}>
          <b>
            {c.type === 'inr' ? inr(c.value) : c.type === 'num' ? num(c.value) : (c.value ?? '—')}
          </b>
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

type PanelRow = FinPanel['rows'][number];

function PanelTable({
  panel,
  onAllocate,
  onView,
}: {
  panel: FinPanel;
  onAllocate?: ((id: string) => void) | undefined;
  /** a line of the panel with no action of its own gets a View button */
  onView?: ((row: PanelRow) => void) | undefined;
}) {
  return (
    <section className="fv40-panel" aria-label={panel.title}>
      <h3>{panel.title}</h3>
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              {panel.columns.map((c) => (
                <th
                  key={c.key}
                  title={c.source ? undefined : 'No source for this column in the database yet'}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((r, i) => (
              <tr key={i}>
                {panel.columns.map((c) =>
                  c.type === 'actions' ? (
                    <td key={c.key}>
                      {!r[c.key] ? (
                        onView ? (
                          <button type="button" className="btn sm" onClick={() => onView(r)}>
                            View
                          </button>
                        ) : (
                          '—'
                        )
                      ) : onAllocate && r[c.key] === 'Allocate' && r.id ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => onAllocate(r.id ?? '')}
                        >
                          Allocate
                        </button>
                      ) : (
                        <span className="chip">{r[c.key]}</span>
                      )}
                    </td>
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
    <section className="fv40-panel" aria-label="Audit entries">
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
        <button
          type="button"
          className="btn sm"
          disabled={page <= 1}
          title={page <= 1 ? 'This is the first page.' : undefined}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={rows.length < 10}
          title={rows.length < 10 ? 'This is the last page.' : undefined}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}

export interface FinV40Props {
  pageId: string;
  actions?: ActionSet;
  /** the page's own table, shown outside the tab frame */
  fallback: ReactNode;
  /** opens the page's own record dialog for a row (View, Load Selected) */
  onOpen?: (id: string) => void;
  /** bump to reload after the page changed a record */
  reloadKey?: unknown;
  /** the settlement panel's Allocate button: act on this document id */
  onAllocate?: (docId: string) => void;
  /** page-specific row buttons shown after View */
  rowExtra?: (row: FinRow, reload: () => void) => ReactNode;
  /** more of the record under the cards of the detail dialog (a journal's debit / credit lines) */
  detailExtra?: (row: FinRow) => ReactNode;
}

type RowDialog = { kind: 'email' | 'move'; row: FinRow };

/** Wrap the table of a finance or tax page: `<FinV40 pageId=… fallback={<table…/>} />`. */
export function FinV40(props: FinV40Props) {
  const frame = useFrame();
  if (!frame || !hasFinV40(props.pageId)) return <>{props.fallback}</>;
  return (
    <ClassicViewSwitch pageId={props.pageId} fallback={props.fallback} host>
      <Body {...props} tabName={frame.tabName} first={frame.index === 0} claim={frame.claim} />
    </ClassicViewSwitch>
  );
}


const PAGE_SIZE = 20;

function Body({
  pageId,
  actions,
  fallback: _fallback,
  onOpen,
  reloadKey,
  onAllocate,
  rowExtra,
  detailExtra,
  tabName,
  first,
  claim,
}: FinV40Props & { tabName: string; first: boolean; claim: () => void }) {
  const classic = useClassic();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [dlg, setDlg] = useState<RowDialog | null>(null);
  const [panelRow, setPanelRow] = useState<PanelRow | null>(null);
  const [allocId, setAllocId] = useState<string | null>(null);
  const [hostTick, setHostTick] = useState(0);
  const holders = useHolders(RECORD_PAGE[pageId] ?? pageId);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<FinRow | null>(null);
  const [tick, setTick] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const claimRef = useRef(claim);
  claimRef.current = claim;
  useEffect(() => claimRef.current(), []);
  useEffect(() => {
    setPage(1);
    setPicked(new Set());
  }, [tabName, q, status]);

  const load = useLoad(
    () => getFinV40(pageId, { tab: tabName, first, q, status, page, size: PAGE_SIZE }),
    [pageId, tabName, first, q, status, page, reloadKey, tick],
  );
  const data = load.data;
  const rows: FinRow[] = useMemo(() => data?.rows ?? [], [data]);
  // Analytics / Calendar / Reports work from a larger slice of the same register
  const insight = insightKind(tabName);
  const wide = useLoad(
    () => (insight ? getFinV40(pageId, { tab: tabName, first, q, status, page: 1, size: 100 }) : Promise.resolve(null)),
    [pageId, tabName, first, q, status, insight, reloadKey, tick],
  );
  const columns = data?.columns ?? [];
  for (const r of rows) if (r.status) seen.current.add(r.status);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const docsTab = v40TabsFor(pageId).findIndex((x) => /^documents$/i.test(x));
  const selectedRows = rows.filter((r) => picked.has(r.id));
  const reload = (): void => setTick((n) => n + 1);

  // The page's own screen is mounted (hidden) behind this register: its row buttons (Edit, Delete, Submit, Allocate ...)
  // are what this register offers on each row, so every action runs the page's real dialog and rules.
  useEffect(() => {
    setHostTick(0);
    const t = setInterval(() => setHostTick((n) => (n >= 6 ? n : n + 1)), 500);
    return () => clearInterval(t);
  }, [rows, tick]);
  const hostActions = (r: FinRow): string[] => classic?.actionsOf(r.number) ?? [];
  const proxy = (r: FinRow, label: string): void => {
    if (!classic?.press(r.number, label)) toast(`${label} is not available for ${r.number} right now.`);
    // a button that acts at once opens no pop-up, so the register looks again after the server had time to answer
    else for (const wait of [1500, 4000]) setTimeout(() => setTick((n) => n + 1), wait);
  };
  void hostTick;

  // A dialog of the page (create, edit, delete, allocate ...) changed a record while this register was behind it: when the
  // last dialog closes the register reloads, so it never keeps showing the rows from before the change.
  useEffect(() => {
    let open = document.querySelectorAll('.modal-bg').length;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = new MutationObserver(() => {
      const now = document.querySelectorAll('.modal-bg').length;
      if (open > 0 && now === 0) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setTick((n) => n + 1), 450);
      }
      open = now;
    });
    watch.observe(document.body, { childList: true });
    return () => {
      watch.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const recPage = RECORD_PAGE[pageId] ?? pageId;
  /**
   * The stored record behind a row: normally the row itself; an AR/AP Ageing row is a customer's or a supplier's balance,
   * so its documents, print and e-mail are the party's.
   */
  const recordOf = (r: FinRow): { page: string; id: string } | null => {
    if (UUID.test(r.id)) return { page: recPage, id: r.id };
    if (pageId !== 'fin-ageing' || !UUID.test(r.id.slice(0, 36))) return null;
    const supplier = Object.values(r).some((v) => v === 'Supplier');
    return { page: supplier ? 'scm-suppliers' : 'master-customers', id: r.id.slice(0, 36) };
  };
  const isRecord = (r: FinRow): boolean => recordOf(r) !== null;
  async function printRow(r: FinRow, kind: PrintKind, ext: string): Promise<void> {
    const rec = recordOf(r);
    if (!rec) return;
    try {
      saveFile(await docsMailApi.print(rec.page, rec.id, kind), `${r.number || 'record'}.${ext}`);
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  // tell the page toolbar (Word, Industry PDF, Send Email, Excel, Move Forward ...) which record is ticked
  const activeId = selectedRows[0]?.id ?? '';
  const activeNo = selectedRows[0]?.number ?? '';
  useEffect(() => {
    const announce = (): void => {
      window.dispatchEvent(
        new CustomEvent('v40-active-record', {
          detail: { pageId, recordId: isRecord({ id: activeId } as FinRow) ? activeId : '', docNo: activeNo },
        }),
      );
    };
    announce();
    const onRequest = (e: Event): void => {
      const ce = e as CustomEvent<{ pageId?: string }>;
      if (!ce.detail?.pageId || ce.detail.pageId === pageId) announce();
    };
    window.addEventListener('v40-request-active-record', onRequest);
    return () => window.removeEventListener('v40-request-active-record', onRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, activeId, activeNo]);
  const toggle = (id: string): void =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id));

  function exportSelected(): void {
    const list = selectedRows.length > 0 ? selectedRows : rows;
    const cols = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs');
    const lines = [cols.map((c) => csvCell(c.label)).join(',')];
    for (const r of list) lines.push(cols.map((c) => csvCell(r[c.key] ?? '')).join(','));
    saveFile(
      { blob: new Blob([lines.join('\n')], { type: 'text/csv' }), filename: `${pageId}.csv` },
      `${pageId}.csv`,
    );
  }
  // the Docs button remembers its row in the URL (?doc=): changing tab clears the ticked rows
  const openDocs = (id?: string): void => {
    if (docsTab < 0) return;
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', String(docsTab));
      if (id) n.set('doc', id);
      return n;
    });
  };
  const view = (r: FinRow): void => {
    if (onOpen) onOpen(r.id);
    else setDetail(r);
  };
  const showDocs = /^documents$/i.test(tabName);
  const docParam = params.get('doc');
  const docRow = rows.find((r) => r.id === docParam) ?? selectedRows[0] ?? rows[0];
  const docRec = docRow ? recordOf(docRow) : null;
  const docPage = docRec?.page ?? recPage;
  const docSchema = useMemo(() => ({ pageId: docPage }) as unknown as PageSchema, [docPage]);

  /** Why a record's Edit / Delete / Submit can not run: said on the click instead of a silent grey button. */
  const whyNot = (label: string, r: FinRow): string => {
    const state = r.status ? `${r.number} is ${r.status}: ` : `${r.number}: `;
    if (LEDGER_PAGES.has(pageId))
      return `${state}this line is worked out from posted entries, so it cannot be ${label === 'Submit' ? 'submitted' : label === 'Delete' ? 'deleted' : 'edited'} here. Correct the voucher behind it, or post a journal entry.`;
    if (label === 'Submit') return `${state}there is nothing to submit. Only a Draft goes for approval.`;
    return `${state}a posted or approved record is locked to protect the accounts. ${label === 'Delete' ? 'Cancel or reverse it instead.' : 'Cancel or reverse it and enter it again.'}`;
  };

  /** every action of a record, in the order the V40 reference shows them */
  const recordButtons = (r: FinRow, where: 'row' | 'modal'): ReactNode => {
    const offered = hostActions(r);
    const has = (label: string): boolean => offered.includes(label);
    const proxied = (label: string, perm: boolean | undefined) =>
      perm ? (
        <button
          type="button"
          className={`btn sm${label === 'Delete' && has(label) ? ' danger' : ''}${has(label) ? '' : ' off'}`}
          title={has(label) ? undefined : whyNot(label, r)}
          onClick={() => (has(label) ? proxy(r, label) : toast(whyNot(label, r)))}
        >
          {label}
        </button>
      ) : null;
    const printable = isRecord(r);
    const extras = offered.filter(
      (l) =>
        !FIXED.has(l) && l !== r.number && !['Edit', 'Delete', 'Submit'].includes(l) && !/^(view|open)\b/i.test(l) && !rowExtra,
    );
    return (
      <>
        {where === 'row' ? (
          <button type="button" className="btn sm" onClick={() => view(r)}>
            View
          </button>
        ) : null}
        {proxied('Edit', actions ? actions.edit : true)}
        {proxied('Delete', actions ? actions.delete : true)}
        {printable ? (
          <>
            <button type="button" className="btn sm" onClick={() => setDlg({ kind: 'email', row: r })}>
              Email
            </button>
            <button type="button" className="btn sm" onClick={() => void printRow(r, 'word', 'docx')}>
              Word
            </button>
            <button type="button" className="btn sm" onClick={() => void printRow(r, 'excel', 'xlsx')}>
              Excel
            </button>
            <button type="button" className="btn sm" onClick={() => void printRow(r, 'standard', 'pdf')}>
              PDF
            </button>
          </>
        ) : null}
        {proxied('Submit', actions ? actions.submit : true)}
        {extras.map((l) => (
          <button key={l} type="button" className="btn sm" onClick={() => proxy(r, l)}>
            {l}
          </button>
        ))}
        {where === 'row' ? rowExtra?.(r, reload) : null}
        {printable ? (
          <button type="button" className="btn sm primary" onClick={() => setDlg({ kind: 'move', row: r })}>
            Move Forward
          </button>
        ) : null}
        {printable && docsTab >= 0 ? (
          <button type="button" className="btn sm" onClick={() => openDocs(r.id)}>
            Docs
          </button>
        ) : null}
      </>
    );
  };

  return (
    <section className="fv40" aria-label={`${tabName || 'Register'} (V40 view)`}>
      <ErrorBox message={load.error} />
      {actions?.add !== false && ADD_LABEL[pageId] ? (
        <div className="fv40-head-add">
          <button
            type="button"
            className="btn primary"
            data-add-proxy=""
            onClick={() => window.dispatchEvent(new CustomEvent('v40-add-record', { detail: { pageId, handled: false } }))}
          >
            {ADD_LABEL[pageId]}
          </button>
        </div>
      ) : null}
      {insight ? (
        <TabInsights
          kind={insight}
          title="Register"
          fileName={pageId}
          columns={wide.data?.columns ?? []}
          rows={wide.data?.rows ?? []}
          total={wide.data?.total ?? 0}
          loading={wide.loading}
        />
      ) : null}
      {pageId === 'fin-coa' && first ? <AccountTree reloadKey={tick} onShow={setQ} /> : null}
      <div className="toolbar fv40-toolbar">
        <select
          aria-label="Select record"
          value=""
          onChange={(e) => {
            if (e.target.value) setQ(e.target.value);
          }}
        >
          <option value="">Select record</option>
          {rows.map((r, i) => (
            <option key={`${r.id}-${i}`} value={r.number}>
              {r.number}
            </option>
          ))}
        </select>
        <input
          aria-label="Search"
          placeholder="Search..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {[...seen.current].sort().map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="fv40-count">{total} records</span>
      </div>
      <Cards cards={data?.cards ?? []} />
      {(data?.distribution.length ?? 0) > 0 ? (
        <div className="fv40-cards" role="group" aria-label="Status distribution">
          {data?.distribution.map((x) => (
            <div className="fv40-card" key={x.label}>
              <b>{x.count}</b>
              <span>{x.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="fv40-bulk" role="group" aria-label="Selected records">
        <span>{picked.size} selected</span>
        <button
          type="button"
          className="btn sm"
          disabled={picked.size === 0 || (!onOpen && !classic)}
          title={picked.size === 0 ? 'Tick a record in the table first.' : undefined}
          onClick={() => {
            const first = selectedRows[0];
            if (!first) return;
            if (onOpen) onOpen(first.id);
            else classic?.open(first.number);
          }}
        >
          Load Selected
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={rows.length === 0}
          onClick={exportSelected}
        >
          Export Selected
        </button>
      </div>
      <div className="card table-wrap">
        <table className="register-table fv40-table">
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
                <th
                  key={c.key} className={c.type === 'actions' ? 'row-actions-head' : undefined}
                  title={c.source ? undefined : 'No source for this column in the database yet'}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id}-${i}`} className={picked.has(r.id) ? 'selected' : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.number}`}
                    checked={picked.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                {columns.map((c) => {
                  if (c.type === 'actions')
                    return (
                      <td key={c.key} className="row-actions">
                        <div className="fv40-wrap">
                          <HolderNote holder={holders.get(recordOf(r)?.id ?? r.id)} />
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
      <div className="actions fv40-pager">
        <button
          type="button"
          className="btn sm"
          disabled={page <= 1}
          title={page <= 1 ? 'This is the first page.' : undefined}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="btn sm"
          disabled={page >= pages}
          title={page >= pages ? 'This is the last page.' : undefined}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
      {data?.panel ? (
        <PanelTable panel={data.panel} onAllocate={onAllocate ?? setAllocId} onView={setPanelRow} />
      ) : null}
      {panelRow && data?.panel ? (
        <Modal
          title={data.panel.title}
          onClose={() => setPanelRow(null)}
          footer={
            <button type="button" className="btn" onClick={() => setPanelRow(null)}>
              Close
            </button>
          }
        >
          <dl className="fv40-detail">
            {data.panel.columns
              .filter((c) => c.type !== 'actions' && c.type !== 'docs')
              .map((c) => (
                <div key={c.key} className="fv40-detail-row">
                  <dt>{c.label}</dt>
                  <dd>
                    {c.type === 'inr'
                      ? inr(panelRow[c.key] ?? null)
                      : c.type === 'date'
                        ? dmy(panelRow[c.key] ?? null)
                        : (panelRow[c.key] ?? '—')}
                  </dd>
                </div>
              ))}
          </dl>
        </Modal>
      ) : null}
      {showDocs ? (
        docRow && docRec ? (
          <DocumentsPanel
            schema={docSchema}
            row={{ id: docRec.id, code: docRow.number, status: docRow.status }}
            // a report line's documents belong to the record behind it: the server checks that page's rights
            canEdit={(actions?.edit ?? false) || LEDGER_PAGES.has(pageId)}
            onChanged={reload}
          />
        ) : (
          <p className="v8-sub">{docRow ? 'This line is a total worked out from the books, so it has no documents of its own.' : 'There is no record yet to add documents to.'}</p>
        )
      ) : null}
      {data?.audit ? <AuditEntries pageId={pageId} /> : null}
      {allocId ? (
        <AllocateInvoiceDialog
          id={allocId}
          onClose={() => setAllocId(null)}
          onDone={(msg) => {
            setAllocId(null);
            toast(msg);
            reload();
          }}
        />
      ) : null}
      {dlg?.kind === 'email' ? (
        <EmailDocDialog docType={recordOf(dlg.row)?.page ?? recPage} docId={recordOf(dlg.row)?.id ?? dlg.row.id} onClose={() => setDlg(null)} />
      ) : null}
      {dlg?.kind === 'move' ? (
        <MoveForwardDialog
          docType={recordOf(dlg.row)?.page ?? recPage}
          docId={recordOf(dlg.row)?.id ?? dlg.row.id}
          docNo={dlg.row.number}
          onClose={() => setDlg(null)}
          onMoved={() => setDlg(null)}
        />
      ) : null}
      {columns.some((c) => !c.source) || data?.panel?.columns.some((c) => !c.source) ? (
        <p className="v8-sub fv40-nosource">
          No source in the database yet (shown as a dash):{' '}
          {[...columns, ...(data?.panel?.columns ?? [])]
            .filter((c) => !c.source)
            .map((c) => c.label)
            .join(', ')}
          .
        </p>
      ) : null}
      {detail ? (
        <Modal
          title={detail.number || 'Record'}
          onClose={() => setDetail(null)}
          footer={
            <>
              {recordButtons(rows.find((x) => x.id === detail.id) ?? detail, 'modal')}
              <button type="button" className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
            </>
          }
        >
          <dl className="fv40-detail">
            {columns
              .filter((c) => c.type !== 'actions' && c.type !== 'docs')
              .map((c) => [c, rows.find((x) => x.id === detail.id) ?? detail] as const)
              .map(([c, now]) => (
                <div key={c.key} className="fv40-detail-row">
                  <dt>{c.label}</dt>
                  <dd>
                    {c.type === 'inr'
                      ? inr(now[c.key] ?? null)
                      : c.type === 'date'
                        ? dmy(now[c.key] ?? null)
                        : (now[c.key] ?? '—')}
                  </dd>
                </div>
              ))}
          </dl>
          {detailExtra?.(detail)}
        </Modal>
      ) : null}
    </section>
  );
}
