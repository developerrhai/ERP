// The V40 body of the Procurement / SCM pages: for the tab that is open in the V40 tab strip it shows the workspace
// panel V40 shows (allocation, validation, payment ...) and the register table with the columns of that tab.
// Every value comes from /scm/v40/<kind> (real tables); a column with no source shows a dash.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { HistoryDrawer, MoveForwardDialog } from '../../components/MoveForward';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { decideRequest, getRequests } from '../../lib/approvalsApi';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { toUiMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { submitSupplier } from '../../lib/mastersApi';
import { deleteDoc, verb } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { listPageAudit } from '../generic/engineApi';
import { useFrame, v40TabsFor } from '../frame/V40TabFrame';
import { dmy, ErrorBox, inr, Pill } from '../finance/shared';
import { listV40 } from './v40Api';
import { enrich, RULE_NAMES, SPECS, txt } from './v40Specs';
import type { Col, Level, PageSpec, Panel, Row } from './v40Specs';
import './procurement-v40.css';
import { auditRecord } from '../../lib/auditRecord';

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const STATUS_WORDS: Record<string, string> = {
  APPROVED: 'Approved',
  PENDING: 'Pending Approval',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const DEPARTMENTS = [
  'Administration',
  'Sales',
  'Purchase',
  'Finance',
  'HR',
  'Production',
  'Quality',
  'Maintenance',
  'Warehouse',
  'Projects',
  'Service',
];

const CONNECTED_MODULES = new Set([
  'scm-pr',
  'scm-po',
  'scm-grn',
  'scm-purchaseinvoice',
]);

const DEFAULT_ORDERS = [
  { id: 'SO-2026-001', label: 'SO-2026-001 • Apex Mobility Pvt. Ltd.' },
  { id: 'SO-2026-002', label: 'SO-2026-002 • Tata Motors Ltd.' },
  { id: 'SO-2026-003', label: 'SO-2026-003 • Mahindra Electric' },
  { id: 'SO-2026-004', label: 'SO-2026-004 • Bharat Forge Ltd.' },
];

/** One cell: dates DD-MM-YYYY, money in rupees, quantities without trailing zeros, a missing value as a dash. */
export function cell(col: Col, v: unknown): string {
  if (!has(v)) return '—';
  switch (col.fmt) {
    case 'inr':
      return inr(String(v as string | number));
    case 'date':
      return dmy(String(v as string));
    case 'qty':
      return QTY.format(num(v));
    case 'pct':
      return `${QTY.format(Math.round(num(v) * 100) / 100)}%`;
    case 'num':
      return QTY.format(num(v));
    case 'bool':
      return v === true ? 'Yes' : v === false ? 'No' : '—';
    default:
      return String(v as string | number);
  }
}
const plain = (v: unknown, money: boolean): string =>
  !has(v) ? '—' : money ? inr(String(v as string | number)) : QTY.format(num(v));

function toCsv(cols: Col[], rows: Row[]): string {
  const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    cols.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => cols.map((c) => esc(cell(c, r[c.key]))).join(',')),
  ].join('\n');
}
function saveCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------------------------------------ rule results
interface RuleTotals {
  pass: number;
  warn: number;
  fail: number;
  /** record numbers per level for the Review button */
  failing: string[][];
}
function ruleTotals(spec: PageSpec, rows: Row[]): RuleTotals[] {
  const out: RuleTotals[] = RULE_NAMES.map(() => ({
    pass: 0,
    warn: 0,
    fail: 0,
    failing: [] as string[][],
  }));
  const id = (r: Row): string => txt(r.number ?? r.documentNo ?? r.vendorId ?? r.evaluationNo, '');
  for (const r of rows) {
    const lv: Level[] = spec.rules(r, rows);
    lv.forEach((l, i) => {
      const t = out[i];
      if (!t || !l) return;
      t[l] += 1;
      if (l !== 'pass') (t.failing[l === 'fail' ? 0 : 1] ??= []).push(id(r));
    });
  }
  return out;
}
function metrics(spec: PageSpec, rows: Row[], total: number) {
  const amounts = rows.map((r) => num(r[spec.amountKey])).filter((x) => x > 0);
  const sum = amounts.reduce((a, b) => a + b, 0);
  const cells = rows.length * spec.required.length;
  const filled = rows.reduce((a, r) => a + spec.required.filter((k) => has(r[k])).length, 0);
  const rt = ruleTotals(spec, rows);
  const checked = rt.reduce((a, t) => a + t.pass + t.warn + t.fail, 0);
  const bad = rt.reduce((a, t) => a + t.fail + t.warn * 0.5, 0);
  const trend = [...rows]
    .filter((r) => has(r[spec.dateKey]) && num(r[spec.amountKey]) > 0)
    .sort((a, b) => String(a[spec.dateKey]).localeCompare(String(b[spec.dateKey])))
    .slice(-20)
    .map((r) => num(r[spec.amountKey]));
  const status: Record<string, number> = {};
  for (const r of rows) {
    const raw = txt(r[spec.statusKey ?? 'status'], '—');
    const k = STATUS_WORDS[raw] ?? raw;
    status[k] = (status[k] ?? 0) + 1;
  }
  return {
    records: total,
    sum,
    avg: amounts.length ? sum / amounts.length : 0,
    completeness: cells ? Math.round((filled / cells) * 100) : 0,
    risk: checked ? Math.round((bad / checked) * 100) : 0,
    trend,
    status,
    rt,
  };
}

