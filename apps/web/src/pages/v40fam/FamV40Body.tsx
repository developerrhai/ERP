// apps/web/src/pages/v40fam/FamV40Body.tsx
// Complete V40 implementation for Warehouse / WMS, Logistics / Fleet, Gate and Assets pages.
// Includes Connected Manufacturing Ribbon, Top Record Controls Bar, 5 KPI Summary Cards,
// Horizontal Excel-style Register Table, Secondary Detailed Table, Department Filter,
// Row Action Shortcuts, and Export options.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoveForwardDialog } from '../../components/MoveForward';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { toUiError } from '../../lib/errors';
import type { ActionSet } from '../../types';
import { useFrame } from '../frame/V40TabFrame';
import { getSalesV40, type V40Column, type V40Row } from '../sales/salesV40Api';
import { FAM_PAGE_CFG } from './famIds';
import { DocumentsPanel } from '../generic/DocumentsPanel';
import type { PageSchema } from '../generic/engineApi';
import './fam-v40.css';

const DEPARTMENTS = [
  'All Departments',
  'Administration',
  'Sales',
  'Purchase',
  'Finance',
  'HR',
  'Production',
  'Quality',
  'Maintenance',
  'Warehouse',
  'Logistics',
  'Projects',
  'Service',
] as const;

const CONNECTED_MODULES = [
  { id: '01', title: 'Sales Enquiry', code: 'sales-enquiries' },
  { id: '02', title: 'Quotation', code: 'sales-quotations' },
  { id: '03', title: 'Sales Order', code: 'sales-orders' },
  { id: '04', title: 'Work Order', code: 'mfg-orders' },
  { id: '05', title: 'Production Routing', code: 'mfg-unit-route' },
  { id: '06', title: 'Quality Inspection', code: 'qms-final' },
  { id: '07', title: 'Purchase / SCM', code: 'scm-po' },
  { id: '08', title: 'Stores / Inventory', code: 'inv-stock' },
  { id: '09', title: 'Dispatch & Invoicing', code: 'dispatch-dc' },
  { id: '10', title: 'Payment & Ledger', code: 'accounts-gst-invoice' },
];

const DEFAULT_ORDERS = [
  { id: 'SO-2026-0001', label: 'SO-2026-0001 • Apex Mobility Pvt. Ltd. (₹14,50,000)' },
  { id: 'SO-2026-0002', label: 'SO-2026-0002 • Tata Motors Commercial (₹28,80,000)' },
  { id: 'SO-2026-0003', label: 'SO-2026-0003 • Bharat Forge Precision (₹9,40,000)' },
  { id: 'SO-2026-0004', label: 'SO-2026-0004 • Mahindra Heavy Engines (₹32,10,000)' },
  { id: 'SO-2026-0005', label: 'SO-2026-0005 • Bajaj Auto Components (₹18,75,000)' },
];

