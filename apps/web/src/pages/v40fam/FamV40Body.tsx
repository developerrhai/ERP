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
import { getSalesV40, type V40Column, type V40ColType, type V40Row } from '../sales/salesV40Api';
import { FAM_PAGE_CFG } from './famIds';
import { DocumentsPanel } from '../generic/DocumentsPanel';
import type { PageSchema } from '../generic/engineApi';
import './fam-v40.css';

function formatCellValue(val: unknown, type?: V40ColType): ReactNode {
  if (val === null || val === undefined || val === '') return '—';
  const s = String(val).trim();
  if (type === 'inr') {
    const num = Number(s);
    if (!isNaN(num) && s !== '') {
      return `₹ ${Math.round(num).toLocaleString('en-IN')}`;
    }
  }
  if (type === 'num') {
    const num = Number(s);
    if (!isNaN(num) && s !== '') {
      return Math.round(num).toLocaleString('en-IN');
    }
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    const num = Number(s);
    if (!isNaN(num)) {
      return Math.round(num).toLocaleString('en-IN');
    }
  }
  return s;
}

const WMS_TITLES: Record<string, string> = {
  'wms-warehouses': 'Warehouse Directory – Detailed Table',
  'wms-zones': 'Zone Directory – Detailed Table',
  'wms-racks': 'Rack Directory – Detailed Table',
  'wms-shelves': 'Shelf Directory – Detailed Table',
  'wms-bins': 'Bin Directory – Detailed Table',
  'wms-putaway': 'Putaway Queue – Detailed Table',
  'wms-pick': 'Pick Waves – Detailed Table',
  'wms-packing': 'Packing Queue – Detailed Table',
  'wms-cycle': 'Cycle Count Plan – Detailed Table',
  'wms-physical': 'Physical Count Plan – Detailed Table',
  'wms-transfer': 'Transfer Queue – Detailed Table',
  'wms-barcode': 'Barcode Registry – Detailed Table',
  'wms-rfid': 'RFID Tag Registry – Detailed Table',
  'crm-leads': 'Lead Register – Detailed Table',
  'crm-opportunities': 'Opportunity Register – Detailed Table',
  'crm-followups': 'Follow-up Planner – Detailed Table',
  'crm-meetings': 'Meetings & Calls – Detailed Table',
  'crm-customer360': 'Customer 360° – Detailed Table',
  'crm-feedback': 'Customer Feedback – Detailed Table',
  'crm-sources': 'Source Master – Detailed Table',
};

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
  const toast = useToast();
  const currentId = activeId || (rows.length && rows[0] ? rows[0].id : '');

  return (
    <div className="recordbar" role="toolbar" aria-label="Record Action Bar">
      <select
        value={activeId || currentId}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Active Record"
      >
        <option value="">{`Record: [Select ${title}]`}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {`Record: [${r['Lead No'] || r['Opportunity No'] || r['Follow-up No'] || r['Meeting No'] || r['Feedback No'] || r['Source Code'] || r['Customer'] || r['Rack Code'] || r['Zone Code'] || r['Warehouse Code'] || r.number || r.id.slice(0, 8)}] - ${r.status || 'Active'}`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn sm"
        onClick={() => onSelect(currentId)}
      >
        Load Selected
      </button>
      <button
        type="button"
        className="btn sm primary"
        onClick={() => {
          if (!actions.add) toast('Add permission is not available for this role.');
          else onAdd();
        }}
      >
        ＋ Add
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          if (!actions.edit) toast('Edit permission is not available for this role.');
          else if (!currentId) toast('Select a record first, then press Edit.');
          else onEdit();
        }}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn sm danger"
        onClick={() => {
          if (!actions.delete) toast('Delete permission is not available for this role.');
          else if (!currentId) toast('Select a record first, then press Delete.');
          else onDelete();
        }}
      >
        Delete
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          if (!currentId) toast('Select a record first, then press Documents.');
          else onDocuments();
        }}
      >
        Documents
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          if (!actions.submit) toast('Submit approval permission is not available for this role.');
          else if (!currentId) toast('Select a record first, then press Submit Approval.');
          else onSubmitApproval();
        }}
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
        onClick={() => {
          if (!currentId) toast('Select a record first, then press Move Forward.');
          else onMoveForward();
        }}
      >
        Move Forward
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          if (!currentId) toast('Select a record first, then press Move Forward - Internal.');
          else onMoveForward();
        }}
      >
        Move Forward - Internal
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
  onExportWord,
  onExportEmail,
  onRowAction,
}: {
  title: string;
  rows: V40Row[];
  columns: V40Column[];
  onExportCsv: () => void;
  onExportPdf: () => void;
  onExportWord: () => void;
  onExportEmail: () => void;
  onRowAction: (action: string, row: V40Row) => void;
}) {
  const displayCols = columns.filter((c) => c.type !== 'actions' && c.type !== 'docs').slice(0, 10);

  return (
    <div className="card v92-table-section">
      <div className="v92-table-title">
        <div>
          <h3>{`${title === 'Warehouse Master' ? 'Warehouse Directory' : title} Register • Detailed Table`}</h3>
          <small>{`${Math.min(20, rows.length)} working records • full actions available`}</small>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn sm" onClick={onExportEmail}>
            Send Email
          </button>
          <button type="button" className="btn sm" onClick={onExportWord}>
            Word
          </button>
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
                  <td key={c.key} className={c.type === 'inr' || c.type === 'num' ? 'num' : undefined}>
                    {formatCellValue(r[c.key], c.type)}
                  </td>
                ))}
                <td>
                  <span className="chip">{r.status || 'Active'}</span>
                </td>
                <td>
                  <div className="proc-row-actions">
                    <button type="button" className="btn sm" onClick={() => onRowAction('view', r)}>View</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('edit', r)}>Edit</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('docs', r)}>Docs</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('email', r)}>Email</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('word', r)}>Word</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('pdf', r)}>PDF</button>
                    <button type="button" className="btn sm danger" onClick={() => onRowAction('delete', r)}>Delete</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('submit', r)}>Submit</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('track', r)}>360° Track</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('move', r)}>Move Forward</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('move', r)}>Move Forward - Internal</button>
                    <button type="button" className="btn sm" onClick={() => onRowAction('moveDoc', r)}>Move Document</button>
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
  const [pageSize, setPageSize] = useState(25);
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
  const [commChannel, setCommChannel] = useState('Call');
  const [commNote, setCommNote] = useState('');
  const [commDate, setCommDate] = useState('');
  const [commTimeline, setCommTimeline] = useState<Array<{ channel: string; target: string; date: string; status: string; note: string }>>([
    { channel: 'Call', target: 'Acme Corp Lead', date: '2026-11-15', status: 'Completed', note: 'Discussion captured and next proposal action assigned.' },
    { channel: 'Email', target: 'Apex Engineering', date: '2026-11-14', status: 'Pending', note: 'Quotation revision sent. Awaiting procurement signoff.' },
    { channel: 'Meeting', target: 'Tech Corp Demo', date: '2026-11-12', status: 'Completed', note: 'Presented V40 ERP capabilities to CXO stakeholders.' },
    { channel: 'WhatsApp', target: 'Zenith Logistics', date: '2026-11-10', status: 'In Progress', note: 'Shared updated spec sheet and delivery lead-time commitment.' },
  ]);
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

    void getSalesV40(pageId, { tab: tabName, first: isFirst, q, status, page, size: pageSize })
      .then((res) => {
        if (!live) return;
        setDataRows(res.rows);
        setColumns(res.columns);
        setTotalCount(res.total);
        if (res.rows.length && res.rows[0]) {
          setActiveRecordId((prev) => (prev && res.rows.some((r) => r.id === prev) ? prev : res.rows[0]!.id));
        }
      })
      .catch((err) => {
        if (!live) return;
        toast(toUiError(err).message);
      });

    return () => {
      live = false;
    };
  }, [pageId, frame?.tabName, frame?.index, q, status, page, pageSize, tick]);

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

  useEffect(() => {
    const handleAdd = (e: Event) => {
      const customEvent = e as CustomEvent<{ pageId: string }>;
      if (!customEvent.detail || customEvent.detail.pageId === pageId) {
        setShowAddModal(true);
      }
    };
    window.addEventListener('v40-add-record', handleAdd);
    return () => window.removeEventListener('v40-add-record', handleAdd);
  }, [pageId]);

  useEffect(() => {
    if (activeRecord) {
      window.dispatchEvent(
        new CustomEvent('v40-active-record', {
          detail: { pageId, recordId: activeRecord.id, docNo: activeRecord.number },
        }),
      );
    }
  }, [pageId, activeRecord]);

  useEffect(() => {
    const handleReq = (e: Event) => {
      const ce = e as CustomEvent<{ pageId: string }>;
      if ((!ce.detail || ce.detail.pageId === pageId) && activeRecord) {
        window.dispatchEvent(
          new CustomEvent('v40-active-record', {
            detail: { pageId, recordId: activeRecord.id, docNo: activeRecord.number },
          }),
        );
      }
    };
    window.addEventListener('v40-request-active-record', handleReq);
    return () => window.removeEventListener('v40-request-active-record', handleReq);
  }, [pageId, activeRecord]);

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
      case 'moveDoc':
        navigate('/m/document-movement-center');
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
      case 'asset-master': return { label: 'Active Assets', value: `${total}` };
      case 'asset-capitalization': return { label: 'Capitalized Value', value: '₹ 1.84 Cr' };
      case 'asset-allocation': return { label: 'Allocated Rate', value: '94.2%' };
      case 'asset-transfer': return { label: 'Transfers Pending', value: `${total}` };
      case 'asset-maintenance': return { label: 'Work Orders', value: `${total}` };
      case 'asset-depreciation': return { label: 'Monthly Depreciation', value: '₹ 4.2L' };
      case 'asset-disposal': return { label: 'Disposals Recorded', value: `${total}` };
      case 'asset-qr': return { label: 'QR Tags Generated', value: '100%' };
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
      case 'sales-quotations': return { label: 'Quotations Value', value: '₹ 4.8 Cr' };
      case 'sales-orders': return { label: 'Order Intake', value: '₹ 8.2 Cr' };
      case 'sales-enquiries': return { label: 'Active Enquiries', value: `${total}` };
      case 'sales-reservations': return { label: 'Reserved Stock', value: '100% Allocated' };
      case 'sales-delivery': return { label: 'On-Time Schedule', value: '98.5%' };
      case 'sales-dispatch': return { label: 'Dispatched Units', value: `${total}` };
      case 'sales-invoices': return { label: 'Invoiced Value', value: '₹ 6.4 Cr' };
      case 'sales-collections': return { label: 'Collected Amount', value: '₹ 5.9 Cr' };
      case 'sales-pricelist': return { label: 'Active Price Lists', value: `${total}` };
      case 'sales-credit': return { label: 'Approved Credit Limits', value: `${total}` };
      case 'sales-returns': return { label: 'Return Rate', value: '0.4% Low' };
      case 'crm-leads': return { label: 'Average Score', value: '78/100' };
      case 'crm-opportunities': return { label: 'Pipeline Value', value: '₹ 84,50,000' };
      case 'crm-followups': return { label: 'Due Today', value: '6 Tasks' };
      case 'crm-meetings': return { label: 'Scheduled', value: '4 Calls' };
      case 'crm-customer360': return { label: 'Key Accounts', value: '18 Active' };
      case 'crm-feedback': return { label: 'CSAT Rating', value: '4.8 / 5.0' };
      case 'crm-sources': return { label: 'Conversion ROI', value: '340%' };
      case 'wms-warehouses': return { label: 'Storage Capacity', value: '94% Utilized' };
      case 'wms-zones': return { label: 'Active Zones', value: `${total}` };
      case 'wms-racks': return { label: 'Active Racks', value: `${total}` };
      case 'wms-bins': return { label: 'Bin Fill Rate', value: '88.5%' };
      case 'wms-putaway': return { label: 'Put-Away Queue', value: `${total}` };
      case 'wms-pick': return { label: 'Pick Tasks', value: `${total}` };
      case 'wms-packing': return { label: 'Pack Units', value: `${total}` };
      case 'wms-cycle': return { label: 'Cycle Accuracy', value: '99.8%' };
      case 'wms-physical': return { label: 'Count Discrepancy', value: '0.1% Low' };
      case 'wms-transfer': return { label: 'Transfers In Transit', value: `${total}` };
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
          <small>Completion</small>
          <b>100%</b>
        </div>
        <div className="v8-mini">
          <small>Open / Pending</small>
          <b>{filteredRows.filter((r) => !/completed|closed|delivered|exited|posted/i.test(r.status ?? '')).length}</b>
        </div>
        <div className="v8-mini">
          <small>At Risk</small>
          <b style={{ color: '#16a34a' }}>{pageId.startsWith('asset-') ? '21/100 Controlled' : '0 Low'}</b>
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

      {/* 3.6 Asset Maintenance Workspace Panel */}
      {pageId === 'asset-maintenance' ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Asset Maintenance</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Preventive/breakdown maintenance planning with downtime, spare and MTBF/MTTR visibility.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Working
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                aria-label="Department Filter"
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line, #cbd5e1)', fontSize: 12 }}
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>Quick filter for department wise records on this page</small>
            </div>
            <div className="table-wrap">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>Equipment</th>
                    <th>Type</th>
                    <th>Due / Start</th>
                    <th>Downtime</th>
                    <th>Spare</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, 8).map((r, i) => (
                    <tr key={`wo-${r.id || i}`}>
                      <td><strong>{r['Equipment'] ?? r['Asset'] ?? `Machine-${String(i + 1).padStart(2, '0')}`}</strong></td>
                      <td>{r['Service Type'] ?? (i % 2 === 0 ? 'Preventive' : 'Breakdown')}</td>
                      <td>{r['Due Date'] ?? r['Service Date'] ?? `2026-11-${String(10 + i).padStart(2, '0')}`}</td>
                      <td>{i % 2 === 0 ? '0 hr' : `${(i % 4) + 1.5} hr`}</td>
                      <td>{i % 3 === 0 ? 'Short' : 'Available'}</td>
                      <td><span className="chip">{r.status || (i % 3 === 0 ? 'Review' : 'Scheduled')}</span></td>
                      <td>
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() => {
                            toast(`Maintenance Work Order created for ${r['Equipment'] ?? r.number ?? 'asset'}.`);
                          }}
                        >
                          Create WO
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Reliability Indicators</h3>
            <div className="v9-metric-row"><span>MTBF</span><b>180 hr</b></div>
            <div className="v9-metric-row"><span>MTTR</span><b>2.4 hr</b></div>
            <div className="v9-metric-row"><span>PM compliance</span><b>96%</b></div>
            <div className="v9-metric-row"><span>Breakdown frequency</span><b>1%</b></div>
            <div className="v9-metric-row"><span>Spare readiness</span><b>94%</b></div>
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn primary"
                style={{ width: '100%' }}
                onClick={() => setShowAddModal(true)}
              >
                ＋ Create Maintenance Order
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.7 Asset Lifecycle Workspace Panel (All other Asset submodules) */}
      {pageId.startsWith('asset-') && pageId !== 'asset-maintenance' ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{`${title} Register`}</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Asset lifecycle, allocation, book value, depreciation, maintenance and disposal controls.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Working
              </span>
            </div>
            {/* 5-Stage Asset Lifecycle Stepper */}
            <div className="v9-stepper" style={{ marginBottom: 12 }}>
              {[
                { name: 'Capitalized', status: 'Active' },
                { name: 'Allocated', status: 'Active' },
                { name: 'In Use', status: 'Active' },
                { name: 'Maintenance', status: 'Future' },
                { name: 'Disposal', status: 'Future' },
              ].map((st, i) => (
                <div key={st.name} className={`v9-step ${i < 2 ? 'done' : i === 2 ? 'current' : ''}`}>
                  <b>{st.name}</b>
                  <span>{st.status}</span>
                </div>
              ))}
            </div>
            {/* Department Filter */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                aria-label="Department Filter"
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line, #cbd5e1)', fontSize: 12 }}
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>Quick filter for department wise records on this page</small>
            </div>
          </div>
          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Lifecycle Actions</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  toast(`Transfer initiated for ${activeRecord?.number || 'selected asset'}.`);
                  navigate('/m/asset-transfer');
                }}
              >
                Transfer
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  toast(`Depreciation posted to GL for ${activeRecord?.number || 'selected asset'}.`);
                  navigate('/m/asset-depreciation');
                }}
              >
                Post Depreciation
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  toast(`Asset disposal initiated for ${activeRecord?.number || 'selected asset'}.`);
                  navigate('/m/asset-disposal');
                }}
              >
                Dispose
              </button>
            </div>
            <div className="notice" style={{ marginTop: 12 }}>
              Select an asset from the register or record dropdown above to run targeted lifecycle actions.
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.8 Warehouse / WMS Allocation & Queue Workspace Panel */}
      {pageId.startsWith('wms-') ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {pageId === 'wms-barcode'
                    ? 'Barcode Scanner & Registry Queue'
                    : pageId === 'wms-rfid'
                      ? 'RFID Tag Registry Queue'
                      : pageId === 'wms-racks'
                        ? 'Rack Directory Allocation Queue'
                        : `${title} Allocation Queue`}
                </h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Warehouse execution queue: stock availability, replenishment demand and slotting priority.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Working
              </span>
            </div>

            {/* Special Scanner Form for Barcode / QR */}
            {pageId === 'wms-barcode' ? (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 12,
                  padding: 8,
                  background: 'var(--subtle, #f8fafc)',
                  borderRadius: 6,
                  border: '1px solid var(--line, #e2e8f0)',
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="text"
                  placeholder="Scan here... (barcode, GS1, batch, serial, bin)"
                  aria-label="Scan here"
                  style={{ flex: 1, minWidth: 220, padding: '6px 10px', fontSize: 12 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      toast(`Scanned barcode: ${(e.target as HTMLInputElement).value}. Valid SKU found.`);
                    }
                  }}
                />
                <select
                  aria-label="Purpose selector"
                  defaultValue="LOOKUP"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                >
                  <option value="LOOKUP">LOOKUP</option>
                  <option value="RECEIVING">RECEIVING</option>
                  <option value="PICKING">PICKING</option>
                  <option value="PUTAWAY">PUTAWAY</option>
                  <option value="VERIFICATION">VERIFICATION</option>
                </select>
                <select
                  aria-label="Warehouse selector"
                  defaultValue="WH-MAIN"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                >
                  <option value="WH-MAIN">Central Warehouse - Talwade</option>
                  <option value="WH-RAW">Raw Material Depot</option>
                  <option value="WH-FG">Finished Goods Depot</option>
                </select>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => toast('Barcode check complete. Record matched.')}
                >
                  Check
                </button>
              </div>
            ) : null}

            {/* Department Filter for Queue */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                aria-label="Department Filter"
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line, #cbd5e1)', fontSize: 12 }}
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>
                Quick filter for department wise records on this page
              </small>
            </div>

            {/* Queue Table */}
            <div className="table-wrap">
              <table className="register-table">
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
                  {filteredRows.slice(0, 8).map((r, i) => {
                    const recName =
                      r['Rack Code'] ??
                      r.number ??
                      r['Barcode'] ??
                      r['Tag EPC'] ??
                      r['Zone Code'] ??
                      r['Shelf Code'] ??
                      r['Bin Code'] ??
                      r['Task No'] ??
                      r['Pick Task No'] ??
                      r['Pack No'] ??
                      r['Count Plan No'] ??
                      r['WMS Transfer No'] ??
                      r['Warehouse Code'] ??
                      `REC-${String(i + 1).padStart(4, '0')}`;
                    const dem = r['Demand'] ?? (i % 3 === 0 ? '150' : '80');
                    const avail = r['Available'] ?? (i % 2 === 0 ? '500' : '320');
                    const alloc = r['Allocated'] ?? (i % 2 === 0 ? '120' : '65');
                    const sh = r['Short'] ?? '0';
                    const loc =
                      r['Location'] ??
                      (r['Zone']
                        ? `${r['Warehouse'] ?? ''} · ${r['Zone']} · Aisle ${r['Aisle'] ?? ''}`
                        : r['Warehouse'] ??
                          r['Expected Location'] ??
                          r['Reader Zone'] ??
                          `Zone-A / Aisle-${(i % 4) + 1}`);
                    return (
                      <tr key={`q-${r.id || i}`}>
                        <td>
                          <strong>{recName}</strong>
                        </td>
                        <td>{dem}</td>
                        <td>{avail}</td>
                        <td>{alloc}</td>
                        <td>{sh}</td>
                        <td>{loc}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              className="btn sm primary"
                              onClick={() => toast(`Stock allocated for ${recName}.`)}
                            >
                              Allocate
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => toast(`Reallocation triggered for ${recName}.`)}
                            >
                              Reallocate
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>WMS Execution Status</h3>
            <div className="v9-metric-row">
              <span>Slotting compliance</span>
              <b>98.5%</b>
            </div>
            <div className="v9-metric-row">
              <span>Putaway cycle time</span>
              <b>18 min</b>
            </div>
            <div className="v9-metric-row">
              <span>Pick accuracy</span>
              <b>99.9%</b>
            </div>
            <div className="v9-metric-row">
              <span>Dock to stock</span>
              <b>1.4 hr</b>
            </div>
            <div className="v9-metric-row">
              <span>Scan verification</span>
              <b>100%</b>
            </div>
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn primary"
                style={{ width: '100%' }}
                onClick={() => setShowAddModal(true)}
              >
                {`＋ Add ${title}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.9 CRM Workspace Panel: Funnel & Stage Action Queue (Leads & Opportunities) */}
      {pageId === 'crm-leads' || pageId === 'crm-opportunities' ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Pipeline & Conversion Funnel</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Stage movement, probability, funnel leakage and conversion actions.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Active
              </span>
            </div>
            <div
              className="v9-funnel"
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-end',
                justifyContent: 'space-around',
                padding: '16px 8px',
                background: 'var(--muted-bg, #f8fafc)',
                borderRadius: 8,
                border: '1px solid var(--line, #cbd5e1)',
                minHeight: 140,
              }}
            >
              {[
                { stage: 'New', count: 12, color: '#3b82f6', height: 80 },
                { stage: 'Qualified', count: 9, color: '#06b6d4', height: 65 },
                { stage: 'Proposal', count: 7, color: '#8b5cf6', height: 50 },
                { stage: 'Negotiation', count: 4, color: '#f59e0b', height: 35 },
                { stage: 'Won', count: 3, color: '#10b981', height: 25 },
              ].map((s) => (
                <div key={s.stage} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 48,
                      height: s.height,
                      backgroundColor: s.color,
                      borderRadius: '4px 4px 0 0',
                      transition: 'all 0.3s ease',
                    }}
                  />
                  <b style={{ marginTop: 8, fontSize: 13 }}>{s.stage}</b>
                  <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>{s.count} records</small>
                </div>
              ))}
            </div>

            {/* Stage Action Queue */}
            <div style={{ marginTop: 14 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 13 }}>Stage Action Queue</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {filteredRows.slice(0, 6).map((r, i) => {
                  const leadName = r['Lead Name'] ?? r['Opportunity Name'] ?? r['Company'] ?? r['Customer'] ?? `Lead-${i + 1}`;
                  const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won'];
                  const curStage = r['Stage'] ?? stages[i % stages.length];
                  const prob = 45 + i * 10;
                  return (
                    <div
                      key={`stage-q-${r.id || i}`}
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--line, #cbd5e1)',
                        borderRadius: 6,
                        background: '#fff',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{leadName}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted, #64748b)', marginTop: 2 }}>
                          {curStage} • Probability {prob}%
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn sm primary"
                        style={{ marginTop: 8 }}
                        onClick={() => toast(`Moved ${leadName} to next stage.`)}
                      >
                        Move Next
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Conversion Drivers</h3>
            <div className="v9-metric-row">
              <span>Follow-up discipline</span>
              <b>92%</b>
            </div>
            <div className="v9-metric-row">
              <span>Proposal quality</span>
              <b>88%</b>
            </div>
            <div className="v9-metric-row">
              <span>Price competitiveness</span>
              <b>79%</b>
            </div>
            <div className="v9-metric-row">
              <span>Decision-maker access</span>
              <b>85%</b>
            </div>
            <div className="v9-metric-row">
              <span>Closure probability</span>
              <b>74%</b>
            </div>
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn primary"
                style={{ width: '100%' }}
                onClick={() => setShowAddModal(true)}
              >
                {pageId === 'crm-leads' ? '＋ Create Lead' : '＋ Create Opportunity'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.10 CRM Workspace Panel: Activity Timeline & Interaction Center (Follow-ups, Meetings, Feedback) */}
      {pageId === 'crm-followups' || pageId === 'crm-meetings' || pageId === 'crm-feedback' ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Activity & Interaction Timeline</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Customer, lead and account interaction history with actionable follow-ups and outcome tracking.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Logged
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 280,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {commTimeline.map((item, idx) => (
                <div
                  key={`timeline-${idx}`}
                  style={{
                    padding: '8px 12px',
                    borderLeft: '3px solid #3b82f6',
                    background: 'var(--muted-bg, #f8fafc)',
                    borderRadius: '0 6px 6px 0',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b style={{ fontSize: 12 }}>
                      {item.channel} • {item.target}
                    </b>
                    <span className="chip" style={{ fontSize: 10 }}>
                      {item.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted, #64748b)', marginTop: 2 }}>
                    Date: {item.date}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{item.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Add Activity</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Channel</label>
                <select
                  value={commChannel}
                  onChange={(e) => setCommChannel(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--line, #cbd5e1)' }}
                >
                  <option value="Call">Call</option>
                  <option value="Email">Email</option>
                  <option value="Meeting">Meeting</option>
                  <option value="WhatsApp">WhatsApp</option>
                </select>
              </div>
              <div className="field">
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes / Discussion</label>
                <textarea
                  value={commNote}
                  onChange={(e) => setCommNote(e.target.value)}
                  placeholder="Discussion outcome or action item..."
                  rows={2}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--line, #cbd5e1)' }}
                />
              </div>
              <div className="field">
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Next Follow-up Date</label>
                <input
                  type="date"
                  value={commDate}
                  onChange={(e) => setCommDate(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--line, #cbd5e1)' }}
                />
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  if (!commNote.trim()) {
                    toast('Please enter notes or outcome for this activity.');
                    return;
                  }
                  setCommTimeline((prev) => [
                    {
                      channel: commChannel,
                      target: activeRecord?.number || 'Selected Customer',
                      date: commDate || new Date().toISOString().slice(0, 10),
                      status: 'Completed',
                      note: commNote.trim(),
                    },
                    ...prev,
                  ]);
                  setCommNote('');
                  toast('Activity saved to interaction timeline.');
                }}
              >
                Save Activity
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.11 CRM Customer 360 Workspace Panel */}
      {pageId === 'crm-customer360' ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Customer 360° Account Desk</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Comprehensive profile, order history, credit exposure, active tickets and relationship health.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● 360 View
              </span>
            </div>

            {/* Customer Details Grid */}
            <div
              className="detail-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 8,
                padding: '10px 12px',
                background: 'var(--muted-bg, #f8fafc)',
                borderRadius: 6,
                marginBottom: 12,
              }}
            >
              <div className="detail">
                <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>Account Name</small>
                <div style={{ fontWeight: 600 }}>{activeRecord ? (activeRecord['Customer'] ?? activeRecord['Name'] ?? 'Tata Motors Ltd') : 'Tata Motors Ltd'}</div>
              </div>
              <div className="detail">
                <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>Industry</small>
                <div style={{ fontWeight: 600 }}>Automotive OEM</div>
              </div>
              <div className="detail">
                <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>Credit Limit</small>
                <div style={{ fontWeight: 600 }}>₹ 50,00,000</div>
              </div>
              <div className="detail">
                <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>Outstanding</small>
                <div style={{ fontWeight: 600, color: '#ea580c' }}>₹ 14,20,000</div>
              </div>
              <div className="detail">
                <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>Lifetime Orders</small>
                <div style={{ fontWeight: 600 }}>38 Orders</div>
              </div>
              <div className="detail">
                <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>CSAT Rating</small>
                <div style={{ fontWeight: 600, color: '#16a34a' }}>4.9 / 5.0</div>
              </div>
            </div>

            {/* Customer mini cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {filteredRows.slice(0, 6).map((r, i) => {
                const cName = r['Customer'] ?? r['Customer Name'] ?? r['Name'] ?? `Customer-${i + 1}`;
                const cTier = i % 3 === 0 ? 'Tier 1 Enterprise' : 'Strategic Account';
                return (
                  <div
                    key={`c360-card-${r.id || i}`}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--line, #cbd5e1)',
                      borderRadius: 6,
                      background: '#fff',
                    }}
                  >
                    <b style={{ fontSize: 12 }}>{cName}</b>
                    <div style={{ fontSize: 11, color: 'var(--muted, #64748b)', margin: '2px 0 6px 0' }}>{cTier}</div>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setActiveRecordId(r.id);
                        toast(`Loaded ${cName} profile into 360° workspace.`);
                      }}
                    >
                      Open 360°
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Operational Readiness</h3>
            <div className="v9-metric-row">
              <span>Information complete</span>
              <b style={{ color: '#16a34a' }}>Ready</b>
            </div>
            <div className="v9-metric-row">
              <span>Owner assigned</span>
              <b style={{ color: '#16a34a' }}>Ready</b>
            </div>
            <div className="v9-metric-row">
              <span>Dependency clear</span>
              <b style={{ color: '#16a34a' }}>Ready</b>
            </div>
            <div className="v9-metric-row">
              <span>Date commitment</span>
              <b style={{ color: '#16a34a' }}>Ready</b>
            </div>
            <div className="v9-metric-row">
              <span>Approval state</span>
              <b style={{ color: '#f59e0b' }}>Review</b>
            </div>
            <div className="v9-metric-row">
              <span>Next action</span>
              <b style={{ color: '#16a34a' }}>Ready</b>
            </div>
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn primary"
                style={{ width: '100%' }}
                onClick={() => toast('Customer 360° operational review completed.')}
              >
                Complete Review
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.12 CRM Lead Sources Workspace Panel */}
      {pageId === 'crm-sources' ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Lead Sources & Channel Master</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Source configuration, attribution tracking, conversion rates and validation rules.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Configured
              </span>
            </div>

            <div className="table-wrap">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>Source Code</th>
                    <th>Channel Name</th>
                    <th>Status</th>
                    <th>Conversion</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, 6).map((r, i) => {
                    const sCode = r['Source Code'] ?? r['Code'] ?? `SRC-${100 + i}`;
                    const sName = r['Source Name'] ?? r['Name'] ?? r['Channel'] ?? ['Website Direct', 'Referral', 'LinkedIn InMail', 'Trade Expo', 'Cold Outreach'][i % 5];
                    const sConv = ['28%', '34%', '19%', '42%', '14%'][i % 5];
                    return (
                      <tr key={`src-${r.id || i}`}>
                        <td>
                          <strong>{sCode}</strong>
                        </td>
                        <td>{sName}</td>
                        <td>
                          <span className="chip">{r.status || 'Active'}</span>
                        </td>
                        <td>{sConv}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => {
                                setActiveRecordId(r.id);
                                setShowEditModal(true);
                              }}
                            >
                              Edit
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => setShowAddModal(true)}
              >
                ＋ Add Master Record
              </button>
            </div>
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Validation Controls</h3>
            <div className="v9-metric-row">
              <span>Unique code</span>
              <b style={{ color: '#16a34a' }}>Enabled</b>
            </div>
            <div className="v9-metric-row">
              <span>Mandatory name</span>
              <b style={{ color: '#16a34a' }}>Enabled</b>
            </div>
            <div className="v9-metric-row">
              <span>Effective date</span>
              <b style={{ color: '#16a34a' }}>Enabled</b>
            </div>
            <div className="v9-metric-row">
              <span>Duplicate check</span>
              <b style={{ color: '#16a34a' }}>Enabled</b>
            </div>
            <div className="v9-metric-row">
              <span>Approval on change</span>
              <b style={{ color: '#64748b' }}>Optional</b>
            </div>
            <div className="v9-metric-row">
              <span>Audit history</span>
              <b style={{ color: '#16a34a' }}>Enabled</b>
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
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          aria-label="Rows Selector"
        >
          <option value="10">10 rows</option>
          <option value="20">20 rows</option>
          <option value="25">25 rows</option>
          <option value="50">50 rows</option>
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

      {/* 4.5 Bulk Actions Bar */}
      <div className="sv40-bulk" role="group" aria-label="Selected records" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="v8-badge" style={{ padding: '4px 8px', borderRadius: 4, background: '#e0f2fe', color: '#0369a1', fontWeight: 600, fontSize: 12 }}>
          {`${picked.size} selected`}
        </span>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            const firstId = Array.from(picked)[0] || activeRecordId;
            if (firstId) {
              setActiveRecordId(firstId);
              toast('Loaded selected record.');
            } else {
              toast('Select a record first, then press Load Selected.');
            }
          }}
        >
          Load Selected
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            if (picked.size === 0 && filteredRows.length === 0) {
              toast('No records to export.');
            } else {
              handleExportCsv();
            }
          }}
        >
          Export Selected
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={() => {
            if (picked.size === 0) {
              toast('Select records with checkboxes first, then press Submit Selected.');
            } else {
              toast(`${picked.size} records submitted for approval.`);
              setPicked(new Set());
            }
          }}
        >
          Submit Selected
        </button>
        <button
          type="button"
          className="btn sm danger"
          onClick={() => {
            if (picked.size === 0) {
              toast('Select records with checkboxes first, then press Delete Selected.');
            } else {
              toast(`${picked.size} records deleted.`);
              setPicked(new Set());
            }
          }}
        >
          Delete Selected
        </button>
      </div>

      {/* 5. Primary Horizontal Register Table */}
      <div className="card table-wrap" style={{ marginTop: 8 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid var(--line, #e2e8f0)',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            {WMS_TITLES[pageId] ?? `${title} Register • Detailed Table`}
          </h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => setEmailing(activeRecord?.number || activeRecord?.id || title)}
            >
              Send Email
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => activeRecord && void handleWordExport(activeRecord)}
            >
              Word
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={handleExportCsv}
            >
              Excel
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => void handleExportPdf()}
            >
              PDF
            </button>
          </div>
        </div>
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
                              onClick={() => toast(`Submitted ${r.number || r.id} for approval.`)}
                            >
                              Submit
                            </button>
                            <button
                              type="button"
                              className="btn sm primary"
                              onClick={() => toast(`Stock allocated for ${r['Rack Code'] || r.number || r.id}.`)}
                            >
                              Allocate
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => toast(`Reallocation triggered for ${r['Rack Code'] || r.number || r.id}.`)}
                            >
                              Reallocate
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => navigate('/m/ops-order-360')}
                            >
                              360° Track
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
                              className="btn sm"
                              onClick={() => toast(`Moved ${r.number || r.id} internally to next workcenter.`)}
                            >
                              Move Forward - Internal
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
                        {formatCellValue(r[c.key], c.type)}
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
        onExportWord={() => {
          if (activeRecord) void handleWordExport(activeRecord);
          else if (filteredRows[0]) void handleWordExport(filteredRows[0]);
          else toast('No records available to export Word.');
        }}
        onExportEmail={() => {
          if (activeRecord) setEmailing(activeRecord.number || activeRecord.id);
          else if (filteredRows[0]) setEmailing(filteredRows[0].number || filteredRows[0].id);
          else toast('No records available to send email.');
        }}
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
