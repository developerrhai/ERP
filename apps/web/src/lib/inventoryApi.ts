// Client for the Phase 8 Inventory endpoints (/inventory/...). Quantities and money are plain numbers in responses.
import { api, request } from './api';
import type { PageMeta } from '../types';

const key = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const idem = () => ({ 'Idempotency-Key': key() });
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const qs = (o: Record<string, string | number | boolean | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface Paged<T> {
  rows: T[];
  meta: PageMeta & Record<string, unknown>;
}
async function paged<T>(path: string): Promise<Paged<T>> {
  const r = await request<T[]>(path);
  return {
    rows: r.data,
    meta: (r.meta ?? { page: 1, size: r.data.length, total: r.data.length }) as Paged<T>['meta'],
  };
}

// ---- vouchers ---------------------------------------------------------------------------------------------
export type VoucherKind = 'opening' | 'transactions' | 'adjustment' | 'transfer';
export type StockStatus = 'UNRESTRICTED' | 'QUALITY_INSPECTION' | 'BLOCKED';

export interface VoucherLine {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string; baseUom: string };
  qty: number | null;
  enteredQty: number | null;
  uom: string | null;
  unitCost: number | null;
  value: number | null;
  stockStatus: StockStatus;
  batchNo: string | null;
  batchId: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  serialNos: string[];
  binId: string | null;
  countedQty: number | null;
  systemQty: number | null;
  varianceQty: number | null;
  reasonCode: string | null;
  remarks: string | null;
  dispatchedQty: number | null;
  receivedQty: number | null;
  reservationId: string | null;
}
export interface Voucher {
  id: string;
  kind: string;
  pageId: string;
  number: string;
  status: string;
  postingDate: string;
  warehouse: { id: string; code: string; name: string } | null;
  toWarehouse: { id: string; code: string; name: string } | null;
  txType: 'Receipt' | 'Issue' | null;
  reference: string | null;
  narration: string | null;
  vehicleRef: string | null;
  expectedReceipt: string | null;
  totalQty: number | null;
  totalValue: number | null;
  version: number;
  cancelReason: string | null;
  lines: VoucherLine[];
}
export interface LineInput {
  itemId: string;
  qty?: number | string;
  countedQty?: number | string | null;
  uom?: string | null;
  unitCost?: number | string | null;
  stockStatus?: StockStatus | null;
  batchNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  serialNos?: string[] | null;
  reasonCode?: string | null;
  remarks?: string | null;
  reservationId?: string | null;
}
export interface VoucherInput {
  postingDate?: string;
  warehouseId: string;
  toWarehouseId?: string | null;
  txType?: 'Receipt' | 'Issue' | null;
  reference?: string | null;
  narration?: string | null;
  vehicleRef?: string | null;
  lines: LineInput[];
}
export const listVouchers = (kind: VoucherKind, q: { q?: string; status?: string; page: number }) =>
  paged<Voucher>(`/inventory/vouchers/${kind}${qs({ ...q, size: 20 })}`);
export const getVoucher = (kind: VoucherKind, id: string) =>
  api<Voucher>(`/inventory/vouchers/${kind}/${id}`);
export const createVoucher = (kind: VoucherKind, b: VoucherInput) =>
  api<Voucher>(`/inventory/vouchers/${kind}`, { method: 'POST', body: b });
export const updateVoucher = (kind: VoucherKind, id: string, version: number, b: VoucherInput) =>
  api<Voucher>(`/inventory/vouchers/${kind}/${id}`, {
    method: 'PUT',
    body: b,
    headers: ifMatch(version),
  });
export const deleteVoucher = (kind: VoucherKind, id: string, version: number) =>
  api<void>(`/inventory/vouchers/${kind}/${id}`, { method: 'DELETE', headers: ifMatch(version) });
export const submitVoucher = (kind: VoucherKind, id: string, version: number) =>
  api<Voucher>(`/inventory/vouchers/${kind}/${id}/submit`, {
    method: 'POST',
    headers: ifMatch(version),
  });
export const voucherAction = (
  kind: VoucherKind,
  id: string,
  verb: 'post' | 'dispatch' | 'receive' | 'cancel',
  body: { cancelDate?: string; reason?: string } = {},
) =>
  api<Voucher>(`/inventory/vouchers/${kind}/${id}/${verb}`, {
    method: 'POST',
    body,
    headers: idem(),
  });

