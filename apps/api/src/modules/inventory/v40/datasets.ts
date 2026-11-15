// The real data behind the V40 tab layouts of the Inventory pages (model.ts). Every function answers one page of rows for one
// dataset, scoped to the unit of the request context. Values come from the stock tables only; a V40 column that has no real source
// is simply not set (the page prints a dash), never filled with a made-up number.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import { escapeLike } from '../../../core/http/query-safety';
import type { Caller } from '../../records/service';
import { ageing, expiry, reorderService, valuation } from '../reports-service';
import { balanceOrder, stockRepository } from '../stock/repository';
import { unitFilter } from '../typed';
import type { DatasetKey, PageSpec } from './model';
import { itemStats, OPEN_RESERVATION, pairStats, round3, scopeSql } from './stats';
import type { ItemStat, PairStat } from './stats';

export interface V40Row {
  /** The document id (uuid) when the row is a real document: Move Forward and Open work on it. */
  id: string | null;
  status?: string;
  /** Row version of the document (for the buttons of the page that owns it). */
  version?: number | null;
  /** The (item, warehouse) the Allocate / Reallocate buttons of the row act on. */
  alloc?: { itemId: string; warehouseId: string | null } | null;
  /** In-app page that owns the record. */
  page?: string | null;
  cells: Record<string, unknown>;
}

export interface V40Total {
  label: string;
  value: number;
  format: 'qty' | 'money';
}

export interface DsQuery {
  q?: string | undefined;
  status?: string | undefined;
  variant?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  size: number;
}

export interface DsResult {
  rows: V40Row[];
  total: number;
  totals?: V40Total[];
}

const nz = (v: string | number | null | undefined): number => Number(v ?? 0);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const likeOf = (q: string | undefined): string | null => (q ? `%${escapeLike(q)}%` : null);
const daysSince = (d: Date | null): number | null =>
  d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000)) : null;

/** The Record / Demand / Available / Allocated / Short / Location cells from the availability numbers of one (item, warehouse). */
function allocCells(
  record: string,
  st: Pick<PairStat, 'demand' | 'available' | 'allocated' | 'short'> | undefined,
  location: string | null,
): Record<string, unknown> {
  return {
    w_record: record,
    w_demand: st ? st.demand : null,
    w_available: st ? st.available : null,
    w_allocated: st ? st.allocated : null,
    w_short: st ? st.short : null,
    w_location: location,
  };
}

const locationOf = (wh: string | null, bins: string | null | undefined): string | null =>
  wh ? (bins ? `${wh} / ${bins}` : wh) : null;

async function whIdsByCode(caller: Caller, codes: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (codes.length === 0) return out;
  // unpaginated: warehouses matching a small code list of the page being shown
  const rows = await prisma.$queryRaw<{ id: string; code: string }[]>`
    SELECT w.id::text, w.code FROM warehouses w
    WHERE w.code = ANY(${[...new Set(codes)]}::text[]) AND ${scopeSql(caller)}`;
  for (const r of rows) out.set(r.code, r.id);
  return out;
}

const paginate = <T>(rows: T[], q: DsQuery): T[] => rows.slice((q.page - 1) * q.size, q.page * q.size);

