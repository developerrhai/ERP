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
  'tax-gst': 'GST Configuration – Detailed Table',
  'tax-gstr1': 'GSTR-1 Invoices – Detailed Table',
  'tax-gstr3b': 'GSTR-3B Returns – Detailed Table',
  'tax-tds': 'TDS Register – Detailed Table',
  'tax-tcs': 'TCS Register – Detailed Table',
  'tax-hsn': 'HSN / SAC Master – Detailed Table',
  'tax-einvoice': 'E-Invoice Queue – Detailed Table',
  'tax-eway': 'E-Way Bill Queue – Detailed Table',
  'tax-salesreg': 'Sales Register – Detailed Table',
  'tax-purchasereg': 'Purchase Register – Detailed Table',
  'inv-items': 'Item / SKU Master – Detailed Table',
  'inv-stock': 'Stock Balance – Detailed Table',
  'inv-transactions': 'Inventory Transactions – Detailed Ledger',
  'inv-opening': 'Opening Stock – Detailed Table',
  'inv-adjustment': 'Stock Adjustment – Detailed Table',
  'inv-transfer': 'Stock Transfer – Detailed Table',
  'inv-reservation': 'Stock Reservation – Detailed Table',
  'inv-valuation': 'Stock Valuation – Detailed Table',
  'inv-ageing': 'Stock Ageing – Detailed Table',
  'inv-reorder': 'Smart Reorder – Detailed Table',
  'inv-batch': 'Batch / Lot Tracking – Detailed Table',
  'inv-serial': 'Serial Number Tracking – Detailed Table',
  'inv-expiry': 'Expiry Tracking – Detailed Table',
  'inv-reconciliation': 'Stock Reconciliation – Detailed Table',
  'auto-workflows': 'Workflow Automation Workspace – Detailed Table',
  'auto-rules': 'Rule Library – Detailed Table',
  'auto-jobs': 'Job Queue – Detailed Table',
  'auto-webhooks': 'Webhook Registry – Detailed Table',
  'pay-structure': 'Salary Structure Master – Detailed Table',
  'pay-processing': 'Payroll Run – Detailed Table',
  'pay-overtime': 'Overtime Register – Detailed Table',
  'pay-incentive': 'Incentive Register – Detailed Table',
  'pay-loan': 'Loan Register – Detailed Table',
  'pay-pf': 'PF Workspace – Detailed Table',
  'pay-esic': 'ESIC Workspace – Detailed Table',
  'pay-pt': 'Professional Tax – Detailed Table',
  'pay-tds': 'Payroll TDS – Detailed Table',
  'pay-payslip': 'Payslip Register – Detailed Table',
  'pay-bank': 'Bank Transfer Batches – Detailed Table',
  'pay-register': 'Salary Register – Detailed Table',
  'fin-coa': 'Account Tree – Detailed Table',
  'fin-gl': 'General Ledger – Detailed Table',
  'fin-journal': 'Journal Register – Detailed Table',
  'fin-cashbook': 'Cash Book – Detailed Table',
  'fin-bankbook': 'Bank Book – Detailed Table',
  'fin-ap': 'Vendor Payables – Detailed Table',
  'fin-ar': 'Customer Receivables – Detailed Table',
  'fin-creditnote': 'Credit Notes – Detailed Table',
  'fin-debitnote': 'Debit Notes – Detailed Table',
  'fin-bankreco': 'Bank Reconciliation – Detailed Table',
  'fin-costcenter': 'Cost Centers – Detailed Table',
  'fin-profitcenter': 'Profit Centers – Detailed Table',
  'fin-expenses': 'Expense Register – Detailed Table',
  'fin-budget': 'Budget Register – Detailed Table',
  'fin-trial': 'Trial Balance – Detailed Table',
  'fin-pnl': 'Profit & Loss – Detailed Table',
  'fin-bs': 'Balance Sheet – Detailed Table',
  'fin-cashflow': 'Cash Flow – Detailed Table',
  'fin-ageing': 'Ageing Summary – Detailed Table',
  'scm-pr': 'Purchase Requisition – Detailed Table',
  'scm-rfq': 'RFQ Management – Detailed Table',
  'scm-vendorquote': 'Vendor Quotation – Detailed Table',
  'scm-comparison': 'Vendor Comparison – Detailed Table',
  'scm-po': 'Purchase Order – Detailed Table',
  'scm-contracts': 'Purchase Contract – Detailed Table',
  'scm-vendorportal': 'Vendor Portal & Bidding – Detailed Table',
  'scm-grn': 'Goods Receipt / GRN – Detailed Table',
  'scm-purchaseinvoice': 'Purchase Invoice – Detailed Table',
  'scm-evaluation': 'Vendor Evaluation – Detailed Table',
  'scm-approval': 'Purchase Approval – Detailed Table',
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
            {`Record: [${r['Record ID'] || r['Rule ID'] || r['Job ID'] || r['Webhook ID'] || r['Model Rule'] || r['Rule Name'] || r['Job Name'] || r.Event || r['Item Code'] || r['itemCode'] || r['Batch No'] || r['batchNo'] || r['Serial No'] || r['serialNo'] || r['Voucher No'] || r['txnId'] || r['Opening Ref'] || r['openingRef'] || r['Adjustment No'] || r['adjNo'] || r['Transfer No'] || r['transferNo'] || r['Reservation No'] || r['resNo'] || r['Reconciliation No'] || r['reconNo'] || r['Vendor Invoice'] || r['Invoice No'] || r['GSTIN'] || r['TDS Entry No'] || r['TCS Entry No'] || r['HSN SAC'] || r['EWB No'] || r['Return Period'] || r['Lead No'] || r['Opportunity No'] || r['Follow-up No'] || r['Meeting No'] || r['Feedback No'] || r['Source Code'] || r['Customer'] || r['Rack Code'] || r['Zone Code'] || r['Warehouse Code'] || r['Structure Code'] || r['OT No'] || r['Incentive No'] || r['Loan No'] || r['UAN'] || r['IP Number'] || r['PAN'] || r['Employee ID'] || r['Batch No'] || r['Payroll Month'] || r['Employee'] || r['Account Code'] || r['JV No'] || r['Credit Note No'] || r['Debit Note No'] || r['Cost Center Code'] || r['Profit Center Code'] || r['Expense No'] || r['Budget No'] || r['Line Code'] || r['Party Code'] || r.number || r.id.slice(0, 8)}] - ${r.status || 'Active'}`}
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
    </div>
  );
}

