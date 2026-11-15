// The V40 tab content of the CRM and Sales pages: for the open V40 tab it shows the columns V40 shows there, with the
// values the API reads from the real tables (GET /sales/v40/:pageId), the row buttons (View, Email, PDF, Submit,
// 360° Track, Docs), the selection bar (Load / Export / Submit / Delete Selected), Previous / Next, the page's
// settlement or exception panel and the audit entries. Outside the tab frame (or for a page without V40 views) it shows
// `fallback`, the page's own table, unchanged.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { toUiError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { deleteDoc, getDoc, verb } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { listPageAudit } from '../generic/engineApi';
import { DocumentsPanel } from '../generic/DocumentsPanel';
import type { PageSchema } from '../generic/engineApi';
import { useFrame, v40TabsFor } from '../frame/V40TabFrame';
import { dmy, ErrorBox, inr, Pill } from '../finance/shared';
import {
  SALES_V40_IDS,
  getSalesV40,
  type V40Column,
  type V40Panel,
  type V40Row,
} from './salesV40Api';
import { FAM_PAGE_CFG, FAM_V40_IDS } from '../v40fam/famIds';
import './sales-v40.css';

interface PageCfg {
  noun: string;
  /** REST path of the document (get / submit / delete) */
  path?: string;
  submit?: boolean;
  /** an Approved document can be posted from the row */
  post?: boolean;
  /** the print engine knows this page (Industry PDF, Email) */
  print?: boolean;
  /** "360° Track" opens the order tracking page for the row */
  track?: boolean;
}
const PAGE_CFG: Record<string, PageCfg> = {
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
  },
  'sales-collections': { noun: 'Payments', print: true },
  'sales-enquiries': { noun: 'Enquiries', print: true },
  'crm-leads': { noun: 'Leads', path: '/crm/leads' },
  'crm-opportunities': { noun: 'Opportunities', path: '/crm/opportunities' },
  'crm-followups': { noun: 'Follow-ups', path: '/crm/followups' },
  'crm-meetings': { noun: 'Meetings', path: '/crm/meetings' },
  'crm-feedback': { noun: 'Feedback', path: '/crm/feedback' },
  'crm-sources': { noun: 'Sources' },
  'master-customers': { noun: 'Customers' },
  'crm-customer360': { noun: 'Customers' },
  'sales-reservations': { noun: 'Reservations' },
  'sales-delivery': { noun: 'Delivery Plans' },
  'sales-credit': { noun: 'Credit Profiles' },
  'sales-pricelist': { noun: 'Price Lists' },
  ...FAM_PAGE_CFG,
};
const EDITABLE = new Set(['Draft', 'Rejected']);
const PAGE_SIZE = 20;