// ---------------------------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------------------------
async function items(caller: Caller, q: DsQuery): Promise<DsResult> {
  const like = likeOf(q.q);
  const status = q.status === 'Active' ? 'ACTIVE' : q.status === 'Inactive' ? 'INACTIVE' : null;
  const where: Prisma.ItemWhereInput = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(like
      ? {
          OR: [
            { code: { contains: q.q ?? '', mode: 'insensitive' } },
            { name: { contains: q.q ?? '', mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: [{ code: 'asc' }],
      skip: (q.page - 1) * q.size,
      take: q.size,
    }),
    prisma.item.count({ where }),
  ]);
  const stats = await itemStats(
    caller,
    rows.map((r) => r.id),
  );
  return {
    total,
    rows: rows.map((r) => {
      const s: ItemStat | undefined = stats.get(r.id);
      const st = r.status === 'ACTIVE' ? 'Active' : 'Inactive';
      return {
        id: r.id,
        status: st,
        alloc: { itemId: r.id, warehouseId: null },
        cells: {
          itemCode: r.code,
          itemName: r.name,
          itemType: r.itemType,
          category: r.category,
          brand: r.brand,
          hsnSac: r.hsnSac,
          baseUom: r.baseUom,
          status: st,
          ...allocCells(r.code, s, s?.location ?? null),
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Product Master / Raw Material Master (V40 ERP Process Control): the item master, split by item type
// ---------------------------------------------------------------------------------------------
const PRODUCT_TYPES = ['Finished Good', 'Semi-Finished'];
const MATERIAL_TYPES = ['Raw Material', 'Consumable', 'Packing Material', 'Spare Part'];

async function itemMaster(caller: Caller, q: DsQuery, pageId: string): Promise<DsResult> {
  const types = pageId === 'master-products' ? PRODUCT_TYPES : MATERIAL_TYPES;
  const like = likeOf(q.q);
  const conds: Prisma.Sql[] = [Prisma.sql`i.deleted_at IS NULL`, Prisma.sql`i.item_type = ANY(${types}::text[])`];
  if (like) conds.push(Prisma.sql`(i.code ILIKE ${like} OR i.name ILIKE ${like})`);
  if (q.status) conds.push(Prisma.sql`i.status::text = ${q.status === 'Active' ? 'ACTIVE' : 'INACTIVE'}`);
  if (q.variant === 'bom') conds.push(Prisma.sql`EXISTS (SELECT 1 FROM mfg_boms b WHERE b.item_id = i.id AND b.deleted_at IS NULL)`);
  const rows = await prisma.$queryRaw<
    {
      id: string;
      code: string;
      name: string;
      category: string | null;
      base_uom: string;
      selling_price: string | null;
      standard_cost: string | null;
      reorder_level: string | null;
      status: string;
      version: number;
      tax_pct: string | null;
      min_qty: string | null;
      bom: string | null;
      routing: string | null;
      vendor: string | null;
      lead_days: number | null;
      total: number;
    }[]
  >`
    SELECT i.id::text, i.code, i.name, i.category, i.base_uom, i.selling_price::text, i.standard_cost::text, i.reorder_level::text,
      i.status::text, i.version,
      (SELECT g.igst_pct::text FROM hsn_sac_rates hr JOIN gst_rates g ON g.id = hr.gst_rate_id
        WHERE hr.hsn_id = i.hsn_id AND hr.effective_from <= CURRENT_DATE AND (hr.effective_to IS NULL OR hr.effective_to >= CURRENT_DATE)
        ORDER BY hr.effective_from DESC LIMIT 1) AS tax_pct,
      (SELECT sum(p.min_qty)::text FROM reorder_policies p WHERE p.item_id = i.id AND p.status = 'Active') AS min_qty,
      (SELECT b.number FROM mfg_boms b WHERE b.item_id = i.id AND b.deleted_at IS NULL ORDER BY b.is_default DESC, b.version_no DESC LIMIT 1) AS bom,
      (SELECT r.number FROM mfg_routings r WHERE r.item_id = i.id AND r.deleted_at IS NULL ORDER BY r.version_no DESC LIMIT 1) AS routing,
      (SELECT s.name FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id WHERE si.item_id = i.id ORDER BY si.updated_at DESC LIMIT 1) AS vendor,
      (SELECT si.lead_days FROM supplier_items si WHERE si.item_id = i.id ORDER BY si.updated_at DESC LIMIT 1) AS lead_days,
      count(*) OVER()::int AS total
    FROM items i
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY i.code
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  const stats = await itemStats(
    caller,
    rows.map((r) => r.id),
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => {
      const s = stats.get(r.id);
      const status = r.status === 'ACTIVE' ? 'Active' : 'Inactive';
      return {
        id: r.id,
        version: r.version,
        status,
        page: 'inv-items',
        alloc: { itemId: r.id, warehouseId: null },
        cells: {
          productId: r.code,
          productName: r.name,
          materialCode: r.code,
          materialName: r.name,
          category: r.category,
          uom: r.base_uom,
          unit: r.base_uom,
          sellingPrice: r.selling_price === null ? null : nz(r.selling_price),
          standardCost: r.standard_cost === null ? null : nz(r.standard_cost),
          taxPct: r.tax_pct === null ? null : `${nz(r.tax_pct)}%`,
          minimumStock: r.min_qty === null ? null : nz(r.min_qty),
          reorderLevel: r.reorder_level === null ? null : nz(r.reorder_level),
          defaultBom: r.bom,
          defaultRouting: r.routing,
          preferredVendor: r.vendor,
          leadTimeDays: r.lead_days,
          currentStock: s ? s.onHand : null,
          status,
          ...allocCells(r.code, s, s?.location ?? null),
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// stock balance (item x warehouse)
// ---------------------------------------------------------------------------------------------
async function stockPair(caller: Caller, q: DsQuery): Promise<DsResult> {
  const order = balanceOrder('itemCode');
  if (!order) return { rows: [], total: 0 };
  const res = await stockRepository.balances(
    unitFilter(caller),
    {
      ...(q.q ? { q: q.q } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.variant === 'low' ? { belowReorder: true } : {}),
    },
    order,
    { offset: (q.page - 1) * q.size, limit: q.size },
  );
  const stats = await pairStats(res.rows);
  return {
    total: res.total,
    totals: [
      { label: 'On Hand', value: nz(res.onHand), format: 'qty' },
      { label: 'Stock Value', value: nz(res.stockValue), format: 'money' },
    ],
    rows: res.rows.map((b) => {
      const st = stats.get(`${b.itemId}_${b.warehouseId}`);
      const status = b.belowReorder ? 'Below Reorder' : 'OK';
      const value = nz(b.stockValue);
      const reservedValue = st ? Math.round(st.reserved * nz(b.avgRate) * 100) / 100 : null;
      return {
        id: null,
        status,
        alloc: { itemId: b.itemId, warehouseId: b.warehouseId },
        cells: {
          itemCode: b.itemCode,
          itemName: b.itemName,
          itemType: b.itemType,
          warehouse: b.warehouseCode,
          batch: st?.batches ?? null,
          stockValue: value,
          onHand: nz(b.onHand),
          reserved: st?.reserved ?? null,
          availableCol: st?.available ?? null,
          status,
          ...allocCells(b.itemCode, st, locationOf(b.warehouseCode, st?.bins)),
          // reference / due / amount: Due has no source on a stock balance
          p_reference: `${b.itemCode} / ${b.warehouseCode}`,
          p_due: null,
          p_amount: value,
          p_allocated: reservedValue,
          p_balance: reservedValue === null ? null : Math.round((value - reservedValue) * 100) / 100,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// batches (master + stock per warehouse) and the batch rows of Stock Balance > Batch Traceability
// ---------------------------------------------------------------------------------------------
interface BatchRow {
  batch_id: string;
  version: number;
  item_id: string;
  warehouse_id: string | null;
  batch_no: string;
  item_code: string;
  item_name: string;
  item_type: string;
  wh_code: string | null;
  mfg_date: Date | null;
  expiry_date: Date | null;
  qc_status: string;
  recalled: boolean;
  status: string;
  qty: string;
  unrestricted: string;
  blocked: string;
  received: string;
  reserved_on_batch: string;
  demand: string;
  avg_rate: string;
  bins: string | null;
  total: number;
}

async function batchRows(caller: Caller, q: DsQuery, stockOnly: boolean): Promise<BatchRow[]> {
  const like = likeOf(q.q);
  const conds: Prisma.Sql[] = [Prisma.sql`b.deleted_at IS NULL`, Prisma.sql`(w.id IS NULL OR ${scopeSql(caller)})`];
  if (like) {
    conds.push(Prisma.sql`(b.batch_no ILIKE ${like} OR i.code ILIKE ${like} OR i.name ILIKE ${like})`);
  }
  const having = stockOnly ? Prisma.sql`HAVING COALESCE(sum(s.qty),0) > 0` : Prisma.empty;
  return prisma.$queryRaw<BatchRow[]>`
    SELECT b.id::text AS batch_id, b.version, b.item_id::text, w.id::text AS warehouse_id, b.batch_no, i.code AS item_code, i.name AS item_name,
      i.item_type, w.code AS wh_code, b.mfg_date, b.expiry_date, b.qc_status, b.recalled, b.status,
      COALESCE(sum(s.qty),0)::text AS qty,
      COALESCE(sum(s.qty) FILTER (WHERE s.stock_status = 'UNRESTRICTED'),0)::text AS unrestricted,
      COALESCE(sum(s.qty) FILTER (WHERE s.stock_status = 'BLOCKED'),0)::text AS blocked,
      COALESCE((SELECT sum(l.qty_in) FROM stock_ledger l WHERE l.batch_id = b.id AND l.warehouse_id = w.id AND NOT EXISTS (SELECT 1 FROM stock_ledger rv WHERE rv.reverses_id = l.id)),0)::text AS received,
      COALESCE((SELECT sum(r.reserved_qty) FROM stock_reservations r WHERE r.batch_id = b.id AND r.warehouse_id = w.id AND r.status IN ${OPEN_RESERVATION}),0)::text AS reserved_on_batch,
      COALESCE((SELECT sum(r.required_qty - r.fulfilled_qty) FROM stock_reservations r WHERE r.batch_id = b.id AND r.warehouse_id = w.id AND r.status IN ${OPEN_RESERVATION}),0)::text AS demand,
      COALESCE(max(sb.avg_rate),0)::text AS avg_rate,
      (SELECT string_agg(DISTINCT bn.code, ', ') FROM stock_slices x JOIN wms_bins bn ON bn.id = x.bin_id
        WHERE x.batch_id = b.id AND x.warehouse_id = w.id AND x.qty > 0) AS bins,
      count(*) OVER()::int AS total
    FROM batches b
    JOIN items i ON i.id = b.item_id
    LEFT JOIN stock_slices s ON s.batch_id = b.id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN stock_balances sb ON sb.item_id = s.item_id AND sb.warehouse_id = s.warehouse_id
    WHERE ${Prisma.join(conds, ' AND ')}
    GROUP BY b.id, i.id, w.id
    ${having}
    ORDER BY i.code, b.batch_no, w.code
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
}

function batchCells(r: BatchRow): Record<string, unknown> {
  const unrestricted = nz(r.unrestricted);
  const reserved = nz(r.reserved_on_batch);
  const demand = nz(r.demand);
  const available = Math.max(0, round3(unrestricted - reserved));
  const status = r.recalled ? 'Recalled' : r.status;
  return {
    // Stock Balance > Batch Traceability
    itemCode: r.item_code,
    itemName: r.item_name,
    itemType: r.item_type,
    warehouse: r.wh_code,
    batch: r.batch_no,
    stockValue: Math.round(nz(r.qty) * nz(r.avg_rate) * 100) / 100,
    onHand: nz(r.qty),
    reserved,
    // Batch pages
    batchNo: r.batch_no,
    item: `${r.item_code} · ${r.item_name}`,
    mfgDate: iso(r.mfg_date),
    expiryDate: iso(r.expiry_date),
    batchReceivedQty: nz(r.received),
    batchAvailableQty: available,
    blockedQty: nz(r.blocked),
    qcStatus: r.qc_status,
    status,
    ...allocCells(
      r.batch_no,
      { demand, available, allocated: reserved, short: Math.max(0, round3(demand - reserved)) },
      locationOf(r.wh_code, r.bins),
    ),
  };
}

async function batchStock(caller: Caller, q: DsQuery): Promise<DsResult> {
  const rows = await batchRows(caller, q, true);
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => ({
      id: null,
      status: r.qc_status,
      alloc: { itemId: r.item_id, warehouseId: r.warehouse_id },
      cells: { ...batchCells(r), status: r.qc_status },
    })),
  };
}

async function batch(caller: Caller, q: DsQuery): Promise<DsResult> {
  const rows = await batchRows(caller, { ...q }, q.variant === 'stock');
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => ({
      id: r.batch_id,
      version: r.version,
      status: r.recalled ? 'Recalled' : r.qc_status,
      page: 'inv-batch',
      alloc: { itemId: r.item_id, warehouseId: r.warehouse_id },
      cells: batchCells(r),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// stock ledger (Inventory Transactions)
// ---------------------------------------------------------------------------------------------
const LEDGER_TYPES: Record<string, string[]> = {
  receipts: ['OPENING', 'RECEIPT', 'GRN', 'FG_RECEIPT', 'SALES_RETURN', 'MFG_RETURN', 'MWO_RETURN'],
  issues: ['ISSUE', 'MFG_ISSUE', 'MWO_ISSUE', 'SCRAP', 'PURCH_RETURN'],
  transfers: ['TRANSFER_IN', 'TRANSFER_OUT'],
  fg: ['FG_RECEIPT', 'DISPATCH', 'SALES_RETURN'],
};

async function ledger(caller: Caller, q: DsQuery): Promise<DsResult> {
  const like = likeOf(q.q);
  const conds: Prisma.Sql[] = [scopeSql(caller)];
  if (like) {
    conds.push(Prisma.sql`(l.voucher_no ILIKE ${like} OR i.code ILIKE ${like} OR i.name ILIKE ${like} OR sv.reference ILIKE ${like})`);
  }
  const types = q.variant ? LEDGER_TYPES[q.variant] : undefined;
  if (types) conds.push(Prisma.sql`l.voucher_type = ANY(${types}::text[])`);
  if (q.status === 'Reversal') conds.push(Prisma.sql`l.voucher_type = 'REVERSAL'`);
  if (q.status === 'Posted') conds.push(Prisma.sql`l.voucher_type <> 'REVERSAL'`);
  const rows = await prisma.$queryRaw<
    {
      id: string;
      voucher_no: string;
      voucher_type: string;
      posted_at: Date;
      posting_date: Date;
      qty_in: string;
      qty_out: string;
      value: string;
      balance_qty: string;
      balance_value: string;
      negative_allowed: boolean;
      reason_code: string | null;
      item_id: string;
      item_code: string;
      warehouse_id: string;
      wh_code: string;
      bin_code: string | null;
      posted_by: string;
      reference: string | null;
      parent_no: string | null;
      voucher_pk: string | null;
      total: number;
    }[]
  >`
    SELECT l.id::text, l.voucher_no, l.voucher_type, l.posted_at, l.posting_date, l.qty_in::text, l.qty_out::text, l.value::text,
      l.balance_qty::text, l.balance_value::text, l.negative_allowed, l.reason_code, l.item_id::text, i.code AS item_code,
      l.warehouse_id::text, w.code AS wh_code, bn.code AS bin_code, u.name AS posted_by, sv.reference, orig.voucher_no AS parent_no,
      sv.id::text AS voucher_pk, count(*) OVER()::int AS total
    FROM stock_ledger l
    JOIN items i ON i.id = l.item_id
    JOIN warehouses w ON w.id = l.warehouse_id
    JOIN users u ON u.id = l.created_by_id
    LEFT JOIN stock_vouchers sv ON sv.id = l.voucher_id
    LEFT JOIN stock_ledger orig ON orig.id = l.reverses_id
    LEFT JOIN wms_bins bn ON bn.id = l.bin_id
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY l.posted_at DESC, l.id DESC
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => {
      const reversal = r.voucher_type === 'REVERSAL';
      const status = reversal ? 'Reversal' : 'Posted';
      const amount = Math.abs(nz(r.value));
      const so = r.reference && /^SO[-/ ]/i.test(r.reference) ? r.reference : null;
      return {
        id: r.voucher_pk,
        status,
        page: 'inv-transactions',
        alloc: { itemId: r.item_id, warehouseId: r.warehouse_id },
        cells: {
          txnId: r.voucher_no,
          txnAt: r.posted_at.toISOString(),
          txnType: r.voucher_type,
          refId: r.reference,
          parentRef: r.parent_no,
          salesOrder: so,
          itemCode: r.item_code,
          status,
          // Record / Available / Location are real; Demand / Allocated / Short have no meaning for a posted movement
          w_record: r.voucher_no,
          w_available: nz(r.balance_qty),
          w_location: locationOf(r.wh_code, r.bin_code),
          p_reference: r.voucher_no,
          p_amount: amount,
          p_balance: nz(r.balance_value),
          e_exception: r.negative_allowed ? 'Issued into negative stock' : reversal ? 'Reversal of a posted movement' : (r.reason_code ?? 'None'),
          e_record: r.voucher_no,
          e_severity: r.negative_allowed ? 'High' : reversal ? 'Medium' : 'Low',
          e_age: daysSince(r.posting_date),
          e_rootCause: r.reason_code,
          e_owner: r.posted_by,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// vouchers: opening / adjustment / transfer
// ---------------------------------------------------------------------------------------------
interface VoucherRow {
  id: string;
  number: string;
  status: string;
  posting_date: Date;
  expected_receipt: Date | null;
  upload_batch: string | null;
  validation_status: string | null;
  fy_label: string;
  wh_id: string;
  wh_code: string;
  to_wh_code: string | null;
  approver: string | null;
  header_reason: string | null;
  journal_code: string | null;
  narration: string | null;
  lines: number;
  qty: string;
  value: string;
  system_qty: string;
  counted_qty: string;
  variance_qty: string;
  dispatched: string;
  received: string;
  line_pass: number;
  line_warn: number;
  line_fail: number;
  first_item_id: string | null;
  first_item: string | null;
  first_batch: string | null;
  first_reason: string | null;
  gl_debit: string;
  gl_credit: string;
  total: number;
}

async function voucher(caller: Caller, q: DsQuery, page: PageSpec, pageId: string): Promise<DsResult> {
  const kind = page.kind ?? 'OPENING';
  const like = likeOf(q.q);
  const conds: Prisma.Sql[] = [
    Prisma.sql`sv.kind = ${kind}`,
    Prisma.sql`sv.deleted_at IS NULL`,
    scopeSql(caller),
  ];
  if (like) {
    conds.push(Prisma.sql`(sv.number ILIKE ${like} OR EXISTS (SELECT 1 FROM stock_voucher_lines xl JOIN items xi ON xi.id = xl.item_id WHERE xl.voucher_id = sv.id AND (xi.code ILIKE ${like} OR xi.name ILIKE ${like} OR xl.batch_no ILIKE ${like})))`);
  }
  if (q.status) conds.push(Prisma.sql`sv.status = ${q.status}`);
  switch (q.variant) {
    case 'upload':
      conds.push(Prisma.sql`sv.upload_batch IS NOT NULL`);
      break;
    case 'batchserial':
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM stock_voucher_lines xl WHERE xl.voucher_id = sv.id AND (xl.batch_no IS NOT NULL OR xl.serial_nos IS NOT NULL))`);
      break;
    case 'errors':
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM stock_voucher_lines xl WHERE xl.voucher_id = sv.id AND (xl.qty <= 0 OR COALESCE(xl.unit_cost,0) <= 0))`);
      break;
    case 'posted':
      conds.push(Prisma.sql`sv.status = 'Posted'`);
      break;
    case 'variance':
      conds.push(
        kind === 'ADJUSTMENT'
          ? Prisma.sql`EXISTS (SELECT 1 FROM stock_voucher_lines xl WHERE xl.voucher_id = sv.id AND COALESCE(xl.variance_qty,0) <> 0)`
          : Prisma.sql`EXISTS (SELECT 1 FROM stock_voucher_lines xl WHERE xl.voucher_id = sv.id AND COALESCE(xl.dispatched_qty,0) <> COALESCE(xl.received_qty,0) AND sv.status IN ('Dispatched','Received'))`,
      );
      break;
    case 'approval':
      conds.push(Prisma.sql`sv.status IN ('Pending Approval','Approved','Rejected')`);
      break;
    case 'transit':
      conds.push(Prisma.sql`sv.status = 'Dispatched'`);
      break;
    case 'receipt':
      conds.push(Prisma.sql`sv.status IN ('Dispatched','Received')`);
      break;
    case 'sla':
      conds.push(Prisma.sql`sv.expected_receipt IS NOT NULL`);
      break;
    default:
  }
  const rows = await prisma.$queryRaw<VoucherRow[]>`
    SELECT sv.id::text, sv.number, sv.status, sv.posting_date, sv.expected_receipt, sv.upload_batch, sv.validation_status,
      fy.label AS fy_label, w.id::text AS wh_id, w.code AS wh_code, tw.code AS to_wh_code, ap.name AS approver,
      sv.reason_code AS header_reason, j.code AS journal_code, sv.narration,
      a.lines, a.qty::text, a.value::text, a.system_qty::text, a.counted_qty::text, a.variance_qty::text,
      a.dispatched::text, a.received::text, a.line_pass, a.line_warn, a.line_fail,
      f.item_id::text AS first_item_id, f.item_code AS first_item, f.batch_no AS first_batch, f.reason_code AS first_reason,
      COALESCE((SELECT sum(g.debit) FROM gl_entries g WHERE g.journal_id = sv.journal_id),0)::text AS gl_debit,
      COALESCE((SELECT sum(g.credit) FROM gl_entries g WHERE g.journal_id = sv.journal_id),0)::text AS gl_credit,
      count(*) OVER()::int AS total
    FROM stock_vouchers sv
    JOIN warehouses w ON w.id = sv.warehouse_id
    LEFT JOIN warehouses tw ON tw.id = sv.to_warehouse_id
    JOIN financial_years fy ON fy.id = sv.fy_id
    LEFT JOIN users ap ON ap.id = sv.approved_by_id
    LEFT JOIN journals j ON j.id = sv.journal_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS lines, COALESCE(sum(l.qty),0) AS qty, COALESCE(sum(l.value),0) AS value,
        COALESCE(sum(l.system_qty),0) AS system_qty, COALESCE(sum(l.counted_qty),0) AS counted_qty,
        COALESCE(sum(l.variance_qty),0) AS variance_qty, COALESCE(sum(l.dispatched_qty),0) AS dispatched,
        COALESCE(sum(l.received_qty),0) AS received,
        count(*) FILTER (WHERE l.qty > 0 AND COALESCE(l.unit_cost,0) > 0)::int AS line_pass,
        count(*) FILTER (WHERE l.qty > 0 AND COALESCE(l.unit_cost,0) <= 0)::int AS line_warn,
        count(*) FILTER (WHERE l.qty <= 0)::int AS line_fail
      FROM stock_voucher_lines l WHERE l.voucher_id = sv.id) a ON true
    LEFT JOIN LATERAL (
      SELECT l.item_id, i.code AS item_code, l.batch_no, l.reason_code
      FROM stock_voucher_lines l JOIN items i ON i.id = l.item_id WHERE l.voucher_id = sv.id ORDER BY l.line_no LIMIT 1) f ON true
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY sv.created_at DESC, sv.id DESC
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  const stats = await pairStats(
    rows
      .filter((r) => r.first_item_id)
      .map((r) => ({ itemId: r.first_item_id as string, warehouseId: r.wh_id })),
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => {
      const st = r.first_item_id ? stats.get(`${r.first_item_id}_${r.wh_id}`) : undefined;
      const qty = nz(r.qty);
      const more = r.lines > 1 ? ` +${r.lines - 1} more` : '';
      const item = r.first_item ? `${r.first_item}${more}` : null;
      const posted = r.status === 'Posted';
      const dispatched = nz(r.dispatched);
      const received = nz(r.received);
      let alloc: Record<string, unknown>;
      if (kind === 'TRANSFER') {
        // Source Allocation: how much of the request the source warehouse could still serve
        const left = Math.max(0, round3(qty - dispatched));
        alloc = allocCells(r.number, st ? { demand: qty, available: st.available, allocated: dispatched, short: Math.max(0, round3(left - st.available)) } : undefined, locationOf(r.wh_code, st?.bins));
        if (!st) alloc = { ...alloc, w_demand: qty, w_allocated: dispatched };
      } else if (kind === 'ADJUSTMENT') {
        alloc = allocCells(r.number, { demand: Math.abs(nz(r.variance_qty)), available: nz(r.system_qty), allocated: nz(r.counted_qty), short: Math.max(0, round3(nz(r.system_qty) - nz(r.counted_qty))) }, locationOf(r.wh_code, st?.bins));
      } else {
        alloc = allocCells(r.number, undefined, locationOf(r.wh_code, st?.bins));
        alloc.w_demand = qty;
        alloc.w_allocated = posted ? qty : 0;
      }
      const validation = r.line_fail > 0 ? 'Fail' : r.line_warn > 0 ? 'Warning' : r.lines > 0 ? 'Pass' : null;
      const debit = nz(r.gl_debit);
      const credit = nz(r.gl_credit);
      return {
        id: r.id,
        status: r.status,
        page: pageId,
        alloc: r.first_item_id ? { itemId: r.first_item_id, warehouseId: r.wh_id } : null,
        cells: {
          status: r.status,
          warehouse: r.wh_code,
          item,
          batchSerial: r.first_batch,
          // opening stock
          openingRef: r.number,
          financialYear: r.fy_label,
          openingQty: qty,
          unitCost: qty > 0 ? Math.round((nz(r.value) / qty) * 1_000_000) / 1_000_000 : null,
          uploadBatch: r.upload_batch,
          validationStatus: r.validation_status ?? validation,
          postingStatus: posted ? 'Posted' : r.status === 'Cancelled' ? 'Cancelled' : 'Not posted',
          // adjustment
          adjNo: r.number,
          date: iso(r.posting_date),
          systemQty: nz(r.system_qty),
          countedQty: nz(r.counted_qty),
          varianceQty: nz(r.variance_qty),
          valueImpact: nz(r.value),
          reasonCode: r.first_reason ?? r.header_reason,
          approver: r.approver,
          // transfer
          transferNo: r.number,
          transferDate: iso(r.posting_date),
          sourceWarehouse: r.wh_code,
          destinationWarehouse: r.to_wh_code,
          requestedQty: qty,
          dispatchedQty: dispatched,
          receivedQty: received,
          expectedReceipt: iso(r.expected_receipt),
          ...alloc,
          // validation workspace: line checks of the voucher
          v_rule: 'Each line: quantity above 0 and a unit cost',
          v_pass: r.line_pass,
          v_warning: r.line_warn,
          v_fail: r.line_fail,
          // ledger-book workspace: the GL journal this voucher posted
          b_date: iso(r.posting_date),
          b_reference: r.journal_code ?? r.number,
          b_particulars: r.narration ?? `${r.number} · ${r.wh_code}`,
          b_debit: posted ? debit : null,
          b_credit: posted ? credit : null,
          b_balance: posted ? Math.round((debit - credit) * 100) / 100 : null,
          // reference / due / amount workspace (destination receipt of a transfer)
          p_reference: r.number,
          p_due: iso(r.expected_receipt),
          p_amount: dispatched,
          p_allocated: received,
          p_balance: Math.max(0, round3(dispatched - received)),
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// reservations
// ---------------------------------------------------------------------------------------------
async function reservation(caller: Caller, q: DsQuery): Promise<DsResult> {
  const like = likeOf(q.q);
  const conds: Prisma.Sql[] = [scopeSql(caller)];
  if (like) conds.push(Prisma.sql`(r.code ILIKE ${like} OR r.demand_ref ILIKE ${like} OR i.code ILIKE ${like} OR i.name ILIKE ${like})`);
  if (q.status) conds.push(Prisma.sql`r.status = ${q.status}`);
  if (q.variant === 'short') conds.push(Prisma.sql`r.status IN ('Waiting','Partial')`);
  if (q.variant === 'ageing') conds.push(Prisma.sql`r.status IN ${OPEN_RESERVATION}`);
  const order =
    q.variant === 'priority'
      ? Prisma.sql`CASE r.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, r.created_at ASC`
      : q.variant === 'ageing'
        ? Prisma.sql`r.created_at ASC`
        : Prisma.sql`r.created_at DESC`;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      code: string;
      demand_type: string;
      demand_ref: string | null;
      priority: string;
      version: number;
      required: string;
      reserved: string;
      fulfilled: string;
      status: string;
      item_id: string;
      item_code: string;
      warehouse_id: string;
      wh_code: string;
      batch_no: string | null;
      total: number;
    }[]
  >`
    SELECT r.id::text, r.code, r.demand_type, r.demand_ref, r.priority, r.version, r.required_qty::text AS required, r.reserved_qty::text AS reserved,
      r.fulfilled_qty::text AS fulfilled, r.status, r.item_id::text, i.code AS item_code, r.warehouse_id::text, w.code AS wh_code,
      bt.batch_no, count(*) OVER()::int AS total
    FROM stock_reservations r
    JOIN items i ON i.id = r.item_id
    JOIN warehouses w ON w.id = r.warehouse_id
    LEFT JOIN batches bt ON bt.id = r.batch_id
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY ${order}
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  const stats = await pairStats(rows.map((r) => ({ itemId: r.item_id, warehouseId: r.warehouse_id })));
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => {
      const st = stats.get(`${r.item_id}_${r.warehouse_id}`);
      const open = Math.max(0, round3(nz(r.required) - nz(r.fulfilled)));
      return {
        id: r.id,
        version: r.version,
        status: r.status,
        page: 'inv-reservation',
        alloc: { itemId: r.item_id, warehouseId: r.warehouse_id },
        cells: {
          resNo: r.code,
          demandType: r.demand_type,
          demandRef: r.demand_ref,
          item: r.item_code,
          warehouse: r.wh_code,
          batchSerial: r.batch_no,
          requiredQty: nz(r.required),
          reservedQty: nz(r.reserved),
          availableQty: st?.available ?? null,
          status: r.status,
          ...allocCells(
            r.code,
            { demand: open, available: st?.available ?? 0, allocated: nz(r.reserved), short: Math.max(0, round3(open - nz(r.reserved))) },
            locationOf(r.wh_code, st?.bins),
          ),
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// count lines (Reconciliation: system vs physical)
// ---------------------------------------------------------------------------------------------
async function countLine(caller: Caller, q: DsQuery): Promise<DsResult> {
  const like = likeOf(q.q);
  const conds: Prisma.Sql[] = [Prisma.sql`sc.deleted_at IS NULL`, scopeSql(caller)];
  if (like) conds.push(Prisma.sql`(sc.code ILIKE ${like} OR i.code ILIKE ${like} OR i.name ILIKE ${like})`);
  if (q.status) conds.push(Prisma.sql`sc.status = ${q.status}`);
  const phys = Prisma.sql`COALESCE(l.final_qty, l.count2_qty, l.count1_qty)`;
  if (q.variant === 'variance') conds.push(Prisma.sql`${phys} IS NOT NULL AND ${phys} <> l.system_qty`);
  if (q.variant === 'approval') conds.push(Prisma.sql`sc.status IN ('Under Review','Approved')`);
  if (q.variant === 'posted') conds.push(Prisma.sql`sc.status IN ('Posted','Closed')`);
  const rows = await prisma.$queryRaw<
    {
      count_id: string;
      version: number;
      code: string;
      count_type: string;
      planned: Date;
      status: string;
      item_id: string;
      item_code: string;
      warehouse_id: string;
      wh_code: string;
      system_qty: string;
      physical: string | null;
      unit_cost: string | null;
      journal_code: string | null;
      gl_debit: string;
      gl_credit: string;
      total: number;
    }[]
  >`
    SELECT sc.id::text AS count_id, sc.version, sc.code, sc.count_type, sc.planned_date AS planned, sc.status, l.item_id::text, i.code AS item_code,
      sc.warehouse_id::text, w.code AS wh_code, l.system_qty::text, ${phys}::text AS physical, l.unit_cost::text,
      j.code AS journal_code,
      COALESCE((SELECT sum(g.debit) FROM gl_entries g JOIN stock_vouchers v ON v.journal_id = g.journal_id WHERE v.id = sc.reconciliation_voucher_id),0)::text AS gl_debit,
      COALESCE((SELECT sum(g.credit) FROM gl_entries g JOIN stock_vouchers v ON v.journal_id = g.journal_id WHERE v.id = sc.reconciliation_voucher_id),0)::text AS gl_credit,
      count(*) OVER()::int AS total
    FROM stock_count_lines l
    JOIN stock_counts sc ON sc.id = l.count_id
    JOIN items i ON i.id = l.item_id
    JOIN warehouses w ON w.id = sc.warehouse_id
    LEFT JOIN stock_vouchers rv ON rv.id = sc.reconciliation_voucher_id
    LEFT JOIN journals j ON j.id = rv.journal_id
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY sc.planned_date DESC, sc.code, l.line_no
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  const stats = await pairStats(rows.map((r) => ({ itemId: r.item_id, warehouseId: r.warehouse_id })));
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => {
      const st = stats.get(`${r.item_id}_${r.warehouse_id}`);
      const system = nz(r.system_qty);
      const physical = r.physical === null ? null : nz(r.physical);
      const variance = physical === null ? null : round3(physical - system);
      const cost = r.unit_cost === null ? null : nz(r.unit_cost);
      const value = variance !== null && cost !== null ? Math.round(variance * cost * 100) / 100 : null;
      const debit = nz(r.gl_debit);
      const credit = nz(r.gl_credit);
      return {
        id: r.count_id,
        version: r.version,
        status: r.status,
        page: 'inv-reconciliation',
        alloc: { itemId: r.item_id, warehouseId: r.warehouse_id },
        cells: {
          reconNo: r.code,
          countRef: `${r.count_type} · ${iso(r.planned)}`,
          warehouse: r.wh_code,
          item: r.item_code,
          systemQty: system,
          physicalQty: physical,
          variance,
          unitCost: cost,
          valueVariance: value,
          status: r.status,
          ...allocCells(
            r.code,
            { demand: system, available: st?.available ?? 0, allocated: physical ?? 0, short: physical === null ? 0 : Math.max(0, round3(system - physical)) },
            locationOf(r.wh_code, st?.bins),
          ),
          b_date: iso(r.planned),
          b_reference: r.journal_code ?? r.code,
          b_particulars: `${r.count_type} count · ${r.item_code}`,
          b_debit: debit || null,
          b_credit: credit || null,
          b_balance: debit || credit ? Math.round((debit - credit) * 100) / 100 : null,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// ageing, valuation, expiry, reorder: the report services, filtered and paged here
// ---------------------------------------------------------------------------------------------
async function ageingDs(caller: Caller, q: DsQuery): Promise<DsResult> {
  const out = await ageing(caller, { page: 1, size: 500 });
  const codes = out.rows.map((r) => r.warehouse);
  // unpaginated: last movement date per item of the page being shown
  const whIds = await whIdsByCode(caller, codes);
  const last = await prisma.$queryRaw<{ item_id: string; code: string; d: Date | null }[]>`
    SELECT l.item_id::text, w.code, max(l.posting_date) AS d
    FROM stock_ledger l JOIN warehouses w ON w.id = l.warehouse_id
    WHERE l.item_id = ANY(${out.rows.map((r) => r.itemId)}::uuid[]) AND w.code = ANY(${codes}::text[])
    GROUP BY l.item_id, w.code`;
  const lastBy = new Map(last.map((l) => [`${l.item_id}_${l.code}`, l.d]));
  const needle = q.q?.toLowerCase();
  let rows = out.rows.filter(
    (r) => !needle || r.itemCode.toLowerCase().includes(needle) || r.itemName.toLowerCase().includes(needle),
  );
  if (q.status) rows = rows.filter((r) => r.movement === q.status);
  if (q.variant === 'b030') rows = rows.filter((r) => r.f030 > 0);
  if (q.variant === 'b3190') rows = rows.filter((r) => r.f3190 > 0);
  if (q.variant === 'b91180') rows = rows.filter((r) => r.f91180 > 0);
  if (q.variant === 'b180') rows = rows.filter((r) => r.f180Plus > 0);
  if (q.variant === 'slow') rows = rows.filter((r) => r.movement === 'Slow Moving' || r.movement === 'Dead Stock');
  const pageRows = paginate(rows, q);
  const stats = await pairStats(
    pageRows.flatMap((r) => {
      const wid = whIds.get(r.warehouse);
      return wid ? [{ itemId: r.itemId, warehouseId: wid }] : [];
    }),
  );
  return {
    total: rows.length,
    rows: pageRows.map((r) => {
      const wid = whIds.get(r.warehouse) ?? null;
      const st = wid ? stats.get(`${r.itemId}_${wid}`) : undefined;
      return {
        id: null,
        status: r.movement,
        alloc: { itemId: r.itemId, warehouseId: wid },
        cells: {
          itemCode: r.itemCode,
          itemName: r.itemName,
          warehouse: r.warehouse,
          lastMovement: iso(lastBy.get(`${r.itemId}_${r.warehouse}`) ?? null),
          ageDays: r.ageDays,
          q030: r.f030,
          q3190: r.f3190,
          q91180: r.f91180,
          q180: r.f180Plus,
          status: r.movement,
          ...allocCells(r.itemCode, st, locationOf(r.warehouse, st?.bins)),
        },
      };
    }),
  };
}

async function valuationDs(caller: Caller, q: DsQuery): Promise<DsResult> {
  const today = new Date().toISOString().slice(0, 10);
  const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
  const fyStart = fy ? fy.startDate.toISOString().slice(0, 10) : `${today.slice(0, 4)}-04-01`;
  const to = q.to ?? today;
  const from = q.from ?? (fyStart > to ? to : fyStart);
  const out = await valuation(caller, { from: from > to ? to : from, to, page: 1, size: 500 });
  const codes = out.rows.map((r) => r.warehouse);
  const whIds = await whIdsByCode(caller, codes);
  const items = await prisma.item.findMany({
    where: { id: { in: out.rows.map((r) => r.itemId) } },
    select: { id: true, valuationMethod: true },
  });
  const method = new Map(items.map((i) => [i.id, i.valuationMethod === 'MOVING_AVG' ? 'Moving Average' : i.valuationMethod]));
  const needle = q.q?.toLowerCase();
  let rows = out.rows.filter(
    (r) => !needle || r.itemCode.toLowerCase().includes(needle) || r.itemName.toLowerCase().includes(needle),
  );
  if (q.variant === 'reval') rows = rows.filter((r) => r.adjustments !== 0);
  if (q.status) rows = rows.filter((r) => (r.balanced ? 'Balanced' : 'Check') === q.status);
  const pageRows = paginate(rows, q);
  const stats = await pairStats(
    pageRows.flatMap((r) => {
      const wid = whIds.get(r.warehouse);
      return wid ? [{ itemId: r.itemId, warehouseId: wid }] : [];
    }),
  );
  return {
    total: rows.length,
    rows: pageRows.map((r) => {
      const wid = whIds.get(r.warehouse) ?? null;
      const st = wid ? stats.get(`${r.itemId}_${wid}`) : undefined;
      const status = r.balanced ? 'Balanced' : 'Check';
      return {
        id: null,
        status,
        alloc: { itemId: r.itemId, warehouseId: wid },
        cells: {
          valRef: `${r.itemCode} / ${r.warehouse}`,
          date: to,
          warehouse: r.warehouse,
          item: `${r.itemCode} · ${r.itemName}`,
          method: method.get(r.itemId) ?? null,
          openingValue: r.opening,
          receiptValue: r.receipts,
          issueValue: r.issues,
          adjustmentValue: r.adjustments,
          closingValue: r.closing,
          closingQty: r.closingQty,
          status,
          ...allocCells(r.itemCode, st, locationOf(r.warehouse, st?.bins)),
        },
      };
    }),
  };
}

async function expiryDs(caller: Caller, q: DsQuery): Promise<DsResult> {
  const out = await expiry(caller, { page: 1, size: 5000 });
  const whIds = await whIdsByCode(caller, out.rows.map((r) => r.warehouse));
  const needle = q.q?.toLowerCase();
  let rows = out.rows.filter(
    (r) =>
      !needle ||
      r.itemCode.toLowerCase().includes(needle) ||
      r.itemName.toLowerCase().includes(needle) ||
      r.batchNo.toLowerCase().includes(needle),
  );
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.variant === 'near') rows = rows.filter((r) => r.band === 'Critical' || r.band === 'High');
  if (q.variant === 'expired') rows = rows.filter((r) => r.band === 'Expired');
  const pageRows = paginate(rows, q);
  const stats = await pairStats(
    pageRows.flatMap((r) => {
      const wid = whIds.get(r.warehouse);
      return wid ? [{ itemId: r.itemId, warehouseId: wid }] : [];
    }),
  );
  return {
    total: rows.length,
    totals: [{ label: 'Expired stock value', value: out.expiredValue, format: 'money' as const }],
    rows: pageRows.map((r) => {
      const wid = whIds.get(r.warehouse) ?? null;
      const st = wid ? stats.get(`${r.itemId}_${wid}`) : undefined;
      return {
        id: r.batchId,
        status: r.status,
        page: 'inv-batch',
        alloc: { itemId: r.itemId, warehouseId: wid },
        cells: {
          item: `${r.itemCode} · ${r.itemName}`,
          expBatch: r.batchNo,
          warehouse: r.warehouse,
          expiryDate: r.expiryDate,
          daysToExpiry: r.daysToExpiry,
          expAvailableQty: r.qty,
          expValue: r.value,
          status: r.status,
          ...allocCells(r.batchNo, st, locationOf(r.warehouse, st?.bins)),
        },
      };
    }),
  };
}

async function reorderDs(caller: Caller, q: DsQuery): Promise<DsResult> {
  const out = await reorderService.list(caller, { page: 1, size: 200 });
  const needle = q.q?.toLowerCase();
  let rows = out.rows.filter(
    (r) => !needle || (r.itemCode ?? '').toLowerCase().includes(needle) || (r.itemName ?? '').toLowerCase().includes(needle),
  );
  const statusOf = (r: (typeof rows)[number]): string => r.calc?.status ?? 'Inactive';
  if (q.status) rows = rows.filter((r) => statusOf(r) === q.status);
  if (q.variant === 'suggested') rows = rows.filter((r) => (r.calc?.suggested ?? 0) > 0);
  const pageRows = paginate(rows, q);
  const stats = await pairStats(pageRows.map((r) => ({ itemId: r.itemId, warehouseId: r.warehouseId })));
  return {
    total: rows.length,
    rows: pageRows.map((r) => {
      const st = stats.get(`${r.itemId}_${r.warehouseId}`);
      return {
        id: r.id,
        version: r.version,
        status: statusOf(r),
        page: 'inv-reorder',
        alloc: { itemId: r.itemId, warehouseId: r.warehouseId },
        cells: {
          itemCode: r.itemCode,
          itemName: r.itemName,
          warehouse: r.warehouse,
          adu: r.calc?.adu ?? null,
          leadTime: r.leadTimeDays,
          safetyStock: r.calc?.safetyStock ?? null,
          reorderLevel: r.calc?.reorderLevel ?? r.minQty,
          suggestedQty: r.calc?.suggested ?? null,
          status: statusOf(r),
          ...allocCells(r.itemCode ?? '', st, locationOf(r.warehouse ?? null, st?.bins)),
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// serial numbers
// ---------------------------------------------------------------------------------------------
async function serial(caller: Caller, q: DsQuery): Promise<DsResult> {
  const like = likeOf(q.q);
  const conds: Prisma.Sql[] = [Prisma.sql`(w.id IS NULL OR ${scopeSql(caller)})`];
  if (like) conds.push(Prisma.sql`(s.serial_no ILIKE ${like} OR i.code ILIKE ${like} OR i.name ILIKE ${like})`);
  if (q.status) conds.push(Prisma.sql`s.status = ${q.status}`);
  if (q.variant === 'exceptions') conds.push(Prisma.sql`(s.status NOT IN ('In Stock','Reserved') OR s.warehouse_id IS NULL)`);
  const rows = await prisma.$queryRaw<
    {
      id: string;
      serial_no: string;
      item_id: string;
      item_code: string;
      item_name: string;
      warehouse_id: string | null;
      wh_code: string | null;
      status: string;
      current_owner: string | null;
      grn: string | null;
      invoice_ref: string | null;
      warranty_end: Date | null;
      total: number;
    }[]
  >`
    SELECT s.id::text, s.serial_no, s.item_id::text, i.code AS item_code, i.name AS item_name, s.warehouse_id::text, w.code AS wh_code,
      s.status, s.current_owner,
      (SELECT e.voucher_no FROM serial_events e WHERE e.serial_id = s.id AND e.event = 'RECEIVED' ORDER BY e.created_at LIMIT 1) AS grn,
      wr.invoice_ref, wr.end_date AS warranty_end, count(*) OVER()::int AS total
    FROM serial_numbers s
    JOIN items i ON i.id = s.item_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN warranty_registrations wr ON wr.serial_number_id = s.id
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  const stats = await pairStats(
    rows.filter((r) => r.warehouse_id).map((r) => ({ itemId: r.item_id, warehouseId: r.warehouse_id as string })),
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => {
      const st = r.warehouse_id ? stats.get(`${r.item_id}_${r.warehouse_id}`) : undefined;
      return {
        id: r.id,
        status: r.status,
        page: 'inv-serial',
        alloc: { itemId: r.item_id, warehouseId: r.warehouse_id },
        cells: {
          serialNo: r.serial_no,
          item: `${r.item_code} · ${r.item_name}`,
          currentWarehouse: r.wh_code,
          currentOwner: r.current_owner,
          purchaseGrn: r.grn,
          salesInvoice: r.invoice_ref,
          warrantyEnd: iso(r.warranty_end),
          status: r.status,
          ...allocCells(r.serial_no, st, locationOf(r.wh_code, st?.bins)),
        },
      };
    }),
  };
}

export async function runDataset(
  key: DatasetKey,
  caller: Caller,
  q: DsQuery,
  page: PageSpec,
  pageId: string,
): Promise<DsResult> {
  switch (key) {
    case 'items':
      return items(caller, q);
    case 'itemMaster':
      return itemMaster(caller, q, pageId);
    case 'stockPair':
      return stockPair(caller, q);
    case 'batchStock':
      return batchStock(caller, q);
    case 'batch':
      return batch(caller, q);
    case 'ledger':
      return ledger(caller, q);
    case 'voucher':
      return voucher(caller, q, page, pageId);
    case 'reservation':
      return reservation(caller, q);
    case 'countLine':
      return countLine(caller, q);
    case 'ageing':
      return ageingDs(caller, q);
    case 'valuation':
      return valuationDs(caller, q);
    case 'expiry':
      return expiryDs(caller, q);
    case 'reorder':
      return reorderDs(caller, q);
    case 'serial':
      return serial(caller, q);
  }
}