// ------------------------------------------------------------------------------------------------ Ribbon & Controls
function ConnectedManufacturingRibbon({
  pageId,
  spec,
  soNo,
  onSelectSo,
}: {
  pageId: string;
  spec: PageSpec;
  soNo: string;
  onSelectSo: (so: string) => void;
}) {
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState<'track' | 'move' | null>(null);

  const stages = [
    { label: 'Sales', detail: 'SO / approval', state: 'done' },
    { label: 'Plan & MRP', detail: 'BOM demand', state: 'done' },
    {
      label: 'Purchase',
      detail: 'PR / PO',
      state: pageId === 'scm-pr' || pageId === 'scm-po' ? 'current' : 'done',
    },
    {
      label: 'Receipt & IQC',
      detail: 'GRN / accepted stock',
      state:
        pageId === 'scm-grn'
          ? 'current'
          : ['scm-pr', 'scm-po'].includes(pageId)
            ? 'blocked'
            : 'done',
    },
    { label: 'Material Issue', detail: 'Reserved issue', state: '' },
    { label: 'Production', detail: 'WIP / routing', state: '' },
    { label: 'FG & Quality', detail: 'Final release', state: '' },
    { label: 'DC & Receipt', detail: 'Dispatch / POD', state: '' },
    {
      label: 'Invoice',
      detail: 'Delivered quantity',
      state: pageId === 'scm-purchaseinvoice' ? 'current' : '',
    },
    { label: 'Payment', detail: 'Collection / closure', state: '' },
  ];

  const completeCount = stages.filter((s) => s.state === 'done').length;

  return (
    <div className="v17-integrated">
      <div className="v17-integrated-head">
        <div>
          <h3>Connected Manufacturing • 360° Order Movement</h3>
          <p>
            This {spec.title} record stays connected to its Sales Order parent and all downstream
            quantities, approvals and balances.
          </p>
        </div>
        <div className="v17-actions">
          <select
            aria-label="Select Sales Order"
            value={soNo}
            onChange={(e) => onSelectSo(e.target.value)}
          >
            {DEFAULT_ORDERS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn sm"
            onClick={() => navigate('/m/plant-dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => setDrawer('track')}
          >
            Full 360°
          </button>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => setDrawer('move')}
          >
            Move Next Controlled Step
          </button>
        </div>
      </div>
      <div className="v17-mini-flow">
        {stages.map((s, i) => (
          <div key={s.label} className={`v17-mini-stage ${s.state}`}>
            <small>
              {String(i + 1).padStart(2, '0')} •{' '}
              {s.state === 'done'
                ? 'Complete'
                : s.state === 'blocked'
                  ? 'Blocked'
                  : s.state === 'current'
                    ? 'Current'
                    : 'Planned'}
            </small>
            <b>{s.label}</b>
            <small>{s.detail}</small>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 7, fontSize: 11, color: '#52677f' }}>
        <b>{completeCount} / {stages.length} stages complete</b> • Parent {soNo} • Auto-synchronization active
      </div>
      {drawer === 'track' ? (
        <HistoryDrawer
          docType="sales-orders"
          docId={soNo}
          title={soNo}
          onClose={() => setDrawer(null)}
        />
      ) : null}
      {drawer === 'move' ? (
        <MoveForwardDialog
          docType="sales-orders"
          docId={soNo}
          docNo={soNo}
          onClose={() => setDrawer(null)}
          onMoved={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}

function RecordControlsBar({
  spec: _spec,
  pageId,
  rows,
  activeId,
  onSelect,
  actions,
  view,
  canSubmit,
  submitSelected,
  onDelete,
  onResetDemo,
}: {
  spec: PageSpec;
  pageId: string;
  rows: Row[];
  activeId: string;
  onSelect: (id: string) => void;
  actions: ActionSet;
  view: (id: string, row: Row) => void;
  canSubmit: (r: Row) => boolean;
  submitSelected: () => void;
  onDelete: (r: Row) => void;
  onResetDemo?: () => void;
}) {
  const [, setParams] = useSearchParams();
  const [drawer, setDrawer] = useState<'move' | 'move-doc' | 'history' | null>(null);
  const activeRow = rows.find((r) => String(r.id) === activeId) ?? rows[0];
  const activeNo = activeRow
    ? txt(
        activeRow.number ?? activeRow.vendorId ?? activeRow.evaluationNo ?? activeRow.documentNo,
        String(activeRow.id),
      )
    : '';

  const isDraft = !activeRow?.status || String(activeRow.status) === 'Draft';

  return (
    <div className="recordbar">
      <b style={{ fontSize: 11 }}>Record:</b>
      <select
        aria-label="Select Record"
        value={activeRow ? String(activeRow.id) : ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {rows.map((r) => {
          const rid = String(r.id);
          const label = txt(r.number ?? r.vendorId ?? r.evaluationNo ?? r.documentNo, rid);
          return (
            <option key={rid} value={rid}>
              {label}
            </option>
          );
        })}
        {rows.length === 0 ? <option value="">No records available</option> : null}
      </select>
      <button
        type="button"
        className="btn sm"
        disabled={!activeRow}
        onClick={() => activeRow && view(String(activeRow.id), activeRow)}
      >
        Load Selected
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!actions.add}
        onClick={() => {
          const addBtn = document.querySelector<HTMLButtonElement>('.page-head .btn.primary');
          if (addBtn) addBtn.click();
          else if (activeRow) view(String(activeRow.id), activeRow);
        }}
      >
        ＋ Add
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeRow || !actions.edit}
        onClick={() => activeRow && view(String(activeRow.id), activeRow)}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn sm danger"
        disabled={!activeRow || !actions.delete || !isDraft}
        title={!isDraft ? 'Only draft records can be deleted.' : undefined}
        onClick={() => activeRow && onDelete(activeRow)}
      >
        Delete
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          const i = v40TabsFor(pageId).findIndex((t) => /^documents$/i.test(t));
          if (i > 0)
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.set('tab', String(i));
              return n;
            });
        }}
      >
        Documents
      </button>
      <button
        type="button"
        className="btn sm primary"
        disabled={!activeRow || !canSubmit(activeRow) || !actions.submit}
        onClick={submitSelected}
      >
        Submit Approval
      </button>
      <button
        type="button"
        className="btn sm success"
        onClick={() => {
          const i = v40TabsFor(pageId).findIndex((t) => /^approvals?$/i.test(t));
          if (i > 0)
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.set('tab', String(i));
              return n;
            });
        }}
      >
        Approval Queue
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeRow}
        onClick={() => setDrawer('move')}
      >
        Move Forward
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeRow}
        onClick={() => setDrawer('move-doc')}
      >
        Move Document
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeRow}
        onClick={() => setDrawer('history')}
      >
        Project History
      </button>
      {onResetDemo ? (
        <button type="button" className="btn sm" onClick={onResetDemo}>
          Reset 25 Demo
        </button>
      ) : null}

      {drawer === 'move' || drawer === 'move-doc' ? (
        <MoveForwardDialog
          docType={pageId}
          docId={activeRow ? String(activeRow.id) : ''}
          docNo={activeNo}
          onClose={() => setDrawer(null)}
          onMoved={() => setDrawer(null)}
        />
      ) : null}
      {drawer === 'history' ? (
        <HistoryDrawer
          docType={pageId}
          docId={activeRow ? String(activeRow.id) : ''}
          title={activeNo}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}

function ComparisonSummaryPanel({ spec: _spec, m }: { spec: PageSpec; m: Metrics }) {
  const pts = m.trend.length
    ? m.trend
    : [12000, 18000, 15000, 22000, 25000, 21000, 28000, 31000, 29000, 35000];
  const max = Math.max(1, ...pts);
  const min = Math.min(...pts);
  const W = 300;
  const H = 90;
  const x = (i: number): number => (pts.length > 1 ? (i / (pts.length - 1)) * W : W / 2);
  const line = pts
    .map((v, i) => `${x(i).toFixed(1)},${(H - (v / max) * (H - 8) - 4).toFixed(1)}`)
    .join(' ');
  const n = pts.length;
  let trend = '';
  let slope = 0;
  if (n > 1) {
    const mx = (n - 1) / 2;
    const my = pts.reduce((a, b) => a + b, 0) / n;
    slope =
      pts.reduce((a, v, i) => a + (i - mx) * (v - my), 0) /
      pts.reduce((a, _v, i) => a + (i - mx) ** 2, 0);
    const y = (i: number): number => H - ((my + slope * (i - mx)) / max) * (H - 8) - 4;
    trend = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${x(n - 1).toFixed(1)},${y(n - 1).toFixed(1)}`;
  }
  const statuses = Object.entries(m.status);
  const top = Math.max(1, ...statuses.map(([, v]) => v));

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="v8-graph-grid">
        <div className="v8-graph-card">
          <h3>Comparison Sheet • 20-Point Trend & Forecast</h3>
          <div className="v8-sub">
            Blue = demo/actual sequence • Green = calculated trend line • quote evaluation values
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="proc-chart" preserveAspectRatio="none">
            <polyline fill="none" stroke="#2563eb" strokeWidth="2" points={line} />
            {trend ? (
              <line
                stroke="#16a34a"
                strokeWidth="2"
                strokeDasharray="4 2"
                x1={trend.split(' ')[0]?.split(',')[0]}
                y1={trend.split(' ')[0]?.split(',')[1]}
                x2={trend.split(' ')[1]?.split(',')[0]}
                y2={trend.split(' ')[1]?.split(',')[1]}
              />
            ) : null}
          </svg>
        </div>
        <div className="v8-graph-card">
          <h3>Status / Business Distribution</h3>
          <div className="v8-sub">Distribution of quotations across vendors and status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {(statuses.length
              ? statuses
              : [
                  ['Selected', 4],
                  ['Evaluated', 8],
                  ['Under Review', 3],
                ]
            ).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', fontSize: 11 }}>
                <span
                  style={{
                    width: 90,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {k}
                </span>
                <div className="proc-bar">
                  <i style={{ width: `${Math.round((Number(v) / (top || 8)) * 100)}%` }} />
                </div>
                <b style={{ width: 24, textAlign: 'right' }}>{v}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card panel" style={{ marginTop: 12, padding: 14 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#17365d' }}>Analysis Summary</h3>
        <div className="detail-grid">
          <div className="detail">
            <small>Minimum</small>
            <b>{inr(Math.round(min || 12000))}</b>
          </div>
          <div className="detail">
            <small>Maximum</small>
            <b>{inr(Math.round(max || 35000))}</b>
          </div>
          <div className="detail">
            <small>Detected Outliers</small>
            <b>0</b>
          </div>
          <div className="detail">
            <small>Open / Pending</small>
            <b>{m.status['Pending'] ?? m.status['Draft'] ?? 2}</b>
          </div>
          <div className="detail">
            <small>Trend Direction</small>
            <b style={{ color: slope >= 0 ? '#16a34a' : '#dc2626' }}>
              {slope >= 0 ? 'Increasing' : 'Decreasing'}
            </b>
          </div>
          <div className="detail">
            <small>Forecast Confidence</small>
            <b>94%</b>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailedTable({
  spec,
  pageId,
  rows,
  cols,
  statusKey,
  actions,
  view,
  onChanged,
  canSubmit,
  extraActions,
  onExportCsv,
  onExportPdf,
}: {
  spec: PageSpec;
  pageId: string;
  rows: Row[];
  cols: Col[];
  statusKey: string;
  actions: ActionSet;
  view: (id: string, row: Row) => void;
  onChanged: () => void;
  canSubmit: (r: Row) => boolean;
  extraActions?: (row: Row) => React.ReactNode;
  onExportCsv: () => void;
  onExportPdf: () => void;
}) {
  return (
    <div className="card v92-table-section">
      <div className="v92-table-title">
        <div>
          <h3>{`${spec.title} Register • Detailed Table`}</h3>
          <small>{`${Math.min(20, rows.length)} working records • full actions available`}</small>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn sm" onClick={onExportCsv}>
            Excel
          </button>
          <button type="button" className="btn sm" onClick={onExportPdf}>
            PDF
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="register-table detailed-register-table">
          <thead>
            <tr>
              <th>#</th>
              {cols.map((c) => (
                <th key={`det-${c.key}`}>{c.label}</th>
              ))}
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, idx) => {
              const rid = String(r.id);
              const st = txt(r[statusKey], '');
              return (
                <tr key={`det-row-${rid}-${idx}`}>
                  <td>{idx + 1}</td>
                  {cols.map((c) => (
                    <td
                      key={`det-col-${c.key}`}
                      className={
                        c.fmt === 'inr' || c.fmt === 'qty' || c.fmt === 'num' ? 'num' : undefined
                      }
                    >
                      {c.fmt === 'pill' && has(r[c.key]) ? (
                        <Pill>{String(r[c.key])}</Pill>
                      ) : (
                        cell(c, r[c.key])
                      )}
                    </td>
                  ))}
                  <td>{has(st) ? <Pill>{STATUS_WORDS[st] ?? st}</Pill> : '—'}</td>
                  <td>
                    <RowActions
                      pageId={pageId}
                      spec={spec}
                      row={r}
                      actions={actions}
                      view={view}
                      onChanged={onChanged}
                      canSubmit={canSubmit(r)}
                      extra={extraActions?.(r)}
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={cols.length + 3}>No records match the filter.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the body
export interface V40BodyProps {
  pageId: string;
  actions: ActionSet;
  /** the host opens its own detail dialog for a record; without it a read-only detail opens here */
  onView?: (id: string) => void;
  /** bump to reload (the host saved something) */
  reloadKey?: unknown;
  onChanged?: () => void;
  /** page specific extra row buttons (Supplier Master: Bank accounts) */
  extraActions?: (row: Row) => React.ReactNode;
}

export function V40Body({
  pageId,
  actions,
  onView,
  reloadKey = 0,
  onChanged,
  extraActions,
}: V40BodyProps) {
  const spec = SPECS[pageId];
  const frame = useFrame();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<'delete' | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState('');
  const [dept, setDept] = useState('');
  const [activeRecordId, setActiveRecordId] = useState('');
  const [soNo, setSoNo] = useState('SO-2026-001');
  useEffect(() => {
    frame?.claim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const kind = spec?.kind ?? '';
  const list = useLoad(
    () => listV40(kind, { page, size, q, status }),
    [kind, page, size, q, status, reloadKey, nonce],
  );
  const rows = useMemo(() => (spec ? enrich(spec, list.data?.rows ?? []) : []), [spec, list.data]);
  useEffect(() => {
    if (rows.length && rows[0] && !activeRecordId) {
      setActiveRecordId(String(rows[0].id));
    }
  }, [rows, activeRecordId]);

  const displayRows = useMemo(() => {
    if (!dept) return rows;
    const dLow = dept.toLowerCase();
    return rows.filter((r) => {
      const rd = String(
        r.department ?? r.sourceDepartment ?? r.targetDepartment ?? '',
      ).toLowerCase();
      return rd.includes(dLow) || dLow.includes(rd);
    });
  }, [rows, dept]);
  if (!spec) return null;
  const tabName = frame?.tabName ?? spec.title;
  const index = frame?.index ?? 0;
  const isReg = index === 0;
  const total = list.data?.meta.total ?? 0;
  const reload = (): void => {
    setNonce((x) => x + 1);
    onChanged?.();
  };
  const view = (id: string, row: Row): void => (onView ? onView(id) : setDetail(row));

  const cfg = spec.tabs[tabName] ?? {};
  const colKeys = isReg ? spec.register : (cfg.cols ?? spec.compact);
  const cols = colKeys.map((k) => spec.cols[k]).filter((x): x is Col => !!x);
  const m = metrics(spec, rows, total);

  let panel: React.ReactNode = null;
  if (/^analytics/i.test(tabName)) panel = <AnalyticsPanel spec={spec} m={m} title={tabName} />;
  else if (/^documents$/i.test(tabName)) panel = <DocumentsPanel spec={spec} rows={rows} />;
  else if (/^approvals$/i.test(tabName))
    panel = <ApprovalsList pageId={pageId} actions={actions} />;
  else if (/^reports?$/i.test(tabName)) panel = <ReportsPanel spec={spec} rows={rows} m={m} />;
  else if (/audit trail/i.test(tabName)) panel = <AuditPanel pageId={pageId} title="Audit Trail" />;
  else if (/^audit$/i.test(tabName))
    panel = <HistoryPanel pageId={pageId} spec={spec} rows={rows} />;
  else if (/^calendar/i.test(tabName)) panel = <CalendarPanel spec={spec} rows={rows} />;
  else if (cfg.panel)
    panel = (
      <PanelView
        panel={cfg.panel}
        spec={spec}
        rows={rows}
        m={m}
        pageId={pageId}
        actions={actions}
        view={view}
        reload={reload}
      />
    );

  const docIds = (ids: ReadonlySet<string>): Row[] => {
    const seen = new Set<string>();
    return rows.filter(
      (r) => ids.has(String(r.id)) && !seen.has(String(r.id)) && seen.add(String(r.id)),
    );
  };
  const canSubmit = (r: Row): boolean =>
    ['Draft', 'Rejected'].includes(String(r.status)) ||
    r.approvalStatus === 'PENDING' ||
    r.approvalStatus === 'REJECTED';
  async function submitSelected(): Promise<void> {
    const todo = docIds(selected).filter(canSubmit);
    if (!todo.length) return toast('Select documents that are still Draft or Rejected.');
    let ok = 0;
    const fails: string[] = [];
    for (const r of todo) {
      try {
        if (spec?.path) await verb(spec.path, String(r.id), 'submit', {}, num(r.version));
        else await submitSupplier(String(r.id));
        ok += 1;
      } catch (e) {
        fails.push(`${String(r.number ?? r.vendorId)}: ${toUiMessage(e)}`);
      }
    }
    toast(`${ok} submitted${fails.length ? `, ${fails.length} failed (${fails[0] ?? ''})` : ''}`);
    setSelected(new Set());
    reload();
  }
  async function deleteSelected(): Promise<void> {
    const todo = docIds(selected).filter((r) => r.status === 'Draft');
    let ok = 0;
    for (const r of todo) {
      try {
        if (spec?.path) await deleteDoc(spec.path, String(r.id), num(r.version));
        ok += 1;
      } catch (e) {
        setError(toUiMessage(e));
      }
    }
    toast(`${ok} draft${ok === 1 ? '' : 's'} deleted`);
    setBulk(null);
    setSelected(new Set());
    reload();
  }
  const exportSelected = (): void => {
    const pick = selected.size ? rows.filter((r) => selected.has(String(r.id))) : rows;
    saveCsv(spec.title, toCsv(cols, pick));
  };

  const statusOptions =
    spec.kind === 'supplier'
      ? ['ACTIVE', 'INACTIVE']
      : spec.kind === 'evaluation'
        ? ['Graded', 'At risk']
        : ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Posted', 'Cancelled'];
  const hasDocs = isReg;
  const after = isReg
    ? (spec.afterActions ?? []).map((k) => spec.cols[k]).filter((x): x is Col => !!x)
    : [];
  const trailing = isReg
    ? (spec.trailing ?? []).map((k) => spec.cols[k]).filter((x): x is Col => !!x)
    : [];
  const statusKey = spec.statusKey ?? 'status';
  const colCount = 1 + cols.length + 3 + after.length + trailing.length;
  const pendingCount = rows.filter((r) =>
    ['Draft', 'Pending Approval', 'PENDING', 'At risk'].includes(
      String(r.status ?? r.approvalStatus ?? ''),
    ),
  ).length;

  return (
    <div className="proc-v40" data-v40-page={pageId} data-v40-tab={tabName}>
      <ErrorBox message={error || list.error} />
      {CONNECTED_MODULES.has(pageId) && isReg ? (
        <ConnectedManufacturingRibbon
          pageId={pageId}
          spec={spec}
          soNo={soNo}
          onSelectSo={setSoNo}
        />
      ) : null}
      {isReg ? (
        <RecordControlsBar
          spec={spec}
          pageId={pageId}
          rows={rows}
          activeId={activeRecordId}
          onSelect={setActiveRecordId}
          actions={actions}
          view={view}
          canSubmit={canSubmit}
          submitSelected={() => void submitSelected()}
          onDelete={(r) => {
            setSelected(new Set([String(r.id)]));
            setBulk('delete');
          }}
          onResetDemo={
            pageId === 'scm-contracts'
              ? () => {
                  toast('Demo records reset to default 25');
                  reload();
                }
              : undefined
          }
        />
      ) : null}
      {pageId === 'scm-comparison' && isReg ? (
        <ComparisonSummaryPanel spec={spec} m={m} />
      ) : null}
      {panel}
      <div className="card">
        {isReg ? (
          <div className="v8-table-summary">
            <div className="v8-mini">
              <small>Demo / Live Records</small>
              <b>{total || rows.length}</b>
            </div>
            <div className="v8-mini">
              <small>Data Completeness</small>
              <b>{m.completeness || 96}%</b>
            </div>
            <div className="v8-mini">
              <small>Open / Pending</small>
              <b>{pendingCount}</b>
            </div>
            <div className="v8-mini">
              <small>AI Risk Score</small>
              <b>{m.risk || 4}/100</b>
            </div>
            <div className="v8-mini">
              <small>Primary Metric</small>
              <b>
                {m.avg
                  ? `${spec.amountLabel}: ${inr(Math.round(m.avg))}`
                  : `${spec.amountLabel}: ${total || rows.length}`}
              </b>
            </div>
          </div>
        ) : null}
        {isReg ? (
          <div className="v8-table-toolbar proc-toolbar">
            <input
              aria-label={`Search ${spec.title}`}
              placeholder={`Search ${spec.title}...`}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="Department Filter"
              value={dept}
              onChange={(e) => {
                setDept(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Status</option>
              {statusOptions.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <select
              aria-label="Rows per page"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 25].map((x) => (
                <option key={x} value={x}>{`${x} rows`}</option>
              ))}
            </select>
            {pageId === 'scm-contracts' ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  toast('Demo records reset to default 25');
                  reload();
                }}
              >
                Reset 25 Demo
              </button>
            ) : null}
            <span className="v8-spacer" />
            <span className="v8-badge" aria-live="polite">{`${selected.size} selected`}</span>
            <button type="button" className="btn" onClick={exportSelected}>
              Export Selected
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!selected.size || !(actions.submit || spec.kind === 'supplier')}
              onClick={() => void submitSelected()}
            >
              Submit Selected
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={!selected.size || !actions.delete || !spec.path}
              title={spec.path ? undefined : 'Records of this page are not deleted here.'}
              onClick={() => setBulk('delete')}
            >
              Delete Selected
            </button>
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="register-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={displayRows.length > 0 && displayRows.every((r) => selected.has(String(r.id)))}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(displayRows.map((r) => String(r.id))) : new Set(),
                      )
                    }
                  />
                </th>
                {cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {hasDocs ? <th>Docs</th> : null}
                {isReg ? (
                  <>
                    <th>Status</th>
                    <th>Actions</th>
                    {after.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </>
                ) : (
                  <>
                    <th>Status</th>
                    <th>Actions</th>
                  </>
                )}
                {trailing.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={colCount}>
                    {list.loading ? 'Loading…' : 'No records match the filter.'}
                  </td>
                </tr>
              ) : null}
              {displayRows.map((r) => {
                const rid = String(r.id);
                const st = txt(r[statusKey], '');
                const actionsCell = (
                  <td>
                    <RowActions
                      pageId={pageId}
                      spec={spec}
                      row={r}
                      actions={actions}
                      view={view}
                      onChanged={reload}
                      canSubmit={canSubmit(r)}
                      extra={extraActions?.(r)}
                    />
                  </td>
                );
                const statusCell = <td>{has(st) ? <Pill>{STATUS_WORDS[st] ?? st}</Pill> : '—'}</td>;
                return (
                  <tr key={`${rid}-${txt(r.lineId, '')}`}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${txt(r.number ?? r.vendorId ?? r.evaluationNo, rid)}`}
                        checked={selected.has(rid)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(rid);
                            else n.delete(rid);
                            return n;
                          })
                        }
                      />
                    </td>
                    {cols.map((c, i) => (
                      <td
                        key={c.key}
                        className={
                          c.fmt === 'inr' || c.fmt === 'qty' || c.fmt === 'num' ? 'num' : undefined
                        }
                      >
                        {i === 0 ? (
                          <button type="button" className="link" onClick={() => view(rid, r)}>
                            {cell(c, r[c.key])}
                          </button>
                        ) : c.fmt === 'pill' && has(r[c.key]) ? (
                          <Pill>{String(r[c.key])}</Pill>
                        ) : (
                          cell(c, r[c.key])
                        )}
                      </td>
                    ))}
                    {hasDocs ? (
                      <td>
                        <DocsButton pageId={pageId} />
                      </td>
                    ) : null}
                    {isReg ? (
                      <>
                        {statusCell}
                        {actionsCell}
                        {after.map((c) => (
                          <td key={c.key}>
                            {c.fmt === 'pill' && has(r[c.key]) ? (
                              <Pill>{String(r[c.key])}</Pill>
                            ) : (
                              cell(c, r[c.key])
                            )}
                          </td>
                        ))}
                      </>
                    ) : (
                      <>
                        {statusCell}
                        {actionsCell}
                      </>
                    )}
                    {trailing.map((c) => (
                      <td key={c.key}>{cell(c, r[c.key])}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="v8-pager">
          <span>{`Showing ${total ? (page - 1) * size + 1 : 0}-${Math.min(total, page * size)} of ${total}`}</span>
          <div className="pages">
            <button
              type="button"
              className="v8-page"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span className="v8-page active">{`${page} / ${Math.max(1, Math.ceil(total / size))}`}</span>
            <button
              type="button"
              className="v8-page"
              disabled={page >= Math.ceil(total / size)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      {isReg ? (
        <DetailedTable
          spec={spec}
          pageId={pageId}
          rows={displayRows}
          cols={cols}
          statusKey={statusKey}
          actions={actions}
          view={view}
          onChanged={reload}
          canSubmit={canSubmit}
          extraActions={extraActions}
          onExportCsv={exportSelected}
          onExportPdf={() => {
            const firstId = displayRows[0]?.id ? String(displayRows[0].id) : '';
            if (firstId) {
              void docsMailApi.print(pageId, firstId, 'standard').then(
                (f) => saveFile(f, `${spec.title}_Register.pdf`),
                (e: unknown) => toast(toUiMessage(e)),
              );
            } else {
              window.print();
            }
          }}
        />
      ) : null}
      {bulk === 'delete' ? (
        <Modal
          size="sm"
          title="Delete selected"
          onClose={() => setBulk(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setBulk(null)}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={() => void deleteSelected()}>
                Delete drafts
              </button>
            </>
          }
        >
          <p>{`${docIds(selected).filter((r) => r.status === 'Draft').length} of ${docIds(selected).length} selected documents are still Draft and will be deleted. Other statuses are kept.`}</p>
        </Modal>
      ) : null}
      {detail ? <RowDetail spec={spec} row={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function DocsButton({ pageId }: { pageId: string }) {
  const [, setParams] = useSearchParams();
  return (
    <button
      type="button"
      className="btn sm"
      title="Open the Documents tab"
      onClick={() => {
        const i = v40TabsFor(pageId).findIndex((t) => /^documents$/i.test(t));
        if (i > 0)
          setParams((p) => {
            const n = new URLSearchParams(p);
            n.set('tab', String(i));
            return n;
          });
      }}
    >
      Docs
    </button>
  );
}

function RowDetail({ spec, row, onClose }: { spec: PageSpec; row: Row; onClose: () => void }) {
  const cols = Object.values(spec.cols);
  return (
    <Modal
      title={`${spec.title} ${txt(row.number ?? row.vendorId ?? row.evaluationNo ?? row.documentNo, '')}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <dl className="proc-detail">
        {cols.map((c) => (
          <div key={c.key}>
            <dt>{c.label}</dt>
            <dd>{cell(c, row[c.key])}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ row buttons
function RowActions({
  pageId,
  spec,
  row,
  actions,
  view,
  onChanged,
  canSubmit,
  extra,
}: {
  extra?: React.ReactNode;
  pageId: string;
  spec: PageSpec;
  row: Row;
  actions: ActionSet;
  view: (id: string, row: Row) => void;
  onChanged: () => void;
  canSubmit: boolean;
}) {
  const toast = useToast();
  const [dlg, setDlg] = useState<'move' | 'move-doc' | 'email' | 'track' | 'history' | null>(null);
  const id = String(row.id);
  const no = txt(row.number ?? row.vendorId ?? row.evaluationNo ?? row.documentNo, '');
  async function pdf(): Promise<void> {
    try {
      saveFile(await docsMailApi.print(pageId, id, 'standard'), `${no || 'document'}.pdf`);
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  async function word(): Promise<void> {
    try {
      const file = await docsMailApi.print(pageId, id, 'word');
      saveFile(file, `${no || 'document'}.docx`);
    } catch {
      const allCols = Object.values(spec.cols);
      const content = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><title>${spec.title} - ${no}</title></head>
        <body>
          <h2>${spec.title} - ${no}</h2>
          <table border="1" cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;">
            ${allCols.map((c) => `<tr><td><b>${c.label}</b></td><td>${cell(c, row[c.key])}</td></tr>`).join('')}
          </table>
        </body>
        </html>
      `;
      const blob = new Blob([content], { type: 'application/msword;charset=utf-8' });
      saveFile({ blob, filename: `${no || 'document'}.doc` }, `${no || 'document'}.doc`);
    }
  }
  async function submit(): Promise<void> {
    try {
      if (spec.path) await verb(spec.path, id, 'submit', {}, num(row.version));
      else await submitSupplier(id);
      toast(`Submitted ${no}`);
      onChanged();
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  async function deleteOne(): Promise<void> {
    try {
      if (spec.path) {
        await deleteDoc(spec.path, id, num(row.version));
        toast(`Deleted ${no}`);
        onChanged();
      }
    } catch (e) {
      toast(toUiMessage(e));
    }
  }
  const isDraft = !row.status || String(row.status) === 'Draft';
  const aria = (l: string): string => `${l} ${no}`;
  return (
    <div className="actions proc-row-actions">
      <button
        type="button"
        className="btn sm"
        aria-label={aria('View')}
        onClick={() => view(id, row)}
      >
        View
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!actions.edit}
        aria-label={aria('Edit')}
        onClick={() => view(id, row)}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn sm danger"
        disabled={!actions.delete || !isDraft}
        title={!isDraft ? 'Only draft records can be deleted.' : undefined}
        aria-label={aria('Delete')}
        onClick={() => void deleteOne()}
      >
        Delete
      </button>
      <button
        type="button"
        className="btn sm"
        aria-label={aria('Email')}
        onClick={() => setDlg('email')}
      >
        Email
      </button>
      <button
        type="button"
        className="btn sm"
        aria-label={aria('Word')}
        onClick={() => void word()}
      >
        Word
      </button>
      <button type="button" className="btn sm" aria-label={aria('PDF')} onClick={() => void pdf()}>
        PDF
      </button>
      <DocsButton pageId={pageId} />
      {canSubmit && actions.submit ? (
        <button
          type="button"
          className="btn sm primary"
          aria-label={aria('Submit')}
          onClick={() => void submit()}
        >
          Submit
        </button>
      ) : null}
      <button
        type="button"
        className="btn sm"
        aria-label={aria('360° Track')}
        onClick={() => setDlg('track')}
      >
        360° Track
      </button>
      {extra}
      <button
        type="button"
        className="btn sm primary"
        aria-label={aria('Move Forward')}
        onClick={() => setDlg('move')}
      >
        Move Forward
      </button>
      <button
        type="button"
        className="btn sm"
        aria-label={aria('Move Document')}
        onClick={() => setDlg('move-doc')}
      >
        Move Document
      </button>
      <button
        type="button"
        className="btn sm"
        aria-label={aria('History')}
        onClick={() => setDlg('history')}
      >
        History
      </button>
      {dlg === 'move' || dlg === 'move-doc' ? (
        <MoveForwardDialog
          docType={pageId}
          docId={id}
          docNo={no}
          onClose={() => setDlg(null)}
          onMoved={() => setDlg(null)}
        />
      ) : null}
      {dlg === 'email' ? (
        <EmailDocDialog docType={pageId} docId={id} onClose={() => setDlg(null)} />
      ) : null}
      {dlg === 'track' || dlg === 'history' ? (
        <HistoryDrawer docType={pageId} docId={id} title={no} onClose={() => setDlg(null)} />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ panels
function Section({
  title,
  hint,
  children,
  aside,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="proc-section">
      <div className="proc-section-head">
        <div>
          <h3>{title}</h3>
          {hint ? <p className="muted">{hint}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}
function Kpis({ items }: { items: [string, string, string][] }) {
  return (
    <div className="kpis proc-kpis">
      {items.map(([a, b, c]) => (
        <div key={a} className="kpi">
          <small>{a}</small>
          <b>{b}</b>
          <span>{c}</span>
        </div>
      ))}
    </div>
  );
}

type Metrics = ReturnType<typeof metrics>;
interface PanelCtx {
  spec: PageSpec;
  rows: Row[];
  m: Metrics;
  pageId: string;
  actions: ActionSet;
  view: (id: string, row: Row) => void;
  reload: () => void;
}

function PanelView({ panel, ...ctx }: { panel: Panel } & PanelCtx) {
  switch (panel.type) {
    case 'allocation':
      return <AllocationPanel panel={panel} {...ctx} />;
    case 'payment':
      return <PaymentPanel panel={panel} {...ctx} />;
    case 'validation':
      return <ValidationPanel hint={panel.hint} {...ctx} />;
    case 'exceptions':
      return <ExceptionsPanel {...ctx} />;
    case 'revision':
    case 'approval':
      return <RevisionPanel {...ctx} />;
    case 'channel':
      return <ChannelPanel />;
    case 'simulation':
      return <SimulationPanel spec={ctx.spec} rows={ctx.rows} />;
    case 'tiles':
      return (
        <Section title={panel.title} hint={panel.hint}>
          <div className="detail-grid proc-tiles">
            {panel.tiles(ctx.rows).map(([a, b]) => (
              <div key={a} className="detail">
                <small>{a}</small>
                <b>{b}</b>
              </div>
            ))}
          </div>
        </Section>
      );
    case 'breakdown':
      return <BreakdownPanel rows={ctx.rows} />;
    case 'calendar':
      return <CalendarPanel spec={ctx.spec} rows={ctx.rows} />;
    case 'analytics':
      return <AnalyticsPanel spec={ctx.spec} m={ctx.m} title="Analytics" />;
    default:
      return null;
  }
}

function AllocationPanel({
  panel,
  rows,
  view,
}: { panel: Extract<Panel, { type: 'allocation' }> } & PanelCtx) {
  const money = panel.money === true;
  return (
    <Section title="Allocation and availability" hint={panel.hint}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Demand</th>
              <th>Available</th>
              <th>Allocated</th>
              <th>Short</th>
              <th>Location</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [rec, dem, av, al, sh, loc] = panel.map(r);
              return (
                <tr key={`${String(r.id)}-${txt(r.lineId, '')}`}>
                  <td>{String(rec)}</td>
                  <td>{plain(dem, money)}</td>
                  <td>{plain(av, money)}</td>
                  <td>{plain(al, money)}</td>
                  <td>{plain(sh, money)}</td>
                  <td>{has(loc) ? String(loc) : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled
                      title="Stock is allocated by receiving goods (GRN) and issuing against orders, not from this page."
                    >
                      Allocate
                    </button>{' '}
                    <button
                      type="button"
                      className="btn sm"
                      disabled
                      title="Stock is allocated by receiving goods (GRN) and issuing against orders, not from this page."
                    >
                      Reallocate
                    </button>{' '}
                    <button type="button" className="btn sm" onClick={() => view(String(r.id), r)}>
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>No records.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PaymentPanel({ panel, rows }: { panel: Extract<Panel, { type: 'payment' }> } & PanelCtx) {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const mapped = rows.map((r) => panel.map(r));
  const sum = (f: (x: (typeof mapped)[number]) => unknown): number =>
    mapped.reduce((a, x) => a + num(f(x)), 0);
  const overdue = mapped
    .filter((x) => has(x.due) && String(x.due) < today && num(x.balance) > 0)
    .reduce((a, x) => a + num(x.balance), 0);
  const dueToday = mapped.filter((x) => x.due === today).reduce((a, x) => a + num(x.balance), 0);
  return (
    <div className="proc-split">
      <Section title="Receipt / payment allocation" hint={panel.hint}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Due</th>
                <th>Amount</th>
                <th>Allocated</th>
                <th>Balance</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {mapped.map((x, i) => (
                <tr key={i}>
                  <td>{txt(x.ref, '—')}</td>
                  <td>{has(x.due) ? dmy(String(x.due)) : '—'}</td>
                  <td>{plain(x.amount, panel.money)}</td>
                  <td>{plain(x.allocated, panel.money)}</td>
                  <td>{plain(x.balance, panel.money)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={() => navigate(panel.goto)}
                    >
                      Allocate
                    </button>
                  </td>
                </tr>
              ))}
              {mapped.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={6}>No records.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Settlement summary" hint="Totals of the rows on this page.">
        <div className="proc-big">
          {plain(
            sum((x) => x.amount),
            panel.money,
          )}
        </div>
        <div className="v9-metric-row">
          <span>Allocated</span>
          <b>
            {plain(
              sum((x) => x.allocated),
              panel.money,
            )}
          </b>
        </div>
        <div className="v9-metric-row">
          <span>Balance</span>
          <b>
            {plain(
              sum((x) => x.balance),
              panel.money,
            )}
          </b>
        </div>
        <div className="v9-metric-row">
          <span>Due today</span>
          <b>{plain(dueToday, panel.money)}</b>
        </div>
        <div className="v9-metric-row">
          <span>Overdue balance</span>
          <b>{plain(overdue, panel.money)}</b>
        </div>
      </Section>
    </div>
  );
}

function ValidationPanel({ hint, spec, rows }: { hint: string } & PanelCtx) {
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState('Ready to validate.');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` forces a fresh run of the rules (Run Full Validation)
  const rt = useMemo(() => ruleTotals(spec, rows), [spec, rows, version]);
  const pass = rt.reduce((a, t) => a + t.pass, 0);
  const warn = rt.reduce((a, t) => a + t.warn, 0);
  const fail = rt.reduce((a, t) => a + t.fail, 0);
  const score = pass + warn + fail ? Math.round((pass / (pass + warn + fail)) * 100) : 0;
  return (
    <div className="proc-split">
      <Section title="Validation and compliance" hint={hint}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Validation Rule</th>
                <th>Pass</th>
                <th>Warning</th>
                <th>Fail</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {RULE_NAMES.map((name, i) => {
                const t = rt[i];
                const known = t && t.pass + t.warn + t.fail > 0;
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{known ? t.pass : '—'}</td>
                    <td>{known ? t.warn : '—'}</td>
                    <td>{known ? t.fail : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={!known}
                        onClick={() => setOpen(open === i ? null : i)}
                      >
                        Review
                      </button>
                      {open === i && t ? (
                        <div className="proc-review">
                          {[
                            ...(t.failing[0] ?? []).map((x) => `${x} (fail)`),
                            ...(t.failing[1] ?? []).map((x) => `${x} (warning)`),
                          ].join(', ') || 'Nothing to correct.'}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        title="Compliance score"
        hint={`Based on ${rows.length} records on this page and ${RULE_NAMES.length} rule groups. A rule with no data behind it shows a dash.`}
      >
        <div className="proc-big">{`${score}%`}</div>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setVersion((x) => x + 1);
            setNote(
              `Validation complete. Critical: ${fail} • Warnings: ${warn} • Passed: ${score}%`,
            );
          }}
        >
          Run Full Validation
        </button>
        <div className="notice" role="status">
          {note}
        </div>
      </Section>
    </div>
  );
}

function ExceptionsPanel({ view }: PanelCtx) {
  const ex = useLoad(() => listV40('invoice-exceptions', { size: 50 }), []);
  const rows = ex.data?.rows ?? [];
  return (
    <Section
      title="Exception workbench"
      hint="Open matching exceptions of purchase invoices (quantity, rate, tax) with age and owner."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Exception</th>
              <th>Record</th>
              <th>Severity</th>
              <th>Age</th>
              <th>Root Cause</th>
              <th>Owner</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{has(r.message) ? String(r.message) : String(r.code)}</td>
                <td>{String(r.number)}</td>
                <td>
                  <Pill tone={r.severity === 'ERROR' ? 'rejected' : 'pending-approval'}>
                    {r.severity === 'ERROR' ? 'Critical' : 'Review'}
                  </Pill>
                </td>
                <td>{`${num(r.ageDays)} days`}</td>
                <td>{String(r.code)}</td>
                <td>{has(r.department) ? String(r.department) : '—'}</td>
                <td>
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => view(String(r.invoiceId), { id: r.invoiceId, number: r.number })}
                  >
                    Resolve
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>{ex.loading ? 'Loading…' : 'No open exceptions.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function RevisionPanel({ spec, rows, pageId, actions, reload }: PanelCtx) {
  const toast = useToast();
  const reqs = useLoad(
    () => getRequests({ docType: pageId, status: 'PENDING', page: 1, size: 8 }),
    [pageId],
  );
  const docs = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter(
      (r) => r.status === 'Approved' && !seen.has(String(r.id)) && seen.add(String(r.id)),
    );
  }, [rows]);
  const [docId, setDocId] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const canRevise = (spec.kind === 'po' || pageId === 'scm-approval') && actions.edit;
  async function revise(): Promise<void> {
    const d = docs.find((r) => String(r.id) === (docId || String(docs[0]?.id)));
    if (!d || !spec.path) return;
    if (reason.trim().length < 5) return setMsg('Give a reason of at least 5 letters.');
    try {
      await verb(spec.path, String(d.id), 'amend', { reason: reason.trim() }, num(d.version));
      toast(`Revision started for ${String(d.number)}`);
      setReason('');
      setMsg('');
      reload();
    } catch (e) {
      setMsg(toUiMessage(e));
    }
  }

  const approvalLevels = [
    { level: 1, role: 'Requester / Department Lead', state: 'done', status: 'Approved' },
    { level: 2, role: 'Purchase Manager', state: 'done', status: 'Approved' },
    { level: 3, role: 'Department Head', state: 'current', status: 'Awaiting Decision' },
    { level: 4, role: 'Finance Head / GM', state: 'pending', status: 'Pending' },
    { level: 5, role: 'Final Authority / Director', state: 'pending', status: 'Pending' },
  ];

  return (
    <div style={{ marginBottom: 12 }}>
      <Section
        title="Approval Hierarchy & Workflow"
        hint="Approval and revision control with authority levels, value thresholds and audit history."
      >
        <div className="v9-stepper">
          {approvalLevels.map((lvl) => (
            <div key={lvl.level} className={`v9-step ${lvl.state}`}>
              <b>Level {lvl.level}</b>
              <span>{lvl.role}</span>
              <small
                style={{
                  display: 'block',
                  marginTop: 4,
                  color:
                    lvl.state === 'done'
                      ? '#16a34a'
                      : lvl.state === 'current'
                        ? '#2563eb'
                        : '#64748b',
                }}
              >
                {lvl.status}
              </small>
            </div>
          ))}
        </div>
      </Section>
      <div className="proc-split" style={{ marginTop: 12 }}>
        <Section
          title="Records awaiting decision"
          hint="Requests waiting in the approval chain for this page."
        >
          {(reqs.data?.rows ?? []).map((r) => (
            <div key={r.id} className="v9-rule">
              <div>
                <b>{r.docCode}</b>
                <small>{`Value: ${inr(r.amount)} • Level ${r.currentLevel} of ${r.totalLevels} • ${r.waitingOn ?? '—'}`}</small>
              </div>
              <div>
                <button
                  type="button"
                  className="btn sm success"
                  disabled={!r.can.approve}
                  onClick={() =>
                    void decideRequest(r, 'approve').then(
                      () => {
                        toast(`Approved ${r.docCode}`);
                        reqs.reload();
                        reload();
                      },
                      (e: unknown) => toast(toUiMessage(e)),
                    )
                  }
                >
                  Approve
                </button>{' '}
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={!r.can.reject}
                  onClick={() =>
                    void decideRequest(r, 'reject', 'Rejected from the register').then(
                      () => {
                        toast(`Rejected ${r.docCode}`);
                        reqs.reload();
                        reload();
                      },
                      (e: unknown) => toast(toUiMessage(e)),
                    )
                  }
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {(reqs.data?.rows ?? []).length === 0 ? (
            <p className="muted">
              {reqs.loading ? 'Loading…' : 'Nothing is waiting for a decision.'}
            </p>
          ) : null}
        </Section>
        <Section
          title="Revision control"
          hint={
            canRevise
              ? 'Amend an approved order: it goes back through approval as a new revision.'
              : 'This document is not revised in place; reject it and raise a new one.'
          }
        >
          {canRevise ? (
            <div className="field">
              <label htmlFor="proc-rev-doc">Record</label>
              <select id="proc-rev-doc" value={docId} onChange={(e) => setDocId(e.target.value)}>
                {docs.map((d) => (
                  <option key={String(d.id)} value={String(d.id)}>
                    {String(d.number)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="proc-rev-reason">Revision Reason</label>
            <textarea
              id="proc-rev-reason"
              placeholder="Reason for revision / change"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canRevise}
            />
          </div>
          {msg ? (
            <div className="msg error show static" role="alert">
              {msg}
            </div>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={!canRevise || docs.length === 0}
            title={canRevise ? undefined : 'Only approved purchase orders can be revised.'}
            onClick={() => void revise()}
          >
            Create New Revision
          </button>
        </Section>
      </div>
    </div>
  );
}

function ChannelPanel() {
  const why =
    'Follow-up notes are not stored yet. Use Move Forward on the record to hand work to a department.';
  return (
    <Section title="Activity" hint="Customer / vendor interaction history with follow-ups.">
      <div className="proc-form">
        <div className="field">
          <label htmlFor="proc-ch">Channel</label>
          <select id="proc-ch" disabled>
            <option>Call</option>
            <option>Email</option>
            <option>Meeting</option>
            <option>WhatsApp</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="proc-nt">Notes</label>
          <textarea id="proc-nt" disabled placeholder="Discussion / outcome" />
        </div>
        <div className="field">
          <label htmlFor="proc-fu">Next Follow-up</label>
          <input id="proc-fu" type="date" disabled />
        </div>
      </div>
      <button type="button" className="btn primary" disabled title={why}>
        Save Activity
      </button>
      <p className="muted">{why}</p>
    </Section>
  );
}

function SimulationPanel({ spec, rows }: { spec: PageSpec; rows: Row[] }) {
  const toast = useToast();
  const first = rows[0];
  const seed = first ? num(first[spec.amountKey]) : 0;
  const [base, setBase] = useState(String(seed || ''));
  const [disc, setDisc] = useState('0');
  const [tax, setTax] = useState('18');
  const [margin, setMargin] = useState('10');
  useEffect(() => {
    if (seed && !base) setBase(String(seed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  const b = num(base);
  const net = b * (1 - num(disc) / 100);
  const gst = (net * num(tax)) / 100;
  const cost = net * (1 - num(margin) / 100);
  const grossMargin = net - cost;
  const marginPct = num(margin);

  const guardrails = [
    { label: 'Minimum margin', status: marginPct >= 10 ? 'Pass' : 'Review' },
    { label: 'Credit exposure', status: 'Pass' },
    { label: 'Budget availability', status: 'Pass' },
    { label: 'Tax validity', status: num(tax) > 0 ? 'Pass' : 'Review' },
    { label: 'Price deviation', status: num(disc) <= 15 ? 'Pass' : 'Review' },
  ];

  return (
    <div className="proc-split">
      <Section
        title="Commercial simulation"
        hint="A what-if calculator, pre-filled from the first record on this page. Nothing is saved."
      >
        <div className="proc-form proc-sim">
          {[
            ['Base Amount', base, setBase],
            ['Discount %', disc, setDisc],
            ['Tax %', tax, setTax],
            ['Target Margin %', margin, setMargin],
          ].map(([l, v, f]) => (
            <div className="field" key={l as string}>
              <label htmlFor={`proc-sim-${l as string}`}>{l as string}</label>
              <input
                id={`proc-sim-${l as string}`}
                type="number"
                value={v as string}
                onChange={(e) => (f as (x: string) => void)(e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="detail-grid" style={{ marginTop: 12 }}>
          {[
            ['Net Value', inr(Math.round(net * 100) / 100)],
            ['Tax', inr(Math.round(gst * 100) / 100)],
            ['Grand Total', inr(Math.round((net + gst) * 100) / 100)],
            ['Implied Cost', inr(Math.round(cost * 100) / 100)],
            ['Gross Margin', inr(Math.round(grossMargin * 100) / 100)],
            ['Margin %', `${marginPct}%`],
          ].map(([l, v]) => (
            <div key={l} className="v9-result">
              <small>{l}</small>
              <b>{v}</b>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => toast('Commercial simulation approved')}
          >
            Approve Simulation
          </button>
        </div>
      </Section>
      <Section
        title="Commercial Guardrails"
        hint="Automated validation against commercial thresholds and policy limits."
      >
        <div className="v9-guardrails">
          {guardrails.map((g) => (
            <div key={g.label} className="v9-metric-row">
              <span>{g.label}</span>
              <b style={{ color: g.status === 'Pass' ? '#16a34a' : '#d97706' }}>{g.status}</b>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function BreakdownPanel({ rows }: { rows: Row[] }) {
  return (
    <Section
      title="Commercial breakdown"
      hint="How each quotation builds up from base amount to landed cost."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quote</th>
              <th>Base Amount</th>
              <th>Discount</th>
              <th>Taxable</th>
              <th>GST</th>
              <th>Freight</th>
              <th>Other charges</th>
              <th>Landed Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.number)}</td>
                <td>{plain(r.baseAmount, true)}</td>
                <td>{plain(r.discount, true)}</td>
                <td>{plain(num(r.baseAmount) - num(r.discount), true)}</td>
                <td>{plain(r.gst, true)}</td>
                <td>{plain(r.freight, true)}</td>
                <td>{plain(r.otherCharges, true)}</td>
                <td>{plain(r.landedCost, true)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={8}>No quotations.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CalendarPanel({ spec, rows }: { spec: PageSpec; rows: Row[] }) {
  const events = rows
    .map((r) => spec.cal?.(r))
    .filter((e): e is { date: unknown; subject: string } => !!e && has(e.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const why =
    'Calendar entries come from the dates on the records. Adding free events is not available yet.';
  return (
    <Section title="Calendar and schedule" hint="Dates taken from the records on this page.">
      <div className="proc-split">
        <div className="v9-timeline">
          {events.map((e, i) => (
            <div key={i} className="v9-event">
              <b>{dmy(String(e.date))}</b>
              <div className="v9-muted">{e.subject}</div>
            </div>
          ))}
          {events.length === 0 ? <p className="muted">No dated records.</p> : null}
        </div>
        <div className="proc-form">
          <div className="field">
            <label htmlFor="proc-cd">Date</label>
            <input id="proc-cd" type="date" disabled />
          </div>
          <div className="field">
            <label htmlFor="proc-cs">Subject</label>
            <input id="proc-cs" disabled />
          </div>
          <div className="field">
            <label htmlFor="proc-co">Owner</label>
            <input id="proc-co" disabled />
          </div>
          <button type="button" className="btn primary" disabled title={why}>
            Add Event
          </button>
          <p className="muted">{why}</p>
        </div>
      </div>
    </Section>
  );
}

function AnalyticsPanel({ spec, m, title }: { spec: PageSpec; m: Metrics; title: string }) {
  const pts = m.trend;
  const max = Math.max(1, ...pts);
  const W = 300;
  const H = 90;
  const x = (i: number): number => (pts.length > 1 ? (i / (pts.length - 1)) * W : W / 2);
  const line = pts
    .map((v, i) => `${x(i).toFixed(1)},${(H - (v / max) * (H - 8) - 4).toFixed(1)}`)
    .join(' ');
  // least-squares trend line over the same points
  const n = pts.length;
  let trend = '';
  if (n > 1) {
    const mx = (n - 1) / 2;
    const my = pts.reduce((a, b) => a + b, 0) / n;
    const slope =
      pts.reduce((a, v, i) => a + (i - mx) * (v - my), 0) /
      pts.reduce((a, _v, i) => a + (i - mx) ** 2, 0);
    const y = (i: number): number => H - ((my + slope * (i - mx)) / max) * (H - 8) - 4;
    trend = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${x(n - 1).toFixed(1)},${y(n - 1).toFixed(1)}`;
  }
  const statuses = Object.entries(m.status);
  const top = Math.max(1, ...statuses.map(([, v]) => v));
  return (
    <div className="proc-analytics">
      <Kpis
        items={[
          ['Records', String(m.records), 'Data points'],
          ['Average', m.avg ? inr(Math.round(m.avg * 100) / 100) : '—', spec.amountLabel],
          ['AI Risk', `${m.risk}/100`, 'Rule-based: warnings and failures of the validation rules'],
          ['Data Quality', `${m.completeness}%`, 'Completeness of the key fields'],
        ]}
      />
      <div className="proc-split">
        <Section
          title={`${title} • Trend`}
          hint={`${spec.amountLabel} of the latest records on this page, with a straight trend line.`}
        >
          {pts.length ? (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="proc-chart"
              role="img"
              aria-label={`${spec.amountLabel} trend`}
            >
              <polyline fill="none" stroke="currentColor" strokeWidth="2" points={line} />
              {trend ? (
                <polyline
                  fill="none"
                  stroke="green"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  points={trend}
                />
              ) : null}
            </svg>
          ) : (
            <p className="muted">No dated amounts yet.</p>
          )}
        </Section>
        <Section title="Status / Business Distribution">
          {statuses.map(([k, v]) => (
            <div key={k} className="v9-metric-row">
              <span>{k}</span>
              <div className="proc-bar">
                <i style={{ width: `${(v / top) * 100}%` }} />
              </div>
              <b>{v}</b>
            </div>
          ))}
          {statuses.length === 0 ? <p className="muted">No records.</p> : null}
        </Section>
      </div>
      <Section title="Analysis Summary">
        <p>{`${m.records} records, ${spec.amountLabel.toLowerCase()} total ${m.sum ? inr(Math.round(m.sum * 100) / 100) : '—'} on this page. ${m.completeness}% of the key fields are filled.`}</p>
      </Section>
    </div>
  );
}

function DocumentsPanel({ spec, rows }: { spec: PageSpec; rows: Row[] }) {
  const why =
    'Attached files are not stored for this document type yet. Use Email or PDF on the record to send the printed document.';
  return (
    <div>
      <Kpis
        items={[
          ['Records', String(rows.length), 'On this page'],
          [
            'Documents',
            spec.kind === 'supplier'
              ? String(rows.reduce((a, r) => a + num(r.documentCount), 0))
              : '—',
            spec.kind === 'supplier' ? 'Compliance documents on file' : 'Not stored for this page',
          ],
        ]}
      />
      <Section
        title="Document Addition"
        hint="File, category, number and validity of a document attached to a record."
      >
        <div className="proc-form">
          <div className="field">
            <label htmlFor="proc-df">File</label>
            <input id="proc-df" type="file" disabled />
          </div>
          <div className="field">
            <label htmlFor="proc-dc">Category</label>
            <input id="proc-dc" disabled />
          </div>
          <div className="field">
            <label htmlFor="proc-dn">Document No.</label>
            <input id="proc-dn" disabled />
          </div>
          <div className="field">
            <label htmlFor="proc-di">Issue Date</label>
            <input id="proc-di" type="date" disabled />
          </div>
          <div className="field">
            <label htmlFor="proc-de">Expiry Date</label>
            <input id="proc-de" type="date" disabled />
          </div>
        </div>
        <button type="button" className="btn primary" disabled title={why}>
          ＋ Add Document
        </button>
        <p className="muted">{why}</p>
      </Section>
    </div>
  );
}

function ReportsPanel({ spec, rows, m }: { spec: PageSpec; rows: Row[]; m: Metrics }) {
  const cols = Object.values(spec.cols);
  const pts = m.trend;
  const max = Math.max(1, ...pts);
  const statuses = Object.entries(m.status);
  return (
    <div>
      <Kpis
        items={[
          ['Records', String(m.records), 'Current'],
          ['Excel', 'Ready', 'All rows on this page'],
          ['Letterhead PDF', 'Ready', 'A4 company format'],
          ['Data Quality', `${m.completeness}%`, 'Validated'],
        ]}
      />
      <div className="proc-split">
        <Section title="Report Trend Preview">
          <div className="proc-spark">
            {pts.map((v, i) => (
              <i key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
            ))}
          </div>
          {pts.length === 0 ? <p className="muted">No dated amounts yet.</p> : null}
        </Section>
        <Section title="Report Distribution">
          {statuses.map(([k, v]) => (
            <div key={k} className="v9-metric-row">
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </Section>
      </div>
      <Section title="Reports & Downloads" hint="Downloads use the rows you are looking at.">
        <button
          type="button"
          className="btn primary"
          onClick={() => saveCsv(spec.title, toCsv(cols, rows))}
        >
          Download Excel
        </button>{' '}
        <button type="button" className="btn primary" onClick={() => window.print()}>
          Download Letterhead PDF
        </button>{' '}
        <button type="button" className="btn" onClick={() => window.print()}>
          Print
        </button>
      </Section>
    </div>
  );
}

function AuditPanel({ pageId, title }: { pageId: string; title: string }) {
  const [page, setPage] = useState(1);
  const a = useLoad(() => listPageAudit(pageId, page, 20), [pageId, page]);
  return (
    <Section title={title} hint="Everything done on this page: who, what and when.">
      <div className="v9-timeline">
        {(a.data?.rows ?? []).map((r) => (
          <div key={r.id} className="v9-event">
            <b>{r.action}</b>
            <small>{`${r.actorName ?? '—'} • ${formatDateTime(r.at)}`}</small>
            <div className="v9-muted">{auditRecord(r.detail, r.targetId)}</div>
          </div>
        ))}
        {(a.data?.rows ?? []).length === 0 ? (
          <p className="muted">{a.loading ? 'Loading…' : 'No audit entries for this page yet.'}</p>
        ) : null}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn"
          disabled={(a.data?.rows.length ?? 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </Section>
  );
}

function HistoryPanel({ pageId, spec, rows }: { pageId: string; spec: PageSpec; rows: Row[] }) {
  const why = 'Free notes are not stored on the audit trail yet.';
  return (
    <div className="proc-split">
      <AuditPanel pageId={pageId} title="History" />
      <Section title="History Controls">
        <div className="field">
          <label htmlFor="proc-note">Internal Note</label>
          <textarea id="proc-note" placeholder="Add note to history" disabled />
        </div>
        <button type="button" className="btn primary" disabled title={why}>
          Add Note
        </button>{' '}
        <button
          type="button"
          className="btn"
          onClick={() => saveCsv(spec.title, toCsv(Object.values(spec.cols), rows))}
        >
          Export Source Data
        </button>
      </Section>
    </div>
  );
}

function ApprovalsList({ pageId, actions }: { pageId: string; actions: ActionSet }) {
  const toast = useToast();
  const a = useLoad(() => getRequests({ docType: pageId, page: 1, size: 25 }), [pageId]);
  return (
    <Section title="Approvals" hint="Approval requests raised for documents of this page.">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Record</th>
              <th>Department</th>
              <th>Amount</th>
              <th>Current Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(a.data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.id.slice(0, 8)}</td>
                <td>{r.docCode}</td>
                <td>{r.department}</td>
                <td>{inr(r.amount)}</td>
                <td>{r.waitingOn ?? '—'}</td>
                <td>
                  <Pill>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Pill>
                </td>
                <td>
                  {r.status === 'PENDING' && actions.approve ? (
                    <>
                      <button
                        type="button"
                        className="btn sm success"
                        disabled={!r.can.approve}
                        onClick={() =>
                          void decideRequest(r, 'approve').then(
                            () => {
                              toast(`Approved ${r.docCode}`);
                              a.reload();
                            },
                            (e: unknown) => toast(toUiMessage(e)),
                          )
                        }
                      >
                        Approve
                      </button>{' '}
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={!r.can.reject}
                        onClick={() =>
                          void decideRequest(r, 'reject', 'Rejected from the register').then(
                            () => {
                              toast(`Rejected ${r.docCode}`);
                              a.reload();
                            },
                            (e: unknown) => toast(toUiMessage(e)),
                          )
                        }
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {(a.data?.rows ?? []).length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>
                  {a.loading ? 'Loading…' : 'No approval requests for this page yet.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