// ---- lookups ----------------------------------------------------------------------------------------------
export interface Ref {
  id: string;
  code: string;
  name: string;
  uom?: string;
}
export const lookupItems = (q: string) => api<Ref[]>(`/lookups/items${qs({ q, limit: 30 })}`);
export const lookupWarehouses = () => api<Ref[]>(`/lookups/warehouses${qs({ limit: 50 })}`);
export const lookupWarehousesAny = () =>
  api<Ref[]>(`/lookups/warehouses${qs({ limit: 50, any: true })}`);
export const availabilityOf = (itemId: string, warehouseId: string) =>
  api<{
    onHand: number;
    unrestricted: number;
    qualityInspection: number;
    blocked: number;
    reserved: number;
    held: number;
    available: number;
  }>(`/inventory/availability${qs({ itemId, warehouseId })}`);

// ---- batches / serials / bins -----------------------------------------------------------------------------
export interface BatchRow {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchNo: string;
  mfgDate: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  qcStatus: string;
  recalled: boolean;
  disposition: string | null;
  onHand: number;
  qualityInspection: number;
  version: number;
}
export interface BatchDetail
  extends Omit<
    BatchRow,
    'itemCode' | 'itemName' | 'daysToExpiry' | 'onHand' | 'qualityInspection'
  > {
  supplierName: string | null;
  grnRef: string | null;
  notes: string | null;
  events: {
    at: string;
    event: string;
    from: string | null;
    to: string | null;
    reason: string | null;
  }[];
  stock: { warehouse: string; stockStatus: string; qty: number }[];
  movements: {
    date: string | null;
    voucherNo: string;
    type: string;
    qtyIn: number;
    qtyOut: number;
  }[];
  affected?: { voucherNo: string; type: string; date: string | null; qty: number }[];
}
export const listBatches = (q: {
  q?: string;
  qcStatus?: string;
  withStockOnly?: boolean;
  page: number;
}) => paged<BatchRow>(`/inventory/batches${qs({ ...q, size: 20 })}`);
export const getBatch = (id: string) => api<BatchDetail>(`/inventory/batches/${id}`);
export const batchQc = (id: string, version: number, to: string, reason: string) =>
  api<BatchDetail>(`/inventory/batches/${id}/qc`, {
    method: 'POST',
    body: { to, reason },
    headers: ifMatch(version),
  });
export const batchExtend = (id: string, version: number, expiryDate: string, reason: string) =>
  api<BatchDetail>(`/inventory/batches/${id}/extend-expiry`, {
    method: 'POST',
    body: { expiryDate, reason },
    headers: ifMatch(version),
  });
export const batchRecall = (
  id: string,
  version: number,
  action: 'start' | 'close',
  reason: string,
  closeTo?: string,
) =>
  api<BatchDetail>(`/inventory/batches/${id}/recall`, {
    method: 'POST',
    body: { action, reason, ...(closeTo ? { closeTo } : {}) },
    headers: ifMatch(version),
  });
export const batchPatch = (
  id: string,
  version: number,
  body: { disposition?: string | null; notes?: string | null },
) =>
  api<BatchDetail>(`/inventory/batches/${id}`, {
    method: 'PATCH',
    body,
    headers: ifMatch(version),
  });

export interface SerialRow {
  id: string;
  serialNo: string;
  itemCode: string;
  itemName: string;
  warehouse: string | null;
  status: string;
  currentOwner: string | null;
  lastMovementAt: string | null;
}
export const listSerials = (q: { q?: string; status?: string; page: number }) =>
  paged<SerialRow>(`/inventory/serials${qs({ ...q, size: 20 })}`);
export const serialHistory = (id: string) =>
  api<{
    id: string;
    serialNo: string;
    status: string;
    events: { at: string; event: string; voucherNo: string | null }[];
  }>(`/inventory/serials/${id}`);

export interface BinRow {
  id: string;
  warehouseId: string;
  code: string;
  name: string | null;
  zone: string | null;
  binType: string;
  capacity: number | null;
  status: string;
  version: number;
  onHand: number;
}
export const listBins = (q: { q?: string; warehouseId?: string; page: number }) =>
  paged<BinRow>(`/inventory/bins${qs({ ...q, size: 20 })}`);
export const createBin = (b: {
  warehouseId: string;
  code: string;
  name?: string;
  zone?: string;
  binType?: string;
  capacity?: number | null;
}) => api<BinRow>('/inventory/bins', { method: 'POST', body: b });
export const updateBin = (
  id: string,
  version: number,
  b: Partial<Pick<BinRow, 'name' | 'zone' | 'binType' | 'capacity' | 'status'>>,
) => api<BinRow>(`/inventory/bins/${id}`, { method: 'PATCH', body: b, headers: ifMatch(version) });
export const deleteBin = (id: string) => api<void>(`/inventory/bins/${id}`, { method: 'DELETE' });

