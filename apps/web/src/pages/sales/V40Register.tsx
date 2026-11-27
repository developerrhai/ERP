// The V40 tab content of the CRM and Sales pages: for the open V40 tab it shows the columns V40 shows there, with the
// values the API reads from the real tables (GET /sales/v40/:pageId), the row buttons (View, Email, PDF, Submit,
// 360° Track, Docs), the selection bar (Load / Export / Submit / Delete Selected), Previous / Next, the page's
// settlement or exception panel and the audit entries. Outside the tab frame (or for a page without V40 views) it shows
// `fallback`, the page's own table, unchanged.
import { HolderNote, useHolders } from '../../components/HolderNote';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { Modal } from '../../components/Modal';
import { MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { toUiMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { deleteDoc, getDoc, verb } from '../../lib/scmApi';
import { useColumnChoice } from '../../lib/pageSettings';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { listPageAudit } from '../generic/engineApi';
import { DocumentsPanel } from '../generic/DocumentsPanel';
import type { PageSchema } from '../generic/engineApi';
import { ClassicViewSwitch, useClassic } from '../frame/ClassicView';
import { useFrame, v40TabsFor } from '../frame/V40TabFrame';
import {
  ActivityPanel,
  CreditWorkspace,
  Customer360Workspace,
  RecordStrip,
  RegisterKpis,
  ReviewDialog,
  ReviewManyDialog,
  CRM_PAGES,
} from './SalesRegisterParts';
import { dmy, ErrorBox, inr, Pill } from '../finance/shared';
import {
  SALES_V40_IDS,
  getSalesV40,
  type V40Column,
  type V40Panel,
  type V40Row,
} from './salesV40Api';
import { FAM_PAGE_CFG, FAM_V40_IDS } from '../v40fam/famIds';
import { QMS_V2_PAGE_CFG, QMS_V2_REGISTER_IDS } from '../qms/v2/ids';
import { exportTable } from '../generic/RegisterTab';
import {
  SalesAnalyticsView,
  SalesCalendarView,
  SalesReportsView,
  isAnalyticsTab,
  isCalendarTab,
  isReportsTab,
} from './SalesTabViews';
import { auditRecord } from '../../lib/auditRecord';
import './sales-v40.css';

interface PageCfg {
  /** records with no approval chain: "Submit" sends them to a department for review */
  review?: boolean;
  /** offers a "rows per page" list */
  pageSizes?: number[];
  /** the Detailed Table shows every column, these first, with Send Email / Word / Excel / PDF above it */
  detailFirst?: string[];
  /** the Detailed Table shows just these columns (so its row buttons stay on screen), with the same export buttons */
  detailOnly?: string[];
  /** why Edit / Delete are shown switched off on a row that no longer allows them */
  locked?: { edit?: string; delete?: string };
  /** the page carries the summary cards, the record strip and the Detailed Table */
  dashboard?: boolean;
  noun: string;
  /** REST path of the document (get / submit / delete) */
  path?: string;
  submit?: boolean;
  /** an Approved document can be posted from the row */
  post?: boolean;
  /** the print engine knows this page (Industry PDF, Email) */
  print?: boolean;
  /** Move Forward on the row even without a document path (customers) */
  move?: boolean;
  /** status in which the server still lets the record be deleted (default Draft) */
  draftStatus?: string;
  /** "360° Track" opens the order tracking page for the row */
  track?: boolean;
}
const PAGE_CFG: Record<string, PageCfg> = {
  // the generic families first: a page configured below (sales, CRM) must win over the family default
  ...FAM_PAGE_CFG,
  ...QMS_V2_PAGE_CFG,
  'sales-orders': {
    noun: 'Sales Orders',
    path: '/sales/orders',
    submit: true,
    print: true,
    track: true,
  },
  'sales-quotations': { noun: 'Quotations', path: '/sales/quotations', submit: true, print: true },
  'sales-invoices': {
    noun: 'Invoices',
    path: '/sales/invoices',
    submit: true,
    post: true,
    print: true,
    locked: { edit: 'Only a Draft or Rejected invoice can be edited. A posted invoice is cancelled from View and raised again.', delete: 'Only a Draft invoice can be deleted.' },
  },
  'sales-dispatch': {
    noun: 'Dispatches',
    path: '/sales/dispatch',
    submit: true,
    post: true,
    print: true,
  },
  'sales-returns': {
    noun: 'Returns',
    path: '/sales/returns',
    submit: true,
    post: true,
    print: true,
    dashboard: true,
    pageSizes: [20, 50, 100, 10],
    detailOnly: ['Return No', 'Customer', 'Invoice Ref', 'Return Date', 'Item', 'Qty', 'Reason', 'Status'],
    locked: { edit: 'Only a Draft or Rejected return can be edited.', delete: 'Only a Draft return can be deleted.' },
  },
  'sales-collections': { noun: 'Payments', print: true, move: true, locked: { edit: 'Edit works on a posted receipt: this row is not one.' } },
  'sales-enquiries': { noun: 'Enquiries', print: true, move: true },
  'crm-leads': {
    noun: 'Leads',
    path: '/crm/leads',
    print: true,
    draftStatus: 'New',
    review: true,
    pageSizes: [20, 50, 100, 10],
    detailFirst: ['Lead No', 'Lead Name', 'Consent Status', 'Status'],
    locked: { edit: 'A converted lead is locked: work continues on its opportunity.', delete: 'Only a New lead can be deleted. Press View, then "Not qualified" to close it.' },
  },
  'crm-opportunities': {
    noun: 'Opportunities',
    path: '/crm/opportunities',
    print: true,
    draftStatus: 'Prospecting',
  },
  'crm-followups': { noun: 'Follow-ups', path: '/crm/followups', print: true, draftStatus: 'Open' },
  'crm-meetings': { noun: 'Meetings', path: '/crm/meetings', print: true, draftStatus: 'Planned' },
  'crm-feedback': { noun: 'Feedback', path: '/crm/feedback', print: true, draftStatus: 'New' },
  'crm-sources': { noun: 'Sources', print: true, move: true },
  'master-customers': { noun: 'Customers', print: true, move: true },
  'crm-customer360': { noun: 'Customers', print: true, move: true },
  'sales-reservations': { noun: 'Reservations', print: true, move: true, locked: { edit: 'A fulfilled, released or expired reservation can no longer be edited, and changing reserved stock needs the Inventory reservation right.' } },
  'sales-delivery': { noun: 'Delivery Plans', print: true, move: true, locked: { edit: 'Everything on this order is delivered.' } },
  'sales-credit': {
    noun: 'Credit Profiles',
    print: true,
    move: true,
    review: true,
    dashboard: true,
    pageSizes: [20, 50, 100, 10],
    detailOnly: ['Customer Code', 'Customer', 'Credit Limit', 'Used Limit', 'Available Limit', 'Overdue', 'Oldest Due Days', 'Status'],
    locked: { delete: "A customer's credit profile is not deleted: change the limit with Edit." },
  },
  'sales-pricelist': { noun: 'Price Lists', print: true, move: true },
};
const EDITABLE = new Set(['Draft', 'Rejected']);
/**
 * The record a register row stands for when its page has no table of its own: a delivery plan is a sales order, a credit
 * profile is a customer. Email / Word / Excel / PDF / Docs / Move Forward act on that record.
 */
const RECORD_PAGE: Record<string, string> = { 'sales-delivery': 'sales-orders', 'sales-credit': 'master-customers' };
/** Buttons of the page's own row that the register already draws itself (never repeated as a proxy). */
const FIXED_LABELS = new Set(['View', 'Open', 'Details', 'Docs', 'Email', 'Word', 'Excel', 'PDF', 'Move Forward', 'Edit', 'Delete', 'Submit']);
const PAGE_SIZE = 20;
/** The stored record a row stands for: itself, or the record it is a line of. */
const recordOf = (r: V40Row): string => r.record_id ?? r.id;

const num = (v: string | null): string => {
  if (v === null || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? v : Math.round(n).toLocaleString('en-IN');
};

/** The text of a cell for the detail dialog (the same formatting the table uses). */
function cellText(col: V40Column, row: Record<string, string | null>): string {
  const v = row[col.key] ?? null;
  if (col.type === 'inr') return inr(v);
  if (col.type === 'date') return dmy(v);
  if (col.type === 'num') return num(v);
  return v === null || v === '' ? '—' : v;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function Cell({
  col,
  row,
  children,
}: {
  col: V40Column;
  row: Record<string, string | null>;
  children?: ReactNode;
}) {
  const v = row[col.key] ?? null;
  if (children) return <td>{children}</td>;
  if (col.type === 'inr') return <td className="num">{inr(v)}</td>;
  if (col.type === 'num') return <td className="num">{num(v)}</td>;
  if (col.type === 'date') return <td className="cell-date">{dmy(v)}</td>;
  if (col.type === 'pill') return <td>{v ? <Pill>{v}</Pill> : '—'}</td>;
  if (v !== null && /^-?\d+\.\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    if (!isNaN(n)) return <td className="num">{Math.round(n).toLocaleString('en-IN')}</td>;
  }
  return <td>{v === null || v === '' ? '—' : v}</td>;
}

function PanelTable({
  panel,
  onAllocate,
  allocateOff,
}: {
  panel: V40Panel;
  onAllocate?: ((id: string, action?: string) => void) | undefined;
  allocateOff?: string | undefined;
}) {
  return (
    <section className="sv40-panel" aria-label={panel.title}>
      <h3>{panel.title}</h3>
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              {panel.columns.map((c) => (
                // a heading sits over its figures: numbers are right-aligned in both
                <th key={c.key} className={c.type === 'num' || c.type === 'inr' ? 'num' : undefined}>
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
                        '—'
                      ) : onAllocate &&
                        (r[c.key] === 'Allocate' || r[c.key] === 'Reallocate') &&
                        r.id ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => onAllocate(r.id ?? '', r[c.key] ?? '')}
                        >
                          {r[c.key]}
                        </button>
                      ) : allocateOff && (r[c.key] === 'Allocate' || r[c.key] === 'Reallocate') ? (
                        <button type="button" className="btn sm" disabled title={allocateOff}>
                          {r[c.key]}
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
    <section className="sv40-panel" aria-label="Audit entries">
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
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={rows.length < 10}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}

export interface V40RegisterProps {
  pageId: string;
  actions?: ActionSet;
  /** the page's own table, shown outside the tab frame */
  fallback: ReactNode;
  /** opens the page's own record dialog for a row (View, Load Selected) */
  onOpen?: (id: string) => void;
  /** opens the record's edit form: a row "Edit" button (only for rows `canEditRow` accepts) */
  onEdit?: ((id: string, row?: V40Row) => void) | undefined;
  canEditRow?: (status: string) => boolean;
  /** bump to reload after the page changed a record */
  reloadKey?: unknown;
  /** the page's own list reloads (after Submit / Delete here) */
  onChanged?: () => void;
  /** the money panel's Allocate button: record a receipt against this invoice id */
  onAllocate?: ((id: string, action?: string) => void) | undefined;
  /** why the panel's Allocate / Reallocate button is shown switched off for this person */
  allocateOff?: string | undefined;
  /** page-specific row buttons (Qualify, Won, Lost ...) shown after the standard ones */
  rowExtra?: (row: V40Row, reload: () => void) => ReactNode;
  /** page-specific buttons of the selection bar (Delete Selected, Deactivate Selected ...) */
  bulkExtra?: (selected: V40Row[], done: () => void) => ReactNode;
  /** shows a "Sort by" box and a Print button on each row */
  sortable?: boolean;
  /**
   * Keep the page's own screen mounted (hidden) behind the register, so its dialogs (create, edit, allocate ...) open from
   * the register's buttons and its row actions are offered on every row.
   */
  host?: boolean;
  /** Extra filters sent with the register query (Lead Sources "Department Filter"). Pass a value that only changes when the filter does. */
  query?: { department?: string } | undefined;
}

/** True when the V40 register (with its own search box) replaces the page's table. */
export const hasV40Register = (pageId: string): boolean => SALES_V40_IDS.has(pageId) || FAM_V40_IDS.has(pageId) || QMS_V2_REGISTER_IDS.has(pageId);

/** Wrap the table of a sales page: `<V40Register pageId=… actions=… fallback={<table…/>} />`. */
export function V40Register(props: V40RegisterProps) {
  const frame = useFrame();
  if (!frame || !hasV40Register(props.pageId)) return <>{props.fallback}</>;
  const body = (
    <V40Body {...props} tabName={frame.tabName} first={frame.index === 0} claim={frame.claim} />
  );
  return props.host ? (
    <ClassicViewSwitch pageId={props.pageId} fallback={props.fallback} host>
      {body}
    </ClassicViewSwitch>
  ) : (
    body
  );
}

function V40Body({
  pageId,
  actions: given,
  onOpen,
  onEdit,
  canEditRow,
  reloadKey,
  onChanged,
  onAllocate,
  allocateOff,
  rowExtra,
  bulkExtra,
  sortable,
  query,
  tabName,
  first,
  claim,
}: V40RegisterProps & { tabName: string; first: boolean; claim: () => void }) {
  const actions: ActionSet = given ?? ({} as ActionSet);
  const cfg = PAGE_CFG[pageId] ?? { noun: 'Records' };
  // a tab whose rows are records of another page (Collections "Overdue" lists invoices) says so with the answer
  const [otherPage, setOtherPage] = useState('');
  const recPage = otherPage || (RECORD_PAGE[pageId] ?? pageId);
  const holders = useHolders(recPage);
  const classic = useClassic();
  const [detail, setDetail] = useState<V40Row | null>(null);
  // a host page whose "＋ New ..." button lives only in its hidden screen gets a visible copy above the register
  const [headAdd, setHeadAdd] = useState('');
  useEffect(() => {
    if (!classic) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      const label = classic.addLabel();
      const visible = Array.from(document.querySelectorAll<HTMLButtonElement>('.main button')).some(
        (b) => !b.closest('[data-classic-host]') && !b.closest('.actionbar') && (b.textContent ?? '').trim() === label,
      );
      if (label && !visible) setHeadAdd(label);
      if (label || tries >= 8) clearInterval(t);
    }, 400);
    return () => clearInterval(t);
  }, [classic]);
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  // the record chosen in the "Select ..." list, so Load Selected works without ticking its row too
  const [chosen, setChosen] = useState('');
  const [size, setSize] = useState(PAGE_SIZE);
  const [reviewing, setReviewing] = useState<{ id: string; number: string } | null>(null);
  const [reviewMany, setReviewMany] = useState<V40Row[] | null>(null);
  const detailBox = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState<string[] | null>(null);
  const [moving, setMoving] = useState<V40Row | null>(null);
  const [tick, setTick] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const claimRef = useRef(claim);
  claimRef.current = claim;
  useEffect(() => claimRef.current(), []);
  useEffect(() => {
    setPage(1);
    setPicked(new Set());
  }, [tabName, q, status]);
  // the columns differ between tabs, so a sort choice belongs to its tab
  useEffect(() => setSort(''), [tabName]);

  const department = query?.department ?? '';
  useEffect(() => setPage(1), [department]);
  const load = useLoad(
    () => getSalesV40(pageId, { tab: tabName, first, q, status, page, size, ...(sort ? { sort } : {}), ...(department ? { department } : {}) }),
    [pageId, tabName, first, q, status, page, size, sort, reloadKey, tick, department],
  );
  const data = load.data;
  useEffect(() => setOtherPage(data?.recordPage ?? ''), [data]);
  const rows: V40Row[] = useMemo(() => data?.rows ?? [], [data]);
  const columns = useColumnChoice(pageId, data?.columns ?? [], (c) => c.type === 'actions');
  for (const r of rows) if (r.status) seen.current.add(r.status);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const docsTab = v40TabsFor(pageId).findIndex((t) => /^documents$/i.test(t));
  const selectedRows = rows.filter((r) => picked.has(r.id));
  const listed = chosen && q === chosen ? rows.find((r) => r.number === chosen) : undefined;
  const loadTarget = selectedRows[0] ?? listed;
  // Tell the page toolbar (Word, Industry PDF, Send Email, Excel, Move Forward ...) which record is ticked, so those
  // buttons act on it instead of answering "select a record first" (QA: toolbar buttons did nothing on CRM screens).
  const activeId = selectedRows[0] ? recordOf(selectedRows[0]) : '';
  const activeNo = selectedRows[0]?.number ?? '';
  useEffect(() => {
    const announce = (): void => {
      window.dispatchEvent(
        new CustomEvent('v40-active-record', { detail: { pageId, recordId: activeId, docNo: activeNo } }),
      );
    };
    announce();
    const onRequest = (e: Event): void => {
      const ce = e as CustomEvent<{ pageId?: string }>;
      if (!ce.detail?.pageId || ce.detail.pageId === pageId) announce();
    };
    window.addEventListener('v40-request-active-record', onRequest);
    return () => window.removeEventListener('v40-request-active-record', onRequest);
  }, [pageId, activeId, activeNo]);
  const reload = (): void => {
    setTick((n) => n + 1);
    onChanged?.();
  };

  const toggle = (id: string): void =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id));

  /** Opens the printed record in a hidden frame and sends it to the printer. */
  async function printRow(r: V40Row): Promise<void> {
    try {
      const file = await docsMailApi.print(recPage, recordOf(r), 'standard');
      const url = URL.createObjectURL(file.blob);
      const frameEl = document.createElement('iframe');
      frameEl.style.display = 'none';
      frameEl.title = `Print ${r.number}`;
      frameEl.src = url;
      frameEl.onload = () => {
        try {
          frameEl.contentWindow?.focus();
          frameEl.contentWindow?.print();
        } catch {
          window.open(url, '_blank', 'noopener');
        }
      };
      document.body.appendChild(frameEl);
      setTimeout(() => {
        frameEl.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  async function pdf(r: V40Row): Promise<void> {
    try {
      saveFile(await docsMailApi.print(recPage, recordOf(r), 'standard'), `${r.number || 'document'}.pdf`);
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  async function word(r: V40Row): Promise<void> {
    try {
      saveFile(await docsMailApi.print(recPage, recordOf(r), 'word'), `${r.number || 'document'}.docx`);
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  async function excel(r: V40Row): Promise<void> {
    try {
      saveFile(await docsMailApi.print(recPage, recordOf(r), 'excel'), `${r.number || 'document'}.xlsx`);
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  async function submit(ids: string[]): Promise<void> {
    if (!cfg.path) return;
    setMsg('');
    let done = 0;
    for (const id of ids) {
      try {
        const d = await getDoc(cfg.path, id);
        if (!EDITABLE.has(d.status)) continue;
        await verb(cfg.path, id, 'submit', {}, d.version);
        done += 1;
      } catch (e) {
        setMsg(toUiMessage(e));
      }
    }
    toast(`${done} submitted`);
    setPicked(new Set());
    reload();
  }
  async function post(r: V40Row): Promise<void> {
    if (!cfg.path) return;
    setMsg('');
    try {
      await verb(cfg.path, r.id, 'post');
      toast(`Posted ${r.number}`);
      reload();
    } catch (e) {
      setMsg(toUiMessage(e));
    }
  }
  async function remove(ids: string[]): Promise<void> {
    if (!cfg.path) return;
    setMsg('');
    let done = 0;
    for (const id of ids) {
      try {
        const d = await getDoc(cfg.path, id);
        await deleteDoc(cfg.path, id, d.version);
        done += 1;
      } catch (e) {
        setMsg(toUiMessage(e));
      }
    }
    toast(`${done} deleted`);
    setPicked(new Set());
    reload();
  }
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
  // SE-02: the Docs button remembers its row in the URL (?doc=), because changing tab clears the ticked rows
  const openDocs = (id?: string): void => {
    if (otherPage) {
      const there = v40TabsFor(otherPage).findIndex((t) => /^documents$/i.test(t));
      navigate(`/m/${otherPage}?tab=${Math.max(there, 0)}${id ? `&doc=${id}` : ''}`);
      return;
    }
    if (docsTab < 0) return;
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', String(docsTab));
      if (id) n.set('doc', id);
      return n;
    });
  };

  const showDocs = /^documents$/i.test(tabName);
  const docParam = params.get('doc');
  const docRow = rows.find((r) => r.id === docParam) ?? selectedRows[0] ?? rows[0];
  // the real-data tab views exist for the pages the sales endpoint serves
  const realViews = SALES_V40_IDS.has(pageId) || pageId.startsWith('wms-');
  const view = !realViews
    ? null
    : isAnalyticsTab(tabName)
      ? 'analytics'
      : isCalendarTab(tabName)
        ? 'calendar'
        : isReportsTab(tabName)
          ? 'reports'
          : null;
  const docSchema = useMemo(() => ({ pageId: recPage }) as unknown as PageSchema, [recPage]);

  // the row buttons, shared by the register and its Detailed Table
  // what the page's own screen (hidden behind this register) offers on the row of this record
  const hostActions = (r: V40Row): string[] => classic?.actionsOf(r.number) ?? [];
  const proxy = (r: V40Row, label: string): void => {
    if (!classic?.press(r.number, label)) toast(`${label} is not available for ${r.number} right now.`);
  };
  // a row whose record link is empty (a scan of an unknown code) has no record to print, send, move or attach to
  const noRecord = (r: V40Row): boolean => 'record_id' in r && r.record_id === null;
  const rowButtons = (r: V40Row, inModal = false): ReactNode => (
    <>
      {inModal ? null : (
        <button type="button" className="btn sm" onClick={() => (onOpen ? onOpen(recordOf(r)) : setDetail(r))}>
          View
        </button>
      )}
      {onEdit && (canEditRow ? canEditRow(r.status) : EDITABLE.has(r.status)) ? (
        <button type="button" className="btn sm" onClick={() => onEdit(recordOf(r), r)}>
          Edit
        </button>
      ) : !onEdit && hostActions(r).includes('Edit') ? (
        <button type="button" className="btn sm" onClick={() => proxy(r, 'Edit')}>
          Edit
        </button>
      ) : onEdit && cfg.locked?.edit ? (
        <button type="button" className="btn sm" disabled title={cfg.locked.edit}>
          Edit
        </button>
      ) : null}
      {cfg.print && !noRecord(r) ? (
        <>
          <button type="button" className="btn sm" onClick={() => setEmail(recordOf(r))}>
            Email
          </button>
          <button type="button" className="btn sm" onClick={() => void pdf(r)}>
            PDF
          </button>
          <button type="button" className="btn sm" onClick={() => void word(r)}>
            Word
          </button>
          <button type="button" className="btn sm" onClick={() => void excel(r)}>
            Excel
          </button>
          {sortable ? (
            <button type="button" className="btn sm" onClick={() => void printRow(r)}>
              Print
            </button>
          ) : null}
        </>
      ) : null}
      {cfg.submit && actions.submit && EDITABLE.has(r.status) ? (
        <button type="button" className="btn sm" onClick={() => void submit([r.id])}>
          Submit
        </button>
      ) : !cfg.submit && hostActions(r).includes('Submit') ? (
        <button type="button" className="btn sm" onClick={() => proxy(r, 'Submit')}>
          Submit
        </button>
      ) : null}
      {!rowExtra
        ? hostActions(r)
            .filter((l) => !FIXED_LABELS.has(l) && l !== r.number && !/^(view|open)\b/i.test(l))
            .map((l) => (
              <button key={l} type="button" className="btn sm" onClick={() => proxy(r, l)}>
                {l}
              </button>
            ))
        : null}
      {cfg.path && cfg.post && r.status === 'Approved' && actions.post ? (
        <button type="button" className="btn sm" onClick={() => void post(r)}>
          Post
        </button>
      ) : null}
      {rowExtra?.(r, reload)}
      {cfg.path && actions.delete && r.status === (cfg.draftStatus ?? 'Draft') ? (
        <button type="button" className="btn sm danger" onClick={() => setAskDelete([r.id])}>
          Delete
        </button>
      ) : !cfg.path && hostActions(r).includes('Delete') ? (
        <button type="button" className="btn sm danger" onClick={() => proxy(r, 'Delete')}>
          Delete
        </button>
      ) : cfg.locked?.delete && actions.delete ? (
        <button type="button" className="btn sm danger" disabled title={cfg.locked.delete}>
          Delete
        </button>
      ) : null}
      {cfg.review && actions.submit && !noRecord(r) ? (
        <button type="button" className="btn sm" title="Send to a department for review" onClick={() => setReviewing({ id: recordOf(r), number: r.number })}>
          Submit
        </button>
      ) : null}
      {(cfg.path || cfg.move) && !noRecord(r) ? (
        <button type="button" className="btn sm primary" onClick={() => setMoving(r)}>
          Move Forward
        </button>
      ) : null}
      {cfg.track ? (
        <button
          type="button"
          className="btn sm"
          onClick={() => navigate(`/m/ops-order-360?so=${r.id}`)}
        >
          360° Track
        </button>
      ) : null}
      {docsTab >= 0 && !noRecord(r) ? (
        <button type="button" className="btn sm" onClick={() => openDocs(r.id)}>
          Docs
        </button>
      ) : null}
    </>
  );

  // Detailed Table: the lead page shows every column (consent and status first); the other pages their first eight
  const dataColumns = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs');
  const firstLabels = cfg.detailFirst ?? [];
  const only = (cfg.detailOnly ?? []).flatMap((l) => dataColumns.filter((c) => c.label === l));
  const detailColumns = only.length
    ? only
    : cfg.detailFirst
      ? [...firstLabels.flatMap((l) => dataColumns.filter((c) => c.label === l)), ...dataColumns.filter((c) => !firstLabels.includes(c.label))]
      : dataColumns.slice(0, 8);

  const dashboard = CRM_PAGES.has(pageId) || Boolean(cfg.dashboard);
  const activity = ['crm-followups', 'crm-meetings', 'crm-feedback'].includes(pageId) ? (
    <ActivityPanel pageId={pageId} rows={rows} columns={columns} canAdd={Boolean(actions.add)} onSaved={reload} />
  ) : null;

  return (
    <section className="sv40" aria-label={`${tabName || cfg.noun} (V40 view)`}>
      <ErrorBox message={msg || load.error} />
      {headAdd && actions.add !== false ? (
        <div className="sv40-head-add">
          <button type="button" className="btn primary" data-add-proxy="" onClick={() => classic?.pressAdd()}>
            {headAdd}
          </button>
        </div>
      ) : null}
      {view === 'analytics' ? <SalesAnalyticsView pageId={pageId} noun={cfg.noun} /> : null}
      {view === 'calendar' ? <SalesCalendarView pageId={pageId} tabName={tabName} /> : null}
      {view === 'reports' ? <SalesReportsView pageId={pageId} noun={cfg.noun} /> : null}
      {view ? null : (
        <>
          {dashboard ? <RegisterKpis pageId={pageId} reloadKey={`${tick}-${String(total)}-${String(reloadKey ? 1 : 0)}`} /> : null}
          {dashboard ? (
            <RecordStrip
              pageId={pageId}
              recordPage={recPage}
              rows={rows}
              actions={actions}
              canSubmitDoc={Boolean(cfg.submit)}
              canEdit={(st) => (canEditRow ? canEditRow(st) : EDITABLE.has(st))}
              canDelete={(st) => Boolean(cfg.path) && st === (cfg.draftStatus ?? 'Draft')}
              deleteWhy={cfg.locked?.delete}
              onLoad={onOpen}
              onEdit={onEdit}
              onDelete={(id) => setAskDelete([id])}
              onSubmit={(id) => void submit([id])}
              review={Boolean(cfg.review)}
            />
          ) : null}
          {/* V40 order: the Meeting Calendar / Customer 360 workspace first, the detailed table under it */}
          {pageId === 'crm-meetings' ? activity : null}
          {pageId === 'crm-customer360' ? <Customer360Workspace rows={rows} columns={columns} onOpen={onOpen} /> : null}
          {pageId === 'sales-credit' ? <CreditWorkspace rows={rows} columns={columns} onOpen={onOpen} /> : null}
          <div className="toolbar sv40-toolbar">
            <select
              aria-label="Select record"
              value={listed ? chosen : ''}
              onChange={(e) => {
                if (!e.target.value) return;
                setChosen(e.target.value);
                setQ(e.target.value);
              }}
            >
              <option value="">{`Select ${cfg.noun}`}</option>
              {rows.map((r, i) => (
                <option key={`${r.id}-${i}`} value={r.number}>
                  {r.number}
                </option>
              ))}
            </select>
            <input
              aria-label={`Search ${cfg.noun}`}
              placeholder={`Search ${cfg.noun}...`}
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
            {sortable ? (
              <select aria-label="Sort by" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                <option value="">Sort by: usual order</option>
                {columns
                  .filter((c) => c.source && c.type !== 'actions' && c.type !== 'docs')
                  .flatMap((c) => [
                    <option key={c.key} value={c.key}>{`${c.label} (A to Z, low to high)`}</option>,
                    <option key={`-${c.key}`} value={`-${c.key}`}>{`${c.label} (Z to A, high to low)`}</option>,
                  ])}
              </select>
            ) : null}
            {cfg.pageSizes ? (
              <select aria-label="Rows per page" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}>
                {cfg.pageSizes.map((n) => (
                  <option key={n} value={n}>
                    {n} rows
                  </option>
                ))}
              </select>
            ) : null}
            <span className="sv40-count">{total} records</span>
          </div>
          {picked.size > 0 || rows.length > 0 ? (
            <div className="sv40-bulk" role="group" aria-label="Selected records">
              <span>{picked.size} selected</span>
              <button
                type="button"
                className="btn sm"
                disabled={!loadTarget || !onOpen}
                title={!onOpen ? 'These records have no separate form: press View in the table.' : !loadTarget ? 'Tick a record in the table, or choose it in the list, first.' : undefined}
                onClick={() => loadTarget && onOpen?.(recordOf(loadTarget))}
              >
                Load Selected
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={rows.length === 0}
                title={rows.length === 0 ? 'There is nothing to export on this tab.' : undefined}
                onClick={exportSelected}
              >
                Export Selected
              </button>
              {cfg.submit && actions.submit ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={picked.size === 0}
                  title={picked.size === 0 ? 'Tick the records to submit first.' : undefined}
                  onClick={() => void submit([...picked])}
                >
                  Submit Selected
                </button>
              ) : null}
              {cfg.review && actions.submit ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={selectedRows.length === 0}
                  title={selectedRows.length === 0 ? 'Tick the records to submit first.' : undefined}
                  onClick={() => setReviewMany(selectedRows)}
                >
                  Submit Selected
                </button>
              ) : null}
              {cfg.path && actions.delete ? (
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={picked.size === 0}
                  title={picked.size === 0 ? 'Tick the draft records to delete first.' : undefined}
                  onClick={() => setAskDelete([...picked])}
                >
                  Delete Selected
                </button>
              ) : null}
              {bulkExtra?.(selectedRows, () => {
                setPicked(new Set());
                reload();
              })}
            </div>
          ) : null}
          <div className="card table-wrap">
            <table className="register-table sv40-table">
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
                            <div className="sv40-wrap">
                              <HolderNote holder={holders.get(recordOf(r))} />
                              {rowButtons(r)}
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
          <div className="actions sv40-pager">
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
          {dashboard && rows.length > 0 ? (
            <section className="sv40-panel" aria-label={`${cfg.noun} Register – Detailed Table`}>
              <div className="sv40-detail-head">
                <h3>{cfg.noun} Register – Detailed Table</h3>
                {cfg.detailFirst || cfg.detailOnly ? (
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => (selectedRows[0] ? setEmail(recordOf(selectedRows[0])) : toast('Tick a row first, then press Send Email.'))}
                    >
                      Send Email
                    </button>
                    {actions.export ? (
                      <>
                        <button type="button" className="btn sm" onClick={() => exportTable(detailBox.current, `${cfg.noun} Register`, 'word', toast)}>
                          Word
                        </button>
                        <button type="button" className="btn sm" onClick={() => exportTable(detailBox.current, `${cfg.noun} Register`, 'excel', toast)}>
                          Excel
                        </button>
                        <button type="button" className="btn sm" onClick={() => exportTable(detailBox.current, `${cfg.noun} Register`, 'pdf', toast)}>
                          PDF
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="table-wrap" ref={detailBox}>
                <table className="register-table">
                  <thead>
                    <tr>
                      {detailColumns.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        {detailColumns.map((c) => (
                          <Cell key={c.key} col={c} row={r} />
                        ))}
                        <td className="row-actions">{rowButtons(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          {pageId === 'crm-followups' || pageId === 'crm-feedback' ? activity : null}
        </>
      )}
      {!view && data?.panel ? <PanelTable panel={data.panel} onAllocate={onAllocate} allocateOff={allocateOff} /> : null}
      {reviewing ? (
        <ReviewDialog pageId={recPage} id={reviewing.id} number={reviewing.number} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); reload(); }} />
      ) : null}
      {reviewMany ? (
        <ReviewManyDialog pageId={recPage} rows={reviewMany} onClose={() => setReviewMany(null)} onDone={() => { setReviewMany(null); setPicked(new Set()); reload(); }} />
      ) : null}
      {showDocs ? (
        docRow ? (
          <>
            <label className="v8-sub sv40-doc-pick">
              Record{' '}
              <select
                aria-label="Record for documents"
                value={docRow.id}
                onChange={(e) =>
                  setParams((p) => {
                    const n = new URLSearchParams(p);
                    n.set('doc', e.target.value);
                    return n;
                  })
                }
              >
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number}
                  </option>
                ))}
              </select>
            </label>
            <DocumentsPanel
              schema={docSchema}
              row={{ id: recordOf(docRow), code: docRow.number, status: docRow.status }}
              canEdit={actions.edit}
              onChanged={reload}
            />
          </>
        ) : (
          <p className="v8-sub">No record to show documents for yet.</p>
        )
      ) : null}
      {data?.audit || /audit/i.test(tabName) ? <AuditEntries pageId={pageId} /> : null}
      {columns.some((c) => !c.source) ? (
        <p className="v8-sub sv40-nosource">
          No source in the database yet (shown as a dash):{' '}
          {columns
            .filter((c) => !c.source)
            .map((c) => c.label)
            .join(', ')}
          .
        </p>
      ) : null}
      {askDelete ? (
        <Modal
          title={`Delete ${askDelete.length} ${cfg.noun.toLowerCase()}?`}
          size="sm"
          onClose={() => setAskDelete(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAskDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const ids = askDelete;
                  setAskDelete(null);
                  void remove(ids);
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            Only drafts can be deleted. A record that is already approved or posted is refused with
            the reason.
          </p>
        </Modal>
      ) : null}
      {moving ? (
        <MoveForwardDialog
          docType={recPage}
          docId={recordOf(moving)}
          docNo={moving.number}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            toast(`Moved ${moving.number} forward`);
            reload();
          }}
        />
      ) : null}
      {email ? (
        <EmailDocDialog docType={recPage} docId={email} onClose={() => setEmail(null)} />
      ) : null}
      {detail ? (
        <Modal
          title={detail.number || cfg.noun}
          onClose={() => setDetail(null)}
          footer={
            <>
              {/* the row as it is now: a button pressed here changes the record, so the next press needs the new version */}
              {rowButtons({ ...(rows.find((x) => x.id === detail.id) ?? detail) }, true)}
              <button type="button" className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
            </>
          }
        >
          <dl className="fv40-detail">
            {columns
              .filter((c) => c.type !== 'actions' && c.type !== 'docs')
              .map((c) => (
                <div key={c.key} className="fv40-detail-row">
                  <dt>{c.label}</dt>
                  <dd>{cellText(c, rows.find((x) => x.id === detail.id) ?? detail)}</dd>
                </div>
              ))}
          </dl>
        </Modal>
      ) : null}
    </section>
  );
}