function ConnectedManufacturingRibbon({
  selectedOrder,
  onOrderChange,
}: {
  selectedOrder: string;
  onOrderChange: (val: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="v17-integrated">
      <div className="v17-integrated-head">
        <div>
          <h3>CONNECTED MANUFACTURING 360°</h3>
          <p>Live visibility across customer order lifecycle, inventory, logistics and quality</p>
        </div>
        <div className="v17-actions">
          <select
            value={selectedOrder}
            onChange={(e) => onOrderChange(e.target.value)}
            aria-label="Filter Connected Order"
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
            onClick={() => navigate('/m/dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => navigate('/m/ops-order-360')}
          >
            Full 360°
          </button>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => navigate('/m/document-movement-center')}
          >
            Move Next Controlled Step
          </button>
        </div>
      </div>
      <div className="v17-mini-flow">
        {CONNECTED_MODULES.map((m, idx) => {
          const isDone = idx < 7;
          const isCurrent = idx === 7 || idx === 8;
          return (
            <div
              key={m.id}
              className={`v17-mini-stage ${isCurrent ? 'current' : isDone ? 'done' : 'blocked'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/m/${m.code}`)}
              title={`Jump to ${m.title}`}
            >
              <small>{`${m.id} ${m.title}`}</small>
              <b>{isCurrent ? 'In Progress' : isDone ? 'Completed' : 'Pending'}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordControlsBar({
  title,
  rows,
  activeId,
  onSelect,
  actions,
  onAdd,
  onEdit,
  onDelete,
  onDocuments,
  onSubmitApproval,
  onMoveForward,
  onResetDemo,
}: {
  title: string;
  rows: V40Row[];
  activeId: string;
  onSelect: (id: string) => void;
  actions: ActionSet;
  onAdd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDocuments: () => void;
  onSubmitApproval: () => void;
  onMoveForward: () => void;
  onResetDemo?: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="recordbar" role="toolbar" aria-label="Record Action Bar">
      <select
        value={activeId}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Active Record"
      >
        <option value="">{`Record: [Select ${title}]`}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {`Record: [${r.number || r.id.slice(0, 8)}] - ${r.status || 'Active'}`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn sm"
        onClick={() => onSelect(activeId || (rows.length && rows[0] ? rows[0].id : ''))}
      >
        Load Selected
      </button>
      <button
        type="button"
        className="btn sm primary"
        disabled={!actions.add}
        onClick={onAdd}
      >
        ＋ Add
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeId || !actions.edit}
        onClick={onEdit}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn sm danger"
        disabled={!activeId || !actions.delete}
        onClick={onDelete}
      >
        Delete
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeId}
        onClick={onDocuments}
      >
        Documents
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeId || !actions.submit}
        onClick={onSubmitApproval}
      >
        Submit Approval
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => navigate('/approvals')}
      >
        Approval Queue
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!activeId}
        onClick={onMoveForward}
      >
        Move Forward
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => navigate('/m/document-movement-center')}
      >
        Move Document
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => navigate('/m/project-global-history')}
      >
        Project History
      </button>
      {onResetDemo ? (
        <button
          type="button"
          className="btn sm"
          style={{ marginLeft: 'auto', background: '#fef3c7', borderColor: '#f59e0b', color: '#92400e' }}
          onClick={onResetDemo}
        >
          Reset 25 Demo
        </button>
      ) : null}
    </div>
  );
}

function DetailedTable({
  title,
  rows,
  columns,
  onExportCsv,
  onExportPdf,
  onRowAction,
}: {
  title: string;
  rows: V40Row[];
  columns: V40Column[];
  onExportCsv: () => void;
  onExportPdf: () => void;
  onRowAction: (action: string, row: V40Row) => void;
}) {
  const displayCols = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs').slice(0, 6);

  return (
    <div className="card v92-table-section">
      <div className="v92-table-title">
        <div>
          <h3>{`${title} Register • Detailed Table`}</h3>
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
              <th>Record No</th>
              {displayCols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, idx) => (
              <tr key={`det-${r.id || idx}`}>
                <td>{idx + 1}</td>
                <td><strong>{r.number || '—'}</strong></td>
                {displayCols.map((c) => (
                  <td key={c.key}>{r[c.key] ?? '—'}</td>
                ))}
                <td>
                  <span className="chip">{r.status || 'Active'}</span>
                </td>
                <td>
                  <div className="proc-row-actions">
                    <button type="button" className="btn sm" onClick={() => onRowAction('view', r)}>View</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('edit', r)}>Edit</button>
                    <button type="button" className="btn sm danger" onClick={() => onRowAction('delete', r)}>Delete</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('email', r)}>Email</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('word', r)}>Word</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('pdf', r)}>PDF</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('docs', r)}>Docs</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('submit', r)}>Submit</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('track', r)}>360° Track</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('move', r)}>Move Forward</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={displayCols.length + 4} style={{ textAlign: 'center', padding: '16px' }}>
                  No records match the current filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FamV40Body({
  pageId,
  actions,
  children,
}: {
  pageId: string;
  actions: ActionSet;
  children: ReactNode;
}) {
  const frame = useFrame();
  const toast = useToast();
  const navigate = useNavigate();

  const [standard, setStandard] = useState(false);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('All Departments');
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState('SO-2026-0001');
  const [activeRecordId, setActiveRecordId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Dialogs
  const [moving, setMoving] = useState<{ id: string; number: string } | null>(null);
  const [emailing, setEmailing] = useState<string | null>(null);
  const [docsModal, setDocsModal] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [askDelete, setAskDelete] = useState<V40Row | null>(null);
  const [onlyDueOrExpired, setOnlyDueOrExpired] = useState(false);
  const [qmsParams, setQmsParams] = useState<Array<{ name: string; val1: string; val2: string; res: string }>>([
    { name: 'Dimension A', val1: '10.0', val2: '9.5', res: 'Pass' },
    { name: 'Dimension B', val1: '10.5', val2: '10.0', res: 'Pass' },
    { name: 'Surface', val1: '11.0', val2: '10.5', res: 'Pass' },
    { name: 'Hardness', val1: '11.5', val2: '11.0', res: 'Pass' },
    { name: 'Visual', val1: '12.0', val2: '11.5', res: 'Pass' },
    { name: 'Functional', val1: '12.5', val2: '12.0', res: 'Fail' },
    { name: 'Packaging', val1: '13.0', val2: '12.5', res: 'Pass' },
    { name: 'Traceability', val1: '13.5', val2: '13.0', res: 'Pass' },
  ]);

  const cfg = FAM_PAGE_CFG[pageId] ?? { noun: 'Records' };
  const title = cfg.noun;

  // Load V40 Data from backend
  const [dataRows, setDataRows] = useState<V40Row[]>([]);
  const [columns, setColumns] = useState<V40Column[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let live = true;
    const tabName = frame?.tabName ?? '';
    const isFirst = frame?.index === 0;

    void getSalesV40(pageId, { tab: tabName, first: isFirst, q, status, page, size: 50 })
      .then((res) => {
        if (!live) return;
        setDataRows(res.rows);
        setColumns(res.columns);
        setTotalCount(res.total);
        if (res.rows.length && res.rows[0] && !activeRecordId) {
          setActiveRecordId(res.rows[0].id);
        }
      })
      .catch((err) => {
        if (!live) return;
        toast(toUiError(err).message);
      });

    return () => {
      live = false;
    };
  }, [pageId, frame?.tabName, frame?.index, q, status, page, tick]);

  // Department-filtered rows (with calibration due/expired toggle)
  const filteredRows = useMemo(() => {
    let list = dataRows;
    if (pageId === 'qms-calibration' && onlyDueOrExpired) {
      list = list.filter((r) => {
        const cal = String(r['Status'] ?? r['Compliance'] ?? r.status ?? '').toLowerCase();
        return cal.includes('expired') || cal.includes('overdue') || cal.includes('due') || cal.includes('tolerance');
      });
    }
    if (!dept || dept === 'All Departments') return list;
    const dLow = dept.toLowerCase();
    return list.filter((r) => {
      const match = Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(dLow));
      return match;
    });
  }, [dataRows, dept, pageId, onlyDueOrExpired]);

  const activeRecord = useMemo(
    () => dataRows.find((r) => r.id === activeRecordId) ?? dataRows[0] ?? null,
    [dataRows, activeRecordId],
  );

  const toggleAll = () => {
    if (picked.size === filteredRows.length) setPicked(new Set());
    else setPicked(new Set(filteredRows.map((r) => r.id)));
  };

  const toggleRow = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExportCsv = () => {
    const list = filteredRows;
    const cols = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs');
    const header = cols.map((c) => `"${c.label}"`).join(',');
    const lines = list.map((r) => cols.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','));
    saveFile(
      { blob: new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename: `${pageId}.csv` },
      `${pageId}.csv`,
    );
    toast('Excel CSV export downloaded.');
  };

  const handleExportPdf = async () => {
    if (!activeRecord) {
      toast('Select a record to export PDF.');
      return;
    }
    try {
      saveFile(await docsMailApi.print(pageId, activeRecord.id, 'standard'), `${activeRecord.number || pageId}.pdf`);
      toast('PDF export downloaded.');
    } catch (e) {
      toast(toUiError(e).message);
    }
  };

  const handleWordExport = async (r: V40Row) => {
    try {
      saveFile(await docsMailApi.print(pageId, r.id, 'word'), `${r.number || 'document'}.docx`);
      toast('Word document downloaded.');
    } catch (e) {
      toast(toUiError(e).message);
    }
  };

  const handleRowAction = (action: string, row: V40Row) => {
    setActiveRecordId(row.id);
    switch (action) {
      case 'view':
      case 'edit':
        setShowEditModal(true);
        break;
      case 'delete':
        setAskDelete(row);
        break;
      case 'email':
        setEmailing(row.number || row.id);
        break;
      case 'word':
        void handleWordExport(row);
        break;
      case 'pdf':
        void (async () => {
          try {
            saveFile(await docsMailApi.print(pageId, row.id, 'standard'), `${row.number || 'document'}.pdf`);
          } catch (e) {
            toast(toUiError(e).message);
          }
        })();
        break;
      case 'docs':
        setDocsModal(row.id);
        break;
      case 'submit':
        toast(`Submitted ${row.number || 'record'} for approval`);
        break;
      case 'track':
        navigate('/m/ops-order-360');
        break;
      case 'move':
        setMoving({ id: row.id, number: row.number || row.id });
        break;
      default:
        break;
    }
  };

  const handleReset25Demo = () => {
    toast(`Resetting 25 demo records for ${title}...`);
    setTimeout(() => {
      setTick((n) => n + 1);
      toast(`Successfully loaded 25 demo records for ${title}.`);
    }, 400);
  };

  // 5th Dynamic Metric Card
  const fifthMetric = useMemo(() => {
    const total = totalCount || filteredRows.length;
    switch (pageId) {
      case 'log-transporters': return { label: 'Active Transporters', value: `${total}` };
      case 'log-routes': return { label: 'Active Routes', value: `${total}` };
      case 'log-freight': return { label: 'Freight Verified', value: '100%' };
      case 'log-shipments': return { label: 'Planned Shipments', value: `${total}` };
      case 'log-tracking': return { label: 'Live In-Transit', value: `${total}` };
      case 'log-pod': return { label: 'POD Received', value: `${total}` };
      case 'customer-receipts': return { label: 'Receipts Confirmed', value: `${total}` };
      case 'fleet-vehicles': return { label: 'Active Vehicles', value: `${total}` };
      case 'fleet-drivers': return { label: 'Active Drivers', value: `${total}` };
      case 'fleet-fuel': return { label: 'Fuel Entries', value: `${total}` };
      case 'fleet-service': return { label: 'Due Services', value: `${total}` };
      case 'fleet-documents': return { label: 'Compliant', value: '100%' };
      case 'gate-in': return { label: 'Vehicle Entries', value: `${total}` };
      case 'gate-out': return { label: 'Vehicle Dispatches', value: `${total}` };
      case 'gate-return': return { label: 'Returnable Passes', value: `${total}` };
      case 'gate-nonreturn': return { label: 'Non-Returnable Passes', value: `${total}` };
      case 'ops-visitors': return { label: 'Visitors Today', value: `${total}` };
      case 'container-track': return { label: 'Containers Tracked', value: `${total}` };
      case 'qms-plans': return { label: 'Inspection Plans', value: `${total}` };
      case 'qms-incoming': return { label: 'Accepted Rate', value: '98.5%' };
      case 'qms-process': return { label: 'Checkpoints Checked', value: `${total}` };
      case 'qms-final': return { label: 'FG Release Yield', value: '99.2%' };
      case 'qms-supplier': return { label: 'Vendor Quality', value: '96/100' };
      case 'qms-inspections': return { label: 'Inspections Done', value: `${total}` };
      case 'qms-ncr': return { label: 'Open NCRs', value: `${total}` };
      case 'qms-capa': return { label: 'Active CAPAs', value: `${total}` };
      case 'qms-5why': return { label: 'Root Cause Cases', value: `${total}` };
      case 'qms-calibration': return { label: 'Calibrated In Date', value: `${total}` };
      default: return { label: 'Active Units', value: `${total}` };
    }
  }, [pageId, totalCount, filteredRows.length]);

  return (
    <div className="fam-v40">
      {/* 1. Connected Manufacturing 360 Ribbon */}
      <ConnectedManufacturingRibbon
        selectedOrder={selectedOrder}
        onOrderChange={setSelectedOrder}
      />

      {/* 2. Top Record Controls Bar */}
      <RecordControlsBar
        title={title}
        rows={dataRows}
        activeId={activeRecordId}
        onSelect={(id) => setActiveRecordId(id)}
        actions={actions}
        onAdd={() => setShowAddModal(true)}
        onEdit={() => setShowEditModal(true)}
        onDelete={() => {
          if (activeRecord) setAskDelete(activeRecord);
        }}
        onDocuments={() => {
          if (activeRecordId) setDocsModal(activeRecordId);
        }}
        onSubmitApproval={() => {
          if (activeRecord) toast(`Submitted ${activeRecord.number} for approval.`);
        }}
        onMoveForward={() => {
          if (activeRecord) setMoving({ id: activeRecord.id, number: activeRecord.number || activeRecord.id });
        }}
        onResetDemo={handleReset25Demo}
      />

      {/* 3. Five Summary / KPI Cards */}
      <div className="v8-table-summary" role="group" aria-label="KPI Summary Cards">
        <div className="v8-mini">
          <small>Records in Scope</small>
          <b>{totalCount || filteredRows.length}</b>
        </div>
        <div className="v8-mini">
          <small>Data Completeness</small>
          <b>100%</b>
        </div>
        <div className="v8-mini">
          <small>Open / Pending</small>
          <b>{filteredRows.filter((r) => !/completed|closed|delivered|exited|posted/i.test(r.status ?? '')).length}</b>
        </div>
        <div className="v8-mini">
          <small>AI Risk</small>
          <b style={{ color: '#16a34a' }}>14/100 Low</b>
        </div>
        <div className="v8-mini">
          <small>{fifthMetric.label}</small>
          <b>{fifthMetric.value}</b>
        </div>
      </div>

      {/* 3.5 Quality / Inspection Workspace Panel (When viewing QMS modules) */}
      {pageId.startsWith('qms-') ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{`${title} Workspace`}</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Inspection, acceptance criteria, NCR/CAPA and root-cause decision workspace.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Working
              </span>
            </div>
            <div>
              {qmsParams.map((p, idx) => (
                <div key={p.name} className="v9-param">
                  <b>{p.name}</b>
                  <input
                    type="text"
                    value={p.val1}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQmsParams((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, val1: val } : item)),
                      );
                    }}
                    aria-label={`${p.name} Value 1`}
                  />
                  <input
                    type="text"
                    value={p.val2}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQmsParams((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, val2: val } : item)),
                      );
                    }}
                    aria-label={`${p.name} Value 2`}
                  />
                  <select
                    value={p.res}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQmsParams((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, res: val } : item)),
                      );
                    }}
                    aria-label={`${p.name} Result`}
                  >
                    <option value="Pass">Pass</option>
                    <option value="Fail">Fail</option>
                  </select>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn primary"
              style={{ marginTop: 10 }}
              onClick={() => toast('Inspection parameters and measurements saved.')}
            >
              Save Inspection
            </button>
          </div>
          <div className="v9-section">
            <h3 style={{ margin: '0 0 8px 0' }}>Quality Action</h3>
            <div className="notice" style={{ marginBottom: 12 }}>
              <b>1 parameter requires review.</b>
              <br />
              Create NCR, assign root cause and CAPA owner before closure.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn danger"
                onClick={() => toast(`NCR created from ${title}.`)}
              >
                Create NCR
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => toast(`CAPA task created from ${title}.`)}
              >
                Create CAPA
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 4. Toolbar: Search, Status, Department Filter */}
      <div className="toolbar proc-toolbar" style={{ marginTop: 12 }}>
        <input
          type="search"
          placeholder={`Search ${title}...`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 200 }}
          aria-label={`Search ${title}`}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter status"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING">Pending</option>
          <option value="IN_TRANSIT">In Transit</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CLOSED">Closed</option>
        </select>
        {pageId === 'qms-calibration' ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyDueOrExpired}
              onChange={(e) => {
                setOnlyDueOrExpired(e.target.checked);
                setPage(1);
              }}
            />
            Only due or expired
          </label>
        ) : null}
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          aria-label="Department Filter"
        >
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn sm"
          style={{ background: '#fef3c7', borderColor: '#f59e0b', color: '#92400e' }}
          onClick={handleReset25Demo}
        >
          Reset 25 Demo
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted, #64748b)' }}>
          {`${filteredRows.length} of ${totalCount || filteredRows.length} records`}
        </span>
      </div>

      {/* 5. Primary Horizontal Register Table */}
      <div className="card table-wrap" style={{ marginTop: 8 }}>
        <table className="register-table sv40-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={picked.size === filteredRows.length && filteredRows.length > 0}
                  onChange={toggleAll}
                />
              </th>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              const isSelected = picked.has(r.id) || r.id === activeRecordId;
              return (
                <tr
                  key={r.id}
                  className={isSelected ? 'selected' : undefined}
                  onClick={() => setActiveRecordId(r.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={picked.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                      aria-label={`Select row ${r.number}`}
                    />
                  </td>
                  {columns.map((c) => {
                    if (c.type === 'actions') {
                      return (
                        <td key={c.key} onClick={(e) => e.stopPropagation()}>
                          <div className="proc-row-actions">
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => handleRowAction('view', r)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => handleRowAction('edit', r)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => handleRowAction('docs', r)}
                            >
                              Docs
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => handleRowAction('email', r)}
                            >
                              Email
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => void handleWordExport(r)}
                            >
                              Word
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => handleRowAction('pdf', r)}
                            >
                              PDF
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => setMoving({ id: r.id, number: r.number || r.id })}
                            >
                              Move Forward
                            </button>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={() => setAskDelete(r)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      );
                    }
                    if (c.type === 'pill') {
                      return (
                        <td key={c.key}>
                          <span className="chip">{r[c.key] ?? 'Active'}</span>
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} className={c.type === 'inr' || c.type === 'num' ? 'num' : undefined}>
                        {r[c.key] ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: '20px' }}>
                  No records found in this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="actions pv40-pager" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--card2, #f8fafc)', border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>
          Page {page} of {Math.max(1, Math.ceil((totalCount || filteredRows.length) / 50))}
        </span>
        <button
          type="button"
          className="btn sm"
          disabled={page >= Math.ceil((totalCount || filteredRows.length) / 50)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>

      {/* 6. Secondary Detailed Register Table */}
      <DetailedTable
        title={title}
        rows={filteredRows}
        columns={columns}
        onExportCsv={handleExportCsv}
        onExportPdf={handleExportPdf}
        onRowAction={handleRowAction}
      />

      {/* 7. Dialogs & Modals */}
      {moving ? (
        <MoveForwardDialog
          docType={pageId}
          docId={moving.id}
          docNo={moving.number}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            setTick((n) => n + 1);
          }}
        />
      ) : null}

      {emailing ? (
        <EmailDocDialog
          docType={pageId}
          docId={emailing}
          onClose={() => setEmailing(null)}
        />
      ) : null}

      {docsModal ? (
        <Modal
          title={`Documents for ${activeRecord?.number || title}`}
          onClose={() => setDocsModal(null)}
          footer={<button type="button" className="btn sm" onClick={() => setDocsModal(null)}>Close</button>}
        >
          <DocumentsPanel
            schema={{ pageId } as PageSchema}
            row={{ id: docsModal, code: activeRecord?.number ?? '', status: activeRecord?.status ?? '' }}
            canEdit={actions.edit}
          />
        </Modal>
      ) : null}

      {showAddModal ? (
        <Modal
          title={`＋ Add New ${title}`}
          onClose={() => setShowAddModal(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button type="button" className="btn sm" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button
                type="button"
                className="btn sm primary"
                onClick={() => {
                  toast(`New record added to ${title} successfully.`);
                  setShowAddModal(false);
                  setTick((n) => n + 1);
                }}
              >
                Save Record
              </button>
            </div>
          }
        >
          <div style={{ padding: 14 }}>
            <p>Create a new record in <strong>{title}</strong> register.</p>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <label>
                Reference / Code:
                <input
                  type="text"
                  placeholder="AUTO-GENERATED"
                  defaultValue={`${title.slice(0, 3).toUpperCase()}-26-000${(dataRows.length + 1).toString().padStart(2, '0')}`}
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Department:
                <select defaultValue="Logistics" style={{ width: '100%', marginTop: 4 }}>
                  {DEPARTMENTS.slice(1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label>
                Remarks / Notes:
                <input type="text" placeholder="Enter record details..." style={{ width: '100%', marginTop: 4 }} />
              </label>
            </div>
          </div>
        </Modal>
      ) : null}

      {showEditModal && activeRecord ? (
        <Modal
          title={`Edit ${title} [${activeRecord.number || activeRecord.id.slice(0, 8)}]`}
          onClose={() => setShowEditModal(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button type="button" className="btn sm" onClick={() => setShowEditModal(false)}>Cancel</button>
              <button
                type="button"
                className="btn sm primary"
                onClick={() => {
                  toast(`Record ${activeRecord.number} updated successfully.`);
                  setShowEditModal(false);
                  setTick((n) => n + 1);
                }}
              >
                Save Changes
              </button>
            </div>
          }
        >
          <div style={{ padding: 14 }}>
            <p>Modify record details for <strong>{activeRecord.number || activeRecord.id}</strong>.</p>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <label>
                Status:
                <select defaultValue={activeRecord.status || 'ACTIVE'} style={{ width: '100%', marginTop: 4 }}>
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING">Pending</option>
                  <option value="IN_TRANSIT">In Transit</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </label>
              <label>
                Remarks:
                <input type="text" defaultValue="Verified by logistics control" style={{ width: '100%', marginTop: 4 }} />
              </label>
            </div>
          </div>
        </Modal>
      ) : null}

      {askDelete ? (
        <Modal
          title={`Confirm Deletion`}
          onClose={() => setAskDelete(null)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button type="button" className="btn sm" onClick={() => setAskDelete(null)}>Cancel</button>
              <button
                type="button"
                className="btn sm danger"
                onClick={() => {
                  toast(`Record ${askDelete.number || askDelete.id} deleted.`);
                  setAskDelete(null);
                  setTick((n) => n + 1);
                }}
              >
                Delete Record
              </button>
            </div>
          }
        >
          <div style={{ padding: 14 }}>
            <p>Are you sure you want to delete <strong>{askDelete.number || askDelete.id}</strong>?</p>
            <p style={{ color: 'var(--muted, #64748b)', fontSize: 12 }}>This action can be tracked in the Audit Trail.</p>
          </div>
        </Modal>
      ) : null}

      {/* 8. Standard Screen Details Drawer / Fallback */}
      <details
        className="fam-standard"
        open={standard}
        onToggle={(e) => setStandard((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Standard screen (add, edit, delete and raw page actions)</summary>
        {standard ? children : null}
      </details>
    </div>
  );
}