// ---- reservations / holds ---------------------------------------------------------------------------------
export interface Reservation {
  id: string;
  code: string;
  itemCode?: string;
  itemName?: string;
  warehouseCode?: string;
  priority: string;
  requiredQty: number;
  reservedQty: number;
  fulfilledQty: number;
  reservedUntil: string | null;
  status: string;
  demandRef: string | null;
  version: number;
}
export const listReservations = (q: { q?: string; status?: string; page: number }) =>
  paged<Reservation>(`/inventory/reservations${qs({ ...q, size: 20 })}`);
export const createReservation = (b: {
  itemId: string;
  warehouseId: string;
  requiredQty: number;
  priority?: string;
  reservedUntil?: string | null;
  demandRef?: string | null;
}) => api<Reservation>('/inventory/reservations', { method: 'POST', body: b });
export const releaseReservation = (id: string, version: number, reason: string) =>
  api<Reservation>(`/inventory/reservations/${id}/release`, {
    method: 'POST',
    body: { reason },
    headers: ifMatch(version),
  });
export const extendReservation = (id: string, version: number, days: number) =>
  api<Reservation>(`/inventory/reservations/${id}/extend`, {
    method: 'POST',
    body: { days },
    headers: ifMatch(version),
  });
export interface Hold {
  id: string;
  code: string;
  itemId: string;
  warehouseId: string;
  qty: number;
  reason: string;
  status: string;
  version: number;
}
export const listHolds = (page: number) => paged<Hold>(`/inventory/holds${qs({ page, size: 20 })}`);
export const placeHold = (b: {
  itemId: string;
  warehouseId: string;
  qty: number;
  reason: string;
}) => api<{ id: string; code: string }>('/inventory/holds', { method: 'POST', body: b });
export const releaseHold = (id: string, version: number) =>
  api<Hold>(`/inventory/holds/${id}/release`, { method: 'POST', headers: ifMatch(version) });
export const changeStockStatus = (b: {
  itemId: string;
  warehouseId: string;
  batchId?: string | null;
  qty: number;
  from: StockStatus;
  to: StockStatus;
  reason: string;
}) => api<{ ok: boolean }>('/inventory/stock-status', { method: 'POST', body: b });

// ---- counts -----------------------------------------------------------------------------------------------
export interface CountHead {
  id: string;
  code: string;
  countType: 'CYCLE' | 'PHYSICAL' | 'POWDER_WEEKLY';
  warehouseId: string;
  status: string;
  plannedDate: string;
  monthLabel: string | null;
  blind: boolean;
  accuracyPct: number | null;
  version: number;
}
export interface CountLine {
  id: string;
  lineNo: number;
  itemId: string;
  item: { id: string; code: string; name: string; itemType: string } | null;
  systemQty: number | null;
  count1Qty: number | null;
  count2Qty: number | null;
  finalQty: number | null;
  status: string;
  weekNo: number | null;
  remarks: string | null;
  variance: number | null;
}
export interface CountDetail extends CountHead {
  lines: CountLine[];
  review: {
    accuracyPct: number | null;
    classes: {
      itemType: string;
      bookValue: number;
      netVariance: number;
      netVariancePct: number;
      caroFlag: boolean;
    }[];
  } | null;
}
export const listCounts = (q: { countType?: string; status?: string; page: number }) =>
  paged<CountHead>(`/inventory/counts${qs({ ...q, size: 20 })}`);
export const getCount = (id: string) => api<CountDetail>(`/inventory/counts/${id}`);
export const createCount = (b: {
  countType: string;
  warehouseId: string;
  itemIds?: string[];
  monthLabel?: string;
  freezeWarehouse?: boolean;
  blind?: boolean;
}) => api<CountHead>('/inventory/counts', { method: 'POST', body: b });
export const countStep = (
  id: string,
  version: number,
  step: 'start' | 'review' | 'approve' | 'post' | 'cancel',
) =>
  api<CountHead>(`/inventory/counts/${id}/${step}`, {
    method: 'POST',
    body: step === 'post' ? {} : undefined,
    headers: ifMatch(version),
  });
export const closeCount = (id: string, version: number, closureNote: string) =>
  api<CountHead>(`/inventory/counts/${id}/close`, {
    method: 'POST',
    body: { closureNote },
    headers: ifMatch(version),
  });
export const enterCount = (id: string, lineId: string, qty: number, remarks?: string) =>
  api<CountLine>(`/inventory/counts/${id}/lines/${lineId}/count`, {
    method: 'POST',
    body: { qty, ...(remarks ? { remarks } : {}) },
  });

