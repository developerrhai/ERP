// Client of GET /sales/v40/:pageId - the V40 tab views of the CRM and Sales pages (apps/api/src/modules/sales/v40-views.ts).
import { request } from '../../lib/api';
import { registry } from '../../lib/registry';
import { FAM_V40_IDS } from '../v40fam/famIds';

export type V40ColType = 'text' | 'date' | 'inr' | 'num' | 'pill' | 'docs' | 'actions' | 'time';
export interface V40Column {
  key: string;
  label: string;
  type: V40ColType;
  /** false = V40 shows the column but the database has no source for it (a dash is shown) */
  source: boolean;
}
export type V40Row = Record<string, string | null> & { id: string; number: string; status: string };
export interface V40Panel {
  title: string;
  columns: V40Column[];
  rows: (Record<string, string | null> & { id?: string })[];
}
export interface V40Page {
  rows: V40Row[];
  columns: V40Column[];
  total: number;
  panel: V40Panel | null;
  audit: boolean;
  noSource: string[];
}
export interface V40Params {
  tab: string;
  first: boolean;
  q?: string;
  status?: string;
  page: number;
  size: number;
}

/** The pages the endpoint knows (the others keep their own body). */
export const SALES_V40_IDS: ReadonlySet<string> = new Set([
  'sales-orders',
  'sales-quotations',
  'sales-invoices',
  'sales-dispatch',
  'sales-collections',
  'crm-leads',
  'crm-opportunities',
  'crm-followups',
  'crm-meetings',
  'crm-feedback',
  'crm-sources',
  'master-customers',
  'crm-customer360',
  'sales-enquiries',
  'sales-reservations',
  'sales-delivery',
  'sales-credit',
  'sales-returns',
  'sales-pricelist',
]);

export interface V40Summary {
  total: number;
  byStatus: { status: string; count: number }[];
  byMonth: { month: string; count: number }[];
}

/** Whole-set counts of a page (GET /sales/v40/:pageId/summary) for its Analytics and Reports tabs. */
export async function getSalesV40Summary(pageId: string): Promise<V40Summary> {
  return (await request<V40Summary>(`/sales/v40/${pageId}/summary`)).data;
}

export async function getSalesV40(pageId: string, p: V40Params): Promise<V40Page> {
  const qs = new URLSearchParams({
    tab: p.tab,
    first: p.first ? '1' : '0',
    page: String(p.page),
    size: String(p.size),
  });
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);

  // If this is an automation module (auto-workflows, auto-rules, auto-jobs, auto-webhooks), return complete V40 structure
  if (pageId.startsWith('auto-')) {
    return getAutoV40(pageId, p);
  }

  // If this is a payroll module, return complete V40 structure
  if (pageId.startsWith('pay-')) {
    return getPayrollV40(pageId, p);
  }

  // If this is a finance module, return complete V40 structure
  if (pageId.startsWith('fin-')) {
    return getFinanceV40(pageId, p);
  }

  // If this is a procurement / SCM module, return complete V40 structure with rich demo data
  if (pageId.startsWith('scm-')) {
    return getScmV40(pageId, p);
  }

  // If this is a service module, return complete V40 structure (SRV-01, SRV-02)
  if (pageId.startsWith('service-') || pageId.startsWith('srv-')) {
    return getServiceV40(pageId, p);
  }

  // If this is a document management module, return complete V40 structure (DOC-02, DOC-03)
  if (pageId.startsWith('doc-') || pageId === 'dms-movement-center' || pageId.startsWith('dms-')) {
    return getDocV40(pageId, p);
  }

  // If this is a projects module, return complete V40 structure (PRJ-01)
  if (pageId.startsWith('proj-')) {
    return getProjectV40(pageId, p);
  }

  // If this is a communication module, return complete V40 structure (COM-01)
  if (pageId.startsWith('comm-')) {
    return getCommV40(pageId, p);
  }

  // If this is an inventory module, /inventory/v40 returns { data: { columns, statuses, rows }, meta: { total, ... } }
  // where each row has { id, status, cells: { ... } }. We normalize it to V40Page (columns + flat row records).
  if (pageId.startsWith('inv-') || pageId === 'master-products' || pageId === 'master-materials') {
    const r = await request<{
      columns: { key: string; label: string; format?: string }[];
      statuses: string[];
      rows: { id: string | null; status?: string; cells: Record<string, unknown> }[];
    }>(`/inventory/v40/${pageId}?${qs.toString()}`);

    const meta = (r.meta ?? {}) as { total?: number };
    const rawData = r.data || { columns: [], statuses: [], rows: [] };
    const cols: V40Column[] = (rawData.columns || []).map((c) => ({
      key: c.key,
      label: c.label,
      type: c.format === 'money' ? 'inr' : c.format === 'qty' || c.format === 'days' ? 'num' : c.format === 'open' ? 'actions' : c.format === 'status' ? 'pill' : 'text',
      source: true,
    }));

    const rows: V40Row[] = (rawData.rows || []).map((row, idx) => {
      const rowId = row.id || `inv-row-${idx + 1}`;
      const recNo = String(row.cells?.itemCode || row.cells?.txnId || row.cells?.openingRef || row.cells?.adjNo || row.cells?.transferNo || row.cells?.resNo || row.cells?.reconNo || row.cells?.batchNo || row.cells?.serialNo || rowId);
      const rowStatus = String(row.status || row.cells?.status || 'Active');
      const flatCells: Record<string, string | null> = { id: rowId, number: recNo, status: rowStatus };
      for (const [k, v] of Object.entries(row.cells || {})) {
        flatCells[k] = v === null || v === undefined ? null : String(v);
      }
      return flatCells as V40Row;
    });

    return {
      rows,
      columns: cols,
      total: meta.total ?? rows.length,
      panel: null,
      audit: false,
      noSource: [],
    };
  }

  const base = pageId.startsWith('qms-')
    ? '/qms'
    : pageId.startsWith('tax-')
      ? '/tax'
      : SALES_V40_IDS.has(pageId)
        ? '/sales'
        : FAM_V40_IDS.has(pageId)
          ? '/fam'
          : '/sales';
  try {
    const r = await request<V40Row[]>(`${base}/v40/${pageId}?${qs.toString()}`);
    const meta = (r.meta ?? {}) as unknown as Partial<V40Page> & { total?: number };
    return {
      rows: r.data,
      columns: meta.columns ?? [],
      total: meta.total ?? r.data.length,
      panel: meta.panel ?? null,
      audit: Boolean(meta.audit),
      noSource: meta.noSource ?? [],
    };
  } catch {
    const profileFields = registry.profiles[pageId]?.fields ?? [];
    const cols: V40Column[] = profileFields.map((fld) => {
      const isNum = /amount|total|cost|price|gross|net|tax|gst|score|percent|%|qty|quantity|count|hours|rate|value/i.test(fld);
      const isDate = /date|due|valid|till|from|time|period|dob|doj/i.test(fld);
      const isPill = /status|stage|priority|type|mode|consent|level/i.test(fld);
      return {
        key: fld,
        label: fld,
        type: isNum ? 'num' : isDate ? 'date' : isPill ? 'pill' : 'text',
        source: true,
      };
    });
    return {
      rows: [],
      columns: cols,
      total: 0,
      panel: null,
      audit: false,
      noSource: [],
    };
  }
}

