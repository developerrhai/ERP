// Fixtures for the generic / typed record engine tests: a Lead Management schema, a typed stock
// adjustment schema, record factories and a small stateful records endpoint (filter, sort, page).
import { json, type Call, type Handler } from './helpers';
import type { FieldMeta, PageSchema, RecordRow } from '../pages/generic/engineApi';

export const LEAD_SCHEMA: PageSchema = {
  pageId: 'crm-leads',
  title: 'Lead Management',
  family: 'CRM',
  purpose: 'Manage prospect engagement, qualification and conversion.',
  tabs: [
    'Lead Register',
    'Qualification Desk',
    'Communication Timeline',
    'Follow-up Queue',
    'Lead Scoring',
    'Conversion Analytics',
  ],
  kind: 'generic',
  statuses: ['Draft', 'Open', 'Active', 'Completed'],
  actions: [],
  listColumns: [
    'leadNo',
    'leadName',
    'company',
    'stage',
    'expectedValue',
    'nextFollowUp',
    'status',
  ],
  ownerDepartment: 'Sales',
  approvalRequired: true,
  fields: [
    { key: 'leadNo', label: 'Lead No', type: 'code', required: false, readOnly: true },
    {
      key: 'leadName',
      label: 'Lead Name',
      type: 'text',
      required: true,
      readOnly: false,
      maxLength: 100,
    },
    { key: 'company', label: 'Company', type: 'text', required: false, readOnly: false },
    { key: 'mobile', label: 'Mobile', type: 'phone', required: false, readOnly: false },
    { key: 'email', label: 'Email', type: 'email', required: false, readOnly: false },
    {
      key: 'stage',
      label: 'Stage',
      type: 'enum',
      required: false,
      readOnly: false,
      options: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
    },
    {
      key: 'expectedValue',
      label: 'Expected Value',
      type: 'money',
      required: false,
      readOnly: false,
      min: 0,
    },
    { key: 'discount', label: 'Discount', type: 'pct', required: false, readOnly: false },
    {
      key: 'nextFollowUp',
      label: 'Next Follow-up',
      type: 'date',
      required: false,
      readOnly: false,
    },
    { key: 'gstin', label: 'GSTIN', type: 'gstin', required: false, readOnly: false },
    { key: 'consent', label: 'Consent', type: 'bool', required: false, readOnly: false },
    { key: 'notes', label: 'Notes', type: 'longtext', required: false, readOnly: false },
    { key: 'status', label: 'Status', type: 'status', required: false, readOnly: true },
  ],
};

export function leadRow(i: number, over: Partial<RecordRow> = {}): RecordRow {
  const n = String(i).padStart(5, '0');
  return {
    id: `r${i}`,
    code: `LEA/TAL/26-27/${n}`,
    status: i % 2 ? 'Draft' : 'Active',
    unitId: 'unit-tal',
    fyId: 'fy-2627',
    department: 'Sales',
    data: {
      leadName: `Lead ${i}`,
      company: i === 3 ? '' : `Company ${i}`,
      stage: 'New',
      expectedValue: 1000 * i + 0.5,
      nextFollowUp: '2026-12-05',
    },
    version: i,
    createdAt: new Date().toISOString(),
    createdBy: { id: 'u1', name: 'Asha Patil' },
    ...over,
  };
}

export const LEAD_ROWS: RecordRow[] = [1, 2, 3].map((i) => leadRow(i));

export const ITEM_REF = { id: 'item-1', code: 'ITM/00001', name: 'Steel Rod', uom: 'Kg' };
export const WH_REF = { id: 'wh-1', code: 'TAL-MAIN', name: 'Talwade Main Store' };