// ---- reports / reorder / scan / ops -----------------------------------------------------------------------
export interface AgeingRow {
  itemCode: string;
  itemName: string;
  warehouse: string;
  onHand: number;
  f030: number;
  f3190: number;
  f91180: number;
  f180Plus: number;
  ageDays: number;
  lastIssue: string | null;
  movement: string;
}
export const ageingReport = (q: { asOf?: string; page: number }) =>
  paged<AgeingRow>(`/inventory/reports/ageing${qs({ ...q, size: 20 })}`);
export interface ExpiryRow {
  batchId: string;
  batchNo: string;
  itemCode: string;
  itemName: string;
  warehouse: string;
  expiryDate: string;
  daysToExpiry: number;
  band: string;
  status: string;
  qty: number;
  qualityInspection: number;
  value: number;
  disposition: string | null;
}
export const expiryReport = (q: { band?: string; page: number }) =>
  paged<ExpiryRow>(`/inventory/reports/expiry${qs({ ...q, size: 20 })}`);
export interface ValuationRow {
  itemCode: string;
  itemName: string;
  warehouse: string;
  opening: number;
  receipts: number;
  issues: number;
  adjustments: number;
  closing: number;
  closingQty: number;
  balanced: boolean;
}
export const valuationReport = (q: { from: string; to: string; page: number }) =>
  paged<ValuationRow>(`/inventory/reports/valuation${qs({ ...q, size: 20 })}`);
export interface GlCompare {
  asOf: string;
  inBalance: boolean;
  rows: {
    unit: string;
    key: string;
    stockValue: number;
    glBalance: number | null;
    variance: number | null;
  }[];
}
export const glCompare = () => api<GlCompare>('/inventory/reports/gl-compare');
export interface Integrity {
  ok: boolean;
  checks: {
    id: string;
    name: string;
    ok: boolean;
    mismatches: { ref: string; expected: string; actual: string }[];
  }[];
}
export const integrity = () => api<Integrity>('/inventory/integrity');
export interface Preflight {
  ready: boolean;
  checks: { id: string; name: string; level: string; count: number; sample: string[] }[];
}
export const preflight = () => api<Preflight>('/inventory/preflight');
export interface CutoverPlan {
  unitId: string;
  asOf: string;
  needed: boolean;
  lines: { key: string; stock: string | number; gl: string | number; diff: string | number }[];
}
export const cutoverPlan = (asOf: string) =>
  api<CutoverPlan>(`/inventory/gl-cutover${qs({ asOf })}`);
export const cutoverRun = (asOf: string) =>
  api<{ status: string; journalId: string | null }>('/inventory/gl-cutover', {
    method: 'POST',
    body: { asOf },
  });

export interface PolicyRow {
  id: string;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  warehouseId: string;
  warehouse?: string;
  method: 'MIN_MAX' | 'ROP_EOQ';
  minQty: number;
  maxQty: number;
  leadTimeDays: number;
  serviceLevelPct: number;
  orderingCost: number;
  holdingCostPct: number;
  orderMultiple: number;
  status: string;
  version: number;
  calc: {
    adu: number;
    safetyStock: number;
    reorderLevel: number;
    eoq: number;
    available: number;
    position: number;
    trigger: number;
    suggested: number;
    status: string;
  } | null;
}
export const listPolicies = (page: number) =>
  paged<PolicyRow>(`/inventory/reorder/policies${qs({ page, size: 20 })}`);
export const savePolicy = (
  id: string | null,
  version: number | null,
  b: Record<string, unknown>,
) =>
  id
    ? api<{ id: string; version: number }>(`/inventory/reorder/policies/${id}`, {
        method: 'PUT',
        body: b,
        headers: ifMatch(version ?? 0),
      })
    : api<{ id: string; version: number }>('/inventory/reorder/policies', {
        method: 'POST',
        body: b,
      });
export const recalcReorder = () =>
  api<{ checked: number; open: number }>('/inventory/reorder/recalculate', { method: 'POST' });
export interface Suggestion {
  id: string;
  itemCode: string;
  itemName: string;
  warehouse: string;
  suggestedQty: number;
  positionQty: number;
  triggerQty: number;
  status: string;
  prRef: string | null;
}
export const listSuggestions = (status: string, page: number) =>
  paged<Suggestion>(`/inventory/reorder/suggestions${qs({ status, page, size: 20 })}`);
export const resolveSuggestion = (id: string, action: 'convert' | 'dismiss', text: string) =>
  api<{ id: string; status: string }>(`/inventory/reorder/suggestions/${id}`, {
    method: 'POST',
    body: { action, text },
  });