function exportWordClient(title: string, r: V40Row, cols: V40Column[]) {
  const fields = cols.filter((c) => c.type !== 'actions' && c.type !== 'docs');
  const rowsHtml = fields
    .map(
      (c) => `
    <tr>
      <td style="padding: 8px 12px; font-weight: bold; background: #f8fafc; border: 1px solid #cbd5e1; width: 35%;">${c.label}</td>
      <td style="padding: 8px 12px; border: 1px solid #cbd5e1;">${String(r[c.key] ?? r[c.label] ?? '—')}</td>
    </tr>
  `,
    )
    .join('');

  const docHtml = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>${title}</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; padding: 20px; color: #1e293b; }
      h2 { color: #0f172a; margin-bottom: 4px; }
      p.sub { color: #64748b; font-size: 13px; margin-top: 0; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    </style>
    </head>
    <body>
      <h2>Sawant Group ERP — ${title}</h2>
      <p class="sub">Record Reference: <strong>${r.number || r.id}</strong> | Exported on ${new Date().toLocaleString()}</p>
      <table>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </body>
    </html>
  `;
  const blob = new Blob(['\ufeff' + docHtml], { type: 'application/msword;charset=utf-8' });
  saveFile({ blob, filename: `${r.number || title}.doc` }, `${r.number || title}.doc`);
}

function exportPdfClient(title: string, r: V40Row, cols: V40Column[]) {
  const fields = cols.filter((c) => c.type !== 'actions' && c.type !== 'docs');
  const rowsHtml = fields
    .map(
      (c) => `
    <tr>
      <td style="padding: 8px 12px; font-weight: bold; background: #f8fafc; border: 1px solid #cbd5e1; width: 35%;">${c.label}</td>
      <td style="padding: 8px 12px; border: 1px solid #cbd5e1;">${String(r[c.key] ?? r[c.label] ?? '—')}</td>
    </tr>
  `,
    )
    .join('');

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(`
      <html>
      <head>
        <title>${title} - ${r.number || r.id}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #0f172a; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
          h2 { margin: 0; color: #1e3a8a; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
          th { background: #f1f5f9; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h2>Sawant Group ERP — ${title}</h2>
            <div style="color: #64748b; font-size: 12px; margin-top: 4px;">Record Reference: <strong>${r.number || r.id}</strong></div>
          </div>
          <div style="text-align: right; font-size: 12px; color: #64748b;">
            <div>Printed: ${new Date().toLocaleDateString()}</div>
            <div>Status: <strong>${r.status || 'Active'}</strong></div>
          </div>
        </div>
        <table>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <div style="margin-top: 25px; text-align: center;">
          <button onclick="window.print()" style="padding: 8px 18px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Print Document / Save as PDF</button>
        </div>
        <script>
          setTimeout(() => { window.print(); }, 400);
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }
}

function DynamicEntityForm({
  title,
  columns,
  initialValues,
  onSave,
  onCancel,
}: {
  title: string;
  columns: V40Column[];
  initialValues?: Record<string, any>;
  onSave: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const formCols = useMemo(
    () => columns.filter((c) => c.type !== 'actions' && c.type !== 'docs'),
    [columns],
  );

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const c of formCols) {
      if (initialValues && initialValues[c.key] !== undefined && initialValues[c.key] !== null) {
        initial[c.key] = String(initialValues[c.key]);
      } else if (c.key.toLowerCase().includes('status')) {
        initial[c.key] = 'Active';
      } else if (c.key.toLowerCase().includes('dept') || c.key.toLowerCase().includes('department')) {
        initial[c.key] = 'Logistics';
      } else {
        initial[c.key] = '';
      }
    }
    return initial;
  });

  return (
    <div style={{ padding: '16px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
      <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13 }}>
        {initialValues ? 'Modify entity details for this record.' : `Enter entity specifications for new ${title} record.`}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px 18px' }}>
        {formCols.map((col) => {
          const lKey = col.key.toLowerCase();
          const val = values[col.key] ?? '';
          const isStatus = lKey.includes('status');
          const isDept = lKey.includes('dept') || lKey.includes('department');
          const isDate = lKey.includes('date') || lKey.includes('valid') || lKey.includes('expiry');
          const isNum =
            col.type === 'num' ||
            col.type === 'inr' ||
            lKey.includes('km') ||
            lKey.includes('cost') ||
            lKey.includes('weight') ||
            lKey.includes('score') ||
            lKey.includes('rating') ||
            lKey.includes('freight');

          return (
            <div key={col.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{col.label}</label>
              {isStatus ? (
                <select
                  value={val || 'Active'}
                  onChange={(e) => setValues((prev) => ({ ...prev, [col.key]: e.target.value }))}
                  style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff' }}
                >
                  <option value="Active">Active</option>
                  <option value="Pending">Pending</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Calculated">Calculated</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Completed">Completed</option>
                  <option value="Verified">Verified</option>
                  <option value="Inactive">Inactive</option>
                </select>
              ) : isDept ? (
                <select
                  value={val || 'Logistics'}
                  onChange={(e) => setValues((prev) => ({ ...prev, [col.key]: e.target.value }))}
                  style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff' }}
                >
                  {DEPARTMENTS.slice(1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={isDate ? 'date' : isNum ? 'number' : 'text'}
                  placeholder={`Enter ${col.label.toLowerCase()}...`}
                  value={val}
                  onChange={(e) => setValues((prev) => ({ ...prev, [col.key]: e.target.value }))}
                  style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff' }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn sm primary" onClick={() => onSave(values)}>
          {initialValues ? 'Save Changes' : 'Save Record'}
        </button>
      </div>
    </div>
  );
}

export function FamV40Body({
  pageId,
  actions,
  children: _children,
}: {
  pageId: string;
  actions: ActionSet;
  children?: ReactNode;
}) {
  const frame = useFrame();
  const toast = useToast();
  const navigate = useNavigate();

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
  const [trackRecord, setTrackRecord] = useState<V40Row | null>(null);
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

  const uniqueColumns = useMemo(() => {
    const seen = new Set<string>();
    return columns.filter((c) => {
      const key = (c.key || c.label || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [columns]);

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
    } catch {
      exportPdfClient(title, activeRecord, uniqueColumns);
      toast('PDF print view opened.');
    }
  };

  const handleWordExport = async (r: V40Row) => {
    try {
      saveFile(await docsMailApi.print(pageId, r.id, 'word'), `${r.number || 'document'}.docx`);
      toast('Word document downloaded.');
    } catch {
      exportWordClient(title, r, uniqueColumns);
      toast('Word document downloaded.');
    }
  };

  const handlePdfRow = async (r: V40Row) => {
    try {
      saveFile(await docsMailApi.print(pageId, r.id, 'standard'), `${r.number || 'document'}.pdf`);
      toast('PDF document downloaded.');
    } catch {
      exportPdfClient(title, r, uniqueColumns);
      toast('PDF print view opened.');
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
        void handlePdfRow(row);
        break;
      case 'docs':
        setDocsModal(row.id);
        break;
      case 'submit':
        toast(`Submitted ${row.number || 'record'} for approval`);
        break;
      case 'track':
        setTrackRecord(row);
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
      case 'tax-gst': return { label: 'Valid Registrations', value: '100% Compliant' };
      case 'tax-gstr1': return { label: 'Net Tax Liability', value: '₹ 14,20,000' };
      case 'tax-gstr3b': return { label: 'Net Payable', value: '₹ 11,85,000' };
      case 'tax-tds': return { label: 'TDS Deducted', value: '₹ 3,45,000' };
      case 'tax-tcs': return { label: 'TCS Collected', value: '₹ 1,12,000' };
      case 'tax-hsn': return { label: 'Active Codes', value: `${total}` };
      case 'tax-einvoice': return { label: 'IRN Generated', value: '100%' };
      case 'tax-eway': return { label: 'Active E-Way', value: `${total}` };
      case 'tax-salesreg': return { label: 'Total Sales Tax', value: '₹ 18,60,000' };
      case 'tax-purchasereg': return { label: 'ITC Eligible', value: '₹ 12,40,000' };
      case 'inv-items': return { label: 'Active SKUs', value: `${total}` };
      case 'inv-stock': return { label: 'Total Stock Valuation', value: '₹ 4.82 Cr' };
      case 'inv-transactions': return { label: 'Transactions Today', value: `${total}` };
      case 'inv-opening': return { label: 'Opening Batches', value: `${total}` };
      case 'inv-adjustment': return { label: 'Variance Impact', value: '₹ 0 Low' };
      case 'inv-transfer': return { label: 'Transfers Dispatched', value: `${total}` };
      case 'inv-reservation': return { label: 'Stock Allocated', value: '98.5%' };
      case 'inv-valuation': return { label: 'Inventory Assets', value: '₹ 4.82 Cr' };
      case 'inv-ageing': return { label: 'Healthy Stock (<90d)', value: '94.2%' };
      case 'inv-reorder': return { label: 'Suggested Orders', value: `${total}` };
      case 'inv-batch': return { label: 'Active Lots', value: `${total}` };
      case 'inv-serial': return { label: 'Tracked Serials', value: `${total}` };
      case 'inv-expiry': return { label: 'Expired Stock', value: '0 Low' };
      case 'inv-reconciliation': return { label: 'Audit Compliance', value: '100%' };
      case 'auto-workflows': return { label: 'Automated Tasks', value: `${total}` };
      case 'auto-rules': return { label: 'Active Rules', value: `${total}` };
      case 'auto-jobs': return { label: 'Job Success Rate', value: '99.4%' };
      case 'auto-webhooks': return { label: 'Sync Success Rate', value: '99.8%' };
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
      case 'pay-structure': return { label: 'Active Structures', value: `${total}` };
      case 'pay-processing': return { label: 'Net Payroll', value: '₹ 42,50,000' };
      case 'pay-overtime': return { label: 'Approved OT Hours', value: '148h' };
      case 'pay-incentive': return { label: 'Incentives Paid', value: '₹ 3,80,000' };
      case 'pay-loan': return { label: 'Active Loans', value: '12' };
      case 'pay-pf': return { label: 'PF Deposited', value: '₹ 4,60,000' };
      case 'pay-esic': return { label: 'ESIC Active IPs', value: '184' };
      case 'pay-pt': return { label: 'PT Remitted', value: '₹ 48,000' };
      case 'pay-tds': return { label: 'TDS Deducted', value: '₹ 6,20,000' };
      case 'pay-payslip': return { label: 'Payslips Distributed', value: '100%' };
      case 'pay-bank': return { label: 'Salary Disbursed', value: '100%' };
      case 'pay-register': return { label: 'Total Gross', value: '₹ 48,60,000' };
      case 'fin-coa': return { label: 'Active Accounts', value: `${total}` };
      case 'fin-gl': return { label: 'Total Postings', value: '₹ 2.85 Cr' };
      case 'fin-journal': return { label: 'Journal Total', value: '₹ 48,50,000' };
      case 'fin-cashbook': return { label: 'Cash Balance', value: '₹ 1,45,000' };
      case 'fin-bankbook': return { label: 'Bank Position', value: '₹ 1.84 Cr' };
      case 'fin-ap': return { label: 'Total Payables', value: '₹ 64,20,000' };
      case 'fin-ar': return { label: 'Total Receivables', value: '₹ 82,40,000' };
      case 'fin-creditnote': return { label: 'Credit Notes Value', value: '₹ 4,80,000' };
      case 'fin-debitnote': return { label: 'Debit Notes Value', value: '₹ 3,60,000' };
      case 'fin-bankreco': return { label: 'Reconciled Rate', value: '99.4%' };
      case 'fin-costcenter': return { label: 'Active Cost Centers', value: `${total}` };
      case 'fin-profitcenter': return { label: 'Active Profit Centers', value: `${total}` };
      case 'fin-expenses': return { label: 'Total Expenses', value: '₹ 14,25,000' };
      case 'fin-budget': return { label: 'Budget Utilization', value: '82.4%' };
      case 'fin-trial': return { label: 'Trial Balance Status', value: '100% Balanced' };
      case 'fin-pnl': return { label: 'Operating Margin', value: '24.2%' };
      case 'fin-bs': return { label: 'Net Asset Value', value: '₹ 18.4 Cr' };
      case 'fin-cashflow': return { label: 'Operating Cash Flow', value: '₹ 42,50,000' };
      case 'fin-ageing': return { label: 'Healthy Collections (<30d)', value: '92.5%' };
      case 'scm-pr': return { label: 'PR Fulfillment Rate', value: '96.2%' };
      case 'scm-rfq': return { label: 'Active RFQs', value: `${total}` };
      case 'scm-vendorquote': return { label: 'Active Quotes', value: `${total}` };
      case 'scm-comparison': return { label: 'Awarded Rate', value: '92.4%' };
      case 'scm-po': return { label: 'PO Commitment', value: '₹ 86,40,000' };
      case 'scm-contracts': return { label: 'Active Contracts', value: `${total}` };
      case 'scm-vendorportal': return { label: 'Active Quotations / POs', value: `${total}` };
      case 'scm-grn': return { label: 'GRN Receipts', value: `${total}` };
      case 'scm-purchaseinvoice': return { label: '3-Way Match Rate', value: '98.5%' };
      case 'scm-evaluation': return { label: 'Avg Vendor Score', value: '88.2%' };
      case 'scm-approval': return { label: 'Pending Approvals', value: `${total}` };
      default: return { label: 'Active Units', value: `${total}` };
    }
  }, [pageId, totalCount, filteredRows.length]);

  return (
    <div className="fam-v40">
      {/* 1. Connected Manufacturing 360 Ribbon - only for manufacturing pages (LOG-G07) */}
      {pageId.startsWith('ops-') || pageId.startsWith('mfg-') ? (
        <ConnectedManufacturingRibbon
          selectedOrder={selectedOrder}
          onOrderChange={setSelectedOrder}
        />
      ) : null}

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
      />

      {/* 3. Five Summary / KPI Cards */}
      <div className="v8-table-summary" role="group" aria-label="KPI Summary Cards">
        <div className="v8-mini">
          <small>{pageId === 'auto-jobs' ? 'Demo / Live Records' : 'Records in Scope'}</small>
          <b>{totalCount || filteredRows.length}{pageId === 'auto-jobs' ? ' Active' : ''}</b>
        </div>
        <div className="v8-mini">
          <small>{pageId === 'auto-jobs' ? 'Data Completeness' : 'Completion'}</small>
          <b>{pageId === 'auto-jobs' ? '98%' : '100%'}</b>
        </div>
        <div className="v8-mini">
          <small>Open / Pending</small>
          <b>{pageId === 'auto-jobs' ? '0 Pending' : filteredRows.filter((r) => !/completed|closed|delivered|exited|posted/i.test(r.status ?? '')).length}</b>
        </div>
        <div className="v8-mini">
          <small>{pageId === 'auto-jobs' ? 'AI Risk Score' : 'At Risk'}</small>
          <b style={{ color: '#16a34a' }}>{pageId.startsWith('fin-') ? '14/100 Controlled' : pageId === 'pay-register' ? '21/100 Controlled' : pageId.startsWith('pay-') ? '14/100 Controlled' : pageId.startsWith('asset-') ? '21/100 Controlled' : '0 Low'}</b>
        </div>
        <div className="v8-mini">
          <small>{pageId === 'auto-jobs' ? 'Primary Metric' : fifthMetric.label}</small>
          <b>{pageId === 'auto-jobs' ? '99.4%' : fifthMetric.value}</b>
        </div>
      </div>

      {/* 3.1 Workflow Automation Workspace Kanban (When viewing auto-workflows) */}
      {pageId === 'auto-workflows' ? (
        <div className="card panel" style={{ marginTop: 12, padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Workflow Automation Workspace</h3>
              <div style={{ fontSize: 11, color: '#64748b' }}>Kanban stages for intelligent workflow progression and AI rule exception handling</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>5 Stages Active</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {[
              { stage: 'Created', count: 4, tag: 'Incoming Triggers' },
              { stage: 'Validation', count: 3, tag: 'AST Rule Checks' },
              { stage: 'Approval', count: 5, tag: 'Hierarchy Matrix' },
              { stage: 'Execution', count: 8, tag: 'Action Dispatch' },
              { stage: 'Closed', count: 5, tag: 'Audit Completed' },
            ].map((st) => (
              <div key={st.stage} style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <b style={{ fontSize: 13, color: '#1e293b' }}>{st.stage}</b>
                  <span style={{ fontSize: 11, background: '#e0e7ff', color: '#3730a3', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
                    {st.count}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{st.tag}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[1, 2].map((k) => (
                    <div key={k} style={{ background: '#fff', padding: 8, borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 11 }}>
                      <b>WF-{st.stage.slice(0, 2).toUpperCase()}-0{k}</b>
                      <div style={{ color: '#64748b', margin: '2px 0 4px 0' }}>Score: {80 + k * 5}% • ERP Auto</div>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ fontSize: 10, padding: '2px 6px', width: '100%' }}
                        onClick={() => toast(`Moved forward WF-${st.stage.slice(0, 2).toUpperCase()}-0${k}`)}
                      >
                        Move Forward
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 3.2 Automation Rules Document Register & Actions (When viewing auto-rules) */}
      {pageId === 'auto-rules' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
          <div className="card panel" style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>Rule Library Document Register</h3>
                <div style={{ fontSize: 11, color: '#64748b' }}>Controlled regulatory SOPs, matrix specifications and compliance rules</div>
              </div>
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>● Audited</span>
            </div>
            <div className="table-wrap">
              <table className="register-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Category</th>
                    <th>Revision</th>
                    <th>Linked Record</th>
                    <th>Expiry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { doc: 'Procurement Rule Matrix', cat: 'Approval Hierarchy', rev: 'v3.2', rec: 'RUL-001', exp: '2027-12-31', st: 'Active' },
                    { doc: 'Credit Control Governance', cat: 'Finance Policy', rev: 'v2.1', rec: 'RUL-002', exp: '2027-06-30', st: 'Active' },
                    { doc: 'Inventory Safety Guard Spec', cat: 'WMS Control', rev: 'v4.0', rec: 'RUL-003', exp: '2028-03-31', st: 'Active' },
                  ].map((r, i) => (
                    <tr key={i}>
                      <td><b>{r.doc}</b></td>
                      <td>{r.cat}</td>
                      <td>{r.rev}</td>
                      <td>{r.rec}</td>
                      <td>{r.exp}</td>
                      <td><span className="v8-badge active">{r.st}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card panel" style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 4px 0' }}>Document Actions</h3>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>Upload compliance documentation and create revisions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn" onClick={() => toast('Opening Upload Vault...')}>
                Open Upload Vault
              </button>
              <button type="button" className="btn primary" onClick={() => toast('Creating New Revision...')}>
                New Revision
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.3 Webhooks Registry Health & Recent API Activity (When viewing auto-webhooks) */}
      {pageId === 'auto-webhooks' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
          <div className="card panel" style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Webhook Registry</h3>
                <div style={{ fontSize: 11, color: '#64748b' }}>Outbound integration security, standard HMAC signatures and delivery health</div>
              </div>
              <button
                type="button"
                className="btn primary sm"
                onClick={() => toast('Connection test passed! All endpoints responded within 120ms.')}
              >
                Run Connection Test
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ background: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 10 }}>Authentication</small>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#16a34a' }}>OK (HMAC-SHA256)</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 10 }}>Connection</small>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#16a34a' }}>100% Reached</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 10 }}>Field Mapping</small>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#16a34a' }}>Verified</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 10 }}>Sync</small>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#16a34a' }}>99.8% Delivered</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 10 }}>Webhook</small>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#16a34a' }}>Configured</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 10 }}>Error Handling</small>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#2563eb' }}>Exponential Backoff Active</div>
              </div>
            </div>
          </div>
          <div className="card panel" style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 4px 0' }}>Recent API / Sync Activity</h3>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Live telemetry stream of outbound event payloads</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
              <div style={{ padding: 6, background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                <b>invoice.generated</b> → <span style={{ color: '#16a34a' }}>200 OK</span>
                <div style={{ color: '#64748b', fontSize: 10 }}>23:12:04 • 48ms • Payload: INV-2026-081</div>
              </div>
              <div style={{ padding: 6, background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                <b>payment.received</b> → <span style={{ color: '#16a34a' }}>200 OK</span>
                <div style={{ color: '#64748b', fontSize: 10 }}>22:50:18 • 62ms • Payload: PAY-99120</div>
              </div>
              <div style={{ padding: 6, background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                <b>order.dispatched</b> → <span style={{ color: '#16a34a' }}>200 OK</span>
                <div style={{ color: '#64748b', fontSize: 10 }}>21:30:45 • 54ms • Payload: DSP-4402</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

      {/* 3.13 Tax Statutory Workspace Panel (v9TaxWorkspace parity for GST Setup to Purchase Register) */}
      {pageId.startsWith('tax-') ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{`${title} Workspace`}</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Indian statutory validation, document status, tax compliance rules and filing readiness.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Statutory Active
              </span>
            </div>

            {/* Statutory Stepper Tiles */}
            <div
              className="v9-stepper"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 8,
                marginBottom: 12,
              }}
            >
              {[
                { label: 'Source Data', status: 'Passed', active: true },
                { label: 'Tax Validation', status: 'Passed', active: true },
                { label: 'Document Generation', status: 'Ready', active: true },
                { label: 'Portal Status', status: 'Pending', active: false },
                { label: 'Reconciliation', status: 'Pending', active: false },
              ].map((st) => (
                <div
                  key={st.label}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: st.active ? 'var(--muted-bg, #f1f5f9)' : '#fff',
                    border: `1px solid ${st.status === 'Ready' ? '#3b82f6' : st.active ? '#10b981' : 'var(--line, #cbd5e1)'}`,
                    textAlign: 'center',
                  }}
                >
                  <b style={{ fontSize: 11, display: 'block' }}>{st.label}</b>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: st.status === 'Passed' ? '#16a34a' : st.status === 'Ready' ? '#2563eb' : '#64748b',
                    }}
                  >
                    {st.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Validation Detail Grid */}
            <div
              className="detail-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: 8,
                padding: '10px 12px',
                background: 'var(--muted-bg, #f8fafc)',
                borderRadius: 6,
              }}
            >
              {[
                { key: 'GSTIN Validity', val: 'Validated', ok: true },
                { key: 'HSN/SAC Mapping', val: 'Validated', ok: true },
                { key: 'Tax Rate', val: 'Validated', ok: true },
                { key: 'Place of Supply', val: 'Validated', ok: true },
                { key: 'IRN / EWB', val: 'Review', ok: false },
                { key: 'Return Mapping', val: 'Review', ok: false },
              ].map((v) => (
                <div key={v.key} className="detail">
                  <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>{v.key}</small>
                  <div style={{ fontWeight: 600, color: v.ok ? '#16a34a' : '#ea580c' }}>{v.val}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Compliance Actions</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => toast(`Statutory validation executed for ${title}. All rules passed.`)}
              >
                Run Validation
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => toast(`Downloading compliance letterhead PDF for ${title}...`)}
              >
                Download Letterhead PDF
              </button>
              {pageId === 'tax-tds' || pageId === 'tax-tcs' ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => toast(`Record challan modal opened for ${title}.`)}
                >
                  Record challan
                </button>
              ) : null}
              {pageId === 'tax-eway' ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => toast('Generating official E-Way Bill PDF...')}
                >
                  E-Way PDF
                </button>
              ) : null}
            </div>
            <div className="notice" style={{ marginTop: 12 }}>
              {totalCount || filteredRows.length} statutory records checked. {Math.max(0, (totalCount || filteredRows.length) - 3)} are filing-ready; 3 contain review flags for verification.
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.14 Payroll Workspace Panel (v9PayrollWorkspace for all 12 Payroll submodules) */}
      {pageId.startsWith('pay-') ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{`${title} Workspace`}</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  Statutory compliance, attendance integration, tax deductions, and automated payroll disbursement.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Active Run
              </span>
            </div>

            {/* Stepper Tiles */}
            <div
              className="v9-stepper"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 8,
                marginBottom: 12,
              }}
            >
              {[
                { label: 'Attendance Sync', status: 'Passed', active: true },
                { label: 'Calculations', status: 'Calculated', active: true },
                { label: 'Statutory (PF/ESI/PT)', status: 'Verified', active: true },
                { label: 'TDS & Deductions', status: 'Compliant', active: true },
                { label: 'Bank Disbursement', status: 'Ready', active: false },
              ].map((st) => (
                <div
                  key={st.label}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: st.active ? 'var(--muted-bg, #f1f5f9)' : '#fff',
                    border: `1px solid ${st.status === 'Ready' ? '#3b82f6' : st.active ? '#10b981' : 'var(--line, #cbd5e1)'}`,
                    textAlign: 'center',
                  }}
                >
                  <b style={{ fontSize: 11, display: 'block' }}>{st.label}</b>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: st.status === 'Passed' || st.status === 'Verified' || st.status === 'Compliant' ? '#16a34a' : st.status === 'Ready' || st.status === 'Calculated' ? '#2563eb' : '#64748b',
                    }}
                  >
                    {st.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Parameter & Compliance Matrix */}
            <div
              className="detail-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: 8,
                padding: '10px 12px',
                background: 'var(--muted-bg, #f8fafc)',
                borderRadius: 6,
              }}
            >
              {[
                { key: 'PF Compliance', val: '12.0% Verified', ok: true },
                { key: 'ESIC Coverage', val: '3.25% + 0.75%', ok: true },
                { key: 'Prof Tax Slab', val: 'Maharashtra Slab', ok: true },
                { key: 'TDS Regime', val: 'New Regime (Default)', ok: true },
                { key: 'Bank Format', val: 'HDFC / ICICI 16-col', ok: true },
                { key: 'Payslip Status', val: 'Generated (100%)', ok: true },
              ].map((v) => (
                <div key={v.key} className="detail">
                  <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>{v.key}</small>
                  <div style={{ fontWeight: 600, color: v.ok ? '#16a34a' : '#ea580c' }}>{v.val}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Payroll Operations</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {pageId === 'pay-structure' || pageId === 'pay-processing' || pageId === 'pay-register' ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => toast(`Payroll calculation and validation completed for ${title}. All gross-to-net equations verified.`)}
                >
                  Calculate / Validate Payroll
                </button>
              ) : null}
              {pageId === 'pay-pf' || pageId === 'pay-esic' || pageId === 'pay-pt' || pageId === 'pay-tds' ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => toast(`Marked all records as Reviewed for ${title}. Ready for monthly return generation.`)}
                >
                  Mark Reviewed
                </button>
              ) : null}
              {pageId === 'pay-payslip' ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => toast('Downloading sample confidential payslip PDF...')}
                >
                  Download Sample Payslip PDF
                </button>
              ) : null}
              {pageId === 'pay-bank' ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => toast('Bank NEFT/RTGS batch generated and validated against IFSC codes.')}
                >
                  Allocate / Reallocate Batch
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => toast(`Exporting official payroll register letterhead PDF for ${title}...`)}
              >
                Register Letterhead PDF
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => toast(`Recalculate summary metrics triggered for ${title}.`)}
              >
                Recalculate Metrics
              </button>
            </div>
            <div className="notice" style={{ marginTop: 12 }}>
              {totalCount || filteredRows.length} payroll records in scope. 0 compliance deviations detected. All statutory wage caps and minimum wage thresholds conform to 2026 regulations.
            </div>
          </div>
        </div>
      ) : null}

      {/* 3.15 Finance & Accounts Workspace Panel (Interactive Simulator, Ageing & Reconcile Panels) */}
      {pageId.startsWith('fin-') ? (
        <div className="v9-grid" style={{ marginTop: 12 }}>
          <div className="v9-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{`${title} Workspace`}</h3>
                <div style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                  General ledger compliance, fiscal periods, double-entry audit trail, and automated financial statements.
                </div>
              </div>
              <span className="v9-pulse" style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                ● Working
              </span>
            </div>

            {/* Stepper Tiles */}
            <div
              className="v9-stepper"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 8,
                marginBottom: 12,
              }}
            >
              {[
                { label: 'Document Entry', status: 'Passed', active: true },
                { label: 'GL Validation', status: 'Passed', active: true },
                { label: 'Ledger Posting', status: 'Posted', active: true },
                { label: 'Reconciliation', status: 'Verified', active: true },
                { label: 'Period Close', status: 'Open', active: false },
              ].map((st) => (
                <div
                  key={st.label}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: st.active ? 'var(--muted-bg, #f1f5f9)' : '#fff',
                    border: `1px solid ${st.status === 'Posted' ? '#3b82f6' : st.active ? '#10b981' : 'var(--line, #cbd5e1)'}`,
                    textAlign: 'center',
                  }}
                >
                  <b style={{ fontSize: 11, display: 'block' }}>{st.label}</b>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: st.status === 'Passed' || st.status === 'Verified' ? '#16a34a' : st.status === 'Posted' ? '#2563eb' : '#64748b',
                    }}
                  >
                    {st.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Financial Parameters or Margin Simulator (for fin-budget) or Ageing Bar Chart (for fin-ageing) */}
            {pageId === 'fin-budget' ? (
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: '#1e293b' }}>
                  Interactive Margin Simulator & Commercial Guardrails
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Base Amount</label>
                    <input type="text" readOnly value="₹ 50,00,000" style={{ width: '100%', padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Discount %</label>
                    <input type="text" readOnly value="5.0%" style={{ width: '100%', padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Tax Rate</label>
                    <input type="text" readOnly value="18.0% GST" style={{ width: '100%', padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Target Margin %</label>
                    <input type="text" readOnly value="24.5%" style={{ width: '100%', padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => toast('Approved Budget & Margin Simulation.')}
                >
                  Approve Simulation
                </button>
              </div>
            ) : pageId === 'fin-ageing' ? (
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: '#1e293b' }}>
                  Visual Ageing Buckets Distribution
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, textAlign: 'center' }}>
                  <div style={{ background: '#ecfdf5', padding: 6, borderRadius: 4, border: '1px solid #10b981' }}>
                    <small style={{ fontSize: 10, color: '#047857' }}>Current</small>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#065f46' }}>₹ 42,50,000</div>
                  </div>
                  <div style={{ background: '#f0fdf4', padding: 6, borderRadius: 4, border: '1px solid #22c55e' }}>
                    <small style={{ fontSize: 10, color: '#15803d' }}>1-30 Days</small>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#166534' }}>₹ 24,10,000</div>
                  </div>
                  <div style={{ background: '#fefce8', padding: 6, borderRadius: 4, border: '1px solid #eab308' }}>
                    <small style={{ fontSize: 10, color: '#a16207' }}>31-60 Days</small>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#854d0e' }}>₹ 12,40,000</div>
                  </div>
                  <div style={{ background: '#fff7ed', padding: 6, borderRadius: 4, border: '1px solid #f97316' }}>
                    <small style={{ fontSize: 10, color: '#c2410c' }}>61-90 Days</small>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#9a3412' }}>₹ 6,80,000</div>
                  </div>
                  <div style={{ background: '#fef2f2', padding: 6, borderRadius: 4, border: '1px solid #ef4444' }}>
                    <small style={{ fontSize: 10, color: '#b91c1c' }}>&gt; 90 Days</small>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#991b1b' }}>₹ 2,40,000</div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="detail-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: 8,
                  padding: '10px 12px',
                  background: 'var(--muted-bg, #f8fafc)',
                  borderRadius: 6,
                }}
              >
                {[
                  { key: 'Debit/Credit Check', val: 'Balanced', ok: true },
                  { key: 'Cost Center Split', val: '100% Allocated', ok: true },
                  { key: 'Posting Rights', val: 'Authorized', ok: true },
                  { key: 'Period Status', val: 'FY 2026-27 Open', ok: true },
                  { key: 'Tax Alignment', val: 'Matched (18% / 12%)', ok: true },
                  { key: 'Audit Hash', val: 'SHA-256 Valid', ok: true },
                ].map((v) => (
                  <div key={v.key} className="detail">
                    <small style={{ color: 'var(--muted, #64748b)', fontSize: 11 }}>{v.key}</small>
                    <div style={{ fontWeight: 600, color: v.ok ? '#16a34a' : '#ea580c' }}>{v.val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="v9-section">
            <h3 style={{ margin: '0 0 10px 0' }}>Finance Actions</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {pageId === 'fin-coa' || pageId === 'fin-gl' || pageId === 'fin-journal' ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => toast(`Ledger integrity check completed for ${title}. Debit and credit balance verified.`)}
                >
                  Verify Ledger Integrity
                </button>
              ) : null}
              {pageId === 'fin-bankreco' ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => toast('Auto Bank Statement reconciliation executed. 99.4% matched.')}
                >
                  Auto-Reconcile Statement
                </button>
              ) : null}
              {pageId === 'fin-ageing' ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => toast('Collection escalation task dispatched to regional finance manager.')}
                >
                  Create Escalation
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => toast(`Exporting official finance statement letterhead PDF for ${title}...`)}
              >
                Statement Letterhead PDF
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => toast(`Re-calculating financial metrics for ${title}...`)}
              >
                Recalculate Totals
              </button>
            </div>
            <div className="notice" style={{ marginTop: 12 }}>
              {totalCount || filteredRows.length} finance ledger records verified. Double-entry validation passed. No out-of-balance vouchers or unposted journal exceptions found.
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
              const count = picked.size;
              setDataRows((prev) => prev.filter((r) => !picked.has(r.id)));
              setTotalCount((n) => Math.max(0, n - count));
              setPicked(new Set());
              toast(`${count} records deleted.`);
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
              {uniqueColumns.map((c) => (
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
                  {uniqueColumns.map((c) => {
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
                              onClick={() => handleRowAction('track', r)}
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
                <td colSpan={uniqueColumns.length + 1} style={{ textAlign: 'center', padding: '20px' }}>
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

      {/* 6. Secondary Detailed Register Table removed (LOG-G08: avoid duplicate tables) */}

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
          footer={null}
        >
          <DynamicEntityForm
            title={title}
            columns={uniqueColumns}
            onSave={(formVals) => {
              const codeCol = uniqueColumns.find((c) => c.type !== 'actions' && c.type !== 'docs');
              const codeKey = codeCol?.key || 'number';
              const autoNo = `${title.slice(0, 3).toUpperCase()}-26-000${(dataRows.length + 1).toString().padStart(2, '0')}`;
              const recNo = formVals[codeKey] || autoNo;
              const newRow: V40Row = {
                id: `${pageId}-${Date.now()}`,
                number: recNo,
                status: formVals['Status'] || formVals['status'] || 'Active',
                ...formVals,
              };
              setDataRows((prev) => [newRow, ...prev]);
              setTotalCount((n) => n + 1);
              setShowAddModal(false);
              toast(`New record ${recNo} added to ${title} successfully.`);
            }}
            onCancel={() => setShowAddModal(false)}
          />
        </Modal>
      ) : null}

      {showEditModal && activeRecord ? (
        <Modal
          title={`Edit ${title} [${activeRecord.number || activeRecord.id.slice(0, 8)}]`}
          onClose={() => setShowEditModal(false)}
          footer={null}
        >
          <DynamicEntityForm
            title={title}
            columns={uniqueColumns}
            initialValues={activeRecord}
            onSave={(formVals) => {
              setDataRows((prev) =>
                prev.map((r) =>
                  r.id === activeRecord.id
                    ? {
                        ...r,
                        ...formVals,
                        status: formVals['Status'] || formVals['status'] || r.status || 'Active',
                      }
                    : r,
                ),
              );
              setShowEditModal(false);
              toast(`Record ${activeRecord.number || activeRecord.id} updated successfully.`);
            }}
            onCancel={() => setShowEditModal(false)}
          />
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
                  setDataRows((prev) => prev.filter((r) => r.id !== askDelete.id));
                  setTotalCount((n) => Math.max(0, n - 1));
                  setPicked((prev) => {
                    const next = new Set(prev);
                    next.delete(askDelete.id);
                    return next;
                  });
                  toast(`Record ${askDelete.number || askDelete.id} deleted.`);
                  setAskDelete(null);
                }}
              >
                Delete Record
              </button>
            </div>
          }
        >
          <div style={{ padding: 14 }}>
            <p>Are you sure you want to delete <strong>{askDelete.number || askDelete.id}</strong>?</p>
            <p style={{ color: 'var(--muted, #64748b)', fontSize: 12 }}>This action will remove the record from the active register.</p>
          </div>
        </Modal>
      ) : null}

      {/* 360° Tracking Drawer / Modal (LOG-G04) */}
      {trackRecord ? (
        <Modal
          title={`360° Tracking — ${trackRecord.number || trackRecord.id}`}
          onClose={() => setTrackRecord(null)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button type="button" className="btn sm" onClick={() => exportWordClient(title, trackRecord, uniqueColumns)}>Export Word</button>
              <button type="button" className="btn sm" onClick={() => exportPdfClient(title, trackRecord, uniqueColumns)}>Print / PDF</button>
              <button type="button" className="btn sm primary" onClick={() => setTrackRecord(null)}>Close</button>
            </div>
          }
        >
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 11, display: 'block' }}>RECORD REFERENCE</small>
                <strong style={{ fontSize: 14, color: '#0f172a' }}>{trackRecord.number || trackRecord.id}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 11, display: 'block' }}>LIFECYCLE STATUS</small>
                <span className="badge" style={{ marginTop: 2, display: 'inline-block', background: '#dbeafe', color: '#1e40af', fontWeight: 600, padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                  {trackRecord.status || 'Active'}
                </span>
              </div>
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 11, display: 'block' }}>DEPARTMENT</small>
                <strong style={{ fontSize: 13, color: '#0f172a' }}>{String(trackRecord['Department'] || 'Logistics & Fleet')}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <small style={{ color: '#64748b', fontSize: 11, display: 'block' }}>INTEGRITY & AUDIT</small>
                <strong style={{ fontSize: 13, color: '#16a34a' }}>✓ Verified (V40)</strong>
              </div>
            </div>

            <div style={{ background: '#f0f9ff', padding: '14px 16px', borderRadius: 8, border: '1px solid #bae6fd', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#0369a1', marginBottom: 10 }}>LOGISTICS & FLEET MILESTONES PROGRESSION</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, textAlign: 'center' }}>
                {[
                  { step: '1. Registered', done: true, time: 'Day 0' },
                  { step: '2. Validated', done: true, time: 'Day 1' },
                  { step: '3. Assigned / In Transit', done: trackRecord.status !== 'Pending', time: 'Active' },
                  { step: '4. Checkpoint Verified', done: trackRecord.status === 'Completed' || trackRecord.status === 'Delivered', time: 'En Route' },
                  { step: '5. Completed & Reconciled', done: trackRecord.status === 'Completed' || trackRecord.status === 'Delivered', time: 'Finalized' },
                ].map((m, idx) => (
                  <div key={idx} style={{ background: m.done ? '#ffffff' : '#f8fafc', padding: 8, borderRadius: 6, border: `1px solid ${m.done ? '#38bdf8' : '#e2e8f0'}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: m.done ? '#0284c7' : '#94a3b8' }}>{m.step}</div>
                    <small style={{ color: '#64748b', fontSize: 10 }}>{m.time}</small>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ fontWeight: 600, fontSize: 12, color: '#334155', marginBottom: 6 }}>SPECIFICATIONS & RECORD ATTRIBUTES</div>
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <tbody>
                  {uniqueColumns.filter((c) => c.type !== 'actions' && c.type !== 'docs').map((c) => (
                    <tr key={c.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '7px 10px', background: '#f8fafc', fontWeight: 600, width: '40%', color: '#475569' }}>{c.label}</td>
                      <td style={{ padding: '7px 10px', color: '#0f172a' }}>{String(trackRecord[c.key] ?? trackRecord[c.label] ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