export const ADJUST_SCHEMA: PageSchema = {
  pageId: 'inv-adjustment',
  title: 'Stock Adjustment',
  family: 'Inventory',
  tabs: [
    'Adjustment Register',
    'Count Sheets',
    'Variance',
    'Approvals Desk',
    'Write-offs',
    'Audit',
  ],
  kind: 'typed',
  statuses: ['Draft', 'Posted', 'Cancelled'],
  listColumns: ['adjNo', 'warehouse', 'item', 'countedQty', 'status'],
  actions: [
    {
      key: 'post',
      label: 'Post',
      variant: 'primary',
      confirm: 'Post {code}? Stock will change and the voucher will be locked.',
      allowedFrom: ['Draft'],
    },
    {
      key: 'cancel',
      label: 'Cancel voucher',
      variant: 'danger',
      confirm: true,
      allowedFrom: ['Posted'],
    },
  ],
  fields: [
    { key: 'adjNo', label: 'Adjustment No', type: 'code', required: false, readOnly: true },
    {
      key: 'warehouse',
      label: 'Warehouse',
      type: 'ref',
      required: true,
      readOnly: false,
      refPage: 'wms-warehouses',
    },
    {
      key: 'item',
      label: 'Item',
      type: 'ref',
      required: true,
      readOnly: false,
      refPage: 'inv-items',
    },
    { key: 'systemQty', label: 'System Qty', type: 'qty', required: false, readOnly: true },
    {
      key: 'countedQty',
      label: 'Counted Qty',
      type: 'qty',
      required: true,
      readOnly: false,
      min: 0,
    },
    { key: 'avgRate', label: 'Unit Cost', type: 'money', required: false, readOnly: true },
    { key: 'status', label: 'Status', type: 'status', required: false, readOnly: true },
  ],
};

export function adjustRow(i: number, status: string): RecordRow {
  return {
    ...leadRow(i, { status }),
    code: `ADJ/TAL/26-27/000${i}`,
    data: { warehouse: 'wh-1', item: 'item-1', countedQty: 45 },
    refs: { warehouse: WH_REF, item: ITEM_REF },
  };
}

/** A records endpoint over a fixed list: honours status, q (code/name), page and size. */
export function recordsHandler(all: RecordRow[]): Handler {
  return (call: Call) => {
    const u = new URL(call.url, 'http://test');
    const status = u.searchParams.get('status') ?? '';
    const q = (u.searchParams.get('q') ?? '').toLowerCase();
    const size = Number(u.searchParams.get('size') ?? 10);
    const page = Number(u.searchParams.get('page') ?? 1);
    let rows = all.filter((r) => !status || r.status === status);
    if (q) rows = rows.filter((r) => JSON.stringify([r.code, r.data]).toLowerCase().includes(q));
    return json(200, {
      data: rows.slice((page - 1) * size, page * size),
      meta: { page, size, total: rows.length },
    });
  };
}

// ---- Stage C inventory fixtures ---------------------------------------------------------

const fld = (
  key: string,
  label: string,
  type: FieldMeta['type'],
  over: Partial<FieldMeta> = {},
): FieldMeta => ({
  key,
  label,
  type,
  required: false,
  readOnly: type === 'code' || type === 'status',
  ...over,
});

export const STOCK_SCHEMA: PageSchema = {
  pageId: 'inv-stock',
  title: 'Stock Balance',
  family: 'Inventory',
  tabs: ['Stock Register', 'Valuation', 'Ageing', 'Reorder', 'Bins', 'Audit'],
  kind: 'typed',
  readOnly: true,
  statuses: ['Active'],
  actions: [],
  listColumns: [
    'itemCode',
    'itemName',
    'warehouse',
    'onHand',
    'avgRate',
    'stockValue',
    'stockStatus',
  ],
  filters: [
    { key: 'below', label: 'Below reorder only', type: 'bool', param: 'belowReorder' },
    {
      key: 'wh',
      label: 'Warehouse',
      type: 'select',
      param: 'warehouseId',
      options: [{ value: 'wh-1', label: 'TAL-MAIN' }, 'WH-OTHER'],
    },
  ],
  totals: [
    { key: 'onHand', label: 'Total On Hand', format: 'qty' },
    { key: 'stockValue', label: 'Total Stock Value', format: 'money' },
  ],
  fields: [
    fld('itemCode', 'Item Code', 'text'),
    fld('itemName', 'Item Name', 'text'),
    fld('warehouse', 'Warehouse', 'text'),
    fld('onHand', 'On Hand', 'qty'),
    fld('avgRate', 'Avg Rate', 'money'),
    fld('stockValue', 'Stock Value', 'money'),
    fld('stockStatus', 'Stock Status', 'text'),
  ],
};

export function stockRow(i: number, status: string, onHand: number): RecordRow {
  return {
    ...leadRow(i, { status: 'Active' }),
    code: `STK/${i}`,
    data: {
      itemCode: `ITM/0000${i}`,
      itemName: `Item ${i}`,
      warehouse: 'TAL-MAIN',
      onHand,
      avgRate: 50,
      stockValue: onHand * 50,
      stockStatus: status,
    },
  };
}