export interface ScanResult {
  valid: boolean;
  kind: string;
  message: string;
  item?: Ref & { baseUom: string };
  batch?: { batchNo: string; expiryDate: string | null; qcStatus: string };
  serial?: { serialNo: string; status: string };
  bin?: { code: string };
}
export const scanCode = (raw: string, context: string, warehouseId?: string) =>
  api<ScanResult>('/inventory/scan', {
    method: 'POST',
    body: { raw, context, ...(warehouseId ? { warehouseId } : {}) },
  });

export interface LedgerRow {
  id: string;
  code: string;
  data: Record<string, unknown>;
}
/** The stock ledger (newest first) through the typed Inventory Transactions endpoint. */
export const listLedger = (page: number) =>
  paged<LedgerRow>(`/pages/inv-transactions/records${qs({ view: 'ledger', page, size: 20 })}`);

// ---- customer-supplied material (no value; never part of our stock or books) --------------------------------
export interface CmLot {
  id: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string | null;
  warehouseId: string;
  warehouseCode: string;
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  expiry: 'none' | 'ok' | 'soon' | 'expired';
  challanNo: string;
  challanDate: string | null;
  receivedQty: number;
  balanceQty: number;
  receivedAt: string;
}
export interface CmBalance {
  customerId: string;
  customerName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseCode: string;
  lots: number;
  receivedQty: number;
  balanceQty: number;
  nextExpiry: string | null;
  expiry: 'none' | 'ok' | 'soon' | 'expired';
}
export type CmType = 'RECEIPT' | 'ISSUE' | 'RETURN';
export interface CmDoc {
  id: string;
  code: string;
  type: CmType;
  date: string;
  customerId: string;
  customerName: string;
  warehouseCode: string;
  challanNo: string | null;
  challanDate: string | null;
  vehicleNo: string | null;
  reference: string | null;
  remarks: string | null;
  status: 'Posted' | 'Cancelled';
  cancelReason: string | null;
  cancelDate: string | null;
  version: number;
  lines: number | CmDocLine[];
  totalQty?: number;
}
export interface CmDocLine {
  id: string;
  lineNo: number;
  lotId: string;
  itemCode: string;
  itemName: string;
  batchNo: string | null;
  expiryDate: string | null;
  challanNo: string;
  qty: number;
  remarks: string | null;
}
export interface CmHistory {
  id: string;
  type: string;
  qty: number;
  balanceAfter: number;
  date: string;
  docCode: string;
  by: string;
}
export interface CmHeaderInput {
  customerId: string;
  warehouseId: string;
  docDate: string;
  challanNo?: string | null;
  challanDate?: string | null;
  vehicleNo?: string | null;
  reference?: string | null;
  remarks?: string | null;
}
export interface CmReceiptLine {
  itemId: string;
  qty: number;
  batchNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  remarks?: string | null;
}
export interface CmPickLine {
  lotId: string;
  qty: number;
  remarks?: string | null;
}
export const cmCustomers = () =>
  api<{ id: string; code: string; name: string }[]>('/inventory/customer-material/customers');
export const cmBalances = () => api<CmBalance[]>('/inventory/customer-material/balances');
export const cmLots = (q: {
  customerId?: string;
  warehouseId?: string;
  withBalanceOnly?: boolean;
  q?: string;
  page?: number;
}) => paged<CmLot>(`/inventory/customer-material/lots${qs({ size: 100, ...q })}`);
export const cmDocs = (q: { type?: string; status?: string; q?: string; page: number }) =>
  paged<CmDoc>(`/inventory/customer-material/docs${qs({ ...q, size: 20 })}`);
export const cmDoc = (id: string) => api<CmDoc>(`/inventory/customer-material/docs/${id}`);
export const cmHistory = (lotId: string) =>
  api<CmHistory[]>(`/inventory/customer-material/lots/${lotId}/history`);
export const cmReceive = (b: CmHeaderInput & { lines: CmReceiptLine[] }) =>
  api<CmDoc>('/inventory/customer-material/receipts', { method: 'POST', body: b });
export const cmTake = (kind: 'issues' | 'returns', b: CmHeaderInput & { lines: CmPickLine[] }) =>
  api<CmDoc>(`/inventory/customer-material/${kind}`, { method: 'POST', body: b });
export const cmCancel = (id: string, version: number, reason: string, date: string) =>
  api<CmDoc>(`/inventory/customer-material/docs/${id}/cancel`, {
    method: 'POST',
    body: { reason, date },
    headers: ifMatch(version),
  });