const num = (v: string | null): string => {
  if (v === null || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? v : Math.round(n).toLocaleString('en-IN');
};

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
  if (col.type === 'date') return <td>{dmy(v)}</td>;
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
}: {
  panel: V40Panel;
  onAllocate?: ((id: string, action?: string) => void) | undefined;
}) {
  return (
    <section className="sv40-panel" aria-label={panel.title}>
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
                    <td key={c.key}>
                      {!r[c.key] ? (
                        '—'
                      ) : onAllocate && (r[c.key] === 'Allocate' || r[c.key] === 'Reallocate') && r.id ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => onAllocate(r.id ?? '', r[c.key] ?? '')}
                        >
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
  /** bump to reload after the page changed a record */
  reloadKey?: unknown;
  /** the page's own list reloads (after Submit / Delete here) */
  onChanged?: () => void;
  /** the money panel's Allocate button: record a receipt against this invoice id */
  onAllocate?: (id: string, action?: string) => void;
  /** page-specific row buttons (Qualify, Won, Lost ...) shown after the standard ones */
  rowExtra?: (row: V40Row, reload: () => void) => ReactNode;
}

/** Wrap the table of a sales page: `<V40Register pageId=… actions=… fallback={<table…/>} />`. */
export function V40Register(props: V40RegisterProps) {
  const frame = useFrame();
  if (!frame || (!SALES_V40_IDS.has(props.pageId) && !FAM_V40_IDS.has(props.pageId))) return <>{props.fallback}</>;
  return (
    <V40Body {...props} tabName={frame.tabName} first={frame.index === 0} claim={frame.claim} />
  );
}

function V40Body({
  pageId,
  actions: given,
  onOpen,
  reloadKey,
  onChanged,
  onAllocate,
  rowExtra,
  tabName,
  first,
  claim,
}: V40RegisterProps & { tabName: string; first: boolean; claim: () => void }) {
  const actions: ActionSet = given ?? ({} as ActionSet);
  const cfg = PAGE_CFG[pageId] ?? { noun: 'Records' };
  const toast = useToast();
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState<string[] | null>(null);
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
    () => getSalesV40(pageId, { tab: tabName, first, q, status, page, size: PAGE_SIZE }),
    [pageId, tabName, first, q, status, page, reloadKey, tick],
  );
  const data = load.data;
  const rows: V40Row[] = useMemo(() => data?.rows ?? [], [data]);
  const columns = data?.columns ?? [];
  for (const r of rows) if (r.status) seen.current.add(r.status);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const docsTab = v40TabsFor(pageId).findIndex((t) => /^documents$/i.test(t));
  const selectedRows = rows.filter((r) => picked.has(r.id));
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

  async function pdf(r: V40Row): Promise<void> {
    try {
      saveFile(await docsMailApi.print(pageId, r.id, 'standard'), `${r.number || 'document'}.pdf`);
    } catch (e) {
      toast(toUiError(e).message);
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
        setMsg(toUiError(e).message);
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
      setMsg(toUiError(e).message);
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
        setMsg(toUiError(e).message);
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
    <section className="sv40" aria-label={`${tabName || cfg.noun} (V40 view)`}>
      <ErrorBox message={msg || load.error} />
      <div className="toolbar sv40-toolbar">
        <select
          aria-label="Select record"
          value=""
          onChange={(e) => {
            if (e.target.value) setQ(e.target.value);
          }}
        >
          <option value="">{`Select ${cfg.noun}`}</option>
          {rows.map((r) => (
            <option key={r.id} value={r.number}>
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
        <span className="sv40-count">{total} records</span>
      </div>
      {picked.size > 0 || rows.length > 0 ? (
        <div className="sv40-bulk" role="group" aria-label="Selected records">
          <span>{picked.size} selected</span>
          <button
            type="button"
            className="btn sm"
            disabled={picked.size === 0 || !onOpen}
            onClick={() => selectedRows[0] && onOpen?.(selectedRows[0].id)}
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
          {cfg.submit && actions.submit ? (
            <button
              type="button"
              className="btn sm"
              disabled={picked.size === 0}
              onClick={() => void submit([...picked])}
            >
              Submit Selected
            </button>
          ) : null}
          {cfg.path && actions.delete ? (
            <button
              type="button"
              className="btn sm danger"
              disabled={picked.size === 0}
              onClick={() => setAskDelete([...picked])}
            >
              Delete Selected
            </button>
          ) : null}
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
                  key={c.key}
                  title={c.source ? undefined : 'No source for this column in the database yet'}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={picked.has(r.id) ? 'selected' : undefined}>
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
                        {onOpen ? (
                          <button type="button" className="btn sm" onClick={() => onOpen(r.id)}>
                            View
                          </button>
                        ) : null}
                        {cfg.print ? (
                          <>
                            <button type="button" className="btn sm" onClick={() => setEmail(r.id)}>
                              Email
                            </button>
                            <button type="button" className="btn sm" onClick={() => void pdf(r)}>
                              PDF
                            </button>
                          </>
                        ) : null}
                        {cfg.submit && actions.submit && EDITABLE.has(r.status) ? (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => void submit([r.id])}
                          >
                            Submit
                          </button>
                        ) : null}
                        {cfg.path && cfg.post && r.status === 'Approved' && actions.post ? (
                          <button type="button" className="btn sm" onClick={() => void post(r)}>
                            Post
                          </button>
                        ) : null}
                        {rowExtra?.(r, reload)}
                        {cfg.track ? (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => navigate(`/m/ops-order-360?so=${r.id}`)}
                          >
                            360° Track
                          </button>
                        ) : null}
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
      <div className="actions sv40-pager">
        <button
          type="button"
          className="btn sm"
          disabled={page <= 1}
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
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
      {data?.panel ? <PanelTable panel={data.panel} onAllocate={onAllocate} /> : null}
      {showDocs ? (
        docRow ? (
          <DocumentsPanel
            schema={docSchema}
            row={{ id: docRow.id, code: docRow.number, status: docRow.status }}
            canEdit={actions.edit}
            onChanged={reload}
          />
        ) : (
          <p className="v8-sub">Tick a record to see and add its documents.</p>
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
      {email ? (
        <EmailDocDialog docType={pageId} docId={email} onClose={() => setEmail(null)} />
      ) : null}
    </section>
  );
}