export const OPENING_SCHEMA: PageSchema = {
  pageId: 'inv-opening',
  title: 'Opening Stock',
  family: 'Inventory',
  tabs: ['Opening Register', 'Batches', 'Valuation', 'Variance', 'Approvals Desk', 'Audit'],
  kind: 'typed',
  statuses: ['Draft', 'Posted', 'Cancelled'],
  listColumns: [
    'openingNo',
    'warehouse',
    'item',
    'openingQty',
    'unitCost',
    'openingValue',
    'status',
  ],
  actions: [
    {
      key: 'post',
      label: 'Post',
      variant: 'primary',
      confirm: 'Post {code}? Stock will change and the voucher will be locked.',
      allowedFrom: ['Draft'],
    },
    { key: 'cancel', label: 'Cancel', variant: 'danger', confirm: true, allowedFrom: ['Posted'] },
  ],
  fields: [
    fld('openingNo', 'Opening No', 'code'),
    fld('warehouse', 'Warehouse', 'ref', { required: true, refPage: 'wms-warehouses' }),
    fld('item', 'Item', 'ref', { required: true, refPage: 'inv-items' }),
    fld('openingQty', 'Opening Qty', 'qty', { required: true, min: 0 }),
    fld('unitCost', 'Unit Cost', 'money', { required: true, min: 0 }),
    fld('openingValue', 'Opening Value', 'money', { readOnly: true }),
    fld('status', 'Status', 'status'),
  ],
};

export const TRANSFER_SCHEMA: PageSchema = {
  pageId: 'inv-transfer',
  title: 'Stock Transfer',
  family: 'Inventory',
  tabs: ['Transfer Register', 'In Transit', 'Receipts', 'Variance', 'Approvals Desk', 'Audit'],
  kind: 'typed',
  statuses: ['Draft', 'Dispatched', 'Received', 'Cancelled'],
  listColumns: [
    'transferNo',
    'source',
    'destination',
    'item',
    'requestedQty',
    'inTransit',
    'status',
  ],
  editableStatuses: ['Draft'],
  actions: [
    {
      key: 'dispatch',
      label: 'Dispatch',
      variant: 'primary',
      confirm: 'Dispatch {code}? Stock leaves the source warehouse.',
      allowedFrom: ['Draft'],
    },
    {
      key: 'receive',
      label: 'Receive',
      variant: 'success',
      confirm: 'Receive {code} into the destination warehouse?',
      allowedFrom: ['Dispatched'],
    },
    {
      key: 'cancel',
      label: 'Cancel',
      variant: 'danger',
      confirm: true,
      allowedFrom: ['Draft', 'Dispatched'],
    },
  ],
  fields: [
    fld('transferNo', 'Transfer No', 'code'),
    fld('source', 'Source Warehouse', 'ref', { required: true, refPage: 'wms-warehouses' }),
    fld('destination', 'Destination Warehouse', 'ref', {
      required: true,
      refPage: 'wms-warehouses',
    }),
    fld('item', 'Item', 'ref', { required: true, refPage: 'inv-items' }),
    fld('available', 'Available', 'qty', { readOnly: true }),
    fld('requestedQty', 'Requested Qty', 'qty', { required: true, min: 0 }),
    fld('dispatchedQty', 'Dispatched Qty', 'qty', { readOnly: true }),
    fld('receivedQty', 'Received Qty', 'qty', { readOnly: true }),
    fld('inTransit', 'In Transit', 'qty', { readOnly: true }),
    fld('status', 'Status', 'status'),
  ],
};

export function transferRow(i: number, status: string): RecordRow {
  return {
    ...leadRow(i, { status }),
    code: `TRF/TAL/26-27/000${i}`,
    data: {
      source: 'wh-1',
      destination: 'wh-2',
      item: 'item-1',
      requestedQty: 20,
      dispatchedQty: status === 'Draft' ? null : 20,
      receivedQty: status === 'Received' ? 20 : null,
      inTransit: status === 'Dispatched' ? 20 : 0,
    },
    refs: {
      source: WH_REF,
      destination: { id: 'wh-2', code: 'SAW-MAIN', name: 'Sawardari Main Store' },
      item: ITEM_REF,
    },
  };
}
