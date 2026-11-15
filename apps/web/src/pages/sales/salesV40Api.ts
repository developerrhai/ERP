// Client of GET /sales/v40/:pageId - the V40 tab views of the CRM and Sales pages (apps/api/src/modules/sales/v40-views.ts).
import { request } from '../../lib/api';
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