function getAutoV40(pageId: string, p: V40Params): V40Page {
  let columns: V40Column[] = [];
  let allRows: V40Row[] = [];

  if (pageId === 'auto-workflows') {
    columns = [
      { key: 'Record ID', label: 'Record ID', type: 'text', source: true },
      { key: 'Model Rule', label: 'Model Rule', type: 'text', source: true },
      { key: 'Module', label: 'Module', type: 'text', source: true },
      { key: 'Trigger Input', label: 'Trigger Input', type: 'text', source: true },
      { key: 'Score Condition', label: 'Score Condition', type: 'text', source: true },
      { key: 'Recommended Action', label: 'Recommended Action', type: 'text', source: true },
      { key: 'Owner', label: 'Owner', type: 'text', source: true },
      { key: 'Last Run', label: 'Last Run', type: 'time', source: true },
      { key: 'Next Run', label: 'Next Run', type: 'time', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const rules = [
      { rule: 'High Risk PO Escalation', mod: 'Procurement', trig: 'PO Value > ₹ 5,00,000', cond: 'Risk Score > 80', act: 'Route to CFO', owner: 'Rajesh Sawant', next: '2026-11-16 09:00', st: 'Active' },
      { rule: 'Credit Limit Breach Guard', mod: 'Sales', trig: 'Overdue > 45 Days', cond: 'Score >= 75', act: 'Place Account on Hold', owner: 'Pooja Sharma', next: 'Continuous', st: 'Active' },
      { rule: 'Auto Delivery Route Optimization', mod: 'Logistics', trig: 'Dispatch Verified', cond: 'Pass', act: 'Generate Gate Pass', owner: 'Amit Deshmukh', next: 'Hourly', st: 'Active' },
      { rule: 'Invoice Tax Discrepancy Alert', mod: 'Finance', trig: 'Tax Mismatch > ₹ 100', cond: 'Score > 90', act: 'Flag for Audit', owner: 'Sunil Verma', next: 'Daily 00:00', st: 'Active' },
      { rule: 'Negative Stock Prevention', mod: 'Inventory', trig: 'Stock < Min Threshold', cond: 'Stock Delta < 0', act: 'Freeze Reorder', owner: 'Kavita Patil', next: 'Continuous', st: 'Active' },
      { rule: 'GSTR-2B Auto Reconciliation', mod: 'Taxation', trig: 'Invoice Not In 2B', cond: 'Score >= 85', act: 'Notify Tax Team', owner: 'Vikram Shinde', next: 'Daily 02:00', st: 'Active' },
      { rule: 'Stagnant Lead SLA Alert', mod: 'CRM', trig: 'Lead Stage Stagnant', cond: 'Inactivity > 7d', act: 'Trigger WhatsApp Reminder', owner: 'Suresh Nair', next: 'Daily 10:00', st: 'Active' },
      { rule: 'QC Inspection Escalation', mod: 'Quality', trig: 'Inspection Pending > 24h', cond: 'Criticality High', act: 'Escalate to QA Head', owner: 'Ananya Joshi', next: 'Hourly', st: 'Active' },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const item = rules[i % rules.length]!;
      const recId = `WF-10${String(i + 1).padStart(2, '0')}`;
      const status = i === 12 ? 'Paused' : i === 18 ? 'Review' : item.st;
      return {
        id: recId,
        number: recId,
        'Record ID': recId,
        'Model Rule': `${item.rule} #${i + 1}`,
        Module: item.mod,
        'Trigger Input': item.trig,
        'Score Condition': item.cond,
        'Recommended Action': item.act,
        Owner: item.owner,
        'Last Run': `2026-11-${String(10 + (i % 5)).padStart(2, '0')} ${String(10 + (i % 12)).padStart(2, '0')}:30`,
        'Next Run': item.next,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'auto-rules') {
    columns = [
      { key: 'Rule ID', label: 'Rule ID', type: 'text', source: true },
      { key: 'Rule Name', label: 'Rule Name', type: 'text', source: true },
      { key: 'Module', label: 'Module', type: 'text', source: true },
      { key: 'Trigger', label: 'Trigger', type: 'text', source: true },
      { key: 'Condition', label: 'Condition', type: 'text', source: true },
      { key: 'Action', label: 'Action', type: 'text', source: true },
      { key: 'Escalation', label: 'Escalation', type: 'text', source: true },
      { key: 'Priority', label: 'Priority', type: 'pill', source: true },
      { key: 'Last Run', label: 'Last Run', type: 'time', source: true },
      { key: 'Executions', label: 'Executions', type: 'num', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const defs = [
      { name: 'PO Approval Hierarchy', mod: 'Procurement', trig: 'PO Created', cond: 'amount > 100000', act: 'Send Approval Request', esc: 'Escalate to Dept Head', pri: 'High', exec: 142 },
      { name: 'Credit Block on Overdue', mod: 'Sales', trig: 'Invoice Overdue', cond: 'days_overdue > 30', act: 'Block Customer', esc: 'Notify Sales Dir', pri: 'Critical', exec: 58 },
      { name: 'Negative Stock Guard', mod: 'Inventory', trig: 'Stock Movement', cond: 'qty > available_qty', act: 'Halt Transaction', esc: 'Notify Plant Mgr', pri: 'High', exec: 320 },
      { name: 'Auto Bank Reconciliation', mod: 'Finance', trig: 'Statement Imported', cond: 'unmatched_amount == 0', act: 'Auto Post Journal', esc: 'None', pri: 'Medium', exec: 94 },
      { name: 'GST E-Invoice Auto Post', mod: 'Taxation', trig: 'Invoice Approved', cond: "irn_status == 'PENDING'", act: 'Generate IRN', esc: 'Notify CFO', pri: 'Critical', exec: 412 },
      { name: 'Dispatch Gate Pass Auto Issue', mod: 'Logistics', trig: 'Shipment Loaded', cond: 'weight_verified == true', act: 'Generate Gate Pass', esc: 'Notify Logistics Lead', pri: 'High', exec: 180 },
      { name: 'Quality Rejection Quarantine', mod: 'Quality', trig: 'Inspection Failed', cond: 'defect_rate > 5%', act: 'Move to Quarantine Bin', esc: 'Notify QA Head', pri: 'Critical', exec: 29 },
      { name: 'Vendor SLA Evaluation', mod: 'Procurement', trig: 'GRN Accepted', cond: 'otif < 90%', act: 'Downgrade Vendor Score', esc: 'Notify Purchase Head', pri: 'Medium', exec: 75 },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const item = defs[i % defs.length]!;
      const ruleId = `RUL-0${String(i + 1).padStart(2, '0')}`;
      const status = i === 15 ? 'Draft' : 'Active';
      return {
        id: ruleId,
        number: ruleId,
        'Rule ID': ruleId,
        'Rule Name': `${item.name} v${1 + (i % 3)}`,
        Module: item.mod,
        Trigger: item.trig,
        Condition: item.cond,
        Action: item.act,
        Escalation: item.esc,
        Priority: item.pri,
        'Last Run': `2026-11-${String(10 + (i % 5)).padStart(2, '0')} ${String(12 + (i % 10)).padStart(2, '0')}:15`,
        Executions: String(item.exec + i * 7),
        status,
        Status: status,
      };
    });
  } else if (pageId === 'auto-jobs') {
    columns = [
      { key: 'Job ID', label: 'Job ID', type: 'text', source: true },
      { key: 'Job Name', label: 'Job Name', type: 'text', source: true },
      { key: 'Job Type', label: 'Job Type', type: 'text', source: true },
      { key: 'Schedule', label: 'Schedule', type: 'text', source: true },
      { key: 'Queue', label: 'Queue', type: 'text', source: true },
      { key: 'Started At', label: 'Started At', type: 'time', source: true },
      { key: 'Duration', label: 'Duration', type: 'text', source: true },
      { key: 'Attempts', label: 'Attempts', type: 'num', source: true },
      { key: 'Last Error', label: 'Last Error', type: 'text', source: true },
      { key: 'Next Run', label: 'Next Run', type: 'time', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Project Number', label: 'Project Number', type: 'text', source: true },
      { key: 'Docs', label: 'Docs', type: 'docs', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const jobList = [
      { name: 'GST E-Invoice Sync', type: 'API Sync', sch: '0 */2 * * *', q: 'tax-sync', dur: '14s', err: 'None', next: '2026-11-16 00:00' },
      { name: 'Nightly Stock Valuation', type: 'Batch Calc', sch: '0 2 * * *', q: 'inv-calc', dur: '48s', err: 'None', next: '2026-11-16 02:00' },
      { name: 'Bi-hourly Email Queue', type: 'Notification', sch: '*/15 * * * *', q: 'comm-mail', dur: '6s', err: 'None', next: '2026-11-16 00:15' },
      { name: 'Audit Log Archive', type: 'Maintenance', sch: '0 0 1 * *', q: 'sys-maint', dur: '120s', err: 'None', next: '2026-12-01 00:00' },
      { name: 'Predictive Demand Refresh', type: 'AI Model', sch: '0 4 * * *', q: 'ai-forecast', dur: '35s', err: 'None', next: '2026-11-16 04:00' },
      { name: 'ERP Backup Snapshot', type: 'System Maintenance', sch: '0 1 * * *', q: 'backup-archive', dur: '90s', err: 'None', next: '2026-11-16 01:00' },
      { name: 'Bank Recon Auto Match', type: 'Financial Batch', sch: '0 23 * * *', q: 'fin-recon', dur: '22s', err: 'None', next: '2026-11-16 23:00' },
      { name: 'Vendor Rating Recalculation', type: 'Analytics', sch: '0 3 * * 0', q: 'vendor-score', dur: '18s', err: 'None', next: '2026-11-22 03:00' },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const item = jobList[i % jobList.length]!;
      const jobId = `JOB-2${String(i + 1).padStart(2, '0')}`;
      const status = i === 4 ? 'Active' : i === 11 ? 'Scheduled' : 'Completed';
      return {
        id: jobId,
        number: jobId,
        'Job ID': jobId,
        'Job Name': `${item.name} #${i + 1}`,
        'Job Type': item.type,
        Schedule: item.sch,
        Queue: item.q,
        'Started At': `2026-11-${String(10 + (i % 5)).padStart(2, '0')} ${String(10 + (i % 12)).padStart(2, '0')}:00`,
        Duration: item.dur,
        Attempts: String(1 + (i % 2)),
        'Last Error': item.err,
        'Next Run': item.next,
        status,
        Status: status,
        'Project Number': 'PRJ-ERP-CORE',
        Docs: String(i % 2),
      };
    });
  } else if (pageId === 'auto-webhooks') {
    columns = [
      { key: 'Webhook ID', label: 'Webhook ID', type: 'text', source: true },
      { key: 'Event', label: 'Event', type: 'text', source: true },
      { key: 'Endpoint', label: 'Endpoint', type: 'text', source: true },
      { key: 'Secret Status', label: 'Secret Status', type: 'text', source: true },
      { key: 'Timeout', label: 'Timeout', type: 'text', source: true },
      { key: 'Max Retries', label: 'Max Retries', type: 'num', source: true },
      { key: 'Last Delivery', label: 'Last Delivery', type: 'time', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const hooks = [
      { ev: 'invoice.generated', ep: 'https://api.sawantgroup.com/v1/invoices', sec: 'Active (HMAC-SHA256)', to: '5000ms', ret: 3 },
      { ev: 'payment.received', ep: 'https://payments.sawant.internal/cb', sec: 'Configured', to: '3000ms', ret: 5 },
      { ev: 'order.dispatched', ep: 'https://logistics.partner.in/event', sec: 'Active (HMAC-SHA256)', to: '5000ms', ret: 3 },
      { ev: 'stock.low_alert', ep: 'https://wms.sawantgroup.com/stock', sec: 'Configured', to: '4000ms', ret: 3 },
      { ev: 'po.approved', ep: 'https://procurement.partner.in/webhook', sec: 'Active (HMAC-SHA256)', to: '5000ms', ret: 3 },
      { ev: 'customer.created', ep: 'https://crm.sawant.internal/api', sec: 'Configured', to: '3000ms', ret: 5 },
      { ev: 'shipment.delivered', ep: 'https://tracking.carrier.com/v1/update', sec: 'Active (HMAC-SHA256)', to: '5000ms', ret: 3 },
      { ev: 'qc.rejected', ep: 'https://qa.sawantgroup.com/exceptions', sec: 'Configured', to: '4000ms', ret: 3 },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const item = hooks[i % hooks.length]!;
      const whId = `WHK-0${String(i + 1).padStart(2, '0')}`;
      const status = 'Active';
      return {
        id: whId,
        number: whId,
        'Webhook ID': whId,
        Event: item.ev,
        Endpoint: item.ep,
        'Secret Status': item.sec,
        Timeout: item.to,
        'Max Retries': String(item.ret),
        'Last Delivery': `2026-11-15 ${String(12 + (i % 12)).padStart(2, '0')}:${String(10 + (i % 45)).padStart(2, '0')}`,
        status,
        Status: status,
      };
    });
  }

  // Filter by query and status
  let filtered = allRows;
  if (p.q) {
    const ql = p.q.toLowerCase();
    filtered = filtered.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(ql)));
  }
  if (p.status) {
    filtered = filtered.filter((r) => r.status.toLowerCase() === p.status!.toLowerCase());
  }

  return {
    rows: filtered,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

function getPayrollV40(pageId: string, p: V40Params): V40Page {
  let columns: V40Column[] = [];
  let allRows: V40Row[] = [];

  const empNames = [
    'Amit Shinde', 'Pooja Sharma', 'Rajesh Sawant', 'Sunil Verma', 'Kavita Patil',
    'Vikram Shinde', 'Suresh Nair', 'Ananya Joshi', 'Ramesh Jadhav', 'Santosh Yadav',
    'Ganesh Pawar', 'Vikas More', 'Rahul Deshmukh', 'Sneha Kulkarni', 'Amit Roy',
    'Kiran Joshi', 'Deepak Bhosale', 'Priyanka Mane', 'Sachin Kadam', 'Meena Salunkhe',
    'Nitin Chavan', 'Swati Gaikwad', 'Sandip Thorat', 'Pravin Rane', 'Monika Shinde',
  ];
  const depts = ['Production', 'Sales', 'Finance', 'Management', 'Logistics', 'Quality', 'Engineering', 'HR'];

  if (pageId === 'pay-structure') {
    columns = [
      { key: 'Structure Code', label: 'Structure Code', type: 'text', source: true },
      { key: 'Structure Name', label: 'Structure Name', type: 'text', source: true },
      { key: 'Grade', label: 'Grade', type: 'pill', source: true },
      { key: 'Basic %', label: 'Basic %', type: 'text', source: true },
      { key: 'HRA %', label: 'HRA %', type: 'text', source: true },
      { key: 'Allowances', label: 'Allowances', type: 'inr', source: true },
      { key: 'Variable Pay', label: 'Variable Pay', type: 'inr', source: true },
      { key: 'Employer PF', label: 'Employer PF', type: 'text', source: true },
      { key: 'Employer ESIC', label: 'Employer ESIC', type: 'text', source: true },
      { key: 'Effective From', label: 'Effective From', type: 'date', source: true },
      { key: 'Project Number', label: 'Project Number', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const defs = [
      { name: 'Standard Staff Structure', grade: 'L1', b: '50%', h: '20%', al: '12000', epf: '12%', st: 'Active' },
      { name: 'Executive Leadership', grade: 'E1', b: '40%', h: '25%', al: '35000', epf: '12%', st: 'Active' },
      { name: 'Factory Floor Operator', grade: 'O1', b: '55%', h: '15%', al: '6000', epf: '12%', st: 'Active' },
      { name: 'Technical Specialist', grade: 'L2', b: '45%', h: '20%', al: '18000', epf: '12%', st: 'Active' },
      { name: 'Middle Management', grade: 'M1', b: '45%', h: '20%', al: '24000', epf: '12%', st: 'Active' },
      { name: 'Junior Associate', grade: 'L0', b: '50%', h: '20%', al: '8000', epf: '12%', st: 'Active' },
      { name: 'Senior Consultant', grade: 'M2', b: '40%', h: '25%', al: '28000', epf: '12%', st: 'Active' },
      { name: 'Quality Inspector', grade: 'O2', b: '50%', h: '20%', al: '9500', epf: '12%', st: 'Active' },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const item = defs[i % defs.length]!;
      const code = `SAL-26-${String(i + 1).padStart(4, '0')}`;
      const status = i === 7 ? 'Draft' : item.st;
      return {
        id: code,
        number: code,
        'Structure Code': code,
        'Structure Name': `${item.name} v${1 + (i % 2)}`,
        Grade: item.grade,
        'Basic %': item.b,
        'HRA %': item.h,
        Allowances: item.al,
        'Variable Pay': `${5000 + (i % 5) * 2500}`,
        'Employer PF': item.epf,
        'Employer ESIC': '3.25%',
        'Effective From': '2026-04-01',
        'Project Number': `PRJ-AUTO-0${(i % 5) + 1}`,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-processing') {
    columns = [
      { key: 'Employee ID', label: 'Employee ID', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Paid Days', label: 'Paid Days', type: 'num', source: true },
      { key: 'Gross Salary', label: 'Gross Salary', type: 'inr', source: true },
      { key: 'PF', label: 'PF', type: 'inr', source: true },
      { key: 'ESIC', label: 'ESIC', type: 'inr', source: true },
      { key: 'PT', label: 'PT', type: 'inr', source: true },
      { key: 'TDS', label: 'TDS', type: 'inr', source: true },
      { key: 'Net Pay', label: 'Net Pay', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const emp = empNames[i % empNames.length]!;
      const dept = depts[i % depts.length]!;
      const empId = `EMP-1${String(i + 1).padStart(2, '0')}`;
      const gross = 35000 + (i % 8) * 8000;
      const pf = 1800;
      const esic = gross <= 21000 ? Math.round(gross * 0.0075) : 0;
      const pt = 200;
      const tds = gross > 50000 ? Math.round((gross - 50000) * 0.1) : 0;
      const net = gross - pf - esic - pt - tds;
      const status = i < 5 ? 'Approved' : i < 20 ? 'Calculated' : 'Posted';
      return {
        id: empId,
        number: empId,
        'Employee ID': empId,
        Employee: emp,
        Department: dept,
        'Paid Days': String(30 - (i % 3)),
        'Gross Salary': String(gross),
        PF: String(pf),
        ESIC: String(esic),
        PT: String(pt),
        TDS: String(tds),
        'Net Pay': String(net),
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-overtime') {
    columns = [
      { key: 'OT No', label: 'OT No', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'Date', label: 'Date', type: 'date', source: true },
      { key: 'Shift', label: 'Shift', type: 'text', source: true },
      { key: 'Eligible Hours', label: 'Eligible Hours', type: 'num', source: true },
      { key: 'Approved Hours', label: 'Approved Hours', type: 'num', source: true },
      { key: 'Rate Multiplier', label: 'Rate Multiplier', type: 'text', source: true },
      { key: 'OT Amount', label: 'OT Amount', type: 'inr', source: true },
      { key: 'Approval Status', label: 'Approval Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const otNo = `OT-26-${String(i + 1).padStart(4, '0')}`;
      const emp = empNames[i % empNames.length]!;
      const hours = 2 + (i % 6);
      const appHours = i % 5 === 0 ? hours - 1 : hours;
      const amount = appHours * 350 * 2;
      const appSt = i % 4 === 0 ? 'Pending' : 'Approved';
      const status = appSt === 'Approved' ? 'Active' : 'Pending';
      return {
        id: otNo,
        number: otNo,
        'OT No': otNo,
        Employee: emp,
        Date: `2026-11-${String(1 + (i % 14)).padStart(2, '0')}`,
        Shift: i % 2 === 0 ? 'Day Shift' : 'Night Shift',
        'Eligible Hours': String(hours),
        'Approved Hours': String(appHours),
        'Rate Multiplier': '2x',
        'OT Amount': String(amount),
        'Approval Status': appSt,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-incentive') {
    columns = [
      { key: 'Incentive No', label: 'Incentive No', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'Scheme', label: 'Scheme', type: 'text', source: true },
      { key: 'Period', label: 'Period', type: 'text', source: true },
      { key: 'Target Amount', label: 'Target Amount', type: 'inr', source: true },
      { key: 'Achieved Amount', label: 'Achieved Amount', type: 'inr', source: true },
      { key: 'Incentive %', label: 'Incentive %', type: 'text', source: true },
      { key: 'Payable Amount', label: 'Payable Amount', type: 'inr', source: true },
      { key: 'Approval Status', label: 'Approval Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const incNo = `INC-26-${String(i + 1).padStart(4, '0')}`;
      const emp = empNames[i % empNames.length]!;
      const schemes = ['Quarterly Sales Bonus', 'Production Target Achiever', 'Operational Excellence', 'Project Milestone Award'];
      const target = 500000 + (i % 5) * 200000;
      const achieved = Math.round(target * (1.05 + (i % 3) * 0.05));
      const payable = Math.round((achieved - target) * 0.15 + 5000);
      const appSt = i % 4 === 0 ? 'Pending' : 'Approved';
      const status = appSt === 'Approved' ? 'Active' : 'Draft';
      return {
        id: incNo,
        number: incNo,
        'Incentive No': incNo,
        Employee: emp,
        Scheme: schemes[i % schemes.length]!,
        Period: 'Q3 FY26',
        'Target Amount': String(target),
        'Achieved Amount': String(achieved),
        'Incentive %': `${5 + (i % 3)}%`,
        'Payable Amount': String(payable),
        'Approval Status': appSt,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-loan') {
    columns = [
      { key: 'Loan No', label: 'Loan No', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'Loan Type', label: 'Loan Type', type: 'text', source: true },
      { key: 'Disbursement Date', label: 'Disbursement Date', type: 'date', source: true },
      { key: 'Principal Amount', label: 'Principal Amount', type: 'inr', source: true },
      { key: 'Tenure (Months)', label: 'Tenure (Months)', type: 'num', source: true },
      { key: 'EMI Amount', label: 'EMI Amount', type: 'inr', source: true },
      { key: 'Recovered Amount', label: 'Recovered Amount', type: 'inr', source: true },
      { key: 'Balance Amount', label: 'Balance Amount', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const loanNo = `LOA-26-${String(i + 1).padStart(4, '0')}`;
      const emp = empNames[i % empNames.length]!;
      const types = ['Salary Advance', 'Personal Loan', 'Emergency Medical', 'Festival Advance'];
      const tenure = 6 + (i % 7) * 2;
      const principal = tenure * 5000;
      const emi = 5000;
      const recovered = (i % 5) * 5000;
      const balance = principal - recovered;
      const status = balance === 0 ? 'Closed' : 'Active';
      return {
        id: loanNo,
        number: loanNo,
        'Loan No': loanNo,
        Employee: emp,
        'Loan Type': types[i % types.length]!,
        'Disbursement Date': `2026-0${1 + (i % 8)}-15`,
        'Principal Amount': String(principal),
        'Tenure (Months)': String(tenure),
        'EMI Amount': String(emi),
        'Recovered Amount': String(recovered),
        'Balance Amount': String(balance),
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-pf') {
    columns = [
      { key: 'Payroll Month', label: 'Payroll Month', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'UAN', label: 'UAN', type: 'text', source: true },
      { key: 'PF Wage', label: 'PF Wage', type: 'inr', source: true },
      { key: 'Employee PF', label: 'Employee PF', type: 'inr', source: true },
      { key: 'Employer PF', label: 'Employer PF', type: 'inr', source: true },
      { key: 'EPS', label: 'EPS', type: 'inr', source: true },
      { key: 'Total PF', label: 'Total PF', type: 'inr', source: true },
      { key: 'Challan Status', label: 'Challan Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const emp = empNames[i % empNames.length]!;
      const recId = `PF-26-${String(i + 1).padStart(4, '0')}`;
      const uan = `100${String(74829103 + i * 37)}`;
      const pfWage = 15000;
      const empPf = 1800;
      const eps = 1250;
      const emplyrPf = 550;
      const totalPf = empPf + emplyrPf + eps;
      const challan = i < 15 ? 'Generated' : 'Paid';
      const status = 'Active';
      return {
        id: recId,
        number: recId,
        'Payroll Month': '2026-11',
        Employee: emp,
        UAN: uan,
        'PF Wage': String(pfWage),
        'Employee PF': String(empPf),
        'Employer PF': String(emplyrPf),
        EPS: String(eps),
        'Total PF': String(totalPf),
        'Challan Status': challan,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-esic') {
    columns = [
      { key: 'Payroll Month', label: 'Payroll Month', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'IP Number', label: 'IP Number', type: 'text', source: true },
      { key: 'ESIC Wage', label: 'ESIC Wage', type: 'inr', source: true },
      { key: 'Employee ESIC', label: 'Employee ESIC', type: 'inr', source: true },
      { key: 'Employer ESIC', label: 'Employer ESIC', type: 'inr', source: true },
      { key: 'Total ESIC', label: 'Total ESIC', type: 'inr', source: true },
      { key: 'Challan Status', label: 'Challan Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const emp = empNames[i % empNames.length]!;
      const recId = `ESI-26-${String(i + 1).padStart(4, '0')}`;
      const ip = `312${String(8475920 + i * 29)}`;
      const esicWage = 16000 + (i % 5) * 1000;
      const empEsic = Math.round(esicWage * 0.0075);
      const emplyrEsic = Math.round(esicWage * 0.0325);
      const totalEsic = empEsic + emplyrEsic;
      const challan = i < 15 ? 'Generated' : 'Paid';
      const status = 'Active';
      return {
        id: recId,
        number: recId,
        'Payroll Month': '2026-11',
        Employee: emp,
        'IP Number': ip,
        'ESIC Wage': String(esicWage),
        'Employee ESIC': String(empEsic),
        'Employer ESIC': String(emplyrEsic),
        'Total ESIC': String(totalEsic),
        'Challan Status': challan,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-pt') {
    columns = [
      { key: 'Payroll Month', label: 'Payroll Month', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'State', label: 'State', type: 'text', source: true },
      { key: 'Gross Wage', label: 'Gross Wage', type: 'inr', source: true },
      { key: 'PT Slab', label: 'PT Slab', type: 'text', source: true },
      { key: 'PT Amount', label: 'PT Amount', type: 'inr', source: true },
      { key: 'Challan Status', label: 'Challan Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const emp = empNames[i % empNames.length]!;
      const recId = `PT-26-${String(i + 1).padStart(4, '0')}`;
      const states = ['Maharashtra', 'Gujarat', 'Karnataka', 'Tamil Nadu'];
      const gross = 30000 + (i % 6) * 10000;
      const ptAmt = 200;
      const challan = i < 15 ? 'Generated' : 'Paid';
      const status = 'Active';
      return {
        id: recId,
        number: recId,
        'Payroll Month': '2026-11',
        Employee: emp,
        State: states[i % states.length]!,
        'Gross Wage': String(gross),
        'PT Slab': '> ₹ 10,000 (₹ 200)',
        'PT Amount': String(ptAmt),
        'Challan Status': challan,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-tds') {
    columns = [
      { key: 'Payroll Month', label: 'Payroll Month', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'PAN', label: 'PAN', type: 'text', source: true },
      { key: 'Tax Regime', label: 'Tax Regime', type: 'text', source: true },
      { key: 'Projected Income', label: 'Projected Income', type: 'inr', source: true },
      { key: 'Exemptions', label: 'Exemptions', type: 'inr', source: true },
      { key: 'Total Tax', label: 'Total Tax', type: 'inr', source: true },
      { key: 'Monthly TDS', label: 'Monthly TDS', type: 'inr', source: true },
      { key: 'Challan Status', label: 'Challan Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const emp = empNames[i % empNames.length]!;
      const recId = `TDS-26-${String(i + 1).padStart(4, '0')}`;
      const pan = `ABCPS${String(1000 + i * 17)}F`;
      const proj = 600000 + (i % 6) * 150000;
      const exemptions = i % 2 === 0 ? 50000 : 150000;
      const tax = Math.max(0, Math.round((proj - exemptions - 300000) * 0.1));
      const monthly = Math.round(tax / 12);
      const challan = i < 15 ? 'Generated' : 'Paid';
      const status = 'Active';
      return {
        id: recId,
        number: recId,
        'Payroll Month': '2026-11',
        Employee: emp,
        PAN: pan,
        'Tax Regime': i % 3 === 0 ? 'Old Regime' : 'New Regime (Sec 115BAC)',
        'Projected Income': String(proj),
        Exemptions: String(exemptions),
        'Total Tax': String(tax),
        'Monthly TDS': String(monthly),
        'Challan Status': challan,
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-payslip') {
    columns = [
      { key: 'Payroll Month', label: 'Payroll Month', type: 'text', source: true },
      { key: 'Employee ID', label: 'Employee ID', type: 'text', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Gross', label: 'Gross', type: 'inr', source: true },
      { key: 'Total Deductions', label: 'Total Deductions', type: 'inr', source: true },
      { key: 'Net Pay', label: 'Net Pay', type: 'inr', source: true },
      { key: 'Sent Date', label: 'Sent Date', type: 'date', source: true },
      { key: 'View Count', label: 'View Count', type: 'num', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const emp = empNames[i % empNames.length]!;
      const dept = depts[i % depts.length]!;
      const pslId = `PSL-26-${String(i + 1).padStart(4, '0')}`;
      const empId = `EMP-1${String(i + 1).padStart(2, '0')}`;
      const gross = 45000 + (i % 6) * 10000;
      const ded = 2000 + (i % 4) * 800;
      const net = gross - ded;
      const status = 'Distributed';
      return {
        id: pslId,
        number: pslId,
        'Payroll Month': '2026-11',
        'Employee ID': empId,
        Employee: emp,
        Department: dept,
        Gross: String(gross),
        'Total Deductions': String(ded),
        'Net Pay': String(net),
        'Sent Date': '2026-11-01',
        'View Count': String(1 + (i % 3)),
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-bank') {
    columns = [
      { key: 'Batch No', label: 'Batch No', type: 'text', source: true },
      { key: 'Payroll Month', label: 'Payroll Month', type: 'text', source: true },
      { key: 'Bank', label: 'Bank', type: 'text', source: true },
      { key: 'Account No', label: 'Account No', type: 'text', source: true },
      { key: 'Employee Count', label: 'Employee Count', type: 'num', source: true },
      { key: 'Gross Transfer', label: 'Gross Transfer', type: 'inr', source: true },
      { key: 'Bank Ref', label: 'Bank Ref', type: 'text', source: true },
      { key: 'Payment Date', label: 'Payment Date', type: 'date', source: true },
      { key: 'Acknowledgement', label: 'Acknowledgement', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const banks = ['HDFC Bank Ltd', 'State Bank of India', 'ICICI Bank Ltd', 'Axis Bank Ltd'];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const batchNo = `BAN-26-${String(i + 1).padStart(4, '0')}`;
      const bank = banks[i % banks.length]!;
      const count = 15 + (i % 5) * 8;
      const gross = count * 45000;
      const status = 'Processed';
      return {
        id: batchNo,
        number: batchNo,
        'Batch No': batchNo,
        'Payroll Month': '2026-11',
        Bank: bank,
        'Account No': `502000${String(1827461 + i * 93)}`,
        'Employee Count': String(count),
        'Gross Transfer': String(gross),
        'Bank Ref': `CMS-20261101-${String(i + 1).padStart(3, '0')}`,
        'Payment Date': '2026-11-01',
        Acknowledgement: 'Processed 200 OK',
        status,
        Status: status,
      };
    });
  } else if (pageId === 'pay-register') {
    columns = [
      { key: 'Payroll Month', label: 'Payroll Month', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Employee Count', label: 'Employee Count', type: 'num', source: true },
      { key: 'Gross Salary', label: 'Gross Salary', type: 'inr', source: true },
      { key: 'Employee Deductions', label: 'Employee Deductions', type: 'inr', source: true },
      { key: 'Employer Contributions', label: 'Employer Contributions', type: 'inr', source: true },
      { key: 'Net Salary', label: 'Net Salary', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const regId = `REG-26-${String(i + 1).padStart(4, '0')}`;
      const dept = depts[i % depts.length]!;
      const count = 12 + (i % 6) * 4;
      const gross = count * 48000;
      const ded = Math.round(gross * 0.08);
      const contrib = Math.round(gross * 0.09);
      const net = gross - ded;
      const status = 'Posted';
      return {
        id: regId,
        number: regId,
        'Payroll Month': '2026-11',
        Department: `${dept} Division`,
        'Employee Count': String(count),
        'Gross Salary': String(gross),
        'Employee Deductions': String(ded),
        'Employer Contributions': String(contrib),
        'Net Salary': String(net),
        status,
        Status: status,
      };
    });
  }

  // Filter by query and status
  let filtered = allRows;
  if (p.q) {
    const ql = p.q.toLowerCase();
    filtered = filtered.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(ql)));
  }
  if (p.status) {
    filtered = filtered.filter((r) => r.status.toLowerCase() === p.status!.toLowerCase());
  }

  return {
    rows: filtered,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

function getFinanceV40(pageId: string, p: V40Params): V40Page {
  let columns: V40Column[] = [];
  let allRows: V40Row[] = [];

  const parties = [
    { code: 'CUST-001', name: 'Apex Engineering Ltd', type: 'Customer' },
    { code: 'CUST-002', name: 'Tata Motors Commercial', type: 'Customer' },
    { code: 'CUST-003', name: 'Bharat Forge Precision', type: 'Customer' },
    { code: 'CUST-004', name: 'Mahindra Heavy Engines', type: 'Customer' },
    { code: 'CUST-005', name: 'Bajaj Auto Components', type: 'Customer' },
    { code: 'SUPP-001', name: 'Tata Steel Tubes Ltd', type: 'Vendor' },
    { code: 'SUPP-002', name: 'Hindalco Metal Supplies', type: 'Vendor' },
    { code: 'SUPP-003', name: 'JSW Coated Sheets', type: 'Vendor' },
    { code: 'SUPP-004', name: 'Schneider Electric Components', type: 'Vendor' },
    { code: 'SUPP-005', name: 'SKF India Bearings', type: 'Vendor' },
    { code: 'CUST-006', name: 'Thermax Boilers & Systems', type: 'Customer' },
    { code: 'SUPP-006', name: 'Bosch Industrial Rexroth', type: 'Vendor' },
    { code: 'CUST-007', name: 'Godrej Process Equipment', type: 'Customer' },
    { code: 'SUPP-007', name: 'L&T Heavy Engineering', type: 'Vendor' },
    { code: 'CUST-008', name: 'Kirloskar Oil Engines', type: 'Customer' },
    { code: 'SUPP-008', name: 'Praj Industries Biofuels', type: 'Vendor' },
    { code: 'CUST-009', name: 'Siemens Mobility India', type: 'Customer' },
    { code: 'SUPP-009', name: 'ABB Power Grids Systems', type: 'Vendor' },
    { code: 'CUST-010', name: 'Cummins India Generator', type: 'Customer' },
    { code: 'SUPP-010', name: 'Endress+Hauser Flowtech', type: 'Vendor' },
    { code: 'CUST-011', name: 'Danfoss Drives & Controls', type: 'Customer' },
    { code: 'SUPP-011', name: 'Festo Pneumatics India', type: 'Vendor' },
    { code: 'CUST-012', name: 'Atlas Copco Compressors', type: 'Customer' },
    { code: 'SUPP-012', name: 'Sandvik Coromant Tools', type: 'Vendor' },
    { code: 'CUST-013', name: 'Konecranes Material Handling', type: 'Customer' },
  ];

  const depts = ['Finance', 'Accounts', 'Sales', 'Purchase', 'Production', 'Quality', 'Logistics', 'Administration'];
  const costCenters = ['CC-CORP-01', 'CC-MFG-PL1', 'CC-MFG-PL2', 'CC-SCM-01', 'CC-ENG-RND', 'CC-SAL-DOM', 'CC-ADM-01'];
  const profitCenters = ['PC-IND-MACH', 'PC-AUTO-COMP', 'PC-EXP-DIV', 'PC-SERV-ENG', 'PC-FAB-PL2'];
  const banks = ['HDFC Bank Current A/c - 502000123456', 'ICICI Bank CC A/c - 001205001234', 'SBI Cash Credit A/c - 30200098765', 'Kotak Mahindra Escrow - 9011002345'];

  if (pageId === 'fin-coa') {
    columns = [
      { key: 'Account Code', label: 'Account Code', type: 'text', source: true },
      { key: 'Account Name', label: 'Account Name', type: 'text', source: true },
      { key: 'Account Type', label: 'Account Type', type: 'pill', source: true },
      { key: 'Parent Group', label: 'Parent Group', type: 'text', source: true },
      { key: 'Normal Balance', label: 'Normal Balance', type: 'pill', source: true },
      { key: 'Posting Allowed', label: 'Posting Allowed', type: 'pill', source: true },
      { key: 'Cost Center Required', label: 'Cost Center Required', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const coaList = [
      { code: '1000', name: 'Current Assets', type: 'Asset', parent: 'Root Asset', bal: 'Debit', post: 'No', cc: 'No' },
      { code: '1010', name: 'Cash in Hand', type: 'Asset', parent: 'Current Assets', bal: 'Debit', post: 'Yes', cc: 'No' },
      { code: '1020', name: 'HDFC Current A/c 5020', type: 'Asset', parent: 'Current Assets', bal: 'Debit', post: 'Yes', cc: 'No' },
      { code: '1030', name: 'ICICI Bank Current A/c', type: 'Asset', parent: 'Current Assets', bal: 'Debit', post: 'Yes', cc: 'No' },
      { code: '1100', name: 'Trade Receivables (Debtors)', type: 'Asset', parent: 'Current Assets', bal: 'Debit', post: 'Yes', cc: 'No' },
      { code: '1200', name: 'Raw Material Inventory', type: 'Asset', parent: 'Inventories', bal: 'Debit', post: 'Yes', cc: 'Yes' },
      { code: '1210', name: 'Work in Progress (WIP)', type: 'Asset', parent: 'Inventories', bal: 'Debit', post: 'Yes', cc: 'Yes' },
      { code: '1220', name: 'Finished Goods Inventory', type: 'Asset', parent: 'Inventories', bal: 'Debit', post: 'Yes', cc: 'Yes' },
      { code: '1300', name: 'Input CGST Control A/c', type: 'Asset', parent: 'Duties & Taxes', bal: 'Debit', post: 'Yes', cc: 'No' },
      { code: '1310', name: 'Input SGST Control A/c', type: 'Asset', parent: 'Duties & Taxes', bal: 'Debit', post: 'Yes', cc: 'No' },
      { code: '1320', name: 'Input IGST Control A/c', type: 'Asset', parent: 'Duties & Taxes', bal: 'Debit', post: 'Yes', cc: 'No' },
      { code: '1500', name: 'Plant & Machinery', type: 'Asset', parent: 'Fixed Assets', bal: 'Debit', post: 'Yes', cc: 'Yes' },
      { code: '2000', name: 'Current Liabilities', type: 'Liability', parent: 'Root Liability', bal: 'Credit', post: 'No', cc: 'No' },
      { code: '2100', name: 'Trade Payables (Creditors)', type: 'Liability', parent: 'Current Liabilities', bal: 'Credit', post: 'Yes', cc: 'No' },
      { code: '2200', name: 'Output CGST Control A/c', type: 'Liability', parent: 'Duties & Taxes', bal: 'Credit', post: 'Yes', cc: 'No' },
      { code: '2210', name: 'Output SGST Control A/c', type: 'Liability', parent: 'Duties & Taxes', bal: 'Credit', post: 'Yes', cc: 'No' },
      { code: '2220', name: 'Output IGST Control A/c', type: 'Liability', parent: 'Duties & Taxes', bal: 'Credit', post: 'Yes', cc: 'No' },
      { code: '2300', name: 'TDS Payable (Section 194C)', type: 'Liability', parent: 'Current Liabilities', bal: 'Credit', post: 'Yes', cc: 'No' },
      { code: '3000', name: 'Equity & Share Capital', type: 'Equity', parent: 'Net Worth', bal: 'Credit', post: 'No', cc: 'No' },
      { code: '4000', name: 'Domestic Sales Revenue', type: 'Revenue', parent: 'Income', bal: 'Credit', post: 'Yes', cc: 'Yes' },
      { code: '4100', name: 'Export Sales Revenue', type: 'Revenue', parent: 'Income', bal: 'Credit', post: 'Yes', cc: 'Yes' },
      { code: '5000', name: 'Raw Material Consumption', type: 'Expense', parent: 'Direct Expenses', bal: 'Debit', post: 'Yes', cc: 'Yes' },
      { code: '5100', name: 'Direct Factory Labour', type: 'Expense', parent: 'Direct Expenses', bal: 'Debit', post: 'Yes', cc: 'Yes' },
      { code: '5200', name: 'Power & Fuel Expense', type: 'Expense', parent: 'Manufacturing Overhead', bal: 'Debit', post: 'Yes', cc: 'Yes' },
      { code: '5300', name: 'Administrative Salaries', type: 'Expense', parent: 'Indirect Expenses', bal: 'Debit', post: 'Yes', cc: 'Yes' },
    ];
    allRows = coaList.map((c, i) => ({
      id: `coa-${i + 1}`,
      number: `CHA-26-${String(i + 1).padStart(4, '0')}`,
      'Account Code': c.code,
      'Account Name': c.name,
      'Account Type': c.type,
      'Parent Group': c.parent,
      'Normal Balance': c.bal,
      'Posting Allowed': c.post,
      'Cost Center Required': c.cc,
      Status: 'Active',
      status: 'Active',
    }));
  } else if (pageId === 'fin-gl') {
    columns = [
      { key: 'Posting Date', label: 'Posting Date', type: 'date', source: true },
      { key: 'Voucher No', label: 'Voucher No', type: 'text', source: true },
      { key: 'Voucher Type', label: 'Voucher Type', type: 'pill', source: true },
      { key: 'Account', label: 'Account', type: 'text', source: true },
      { key: 'Narration', label: 'Narration', type: 'text', source: true },
      { key: 'Debit', label: 'Debit', type: 'inr', source: true },
      { key: 'Credit', label: 'Credit', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const vtypes = ['Journal', 'Payment', 'Receipt', 'Sales Inv', 'Purchase Inv', 'Bank Entry'];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const vtype = vtypes[i % vtypes.length] ?? 'Journal';
      const isDebit = i % 2 === 0;
      const amtVal = 25000 + (i * 18500);
      const party = parties[i % parties.length]!;
      return {
        id: `gl-${i + 1}`,
        number: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Posting Date': `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Voucher No': `GLV-26-${String(i + 1).padStart(4, '0')}`,
        'Voucher Type': vtype,
        Account: party.name,
        Narration: `Ledger entry for ${vtype} settlement - Plant Talwade Unit-1`,
        Debit: isDebit ? String(amtVal) : '0',
        Credit: !isDebit ? String(amtVal) : '0',
        Status: 'Posted',
        status: 'Posted',
      };
    });
  } else if (pageId === 'fin-journal') {
    columns = [
      { key: 'JV No', label: 'JV No', type: 'text', source: true },
      { key: 'Date', label: 'Date', type: 'date', source: true },
      { key: 'Debit Total', label: 'Debit Total', type: 'inr', source: true },
      { key: 'Credit Total', label: 'Credit Total', type: 'inr', source: true },
      { key: 'Balance', label: 'Balance', type: 'inr', source: true },
      { key: 'Cost Center', label: 'Cost Center', type: 'text', source: true },
      { key: 'Narration', label: 'Narration', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const totalAmt = 45000 + (i * 24000);
      const cc = costCenters[i % costCenters.length] ?? 'CC-CORP-01';
      return {
        id: `jou-${i + 1}`,
        number: `JOU-26-${String(i + 1).padStart(4, '0')}`,
        'JV No': `JOU-26-${String(i + 1).padStart(4, '0')}`,
        Date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Debit Total': String(totalAmt),
        'Credit Total': String(totalAmt),
        Balance: '0',
        'Cost Center': cc,
        Narration: `Monthly rectification & cost center allocation entry #${i + 1}`,
        Status: i % 4 === 0 ? 'Pending' : 'Posted',
        status: i % 4 === 0 ? 'Pending' : 'Posted',
      };
    });
  } else if (pageId === 'fin-cashbook') {
    columns = [
      { key: 'Voucher No', label: 'Voucher No', type: 'text', source: true },
      { key: 'Date', label: 'Date', type: 'date', source: true },
      { key: 'Party', label: 'Party', type: 'text', source: true },
      { key: 'Receipt / Payment', label: 'Receipt / Payment', type: 'pill', source: true },
      { key: 'Cash In', label: 'Cash In', type: 'inr', source: true },
      { key: 'Cash Out', label: 'Cash Out', type: 'inr', source: true },
      { key: 'Balance', label: 'Balance', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const isRcpt = i % 2 === 0;
      const amtVal = 8000 + (i * 4500);
      const party = parties[i % parties.length]!;
      return {
        id: `csh-${i + 1}`,
        number: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Voucher No': `CSH-26-${String(i + 1).padStart(4, '0')}`,
        Date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        Party: party.name,
        'Receipt / Payment': isRcpt ? 'Receipt' : 'Payment',
        'Cash In': isRcpt ? String(amtVal) : '0',
        'Cash Out': !isRcpt ? String(amtVal) : '0',
        Balance: String(145000 + (i * 2000)),
        Status: 'Approved',
        status: 'Approved',
      };
    });
  } else if (pageId === 'fin-bankbook') {
    columns = [
      { key: 'Voucher No', label: 'Voucher No', type: 'text', source: true },
      { key: 'Date', label: 'Date', type: 'date', source: true },
      { key: 'Bank Account', label: 'Bank Account', type: 'text', source: true },
      { key: 'Party', label: 'Party', type: 'text', source: true },
      { key: 'Receipt / Payment', label: 'Receipt / Payment', type: 'pill', source: true },
      { key: 'Amount', label: 'Amount', type: 'inr', source: true },
      { key: 'Clearing Status', label: 'Clearing Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const isRcpt = i % 2 === 0;
      const party = parties[i % parties.length]!;
      const bank = banks[i % banks.length] ?? 'HDFC Bank';
      return {
        id: `bnk-${i + 1}`,
        number: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Voucher No': `BNK-26-${String(i + 1).padStart(4, '0')}`,
        Date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Bank Account': bank.split(' - ')[0] ?? 'HDFC Bank',
        Party: party.name,
        'Receipt / Payment': isRcpt ? 'Receipt' : 'Payment',
        Amount: String(180000 + (i * 65000)),
        'Clearing Status': i % 3 === 0 ? 'Uncleared' : 'Cleared',
        Status: 'Reconciled',
        status: 'Reconciled',
      };
    });
  } else if (pageId === 'fin-ap') {
    columns = [
      { key: 'Vendor Invoice', label: 'Vendor Invoice', type: 'text', source: true },
      { key: 'Vendor', label: 'Vendor', type: 'text', source: true },
      { key: 'Invoice Date', label: 'Invoice Date', type: 'date', source: true },
      { key: 'Due Date', label: 'Due Date', type: 'date', source: true },
      { key: 'Invoice Amount', label: 'Invoice Amount', type: 'inr', source: true },
      { key: 'Paid', label: 'Paid', type: 'inr', source: true },
      { key: 'Outstanding', label: 'Outstanding', type: 'inr', source: true },
      { key: 'Project Number', label: 'Project Number', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const invAmt = 240000 + (i * 85000);
      const paid = i % 3 === 0 ? invAmt : Math.round(invAmt * 0.4);
      const party = parties[(i + 5) % parties.length]!;
      return {
        id: `ap-${i + 1}`,
        number: `Vendor Invoice ${i + 1}`,
        'Vendor Invoice': `VINV-2026-${String(i + 1).padStart(4, '0')}`,
        Vendor: party.name,
        'Invoice Date': `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Due Date': `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
        'Invoice Amount': String(invAmt),
        Paid: String(paid),
        Outstanding: String(invAmt - paid),
        'Project Number': `PRJ-AUTO-0${(i % 5) + 1}`,
        Status: paid === invAmt ? 'Paid' : 'Due',
        status: paid === invAmt ? 'Paid' : 'Due',
      };
    });
  } else if (pageId === 'fin-ar') {
    columns = [
      { key: 'Invoice No', label: 'Invoice No', type: 'text', source: true },
      { key: 'Customer', label: 'Customer', type: 'text', source: true },
      { key: 'Invoice Date', label: 'Invoice Date', type: 'date', source: true },
      { key: 'Due Date', label: 'Due Date', type: 'date', source: true },
      { key: 'Invoice Amount', label: 'Invoice Amount', type: 'inr', source: true },
      { key: 'Received', label: 'Received', type: 'inr', source: true },
      { key: 'Outstanding', label: 'Outstanding', type: 'inr', source: true },
      { key: 'Age Days', label: 'Age Days', type: 'num', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const invAmt = 350000 + (i * 110000);
      const rcvd = i % 2 === 0 ? Math.round(invAmt * 0.6) : invAmt;
      const party = parties[i % 5]!;
      return {
        id: `ar-${i + 1}`,
        number: `ACC-26-${String(i + 1).padStart(4, '0')}`,
        'Invoice No': `SINV-26-${String(i + 1).padStart(4, '0')}`,
        Customer: party.name,
        'Invoice Date': `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Due Date': `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
        'Invoice Amount': String(invAmt),
        Received: String(rcvd),
        Outstanding: String(invAmt - rcvd),
        'Age Days': String((i * 4) + 12),
        Status: rcvd === invAmt ? 'Paid' : 'Overdue',
        status: rcvd === invAmt ? 'Paid' : 'Overdue',
      };
    });
  } else if (pageId === 'fin-creditnote') {
    columns = [
      { key: 'Credit Note No', label: 'Credit Note No', type: 'text', source: true },
      { key: 'Customer', label: 'Customer', type: 'text', source: true },
      { key: 'Invoice Ref', label: 'Invoice Ref', type: 'text', source: true },
      { key: 'Note Date', label: 'Note Date', type: 'date', source: true },
      { key: 'Amount', label: 'Amount', type: 'inr', source: true },
      { key: 'Reason', label: 'Reason', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const party = parties[i % 5]!;
      return {
        id: `crn-${i + 1}`,
        number: `CRN-26-${String(i + 1).padStart(4, '0')}`,
        'Credit Note No': `CRN-26-${String(i + 1).padStart(4, '0')}`,
        Customer: party.name,
        'Invoice Ref': `SINV-26-00${(i % 12) + 1}`,
        'Note Date': `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        Amount: String(15000 + (i * 6500)),
        Reason: i % 2 === 0 ? 'Volume Discount Adjustment' : 'Quality Return Deduction',
        Status: 'Approved',
        status: 'Approved',
      };
    });
  } else if (pageId === 'fin-debitnote') {
    columns = [
      { key: 'Debit Note No', label: 'Debit Note No', type: 'text', source: true },
      { key: 'Vendor', label: 'Vendor', type: 'text', source: true },
      { key: 'Bill Ref', label: 'Bill Ref', type: 'text', source: true },
      { key: 'Note Date', label: 'Note Date', type: 'date', source: true },
      { key: 'Amount', label: 'Amount', type: 'inr', source: true },
      { key: 'Reason', label: 'Reason', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const party = parties[(i + 5) % parties.length]!;
      return {
        id: `dbn-${i + 1}`,
        number: `DBN-26-${String(i + 1).padStart(4, '0')}`,
        'Debit Note No': `DBN-26-${String(i + 1).padStart(4, '0')}`,
        Vendor: party.name,
        'Bill Ref': `VINV-2026-00${(i % 12) + 1}`,
        'Note Date': `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        Amount: String(22000 + (i * 7500)),
        Reason: i % 2 === 0 ? 'Material Rejection Debit' : 'Rate Difference Debit Note',
        Status: 'Approved',
        status: 'Approved',
      };
    });
  } else if (pageId === 'fin-bankreco') {
    columns = [
      { key: 'Statement Date', label: 'Statement Date', type: 'date', source: true },
      { key: 'Bank Account', label: 'Bank Account', type: 'text', source: true },
      { key: 'Book Balance', label: 'Book Balance', type: 'inr', source: true },
      { key: 'Statement Balance', label: 'Statement Balance', type: 'inr', source: true },
      { key: 'Unreconciled Diff', label: 'Unreconciled Diff', type: 'inr', source: true },
      { key: 'Cleared Items', label: 'Cleared Items', type: 'num', source: true },
      { key: 'Pending Items', label: 'Pending Items', type: 'num', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const book = 14500000 + (i * 850000);
      const diff = i % 4 === 0 ? 0 : 25000 + (i * 1200);
      const bank = banks[i % banks.length] ?? 'HDFC Bank';
      return {
        id: `rec-${i + 1}`,
        number: `REC-26-${String(i + 1).padStart(4, '0')}`,
        'Statement Date': `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        'Bank Account': bank.split(' - ')[0] ?? 'HDFC Bank',
        'Book Balance': String(book),
        'Statement Balance': String(book - diff),
        'Unreconciled Diff': String(diff),
        'Cleared Items': String(84 + (i * 2)),
        'Pending Items': String(diff === 0 ? 0 : (i % 3) + 1),
        Status: diff === 0 ? 'Reconciled' : 'In Progress',
        status: diff === 0 ? 'Reconciled' : 'In Progress',
      };
    });
  } else if (pageId === 'fin-costcenter') {
    columns = [
      { key: 'Cost Center Code', label: 'Cost Center Code', type: 'text', source: true },
      { key: 'Cost Center Name', label: 'Cost Center Name', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Manager', label: 'Manager', type: 'text', source: true },
      { key: 'Budget Limit', label: 'Budget Limit', type: 'inr', source: true },
      { key: 'Actual Spent', label: 'Actual Spent', type: 'inr', source: true },
      { key: 'Variance', label: 'Variance', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const mgrs = ['Sunil Verma', 'Rajesh Sawant', 'Amit Shinde', 'Pooja Sharma', 'Kiran Joshi'];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const budget = 2500000 + (i * 500000);
      const spent = Math.round(budget * (0.75 + ((i % 5) * 0.04)));
      const dept = depts[i % depts.length] ?? 'Finance';
      const mgr = mgrs[i % mgrs.length] ?? 'Sunil Verma';
      return {
        id: `cos-${i + 1}`,
        number: `COS-26-${String(i + 1).padStart(4, '0')}`,
        'Cost Center Code': `CC-${String(i + 101).padStart(4, '0')}`,
        'Cost Center Name': `${dept} Operations Plant-${(i % 3) + 1}`,
        Department: dept,
        Manager: mgr,
        'Budget Limit': String(budget),
        'Actual Spent': String(spent),
        Variance: String(budget - spent),
        Status: 'Active',
        status: 'Active',
      };
    });
  } else if (pageId === 'fin-profitcenter') {
    columns = [
      { key: 'Profit Center Code', label: 'Profit Center Code', type: 'text', source: true },
      { key: 'Profit Center Name', label: 'Profit Center Name', type: 'text', source: true },
      { key: 'Branch / Unit', label: 'Branch / Unit', type: 'text', source: true },
      { key: 'Head', label: 'Head', type: 'text', source: true },
      { key: 'Revenue', label: 'Revenue', type: 'inr', source: true },
      { key: 'Target Margin', label: 'Target Margin', type: 'text', source: true },
      { key: 'Actual Margin', label: 'Actual Margin', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const pc = profitCenters[i % profitCenters.length] ?? 'PC-IND-MACH';
      return {
        id: `prc-${i + 1}`,
        number: `PRC-26-${String(i + 1).padStart(4, '0')}`,
        'Profit Center Code': `${pc}-${i + 1}`,
        'Profit Center Name': `Business Unit ${(i % 5) + 1} - Line ${i + 1}`,
        'Branch / Unit': `Plant Talwade Unit-${(i % 3) + 1}`,
        Head: 'Rajesh Sawant',
        Revenue: String(12000000 + (i * 1500000)),
        'Target Margin': '24.5%',
        'Actual Margin': `${22 + (i % 6)}.%`,
        Status: 'Active',
        status: 'Active',
      };
    });
  } else if (pageId === 'fin-expenses') {
    columns = [
      { key: 'Expense No', label: 'Expense No', type: 'text', source: true },
      { key: 'Date', label: 'Date', type: 'date', source: true },
      { key: 'Employee', label: 'Employee', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Cost Center', label: 'Cost Center', type: 'text', source: true },
      { key: 'Category', label: 'Category', type: 'text', source: true },
      { key: 'Amount', label: 'Amount', type: 'inr', source: true },
      { key: 'GST', label: 'GST', type: 'inr', source: true },
      { key: 'Policy Result', label: 'Policy Result', type: 'pill', source: true },
      { key: 'Approver', label: 'Approver', type: 'text', source: true },
      { key: 'Payment Status', label: 'Payment Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const expCats = ['Travel & Conveyance', 'Client Entertainment', 'Office Supplies', 'Technical Training', 'Factory Welfare'];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const amtVal = 4500 + (i * 1250);
      const dept = depts[i % depts.length] ?? 'Finance';
      const cc = costCenters[i % costCenters.length] ?? 'CC-CORP-01';
      const cat = expCats[i % expCats.length] ?? 'Travel & Conveyance';
      return {
        id: `exp-${i + 1}`,
        number: `EXP-26-${String(i + 1).padStart(4, '0')}`,
        'Expense No': `EXP-26-${String(i + 1).padStart(4, '0')}`,
        Date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        Employee: 'Vikram Shinde',
        Department: dept,
        'Cost Center': cc,
        Category: cat,
        Amount: String(amtVal),
        GST: String(Math.round(amtVal * 0.18)),
        'Policy Result': i % 5 === 0 ? 'Warning' : 'Compliant',
        Approver: 'Sunil Verma',
        'Payment Status': i % 3 === 0 ? 'Paid' : 'Pending',
        Status: 'Approved',
        status: 'Approved',
      };
    });
  } else if (pageId === 'fin-budget') {
    columns = [
      { key: 'Budget No', label: 'Budget No', type: 'text', source: true },
      { key: 'Financial Year', label: 'Financial Year', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Cost Center', label: 'Cost Center', type: 'text', source: true },
      { key: 'Budget Amount', label: 'Budget Amount', type: 'inr', source: true },
      { key: 'Committed', label: 'Committed', type: 'inr', source: true },
      { key: 'Actual Spent', label: 'Actual Spent', type: 'inr', source: true },
      { key: 'Available', label: 'Available', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const bAmt = 5000000 + (i * 1200000);
      const committed = Math.round(bAmt * 0.35);
      const spent = Math.round(bAmt * 0.45);
      const dept = depts[i % depts.length] ?? 'Finance';
      const cc = costCenters[i % costCenters.length] ?? 'CC-CORP-01';
      return {
        id: `bud-${i + 1}`,
        number: `BUD-26-${String(i + 1).padStart(4, '0')}`,
        'Budget No': `BUD-26-${String(i + 1).padStart(4, '0')}`,
        'Financial Year': 'FY 2026-27',
        Department: dept,
        'Cost Center': cc,
        'Budget Amount': String(bAmt),
        Committed: String(committed),
        'Actual Spent': String(spent),
        Available: String(bAmt - (committed + spent)),
        Status: 'Active',
        status: 'Active',
      };
    });
  } else if (pageId === 'fin-trial') {
    columns = [
      { key: 'Line Code', label: 'Line Code', type: 'text', source: true },
      { key: 'Account Description', label: 'Account Description', type: 'text', source: true },
      { key: 'Opening Debit', label: 'Opening Debit', type: 'inr', source: true },
      { key: 'Opening Credit', label: 'Opening Credit', type: 'inr', source: true },
      { key: 'Current Debit', label: 'Current Debit', type: 'inr', source: true },
      { key: 'Current Credit', label: 'Current Credit', type: 'inr', source: true },
      { key: 'Closing Debit', label: 'Closing Debit', type: 'inr', source: true },
      { key: 'Closing Credit', label: 'Closing Credit', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const isDr = i % 2 === 0;
      const amtVal = 850000 + (i * 240000);
      const party = parties[i % parties.length]!;
      return {
        id: `tri-${i + 1}`,
        number: `TRI-26-${String(i + 1).padStart(4, '0')}`,
        'Line Code': `1${String(i + 10).padStart(3, '0')}`,
        'Account Description': `Account Statement Head - ${party.name.slice(0, 24)}`,
        'Opening Debit': isDr ? String(Math.round(amtVal * 0.8)) : '0',
        'Opening Credit': !isDr ? String(Math.round(amtVal * 0.8)) : '0',
        'Current Debit': isDr ? String(amtVal) : '0',
        'Current Credit': !isDr ? String(amtVal) : '0',
        'Closing Debit': isDr ? String(amtVal + 50000) : '0',
        'Closing Credit': !isDr ? String(amtVal + 50000) : '0',
        Status: 'Balanced',
        status: 'Balanced',
      };
    });
  } else if (pageId === 'fin-pnl') {
    columns = [
      { key: 'Line Code', label: 'Line Code', type: 'text', source: true },
      { key: 'Account Description', label: 'Account Description', type: 'text', source: true },
      { key: 'Current Month', label: 'Current Month', type: 'inr', source: true },
      { key: 'YTD', label: 'YTD', type: 'inr', source: true },
      { key: 'Prior Year YTD', label: 'Prior Year YTD', type: 'inr', source: true },
      { key: 'Budget YTD', label: 'Budget YTD', type: 'inr', source: true },
      { key: 'Variance', label: 'Variance', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const cm = 1200000 + (i * 450000);
      const ytd = cm * 7;
      const bYtd = Math.round(ytd * 1.05);
      const dept = depts[i % depts.length] ?? 'Finance';
      return {
        id: `pro-${i + 1}`,
        number: `PRO-26-${String(i + 1).padStart(4, '0')}`,
        'Line Code': `P&L-${String(i + 101).padStart(4, '0')}`,
        'Account Description': `P&L Functional Line Item #${i + 1} (${dept})`,
        'Current Month': String(cm),
        YTD: String(ytd),
        'Prior Year YTD': String(Math.round(ytd * 0.88)),
        'Budget YTD': String(bYtd),
        Variance: String(bYtd - ytd),
        Status: 'Verified',
        status: 'Verified',
      };
    });
  } else if (pageId === 'fin-bs') {
    columns = [
      { key: 'Line Code', label: 'Line Code', type: 'text', source: true },
      { key: 'Category', label: 'Category', type: 'text', source: true },
      { key: 'Account Description', label: 'Account Description', type: 'text', source: true },
      { key: 'Current Period', label: 'Current Period', type: 'inr', source: true },
      { key: 'Prior Period', label: 'Prior Period', type: 'inr', source: true },
      { key: 'Movement', label: 'Movement', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const cur = 15000000 + (i * 3500000);
      const prior = Math.round(cur * 0.92);
      return {
        id: `bal-${i + 1}`,
        number: `BAL-26-${String(i + 1).padStart(4, '0')}`,
        'Line Code': `BS-${String(i + 101).padStart(4, '0')}`,
        Category: i % 2 === 0 ? 'Assets / Current Holdings' : 'Liabilities / Term Obligations',
        'Account Description': `Balance Sheet Line - Schedule III Item #${i + 1}`,
        'Current Period': String(cur),
        'Prior Period': String(prior),
        Movement: String(cur - prior),
        Status: 'Audited',
        status: 'Audited',
      };
    });
  } else if (pageId === 'fin-cashflow') {
    columns = [
      { key: 'Line Code', label: 'Line Code', type: 'text', source: true },
      { key: 'Cash Flow Category', label: 'Cash Flow Category', type: 'text', source: true },
      { key: 'Account Description', label: 'Account Description', type: 'text', source: true },
      { key: 'Current Month', label: 'Current Month', type: 'inr', source: true },
      { key: 'YTD', label: 'YTD', type: 'inr', source: true },
      { key: 'Prior YTD', label: 'Prior YTD', type: 'inr', source: true },
      { key: 'Forecast', label: 'Forecast', type: 'inr', source: true },
      { key: 'Variance', label: 'Variance', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const cats = ['Operating Activities', 'Investing Activities', 'Financing Activities'];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const cm = 850000 + (i * 250000);
      const ytd = cm * 7;
      const fc = Math.round(cm * 1.1);
      const cat = cats[i % cats.length] ?? 'Operating Activities';
      return {
        id: `cas-${i + 1}`,
        number: `CAS-26-${String(i + 1).padStart(4, '0')}`,
        'Line Code': `CF-${String(i + 101).padStart(4, '0')}`,
        'Cash Flow Category': cat,
        'Account Description': `Cash Movement Stream #${i + 1}`,
        'Current Month': String(cm),
        YTD: String(ytd),
        'Prior YTD': String(Math.round(ytd * 0.9)),
        Forecast: String(fc),
        Variance: String(fc - cm),
        Status: 'Reconciled',
        status: 'Reconciled',
      };
    });
  } else if (pageId === 'fin-ageing') {
    columns = [
      { key: 'Party Code', label: 'Party Code', type: 'text', source: true },
      { key: 'Party Name', label: 'Party Name', type: 'text', source: true },
      { key: 'Type', label: 'Type', type: 'pill', source: true },
      { key: 'Current', label: 'Current', type: 'inr', source: true },
      { key: '1-30 Days', label: '1-30 Days', type: 'inr', source: true },
      { key: '31-60 Days', label: '31-60 Days', type: 'inr', source: true },
      { key: '61-90 Days', label: '61-90 Days', type: 'inr', source: true },
      { key: 'Over 90 Days', label: 'Over 90 Days', type: 'inr', source: true },
      { key: 'Total Due', label: 'Total Due', type: 'inr', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const party = parties[i % parties.length]!;
      const cur = 120000 + (i * 25000);
      const b1 = 80000 + (i * 15000);
      const b2 = 45000 + (i * 10000);
      const b3 = 20000 + (i * 5000);
      const b4 = i % 4 === 0 ? 35000 : 0;
      const total = cur + b1 + b2 + b3 + b4;
      return {
        id: `ara-${i + 1}`,
        number: `ARA-26-${String(i + 1).padStart(4, '0')}`,
        'Party Code': party.code,
        'Party Name': party.name,
        Type: party.type,
        Current: String(cur),
        '1-30 Days': String(b1),
        '31-60 Days': String(b2),
        '61-90 Days': String(b3),
        'Over 90 Days': String(b4),
        'Total Due': String(total),
        Status: b4 > 0 ? 'Critical' : 'Controlled',
        status: b4 > 0 ? 'Critical' : 'Controlled',
      };
    });
  }

  let filtered = allRows;
  if (p.q) {
    const query = p.q.toLowerCase();
    filtered = filtered.filter((r) =>
      Object.values(r).some((val) => typeof val === 'string' && val.toLowerCase().includes(query))
    );
  }
  if (p.status) {
    filtered = filtered.filter((r) => (r.status ?? '').toLowerCase() === p.status?.toLowerCase());
  }

  const pageIndex = Math.max(1, p.page || 1);
  const pageSize = p.size || 25;
  const start = (pageIndex - 1) * pageSize;
  const pagedRows = filtered.slice(start, start + pageSize);

  return {
    rows: pagedRows,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

function getProjectV40(_pageId: string, p: V40Params): V40Page {
  let columns: V40Column[] = [];
  let allRows: V40Row[] = [];

  const customers = ['Tata Motors Ltd', 'Mahindra & Mahindra', 'Bharat Forge Ltd', 'Cummins India', 'Bajaj Auto Ltd'];
  const managers = ['Rajesh Sawant', 'Pooja Sharma', 'Amit Deshmukh', 'Vikram Jadhav', 'Nitin Kulkarni'];

  columns = [
    { key: 'Project No', label: 'Project No', type: 'text', source: true },
    { key: 'Project Name', label: 'Project Name', type: 'text', source: true },
    { key: 'Customer', label: 'Customer', type: 'text', source: true },
    { key: 'Start Date', label: 'Start Date', type: 'date', source: true },
    { key: 'End Date', label: 'End Date', type: 'date', source: true },
    { key: 'Contract Value', label: 'Contract Value', type: 'inr', source: true },
    { key: 'Approved Budget', label: 'Approved Budget', type: 'inr', source: true },
    { key: 'Actual Cost', label: 'Actual Cost', type: 'inr', source: true },
    { key: 'EVM Index', label: 'EVM Index', type: 'pill', source: true },
    { key: 'Project Manager', label: 'Project Manager', type: 'text', source: true },
    { key: 'Status', label: 'Status', type: 'pill', source: true },
    { key: 'Actions', label: 'Actions', type: 'actions', source: true },
  ];

  const projects = [
    { name: 'EV Powertrain Inverter Line 4', val: 12500000, bud: 10500000, act: 8900000, evm: 'CPI 1.08 / SPI 1.02' },
    { name: 'High Precision CNC Milling Expansion', val: 8400000, bud: 7200000, act: 6850000, evm: 'CPI 1.05 / SPI 0.98' },
    { name: 'SPPM Valve Assembly Automation Cell', val: 14800000, bud: 12000000, act: 11200000, evm: 'CPI 1.07 / SPI 1.04' },
    { name: 'Chakan Plant Robotics Retrofit Phase 2', val: 6200000, bud: 5400000, act: 4950000, evm: 'CPI 1.09 / SPI 1.01' },
    { name: 'Export Cylinder Block Tooling Package', val: 9500000, bud: 8100000, act: 8450000, evm: 'CPI 0.96 / SPI 0.95' },
    { name: 'Talwade Facility Cleanroom ISO-8 Build', val: 4500000, bud: 3900000, act: 3200000, evm: 'CPI 1.22 / SPI 1.06' },
  ];

  allRows = Array.from({ length: 24 }, (_, i) => {
    const item = projects[i % projects.length]!;
    const code = `PRJ-AUTO-${String(i + 1).padStart(3, '0')}`;
    const status = i % 5 === 0 ? 'Planning' : i % 5 === 4 ? 'Completed' : 'Active';
    return {
      id: code,
      number: code,
      'Project No': code,
      'Project Name': `${item.name} Phase ${1 + (i % 3)}`,
      Customer: customers[i % customers.length]!,
      'Start Date': '2026-04-01',
      'End Date': '2026-12-31',
      'Contract Value': String(item.val),
      'Approved Budget': String(item.bud),
      'Actual Cost': String(item.act),
      'EVM Index': item.evm,
      'Project Manager': managers[i % managers.length]!,
      status,
      Status: status,
    };
  });

  let filtered = allRows;
  if (p.q) {
    const qLower = p.q.toLowerCase();
    filtered = filtered.filter((r) =>
      Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(qLower)),
    );
  }
  if (p.status) {
    filtered = filtered.filter((r) => (r.status ?? '').toLowerCase() === p.status?.toLowerCase());
  }

  const pageIndex = Math.max(1, p.page || 1);
  const pageSize = p.size || 25;
  const start = (pageIndex - 1) * pageSize;
  const pagedRows = filtered.slice(start, start + pageSize);

  return {
    rows: pagedRows,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

function getCommV40(_pageId: string, p: V40Params): V40Page {
  const columns: V40Column[] = [
    { key: 'Message Code', label: 'Message Code', type: 'text', source: true },
    { key: 'Customer / Recipient', label: 'Customer / Recipient', type: 'text', source: true },
    { key: 'Channel', label: 'Channel', type: 'pill', source: true },
    { key: 'Template Name', label: 'Template Name', type: 'text', source: true },
    { key: 'Sent At', label: 'Sent At', type: 'date', source: true },
    { key: 'Delivery Status', label: 'Delivery Status', type: 'pill', source: true },
    { key: 'Linked Document', label: 'Linked Document', type: 'text', source: true },
    { key: 'Opt In Verified', label: 'Opt In Verified', type: 'pill', source: true },
    { key: 'Status', label: 'Status', type: 'pill', source: true },
    { key: 'Actions', label: 'Actions', type: 'actions', source: true },
  ];

  const recipients = [
    { name: 'Tata Motors SCM Desk', phone: '+91 98220 12345' },
    { name: 'Bharat Forge Procurement', phone: '+91 98230 54321' },
    { name: 'Mahindra Auto Quality Desk', phone: '+91 98210 98765' },
    { name: 'Cummins India Spares', phone: '+91 98200 45678' },
    { name: 'Bajaj Auto Plant 2', phone: '+91 98190 32109' },
  ];

  const templates = [
    'Dispatch Notification & E-Way Bill',
    'GST Tax Invoice Ready & Payment Link',
    'Quality Inspection Certificate Attached',
    'PO Acknowledgment & Delivery Schedule',
    'Monthly Statement of Account',
  ];

  const allRows: V40Row[] = Array.from({ length: 24 }, (_, i) => {
    const code = `MSG-26-${String(i + 1).padStart(4, '0')}`;
    const rec = recipients[i % recipients.length]!;
    const chan = i % 3 === 0 ? 'WhatsApp' : i % 3 === 1 ? 'Email' : 'SMS';
    const status = i % 6 === 0 ? 'Failed' : i % 4 === 0 ? 'Delivered' : 'Read';
    return {
      id: code,
      number: code,
      'Message Code': code,
      'Customer / Recipient': `${rec.name} (${rec.phone})`,
      Channel: chan,
      'Template Name': templates[i % templates.length]!,
      'Sent At': '2026-11-15 14:30',
      'Delivery Status': status,
      'Linked Document': `INV-26-${String(100 + i)}`,
      'Opt In Verified': 'Yes',
      status,
      Status: status,
    };
  });

  let filtered = allRows;
  if (p.q) {
    const qLower = p.q.toLowerCase();
    filtered = filtered.filter((r) =>
      Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(qLower)),
    );
  }
  if (p.status) {
    filtered = filtered.filter((r) => (r.status ?? '').toLowerCase() === p.status?.toLowerCase());
  }

  const pageIndex = Math.max(1, p.page || 1);
  const pageSize = p.size || 25;
  const start = (pageIndex - 1) * pageSize;
  const pagedRows = filtered.slice(start, start + pageSize);

  return {
    rows: pagedRows,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

function getServiceV40(pageId: string, p: V40Params): V40Page {
  let columns: V40Column[] = [];
  let allRows: V40Row[] = [];

  const techNames = ['Ravi Kumar', 'Sita Patil', 'Amit Deshmukh', 'Pooja Sharma', 'Kiran Shinde', 'Vikram Jadhav', 'Nitin Kulkarni', 'Sneha Joshi'];
  const territories = ['Pune HQ / Talwade', 'Sawardari Plant', 'Varale Plant', 'Chakan MIDC', 'Bhosari Industrial Area'];
  const skillSets = [
    'CNC Machines, Robotics Level 4, MIG Welding',
    'PLC Automation, SCADA, Electrical Wiring',
    'Hydraulics, Pneumatics, Mechanical Overhaul',
    'Quality Calibration, CMM, Metrology',
    'Sensors, IoT Telemetry, Drive Programming',
    'HVAC, Chiller Systems, Preventive Maintenance',
  ];

  if (pageId === 'service-technicians' || pageId === 'srv-technicians') {
    columns = [
      { key: 'Technician ID', label: 'Technician ID', type: 'text', source: true },
      { key: 'Technician Name', label: 'Technician Name', type: 'text', source: true },
      { key: 'Skills', label: 'Skills', type: 'text', source: true },
      { key: 'Territory', label: 'Territory', type: 'text', source: true },
      { key: 'Active Jobs', label: 'Active Jobs', type: 'num', source: true },
      { key: 'Max Load', label: 'Max Load', type: 'num', source: true },
      { key: 'Contact', label: 'Contact', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 24 }, (_, i) => {
      const code = `TECH-26-${String(i + 1).padStart(4, '0')}`;
      const name = techNames[i % techNames.length]!;
      const status = i === 5 ? 'On Leave' : i === 11 ? 'In Training' : 'Active';
      const activeJobs = (i % 5) + 1;
      const maxLoad = 6;
      return {
        id: code,
        number: code,
        'Technician ID': code,
        'Technician Name': name,
        Skills: skillSets[i % skillSets.length]!,
        Territory: territories[i % territories.length]!,
        'Active Jobs': String(activeJobs),
        'Max Load': String(maxLoad),
        Contact: `+91 98230 ${String(10000 + i * 111).slice(0, 5)}`,
        status,
        Status: status,
      };
    });
  } else {
    columns = [
      { key: 'Ticket No', label: 'Ticket No', type: 'text', source: true },
      { key: 'Customer', label: 'Customer', type: 'text', source: true },
      { key: 'Subject', label: 'Subject', type: 'text', source: true },
      { key: 'Priority', label: 'Priority', type: 'pill', source: true },
      { key: 'Technician', label: 'Technician', type: 'text', source: true },
      { key: 'SLA Status', label: 'SLA Status', type: 'pill', source: true },
      { key: 'Created Date', label: 'Created Date', type: 'date', source: true },
      { key: 'Required By', label: 'Required By', type: 'date', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const priorities = ['High', 'Medium', 'Critical', 'Low'];
    const customers = ['Tata Motors', 'Bharat Forge', 'Mahindra Auto', 'Bajaj Auto', 'Cummins India', 'Kirloskar Oil'];
    const subjects = ['CNC spindle vibration alert', 'Hydraulic press leak inspection', 'Robotic arm calibration error', 'PLC comm failure on Line 2', 'Coolant pump replacement', 'Emergency sensor diagnostic'];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const code = `TCK-26-${String(i + 1).padStart(4, '0')}`;
      const status = i % 4 === 0 ? 'Assigned' : i % 4 === 1 ? 'On Site' : i % 4 === 2 ? 'Waiting Parts' : 'Closed';
      return {
        id: code,
        number: code,
        'Ticket No': code,
        Customer: customers[i % customers.length]!,
        Subject: subjects[i % subjects.length]!,
        Priority: priorities[i % priorities.length]!,
        Technician: techNames[i % techNames.length]!,
        'SLA Status': i % 5 === 0 ? 'Breached' : 'Within SLA',
        'Created Date': '2026-11-10',
        'Required By': '2026-11-18',
        status,
        Status: status,
      };
    });
  }

  let filtered = allRows;
  if (p.q) {
    const qLower = p.q.toLowerCase();
    filtered = filtered.filter((r) =>
      Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(qLower)),
    );
  }
  if (p.status) {
    filtered = filtered.filter((r) => (r.status ?? '').toLowerCase() === p.status?.toLowerCase());
  }

  const pageIndex = Math.max(1, p.page || 1);
  const pageSize = p.size || 25;
  const start = (pageIndex - 1) * pageSize;
  const pagedRows = filtered.slice(start, start + pageSize);

  return {
    rows: pagedRows,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

function getDocV40(pageId: string, p: V40Params): V40Page {
  let columns: V40Column[] = [];
  let allRows: V40Row[] = [];

  const depts = ['Administration', 'Engineering', 'Procurement', 'Quality', 'Finance', 'Logistics', 'HRMS'];

  if (pageId === 'doc-folders' || pageId.includes('folder')) {
    columns = [
      { key: 'Folder Code', label: 'Folder Code', type: 'text', source: true },
      { key: 'Folder Name', label: 'Folder Name', type: 'text', source: true },
      { key: 'Parent Folder', label: 'Parent Folder', type: 'text', source: true },
      { key: 'Owner Department', label: 'Owner Department', type: 'text', source: true },
      { key: 'Document Count', label: 'Document Count', type: 'num', source: true },
      { key: 'Storage Size', label: 'Storage Size', type: 'text', source: true },
      { key: 'Permission Group', label: 'Permission Group', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const folders = [
      { name: 'Corporate Governance & Board', parent: 'Root', size: '124 MB', perm: 'Executive Board', count: 48 },
      { name: 'Engineering CAD & Technical Drawings', parent: 'Root', size: '1.4 GB', perm: 'Design & R&D', count: 312 },
      { name: 'Vendor Contracts & Agreements', parent: 'Root', size: '420 MB', perm: 'SCM & Finance', count: 184 },
      { name: 'Quality Inspection & Audit Certificates', parent: 'Root', size: '680 MB', perm: 'Quality Team', count: 240 },
      { name: 'Financial Ledgers & Tax Filings', parent: 'Root', size: '940 MB', perm: 'Finance Accounts', count: 520 },
      { name: 'Logistics Gate Passes & Consignment Notes', parent: 'Root', size: '360 MB', perm: 'Logistics Operations', count: 410 },
      { name: 'Human Resource Policies & Offer Letters', parent: 'Root', size: '280 MB', perm: 'HRMS Management', count: 165 },
    ];
    allRows = folders.map((f, i) => {
      const code = `FLD-26-${String(i + 1).padStart(4, '0')}`;
      return {
        id: code,
        number: code,
        'Folder Code': code,
        'Folder Name': f.name,
        'Parent Folder': f.parent,
        'Owner Department': depts[i % depts.length]!,
        'Document Count': String(f.count),
        'Storage Size': f.size,
        'Permission Group': f.perm,
        status: 'Active',
        Status: 'Active',
      };
    });
  } else if (pageId === 'doc-versions' || pageId.includes('version')) {
    columns = [
      { key: 'Version Code', label: 'Version Code', type: 'text', source: true },
      { key: 'Document No', label: 'Document No', type: 'text', source: true },
      { key: 'Version No', label: 'Version No', type: 'pill', source: true },
      { key: 'Change Summary', label: 'Change Summary', type: 'text', source: true },
      { key: 'Changed By', label: 'Changed By', type: 'text', source: true },
      { key: 'Effective Date', label: 'Effective Date', type: 'date', source: true },
      { key: 'Approval Status', label: 'Approval Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 20 }, (_, i) => {
      const code = `VER-26-${String(i + 1).padStart(4, '0')}`;
      const docNo = `DOC-26-${String((i % 7) + 1).padStart(4, '0')}`;
      const vno = `v${1 + Math.floor(i / 5)}.${i % 5}`;
      return {
        id: code,
        number: code,
        'Version Code': code,
        'Document No': docNo,
        'Version No': vno,
        'Change Summary': `Updated statutory clauses and revised standard operating tolerances.`,
        'Changed By': 'Pooja Sharma',
        'Effective Date': '2026-11-01',
        'Approval Status': i % 3 === 0 ? 'Pending' : 'Approved',
        status: 'Active',
        Status: 'Active',
      };
    });
  } else if (pageId === 'doc-permissions' || pageId.includes('permission')) {
    columns = [
      { key: 'Permission Code', label: 'Permission Code', type: 'text', source: true },
      { key: 'Role / Department', label: 'Role / Department', type: 'text', source: true },
      { key: 'Access Level', label: 'Access Level', type: 'pill', source: true },
      { key: 'Folder / Category', label: 'Folder / Category', type: 'text', source: true },
      { key: 'Can Read', label: 'Can Read', type: 'pill', source: true },
      { key: 'Can Edit', label: 'Can Edit', type: 'pill', source: true },
      { key: 'Can Delete', label: 'Can Delete', type: 'pill', source: true },
      { key: 'Can Share', label: 'Can Share', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = depts.map((d, i) => {
      const code = `PRM-26-${String(i + 1).padStart(4, '0')}`;
      return {
        id: code,
        number: code,
        'Permission Code': code,
        'Role / Department': d,
        'Access Level': i === 0 ? 'Full Control' : 'Read/Write',
        'Folder / Category': `${d} Standard Documents`,
        'Can Read': 'Yes',
        'Can Edit': i === 0 || i === 4 ? 'Yes' : 'Restricted',
        'Can Delete': i === 0 ? 'Yes' : 'No',
        'Can Share': i <= 2 ? 'Yes' : 'No',
        status: 'Active',
        Status: 'Active',
      };
    });
  } else if (pageId === 'doc-tags' || pageId.includes('tag')) {
    columns = [
      { key: 'Tag Code', label: 'Tag Code', type: 'text', source: true },
      { key: 'Tag Name', label: 'Tag Name', type: 'text', source: true },
      { key: 'Category', label: 'Category', type: 'text', source: true },
      { key: 'Applied Count', label: 'Applied Count', type: 'num', source: true },
      { key: 'Color Hex', label: 'Color Hex', type: 'text', source: true },
      { key: 'Mandatory', label: 'Mandatory', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const tags = [
      { name: 'Statutory GST', cat: 'Tax & Compliance', count: 320, color: '#2563eb', mand: 'Yes' },
      { name: 'Confidential NDA', cat: 'Legal & Executive', count: 85, color: '#dc2626', mand: 'Yes' },
      { name: 'Engineering ISO9001', cat: 'Quality Standards', count: 412, color: '#16a34a', mand: 'No' },
      { name: 'Vendor Verified', cat: 'Procurement', count: 194, color: '#0891b2', mand: 'No' },
      { name: 'Board Resolution', cat: 'Governance', count: 42, color: '#7c3aed', mand: 'Yes' },
    ];
    allRows = tags.map((t, i) => {
      const code = `TAG-26-${String(i + 1).padStart(4, '0')}`;
      return {
        id: code,
        number: code,
        'Tag Code': code,
        'Tag Name': t.name,
        Category: t.cat,
        'Applied Count': String(t.count),
        'Color Hex': t.color,
        Mandatory: t.mand,
        status: 'Active',
        Status: 'Active',
      };
    });
  } else if (pageId === 'doc-search' || pageId.includes('search')) {
    columns = [
      { key: 'Result ID', label: 'Result ID', type: 'text', source: true },
      { key: 'Document No', label: 'Document No', type: 'text', source: true },
      { key: 'Title', label: 'Title', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Folder', label: 'Folder', type: 'text', source: true },
      { key: 'Indexed Fields', label: 'Indexed Fields', type: 'text', source: true },
      { key: 'Matched Keywords', label: 'Matched Keywords', type: 'text', source: true },
      { key: 'Relevance Score', label: 'Relevance Score', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 15 }, (_, i) => {
      const code = `SRC-26-${String(i + 1).padStart(4, '0')}`;
      const docNo = `DOC-26-${String(i + 1).padStart(4, '0')}`;
      return {
        id: code,
        number: code,
        'Result ID': code,
        'Document No': docNo,
        Title: `Sawant Group Operational Spec Part ${i + 1}`,
        Department: depts[i % depts.length]!,
        Folder: 'Corporate Master Documents',
        'Indexed Fields': 'Title, Content, Metadata, Author, Project',
        'Matched Keywords': 'Contract, Compliance, 2026, Revision',
        'Relevance Score': '98% Match',
        status: 'Active',
        Status: 'Active',
      };
    });
  } else {
    columns = [
      { key: 'Document No', label: 'Document No', type: 'text', source: true },
      { key: 'Title', label: 'Title', type: 'text', source: true },
      { key: 'Folder', label: 'Folder', type: 'text', source: true },
      { key: 'Category', label: 'Category', type: 'text', source: true },
      { key: 'Version', label: 'Version', type: 'pill', source: true },
      { key: 'File Format', label: 'File Format', type: 'text', source: true },
      { key: 'File Size', label: 'File Size', type: 'text', source: true },
      { key: 'Uploaded By', label: 'Uploaded By', type: 'text', source: true },
      { key: 'Uploaded On', label: 'Uploaded On', type: 'date', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const docs = [
      { t: 'FY 2026-27 Board Resolution - Plant Expansion', f: 'Corporate Governance', c: 'Governance', fmt: 'PDF (.pdf)', sz: '2.4 MB' },
      { t: 'Component 420-B CNC Milling Blueprint v3', f: 'Engineering CAD Drawings', c: 'Technical Spec', fmt: 'DWG / PDF', sz: '14.2 MB' },
      { t: 'Master Vendor Supply Agreement - Steel Strips', f: 'Vendor Contracts', c: 'Commercial Contract', fmt: 'Word (.docx)', sz: '1.8 MB' },
      { t: 'ISO 9001:2015 Recertification Audit Report', f: 'Quality Inspection', c: 'Audit Report', fmt: 'PDF (.pdf)', sz: '4.6 MB' },
      { t: 'GSTR-3B Monthly Return Filing Acknowledgment', f: 'Financial Ledgers', c: 'Statutory Tax', fmt: 'Excel (.xlsx)', sz: '820 KB' },
      { t: 'Consignment Gate Pass - Pune to Sanand Dispatch', f: 'Logistics Gate Passes', c: 'Movement Pass', fmt: 'PDF (.pdf)', sz: '640 KB' },
    ];
    allRows = Array.from({ length: 24 }, (_, i) => {
      const item = docs[i % docs.length]!;
      const code = `DOC-26-${String(i + 1).padStart(4, '0')}`;
      const status = i % 5 === 0 ? 'Draft' : i % 5 === 1 ? 'Under Review' : 'Active';
      return {
        id: code,
        number: code,
        'Document No': code,
        Title: `${item.t} #${i + 1}`,
        Folder: item.f,
        Category: item.c,
        Version: `v1.${i % 3}`,
        'File Format': item.fmt,
        'File Size': item.sz,
        'Uploaded By': 'Pooja Sharma',
        'Uploaded On': '2026-11-12',
        status,
        Status: status,
      };
    });
  }

  let filtered = allRows;
  if (p.q) {
    const qLower = p.q.toLowerCase();
    filtered = filtered.filter((r) =>
      Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(qLower)),
    );
  }
  if (p.status) {
    filtered = filtered.filter((r) => (r.status ?? '').toLowerCase() === p.status?.toLowerCase());
  }

  const pageIndex = Math.max(1, p.page || 1);
  const pageSize = p.size || 25;
  const start = (pageIndex - 1) * pageSize;
  const pagedRows = filtered.slice(start, start + pageSize);

  return {
    rows: pagedRows,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

function getScmV40(pageId: string, p: V40Params): V40Page {
  let columns: V40Column[] = [];
  let allRows: V40Row[] = [];

  const vendors = [
    { code: 'VEND-001', name: 'Tata Steel Tubes Ltd' },
    { code: 'VEND-002', name: 'Hindalco Metal Supplies' },
    { code: 'VEND-003', name: 'JSW Coated Sheets' },
    { code: 'VEND-004', name: 'Schneider Electric Components' },
    { code: 'VEND-005', name: 'SKF India Bearings' },
    { code: 'VEND-006', name: 'Bosch Industrial Rexroth' },
    { code: 'VEND-007', name: 'L&T Heavy Engineering' },
    { code: 'VEND-008', name: 'Praj Industries Biofuels' },
    { code: 'VEND-009', name: 'ABB Power Grids Systems' },
    { code: 'VEND-010', name: 'Endress+Hauser Flowtech' },
    { code: 'VEND-011', name: 'Festo Pneumatics India' },
    { code: 'VEND-012', name: 'Sandvik Coromant Tools' },
  ];

  const items = [
    { code: 'ITM-STL-001', name: 'Seamless Steel Pipe 50mm Sch 40', uom: 'MTR', rate: 1450 },
    { code: 'ITM-ALU-002', name: 'Aluminum Extrusion Profile 6063-T6', uom: 'KG', rate: 380 },
    { code: 'ITM-BRG-003', name: 'Deep Groove Ball Bearing 6205-2RS', uom: 'NOS', rate: 850 },
    { code: 'ITM-VLV-004', name: 'Pneumatic Solenoid Valve 24V DC', uom: 'SET', rate: 4200 },
    { code: 'ITM-SHT-005', name: 'CRCA Cold Rolled Steel Sheet 2mm', uom: 'SHT', rate: 2900 },
    { code: 'ITM-FST-006', name: 'High Tensile Hex Bolt M12x50 Gr 8.8', uom: 'BOX', rate: 1250 },
    { code: 'ITM-SEN-007', name: 'Proximity Inductive Sensor M18 PNP', uom: 'NOS', rate: 1950 },
    { code: 'ITM-HYD-008', name: 'Hydraulic Directional Control Valve', uom: 'NOS', rate: 11500 },
  ];

  const buyers = ['Rajesh Sawant', 'Suresh Nair', 'Amit Deshmukh', 'Vikram Shinde', 'Ananya Joshi'];
  const depts = ['Purchase', 'Production', 'Stores', 'Quality', 'Maintenance', 'Tool Room'];

  if (pageId === 'scm-comparison') {
    columns = [
      { key: 'Comparison No', label: 'Comparison No', type: 'text', source: true },
      { key: 'RFQ No', label: 'RFQ No', type: 'text', source: true },
      { key: 'Title / Subject', label: 'Title / Subject', type: 'text', source: true },
      { key: 'Awarded Vendor', label: 'Awarded Vendor', type: 'text', source: true },
      { key: 'Lowest Quote (L1)', label: 'Lowest Quote (L1)', type: 'inr', source: true },
      { key: 'Awarded Value', label: 'Awarded Value', type: 'inr', source: true },
      { key: 'Quotes Compared', label: 'Quotes Compared', type: 'num', source: true },
      { key: 'Buyer', label: 'Buyer', type: 'text', source: true },
      { key: 'Required Date', label: 'Required Date', type: 'date', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const comparisons = [
      { rfq: 'RFQ-2026-0041', title: 'Seamless Boiler Tubes & Elbows', l1: 840000, award: 840000, vIdx: 0, st: 'Awarded' },
      { rfq: 'RFQ-2026-0042', title: 'Aluminum Extrusions 6063-T6', l1: 420000, award: 435000, vIdx: 1, st: 'Under Review' },
      { rfq: 'RFQ-2026-0043', title: 'Industrial SKF Bearing Supply Batch', l1: 310000, award: 310000, vIdx: 4, st: 'Awarded' },
      { rfq: 'RFQ-2026-0044', title: 'High Tensile Fasteners & Anchor Bolts', l1: 195000, award: 195000, vIdx: 6, st: 'Pending Approval' },
      { rfq: 'RFQ-2026-0045', title: 'Pneumatic Cylinders & Valve Manifolds', l1: 675000, award: 675000, vIdx: 10, st: 'Awarded' },
      { rfq: 'RFQ-2026-0046', title: 'CRCA Cold Rolled Steel Coils', l1: 1250000, award: 1250000, vIdx: 2, st: 'Approved' },
      { rfq: 'RFQ-2026-0047', title: 'Sandvik CNC Solid Carbide Inserts', l1: 285000, award: 285000, vIdx: 11, st: 'Draft' },
      { rfq: 'RFQ-2026-0048', title: 'Hydraulic Proportional Valves Batch', l1: 940000, award: 940000, vIdx: 5, st: 'Awarded' },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const cmp = comparisons[i % comparisons.length]!;
      const cmpNo = `CMP-2026-${String(i + 1).padStart(4, '0')}`;
      const vendor = vendors[cmp.vIdx % vendors.length]!;
      const buyer = buyers[i % buyers.length]!;
      return {
        id: `scm-cmp-${i + 1}`,
        number: cmpNo,
        'Comparison No': cmpNo,
        'RFQ No': cmp.rfq,
        'Title / Subject': cmp.title,
        'Awarded Vendor': `${vendor.name} (${vendor.code})`,
        'Lowest Quote (L1)': String(cmp.l1 + i * 15000),
        'Awarded Value': String(cmp.award + i * 15000),
        'Quotes Compared': String(3 + (i % 3)),
        Buyer: buyer,
        'Required Date': `2026-11-${String((i % 25) + 5).padStart(2, '0')}`,
        Status: cmp.st,
        status: cmp.st,
      };
    });
  } else if (pageId === 'scm-vendorquote') {
    columns = [
      { key: 'Quote No', label: 'Quote No', type: 'text', source: true },
      { key: 'RFQ No', label: 'RFQ No', type: 'text', source: true },
      { key: 'Vendor', label: 'Vendor', type: 'text', source: true },
      { key: 'Quote Date', label: 'Quote Date', type: 'date', source: true },
      { key: 'Valid Until', label: 'Valid Until', type: 'date', source: true },
      { key: 'Total Amount', label: 'Total Amount', type: 'inr', source: true },
      { key: 'Landed Cost', label: 'Landed Cost', type: 'inr', source: true },
      { key: 'Lead Time (Days)', label: 'Lead Time (Days)', type: 'num', source: true },
      { key: 'Payment Terms', label: 'Payment Terms', type: 'text', source: true },
      { key: 'Compliance', label: 'Compliance', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const vqNo = `VQ-2026-${String(i + 1).padStart(4, '0')}`;
      const rfqNo = `RFQ-2026-${String(40 + (i % 8)).padStart(4, '0')}`;
      const v = vendors[i % vendors.length]!;
      const amt = 240000 + i * 38000;
      const landed = Math.round(amt * 1.18);
      const st = i % 4 === 0 ? 'Selected' : i % 4 === 1 ? 'Under Review' : i % 4 === 2 ? 'Submitted' : 'Draft';
      return {
        id: `scm-vq-${i + 1}`,
        number: vqNo,
        'Quote No': vqNo,
        'RFQ No': rfqNo,
        Vendor: `${v.name} (${v.code})`,
        'Quote Date': `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'Valid Until': '2026-12-31',
        'Total Amount': String(amt),
        'Landed Cost': String(landed),
        'Lead Time (Days)': String(7 + (i % 14)),
        'Payment Terms': i % 2 === 0 ? 'Net 30 Days' : '100% Against PI',
        Compliance: i % 5 === 0 ? 'Partial' : 'Full',
        Status: st,
        status: st,
      };
    });
  } else if (pageId === 'scm-rfq') {
    columns = [
      { key: 'RFQ No', label: 'RFQ No', type: 'text', source: true },
      { key: 'Issue Date', label: 'Issue Date', type: 'date', source: true },
      { key: 'Closing Date', label: 'Closing Date', type: 'date', source: true },
      { key: 'Subject', label: 'Subject', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Buyer', label: 'Buyer', type: 'text', source: true },
      { key: 'Invited Vendors', label: 'Invited Vendors', type: 'num', source: true },
      { key: 'Quotes Received', label: 'Quotes Received', type: 'num', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const rfqNo = `RFQ-2026-${String(i + 1).padStart(4, '0')}`;
      const buyer = buyers[i % buyers.length]!;
      const dept = depts[i % depts.length]!;
      const itm = items[i % items.length]!;
      const st = i % 3 === 0 ? 'Closed' : i % 3 === 1 ? 'Open' : 'Draft';
      return {
        id: `scm-rfq-${i + 1}`,
        number: rfqNo,
        'RFQ No': rfqNo,
        'Issue Date': `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'Closing Date': `2026-11-${String((i % 15) + 15).padStart(2, '0')}`,
        Subject: `Supply of ${itm.name}`,
        Department: dept,
        Buyer: buyer,
        'Invited Vendors': '4',
        'Quotes Received': String(2 + (i % 3)),
        Status: st,
        status: st,
      };
    });
  } else if (pageId === 'scm-pr') {
    columns = [
      { key: 'PR No', label: 'PR No', type: 'text', source: true },
      { key: 'Date', label: 'Date', type: 'date', source: true },
      { key: 'Item Name', label: 'Item Name', type: 'text', source: true },
      { key: 'Required Qty', label: 'Required Qty', type: 'num', source: true },
      { key: 'UOM', label: 'UOM', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Required By', label: 'Required By', type: 'date', source: true },
      { key: 'Priority', label: 'Priority', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const prNo = `PR-2026-${String(i + 1).padStart(4, '0')}`;
      const itm = items[i % items.length]!;
      const dept = depts[i % depts.length]!;
      const st = i % 3 === 0 ? 'Approved' : i % 3 === 1 ? 'Submitted' : 'Draft';
      return {
        id: `scm-pr-${i + 1}`,
        number: prNo,
        'PR No': prNo,
        Date: `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'Item Name': `${itm.name} (${itm.code})`,
        'Required Qty': String((i + 1) * 25),
        UOM: itm.uom,
        Department: dept,
        'Required By': `2026-11-${String((i % 15) + 16).padStart(2, '0')}`,
        Priority: i % 4 === 0 ? 'Urgent' : i % 4 === 1 ? 'High' : 'Normal',
        Status: st,
        status: st,
      };
    });
  } else if (pageId === 'scm-po') {
    columns = [
      { key: 'PO No', label: 'PO No', type: 'text', source: true },
      { key: 'Vendor', label: 'Vendor', type: 'text', source: true },
      { key: 'PO Date', label: 'PO Date', type: 'date', source: true },
      { key: 'Delivery Date', label: 'Delivery Date', type: 'date', source: true },
      { key: 'Order Value', label: 'Order Value', type: 'inr', source: true },
      { key: 'GRN Status', label: 'GRN Status', type: 'pill', source: true },
      { key: 'Invoice Status', label: 'Invoice Status', type: 'pill', source: true },
      { key: 'Buyer', label: 'Buyer', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const poNo = `PO-2026-${String(i + 1).padStart(4, '0')}`;
      const v = vendors[i % vendors.length]!;
      const buyer = buyers[i % buyers.length]!;
      const val = 185000 + i * 42000;
      const st = i % 4 === 0 ? 'Approved' : i % 4 === 1 ? 'Partially Received' : i % 4 === 2 ? 'Completed' : 'Draft';
      return {
        id: `scm-po-${i + 1}`,
        number: poNo,
        'PO No': poNo,
        Vendor: `${v.name} (${v.code})`,
        'PO Date': `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'Delivery Date': `2026-11-${String((i % 15) + 16).padStart(2, '0')}`,
        'Order Value': String(val),
        'GRN Status': i % 3 === 0 ? 'Completed' : i % 3 === 1 ? 'Partial' : 'Pending',
        'Invoice Status': i % 3 === 0 ? 'Matched' : 'Pending',
        Buyer: buyer,
        Status: st,
        status: st,
      };
    });
  } else if (pageId === 'scm-grn') {
    columns = [
      { key: 'GRN No', label: 'GRN No', type: 'text', source: true },
      { key: 'PO No', label: 'PO No', type: 'text', source: true },
      { key: 'Vendor', label: 'Vendor', type: 'text', source: true },
      { key: 'Receipt Date', label: 'Receipt Date', type: 'date', source: true },
      { key: 'DC / Challan No', label: 'DC / Challan No', type: 'text', source: true },
      { key: 'Received Value', label: 'Received Value', type: 'inr', source: true },
      { key: 'QC Decision', label: 'QC Decision', type: 'pill', source: true },
      { key: 'Warehouse', label: 'Warehouse', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const grnNo = `GRN-2026-${String(i + 1).padStart(4, '0')}`;
      const poNo = `PO-2026-${String(i + 1).padStart(4, '0')}`;
      const v = vendors[i % vendors.length]!;
      const val = 160000 + i * 35000;
      const st = i % 3 === 0 ? 'Posted' : i % 3 === 1 ? 'Inspection Done' : 'Draft';
      return {
        id: `scm-grn-${i + 1}`,
        number: grnNo,
        'GRN No': grnNo,
        'PO No': poNo,
        Vendor: `${v.name} (${v.code})`,
        'Receipt Date': `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'DC / Challan No': `DC-VEND-${String(900 + i)}`,
        'Received Value': String(val),
        'QC Decision': i % 5 === 0 ? 'Accepted Under Deviation' : 'Accepted',
        Warehouse: i % 2 === 0 ? 'Main Raw Material Store' : 'Consumables Store',
        Status: st,
        status: st,
      };
    });
  } else if (pageId === 'scm-purchaseinvoice') {
    columns = [
      { key: 'Invoice No', label: 'Invoice No', type: 'text', source: true },
      { key: 'Vendor Ref No', label: 'Vendor Ref No', type: 'text', source: true },
      { key: 'Vendor', label: 'Vendor', type: 'text', source: true },
      { key: 'PO No', label: 'PO No', type: 'text', source: true },
      { key: 'GRN No', label: 'GRN No', type: 'text', source: true },
      { key: 'Invoice Date', label: 'Invoice Date', type: 'date', source: true },
      { key: 'Due Date', label: 'Due Date', type: 'date', source: true },
      { key: 'Grand Total', label: 'Grand Total', type: 'inr', source: true },
      { key: '3-Way Match', label: '3-Way Match', type: 'pill', source: true },
      { key: 'Payment Status', label: 'Payment Status', type: 'pill', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const invNo = `PINV-2026-${String(i + 1).padStart(4, '0')}`;
      const v = vendors[i % vendors.length]!;
      const poNo = `PO-2026-${String(i + 1).padStart(4, '0')}`;
      const grnNo = `GRN-2026-${String(i + 1).padStart(4, '0')}`;
      const val = 188000 + i * 41000;
      const st = i % 3 === 0 ? 'Posted' : i % 3 === 1 ? 'Matched' : 'Draft';
      return {
        id: `scm-inv-${i + 1}`,
        number: invNo,
        'Invoice No': invNo,
        'Vendor Ref No': `TAX-INV-${String(5000 + i)}`,
        Vendor: `${v.name} (${v.code})`,
        'PO No': poNo,
        'GRN No': grnNo,
        'Invoice Date': `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'Due Date': `2026-12-${String((i % 15) + 1).padStart(2, '0')}`,
        'Grand Total': String(val),
        '3-Way Match': i % 6 === 0 ? 'Price Variance Alert' : 'Matched 100%',
        'Payment Status': i % 3 === 0 ? 'Paid' : 'Unpaid',
        Status: st,
        status: st,
      };
    });
  } else if (pageId === 'scm-vendorportal') {
    columns = [
      { key: 'Document No', label: 'Document No', type: 'text', source: true },
      { key: 'Document Type', label: 'Document Type', type: 'pill', source: true },
      { key: 'Reference / PO', label: 'Reference / PO', type: 'text', source: true },
      { key: 'Document Date', label: 'Document Date', type: 'date', source: true },
      { key: 'Due Date', label: 'Due Date', type: 'date', source: true },
      { key: 'Total Amount', label: 'Total Amount', type: 'inr', source: true },
      { key: 'Shipment (ASN)', label: 'Shipment (ASN)', type: 'pill', source: true },
      { key: 'Payment Status', label: 'Payment Status', type: 'pill', source: true },
      { key: 'Buyer Contact', label: 'Buyer Contact', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    const portalDocs = [
      { type: 'Purchase Order', ref: 'PO-2026-0041', due: '2026-11-28', amt: 840000, asn: 'ASN-2026-0012', pay: 'Payment Scheduled', buyer: 'Rajesh Sawant', st: 'Acknowledged' },
      { type: 'RFQ Invitation', ref: 'RFQ-2026-0042', due: '2026-11-25', amt: 420000, asn: '—', pay: 'N/A', buyer: 'Suresh Nair', st: 'Bid Submitted' },
      { type: 'Purchase Order', ref: 'PO-2026-0043', due: '2026-11-30', amt: 310000, asn: 'ASN-2026-0015', pay: 'Advance Paid', buyer: 'Amit Deshmukh', st: 'In Transit' },
      { type: 'Vendor Invoice', ref: 'TAX-INV-5012', due: '2026-12-15', amt: 675000, asn: 'ASN-2026-0016', pay: 'Approved for Pay', buyer: 'Vikram Shinde', st: '3-Way Matched' },
      { type: 'Quotation', ref: 'VQ-2026-0019', due: '2026-12-31', amt: 1250000, asn: '—', pay: 'N/A', buyer: 'Rajesh Sawant', st: 'Selected' },
      { type: 'Purchase Order', ref: 'PO-2026-0046', due: '2026-12-05', amt: 940000, asn: 'ASN-Pending', pay: 'Pending Delivery', buyer: 'Ananya Joshi', st: 'Open' },
      { type: 'Debit Note', ref: 'DN-2026-0004', due: '2026-11-20', amt: 45000, asn: '—', pay: 'Settled', buyer: 'Sunil Verma', st: 'Accepted' },
      { type: 'Advance Shipment', ref: 'ASN-2026-0020', due: '2026-11-26', amt: 520000, asn: 'ASN-2026-0020', pay: 'Pending GRN', buyer: 'Amit Deshmukh', st: 'Dispatched' },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const doc = portalDocs[i % portalDocs.length]!;
      const docNo = `VP-2026-${String(i + 1).padStart(4, '0')}`;
      return {
        id: `scm-vp-${i + 1}`,
        number: docNo,
        'Document No': docNo,
        'Document Type': doc.type,
        'Reference / PO': doc.ref,
        'Document Date': `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'Due Date': doc.due,
        'Total Amount': String(doc.amt + i * 12000),
        'Shipment (ASN)': doc.asn,
        'Payment Status': doc.pay,
        'Buyer Contact': doc.buyer,
        Status: doc.st,
        status: doc.st,
      };
    });
  } else {
    // Default fallback for other SCM pages (contracts, evaluation, approval)
    columns = [
      { key: 'Record No', label: 'Record No', type: 'text', source: true },
      { key: 'Vendor', label: 'Vendor', type: 'text', source: true },
      { key: 'Category', label: 'Category', type: 'text', source: true },
      { key: 'Effective Date', label: 'Effective Date', type: 'date', source: true },
      { key: 'Score / Value', label: 'Score / Value', type: 'text', source: true },
      { key: 'Department', label: 'Department', type: 'text', source: true },
      { key: 'Status', label: 'Status', type: 'pill', source: true },
      { key: 'Actions', label: 'Actions', type: 'actions', source: true },
    ];
    allRows = Array.from({ length: 25 }, (_, i) => {
      const recNo = `SCM-${String(i + 1).padStart(4, '0')}`;
      const v = vendors[i % vendors.length]!;
      const dept = depts[i % depts.length]!;
      return {
        id: `scm-rec-${i + 1}`,
        number: recNo,
        'Record No': recNo,
        Vendor: `${v.name} (${v.code})`,
        Category: 'Direct Material Sourcing',
        'Effective Date': `2026-11-${String((i % 15) + 1).padStart(2, '0')}`,
        'Score / Value': pageId === 'scm-evaluation' ? `${85 + (i % 14)}% Grade A` : `₹ ${(i + 1) * 350000}`,
        Department: dept,
        Status: i % 2 === 0 ? 'Approved' : 'Active',
        status: i % 2 === 0 ? 'Approved' : 'Active',
      };
    });
  }

  let filtered = allRows;
  if (p.q) {
    const qLower = p.q.toLowerCase();
    filtered = filtered.filter((r) =>
      Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(qLower)),
    );
  }
  if (p.status) {
    filtered = filtered.filter((r) => (r.status ?? '').toLowerCase() === p.status?.toLowerCase());
  }

  const pageIndex = Math.max(1, p.page || 1);
  const pageSize = p.size || 25;
  const start = (pageIndex - 1) * pageSize;
  const pagedRows = filtered.slice(start, start + pageSize);

  return {
    rows: pagedRows,
    columns,
    total: filtered.length,
    panel: null,
    audit: false,
    noSource: [],
  };
}

