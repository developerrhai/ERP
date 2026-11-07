// Stock vouchers with header + lines (Phase 8 step 4, R-08). Four kinds share one lifecycle (STANDARDS §6):
//   Draft -> submit -> Pending Approval -> approve -> Approved -> post -> Posted -> cancel -> Cancelled
// Transfers go Approved -> dispatch -> Dispatched -> receive -> Received (cancel while Dispatched reverses).
// Rules: posted rows are never edited; a cancel reverses stock AND GL dated the cancel date; one transaction
// per action holds the voucher row lock, writes ledger + slices + journal and the audit row, and honours
// the Idempotency-Key; the posting date lies in an OPEN financial year; stock never goes negative.
// routes -> controller -> service -> repository: this is the service; DB access for the header/lines is in
// voucher-repository.ts, stock movements go through StockService, money through StockGl.
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Db } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import type { FieldErrors } from '../../../core/http/errors';
import { NumberingService } from '../../../core/numbering';
import { assertCanPost } from '../../../core/posting';
import { accessUserOf, can, scopeFor } from '../../../core/rbac/access';
import { isIsoDate } from '../../../engine/validators';
import { approvalService } from '../../approvals/service';
import type { ApprovalDocHandler } from '../../approvals/handlers';
import { recordRepository } from '../../records/repository';
import type { Caller } from '../../records/service';
import { D, ZERO, num, round2, round3, str } from '../money';
import type { Dec } from '../money';
import { UomService } from '../uom/uom-service';
import { countLedgerRows } from '../stock/posting';
import type { StockStatus } from '../stock/posting';
import { StockGl } from '../stock/gl';
import { StockService } from '../stock/stock-service';
import type { StockMoveInput } from '../stock/stock-service';
import { concreteUnit, writeAudit as writeTypedAudit } from '../typed';
import { voucherRepo } from './voucher-repository';
import type { VoucherRow } from './voucher-repository';

export type Kind = 'OPENING' | 'TRANSACTION' | 'ADJUSTMENT' | 'TRANSFER';

export interface KindInfo {
  kind: Kind;
  pageId: string;
  prefix: string;
  title: string;
}

export const KINDS: Record<string, KindInfo> = {
  opening: { kind: 'OPENING', pageId: 'inv-opening', prefix: 'OPN', title: 'Opening stock' },
  transactions: {
    kind: 'TRANSACTION',
    pageId: 'inv-transactions',
    prefix: 'TXN',
    title: 'Receipt / issue',
  },
  adjustment: {
    kind: 'ADJUSTMENT',
    pageId: 'inv-adjustment',
    prefix: 'ADJ',
    title: 'Stock adjustment',
  },
  transfer: { kind: 'TRANSFER', pageId: 'inv-transfer', prefix: 'TRF', title: 'Stock transfer' },
};
export const kindOfPage = (pageId: string): KindInfo | undefined =>
  Object.values(KINDS).find((k) => k.pageId === pageId);

export const REASON_CODES = [
  'Damage',
  'Expiry',
  'Count Correction',
  'Theft/Loss',
  'Other',
] as const;
const TX = { maxWait: 20_000, timeout: 30_000 };
const STATUSES: StockStatus[] = ['UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED'];

export const E24_MESSAGE =
  'Transfer between different GSTINs needs a tax invoice; available after the Taxation phase.';

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------
export interface LineInput {
  itemId: string;
  warehouseId?: string | null;
  qty?: number | string;
  countedQty?: number | string | null;
  uom?: string | null;
  unitCost?: number | string | null;
  stockStatus?: StockStatus | null;
  batchId?: string | null;
  batchNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  serialNos?: string[] | null;
  binId?: string | null;
  reasonCode?: string | null;
  remarks?: string | null;
  reservationId?: string | null;
}

export interface HeaderInput {
  postingDate?: string;
  warehouseId: string;
  toWarehouseId?: string | null;
  txType?: 'Receipt' | 'Issue' | null;
  reference?: string | null;
  narration?: string | null;
  vehicleRef?: string | null;
  expectedReceipt?: string | null;
  reasonNote?: string | null;
  lines: LineInput[];
}

export interface ActionBody {
  cancelDate?: string;
  reason?: string;
}

const isoOf = (d: Date): string => d.toISOString().slice(0, 10);
const asDate = (s: string): Date => new Date(`${s}T00:00:00Z`);

function clampToFy(fy: { startDate: Date; endDate: Date }, today = new Date()): string {
  const t = isoOf(today);
  if (t < isoOf(fy.startDate)) return isoOf(fy.startDate);
  if (t > isoOf(fy.endDate)) return isoOf(fy.endDate);
  return t;
}

function assertOpen(fy: { code: string; status: string }): void {
  if (fy.status !== 'OPEN') throw Errors.periodClosed(`Financial year ${fy.code} is closed.`);
}

function assertDateInFy(date: string, fy: { startDate: Date; endDate: Date; code: string }): void {
  if (date < isoOf(fy.startDate) || date > isoOf(fy.endDate)) {
    throw Errors.validation({ postingDate: `The date must lie inside financial year ${fy.code}.` });
  }
}

// ---------------------------------------------------------------------------------------------
// Validation of a header + lines (used by create and update)
// ---------------------------------------------------------------------------------------------
interface NormLine {
  itemId: string;
  warehouseId: string;
  qty: Dec;
  enteredQty: Dec;
  uom: string | null;
  uomFactor: Dec | null;
  unitCost: Dec | null;
  stockStatus: StockStatus;
  batchId: string | null;
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  serialNos: string[] | null;
  binId: string | null;
  countedQty: Dec | null;
  reasonCode: string | null;
  remarks: string | null;
  reservationId: string | null;
}

const toDec = (v: number | string | null | undefined): Dec | null =>
  v === null || v === undefined || v === '' ? null : D(v);

async function unitGstin(db: Db, unitId: string): Promise<string | null> {
  const u = await db.unit.findUnique({ where: { id: unitId }, select: { gstin: true } });
  return u?.gstin?.trim().toUpperCase() || null;
}

/** E-24: a transfer between units with different GSTINs needs a tax invoice (Phase 11). */
export async function assertSameGstin(db: Db, fromUnit: string, toUnit: string): Promise<void> {
  if (fromUnit === toUnit) return;
  const [a, b] = await Promise.all([unitGstin(db, fromUnit), unitGstin(db, toUnit)]);
  if (a !== b) throw Errors.conflict(E24_MESSAGE);
}

async function normalize(
  db: Db,
  info: KindInfo,
  h: HeaderInput,
  ctxUnitId: string,
  fy: { startDate: Date; endDate: Date; code: string },
  postingDate: string,
): Promise<{ lines: NormLine[]; toUnitId: string | null }> {
  const errors: FieldErrors = {};
  if (!isIsoDate(postingDate)) errors.postingDate = 'Enter a valid date (YYYY-MM-DD).';
  else {
    try {
      assertDateInFy(postingDate, fy);
    } catch {
      errors.postingDate = `The posting date must lie inside financial year ${fy.code}.`;
    }
  }
  const warehouse = await db.warehouse.findFirst({ where: { id: h.warehouseId, deletedAt: null } });
  if (!warehouse || warehouse.status !== 'ACTIVE')
    errors.warehouseId = 'Choose an active warehouse.';
  else if (warehouse.unitId !== ctxUnitId) {
    errors.warehouseId = 'This warehouse belongs to another unit. Switch unit first.';
  } else if (warehouse.isTransit)
    errors.warehouseId = 'A transit warehouse is used by transfers only.';
  let toUnitId: string | null = null;
  if (info.kind === 'TRANSFER') {
    const to = h.toWarehouseId
      ? await db.warehouse.findFirst({ where: { id: h.toWarehouseId, deletedAt: null } })
      : null;
    if (!to || to.status !== 'ACTIVE')
      errors.toWarehouseId = 'Choose an active destination warehouse.';
    else if (to.id === h.warehouseId)
      errors.toWarehouseId = 'The destination must differ from the source.';
    else if (to.isTransit) errors.toWarehouseId = 'Choose a real warehouse, not a transit one.';
    else toUnitId = to.unitId;
  }
  if (info.kind === 'TRANSACTION' && h.txType !== 'Receipt' && h.txType !== 'Issue') {
    errors.txType = 'Choose Receipt or Issue.';
  }
  if (h.lines.length === 0) errors.lines = 'Add at least one line.';
  if (h.lines.length > 200) errors.lines = 'A voucher can have at most 200 lines.';
  if (Object.keys(errors).length > 0) throw Errors.validation(errors);
  if (info.kind === 'TRANSFER' && toUnitId) await assertSameGstin(db, ctxUnitId, toUnitId);

  const out: NormLine[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < h.lines.length; i++) {
    const l = h.lines[i]!;
    const at = (k: string) => `lines.${i}.${k}`;
    const le: FieldErrors = {};
    const item = await db.item.findFirst({ where: { id: l.itemId, deletedAt: null } });
    if (!item || item.status !== 'ACTIVE') le[at('itemId')] = 'Choose an active item.';
    const wid = l.warehouseId ?? h.warehouseId;
    if (wid !== h.warehouseId) le[at('warehouseId')] = 'Every line uses the voucher warehouse.';
    let qty = toDec(l.qty) ?? ZERO;
    let counted: Dec | null = null;
    if (info.kind === 'ADJUSTMENT') {
      counted = toDec(l.countedQty);
      if (counted === null || counted.lessThan(0))
        le[at('countedQty')] = 'Enter the counted quantity (0 or more).';
      if (!l.reasonCode || !(REASON_CODES as readonly string[]).includes(l.reasonCode)) {
        le[at('reasonCode')] = 'Choose a reason.';
      }
      qty = counted ?? ZERO;
    } else if (qty.lessThanOrEqualTo(0)) le[at('qty')] = 'Enter a quantity greater than 0.';
    let factor: Dec | null = null;
    let base = qty;
    if (item && Object.keys(le).length === 0) {
      try {
        const c = await UomService.toBase(db, { itemId: item.id, uom: l.uom ?? null, qty });
        base = c.baseQty;
        factor = c.factor.equals(1) ? null : c.factor;
      } catch (e) {
        le[at('uom')] = e instanceof Error ? e.message : 'This unit cannot be converted.';
      }
    }
    const cost = toDec(l.unitCost);
    const needsCost =
      info.kind === 'OPENING' || (info.kind === 'TRANSACTION' && h.txType === 'Receipt');
    if (needsCost && (cost === null || cost.lessThan(0)))
      le[at('unitCost')] = 'Enter the unit cost (0 or more).';
    const status = l.stockStatus ?? 'UNRESTRICTED';
    if (!STATUSES.includes(status)) le[at('stockStatus')] = 'Unknown stock status.';
    if (
      item?.batchTracked &&
      info.kind !== 'ADJUSTMENT' &&
      !(info.kind === 'TRANSACTION' && h.txType === 'Issue') &&
      info.kind !== 'TRANSFER' &&
      !l.batchNo &&
      !l.batchId
    ) {
      le[at('batchNo')] = 'This item is batch-tracked: enter a batch number.';
    }
    if (l.mfgDate && !isIsoDate(l.mfgDate)) le[at('mfgDate')] = 'Enter a valid date.';
    if (l.expiryDate && !isIsoDate(l.expiryDate)) le[at('expiryDate')] = 'Enter a valid date.';
    if (l.mfgDate && l.expiryDate && l.expiryDate <= l.mfgDate)
      le[at('expiryDate')] = 'Expiry must be after manufacturing.';
    if (l.binId) {
      const bin = await db.wmsBin.findFirst({ where: { id: l.binId, deletedAt: null } });
      if (!bin || bin.warehouseId !== h.warehouseId)
        le[at('binId')] = 'This bin does not belong to the warehouse.';
    }
    if (Object.keys(le).length > 0) throw Errors.validation(le);
    const key = `${l.itemId}|${l.batchId ?? l.batchNo ?? ''}|${l.binId ?? ''}|${status}`;
    if (seen.has(key)) {
      throw Errors.validation({
        [at('itemId')]: 'The same item, batch and bin is listed twice. Merge the lines.',
      });
    }
    seen.add(key);
    out.push({
      itemId: l.itemId,
      warehouseId: h.warehouseId,
      qty: info.kind === 'ADJUSTMENT' ? ZERO : base,
      enteredQty: qty,
      uom: l.uom ?? null,
      uomFactor: factor,
      unitCost: cost,
      stockStatus: status,
      batchId: l.batchId ?? null,
      batchNo: l.batchNo?.trim() || null,
      mfgDate: l.mfgDate ?? null,
      expiryDate: l.expiryDate ?? null,
      serialNos: l.serialNos?.length ? l.serialNos : null,
      binId: l.binId ?? null,
      countedQty: counted !== null && factor ? round3(counted.times(factor)) : counted,
      reasonCode: l.reasonCode ?? null,
      remarks: l.remarks?.trim() || null,
      reservationId: l.reservationId ?? null,
    });
  }
  return { lines: out, toUnitId };
}

function estimateTotals(info: KindInfo, h: HeaderInput, lines: NormLine[]) {
  const totalQty = lines.reduce((a, l) => a.plus(info.kind === 'ADJUSTMENT' ? ZERO : l.qty), ZERO);
  const costed = info.kind === 'OPENING' || (info.kind === 'TRANSACTION' && h.txType === 'Receipt');
  const totalValue = costed
    ? lines.reduce((a, l) => a.plus(round2(l.qty.times(l.unitCost ?? ZERO))), ZERO)
    : null;
  return { totalQty, totalValue };
}

const lineData = (
  l: NormLine,
  no: number,
): Prisma.StockVoucherLineUncheckedCreateWithoutVoucherInput => ({
  lineNo: no,
  itemId: l.itemId,
  warehouseId: l.warehouseId,
  qty: str(l.qty),
  enteredQty: str(l.enteredQty),
  uom: l.uom,
  uomFactor: l.uomFactor ? str(l.uomFactor) : null,
  unitCost: l.unitCost ? str(l.unitCost) : null,
  stockStatus: l.stockStatus,
  batchId: l.batchId,
  batchNo: l.batchNo,
  mfgDate: l.mfgDate ? asDate(l.mfgDate) : null,
  expiryDate: l.expiryDate ? asDate(l.expiryDate) : null,
  serialNos: l.serialNos ?? undefined,
  binId: l.binId,
  countedQty: l.countedQty ? str(l.countedQty) : null,
  reasonCode: l.reasonCode,
  remarks: l.remarks,
  reservationId: l.reservationId,
});

// ---------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------
export interface VoucherDto {
  id: string;
  kind: Kind;
  pageId: string;
  number: string;
  status: string;
  unitId: string;
  fyId: string;
  department: string;
  postingDate: string;
  warehouse: { id: string; code: string; name: string } | null;
  toWarehouse: { id: string; code: string; name: string } | null;
  txType: string | null;
  reference: string | null;
  narration: string | null;
  vehicleRef: string | null;
  expectedReceipt: string | null;
  reasonNote: string | null;
  totalQty: number | null;
  totalValue: number | null;
  journalId: string | null;
  version: number;
  createdAt: string;
  createdBy: string;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: {
    id: string;
    lineNo: number;
    item: { id: string; code: string; name: string; baseUom: string };
    qty: number | null;
    enteredQty: number | null;
    uom: string | null;
    unitCost: number | null;
    value: number | null;
    stockStatus: string;
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
  }[];
}

function toDto(v: VoucherRow): VoucherDto {
  const info = Object.values(KINDS).find((k) => k.kind === v.kind)!;
  return {
    id: v.id,
    kind: info.kind,
    pageId: info.pageId,
    number: v.number,
    status: v.status,
    unitId: v.unitId,
    fyId: v.fyId,
    department: v.department,
    postingDate: isoOf(v.postingDate),
    warehouse: v.warehouse
      ? { id: v.warehouse.id, code: v.warehouse.code, name: v.warehouse.name }
      : null,
    toWarehouse: v.toWarehouse
      ? { id: v.toWarehouse.id, code: v.toWarehouse.code, name: v.toWarehouse.name }
      : null,
    txType: v.txType,
    reference: v.reference,
    narration: v.narration,
    vehicleRef: v.vehicleRef,
    expectedReceipt: v.expectedReceipt ? isoOf(v.expectedReceipt) : null,
    reasonNote: v.reasonNote,
    totalQty: num(v.totalQty),
    totalValue: num(v.totalValue),
    journalId: v.journalId,
    version: v.version,
    createdAt: v.createdAt.toISOString(),
    createdBy: v.createdById,
    postedAt: v.postedAt ? v.postedAt.toISOString() : null,
    cancelledAt: v.cancelledAt ? v.cancelledAt.toISOString() : null,
    cancelReason: v.cancelReason,
    lines: v.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      item: { id: l.item.id, code: l.item.code, name: l.item.name, baseUom: l.item.baseUom },
      qty: num(l.qty),
      enteredQty: num(l.enteredQty),
      uom: l.uom,
      unitCost: num(l.unitCost),
      value: num(l.value),
      stockStatus: l.stockStatus,
      batchNo: l.batchNo,
      batchId: l.batchId,
      mfgDate: l.mfgDate ? isoOf(l.mfgDate) : null,
      expiryDate: l.expiryDate ? isoOf(l.expiryDate) : null,
      serialNos: Array.isArray(l.serialNos) ? (l.serialNos as string[]) : [],
      binId: l.binId,
      countedQty: num(l.countedQty),
      systemQty: num(l.systemQty),
      varianceQty: num(l.varianceQty),
      reasonCode: l.reasonCode,
      remarks: l.remarks,
      dispatchedQty: num(l.dispatchedQty),
      receivedQty: num(l.receivedQty),
      reservationId: l.reservationId,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------------------------
async function scopeOf(caller: Caller, info: KindInfo) {
  const user = caller.auth.user;
  const [scope, control] = await Promise.all([
    scopeFor(accessUserOf(user), info.pageId),
    prisma.moduleControl.findUnique({
      where: { pageId: info.pageId },
      select: { ownerDepartment: true },
    }),
  ]);
  return {
    ownUserId: scope === 'OWN' ? user.id : undefined,
    department: user.department ?? null,
    anyDepartment:
      scope === 'ALL' ||
      scope === 'UNIT' ||
      (scope === 'DEPARTMENT' && control?.ownerDepartment === user.department),
  };
}

async function load(
  caller: Caller,
  info: KindInfo,
  id: string,
  db: Db = prisma,
): Promise<VoucherRow> {
  const units = {
    unitId: caller.ctx.unitId,
    none: caller.ctx.unitId === null && !caller.ctx.allUnits,
  };
  const row = await voucherRepo.find(
    {
      kind: info.kind,
      id,
      unitId: units.unitId,
      none: units.none,
      scope: await scopeOf(caller, info),
    },
    db,
  );
  if (!row) throw Errors.notFound('Record not found.');
  return row;
}

async function writeAudit(
  tx: Db,
  caller: Caller,
  action: Parameters<typeof writeTypedAudit>[2],
  v: { id: string; number: string; unitId: string },
  info: KindInfo,
  detail: Record<string, unknown> = {},
) {
  await writeTypedAudit(tx, caller, action, 'Voucher', { id: v.id, code: v.number }, info.pageId, {
    unitId: v.unitId,
    ...detail,
  } as Prisma.InputJsonObject);
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------
export const voucherService = {
  async list(
    caller: Caller,
    info: KindInfo,
    q: { q?: string; status?: string; page: number; size: number; deleted?: boolean },
  ) {
    const units = {
      unitId: caller.ctx.unitId,
      none: caller.ctx.unitId === null && !caller.ctx.allUnits,
    };
    const { rows, total } = await voucherRepo.list(
      {
        kind: info.kind,
        ...units,
        scope: await scopeOf(caller, info),
        q: q.q,
        status: q.status,
        deleted: q.deleted === true,
      },
      { skip: (q.page - 1) * q.size, take: q.size },
    );
    return { rows: rows.map(toDto), total };
  },

  async get(caller: Caller, info: KindInfo, id: string): Promise<VoucherDto> {
    return toDto(await load(caller, info, id));
  },

  async create(caller: Caller, info: KindInfo, input: HeaderInput): Promise<VoucherDto> {
    const unitId = concreteUnit(caller);
    const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
    if (!fy) throw Errors.contextInvalid('Unknown financial year.');
    assertOpen(fy);
    const postingDate = input.postingDate ?? clampToFy(fy);
    const user = caller.auth.user;
    const id = await prisma.$transaction(async (tx) => {
      const n = await normalize(tx, info, input, unitId, fy, postingDate);
      const totals = estimateTotals(info, input, n.lines);
      const number = await NumberingService.allocate(tx, {
        pageId: info.pageId,
        unitId,
        fyId: fy.id,
        prefix: info.prefix,
        padding: 4,
      });
      const row = await voucherRepo.create(
        {
          kind: info.kind,
          number,
          status: 'Draft',
          unitId,
          toUnitId: n.toUnitId,
          fyId: fy.id,
          department: user.department ?? 'Administration',
          postingDate: asDate(postingDate),
          warehouseId: input.warehouseId,
          toWarehouseId: input.toWarehouseId ?? null,
          txType: info.kind === 'TRANSACTION' ? (input.txType ?? null) : null,
          reference: input.reference?.trim() || null,
          narration: input.narration?.trim() || null,
          vehicleRef: input.vehicleRef?.trim() || null,
          expectedReceipt: input.expectedReceipt ? asDate(input.expectedReceipt) : null,
          reasonNote: input.reasonNote?.trim() || null,
          hasLines: true,
          totalQty: str(totals.totalQty),
          totalValue: totals.totalValue ? str(totals.totalValue) : null,
          createdById: user.id,
          lines: { create: n.lines.map((l, i) => lineData(l, i + 1)) },
        },
        tx,
      );
      await writeAudit(tx, caller, 'VOUCHER_CREATED', { id: row.id, number, unitId }, info, {
        lines: n.lines.length,
      });
      return row.id;
    }, TX);
    return toDto(await load(caller, info, id));
  },

  async update(
    caller: Caller,
    info: KindInfo,
    id: string,
    version: number,
    input: HeaderInput,
  ): Promise<VoucherDto> {
    const unitId = concreteUnit(caller);
    await prisma.$transaction(async (tx) => {
      await voucherRepo.lock(id, tx);
      const cur = await load(caller, info, id, tx);
      if (!['Draft', 'Rejected'].includes(cur.status)) {
        throw Errors.recordLocked(`A ${cur.status} voucher cannot be edited.`);
      }
      if (cur.version !== version) throw Errors.versionConflict();
      assertOpen(cur.fy);
      const postingDate = input.postingDate ?? isoOf(cur.postingDate);
      const n = await normalize(tx, info, input, unitId, cur.fy, postingDate);
      const totals = estimateTotals(info, input, n.lines);
      const ok = await voucherRepo.replace(
        id,
        version,
        {
          postingDate: asDate(postingDate),
          warehouseId: input.warehouseId,
          toWarehouseId: input.toWarehouseId ?? null,
          toUnitId: n.toUnitId,
          txType: info.kind === 'TRANSACTION' ? (input.txType ?? null) : null,
          reference: input.reference?.trim() || null,
          narration: input.narration?.trim() || null,
          vehicleRef: input.vehicleRef?.trim() || null,
          expectedReceipt: input.expectedReceipt ? asDate(input.expectedReceipt) : null,
          reasonNote: input.reasonNote?.trim() || null,
          totalQty: str(totals.totalQty),
          totalValue: totals.totalValue ? str(totals.totalValue) : null,
          status: 'Draft',
          updatedById: caller.auth.userId,
        },
        n.lines.map((l, i) => lineData(l, i + 1)),
        tx,
      );
      if (!ok) throw Errors.versionConflict();
      await writeAudit(tx, caller, 'VOUCHER_UPDATED', cur, info, { lines: n.lines.length });
    }, TX);
    return toDto(await load(caller, info, id));
  },

  async remove(caller: Caller, info: KindInfo, id: string, version?: number) {
    concreteUnit(caller);
    const cur = await load(caller, info, id);
    if (cur.status !== 'Draft')
      throw Errors.recordLocked(`A ${cur.status} voucher cannot be deleted.`);
    if (version !== undefined && version !== cur.version) throw Errors.versionConflict();
    assertOpen(cur.fy);
    await prisma.$transaction(async (tx) => {
      if (!(await voucherRepo.softDelete(id, caller.auth.userId, new Date(), tx))) {
        throw Errors.recordLocked('Only a Draft voucher can be deleted.');
      }
      await writeAudit(tx, caller, 'VOUCHER_DELETED', cur, info);
    }, TX);
  },

  async restore(caller: Caller, info: KindInfo, id: string): Promise<VoucherDto> {
    concreteUnit(caller);
    const units = { unitId: caller.ctx.unitId, none: false };
    const cur = await voucherRepo.find(
      { kind: info.kind, id, ...units, scope: await scopeOf(caller, info), deleted: true },
      prisma,
    );
    if (!cur) throw Errors.notFound('Record not found.');
    assertOpen(cur.fy);
    await prisma.$transaction(async (tx) => {
      if (!(await voucherRepo.restore(id, caller.auth.userId, tx)))
        throw Errors.notFound('Record not found.');
      await writeAudit(tx, caller, 'VOUCHER_RESTORED', cur, info);
    }, TX);
    return toDto(await load(caller, info, id));
  },

  /** Draft / Rejected -> approval engine. A transfer between different GSTINs is refused here too (E-24). */
  async submit(
    caller: Caller,
    info: KindInfo,
    id: string,
    version: number | undefined,
  ): Promise<VoucherDto> {
    concreteUnit(caller);
    const cur = await load(caller, info, id);
    if (info.kind === 'TRANSFER' && cur.toUnitId)
      await assertSameGstin(prisma, cur.unitId, cur.toUnitId);
    await approvalService.submit(caller, info.pageId, id, { docVersion: version });
    return toDto(await load(caller, info, id));
  },

  async action(
    caller: Caller,
    info: KindInfo,
    id: string,
    action: 'post' | 'dispatch' | 'receive' | 'cancel',
    body: ActionBody,
    idempotencyKey: string | undefined,
  ): Promise<{ record: VoucherDto; replay: boolean }> {
    const allowed: Record<Kind, string[]> = {
      OPENING: ['post', 'cancel'],
      TRANSACTION: ['post', 'cancel'],
      ADJUSTMENT: ['post', 'cancel'],
      TRANSFER: ['dispatch', 'receive', 'cancel'],
    };
    if (!allowed[info.kind].includes(action)) throw Errors.notFound('Unknown action.');
    const user = caller.auth.user;
    const requestHash = createHash('sha256')
      .update(JSON.stringify([info.pageId, id, action, body]))
      .digest('hex');
    const backdateOk = await can(accessUserOf(user), info.pageId, 'approve');
    const out = await prisma.$transaction(async (tx) => {
      await load(caller, info, id, tx); // visible? else 404
      await voucherRepo.lock(id, tx);
      if (idempotencyKey) {
        await recordRepository.lockIdempotency(user.id, idempotencyKey, tx);
        const seen = await recordRepository.findIdempotency(user.id, idempotencyKey, tx);
        if (seen) {
          if (seen.requestHash !== requestHash) {
            throw Errors.conflict('This Idempotency-Key was already used for a different request.');
          }
          return { replay: true, voucher: await load(caller, info, id, tx) };
        }
      }
      const v = await load(caller, info, id, tx);
      if (
        action === 'cancel' &&
        v.status !== 'Draft' &&
        !(await can(accessUserOf(user), info.pageId, 'cancel'))
      ) {
        throw Errors.forbidden();
      }
      assertOpen(v.fy);
      const c = { caller, info, tx, v, body, backdateOk };
      if (action === 'post') await doPost(c);
      else if (action === 'dispatch') await doDispatch(c);
      else if (action === 'receive') await doReceive(c);
      else await doCancel(c);
      if (idempotencyKey) {
        await recordRepository.saveIdempotency(
          { userId: user.id, key: idempotencyKey, requestHash, recordId: id },
          tx,
        );
      }
      return { replay: false, voucher: await load(caller, info, id, tx) };
    }, TX);
    return { record: toDto(out.voucher), replay: out.replay };
  },
};

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------
interface Ctx {
  caller: Caller;
  info: KindInfo;
  tx: Db;
  v: VoucherRow;
  body: ActionBody;
  backdateOk: boolean;
}

function notAllowed(v: VoucherRow, action: string): never {
  throw Errors.conflict(
    `A ${v.status} voucher cannot be ${action === 'cancel' ? 'cancelled' : `${action}ed`}.`,
  );
}

function assertUnit(caller: Caller, v: VoucherRow, allowDestination = false): void {
  const unitId = concreteUnit(caller);
  const ok =
    unitId === v.unitId || (allowDestination && v.toUnitId !== null && unitId === v.toUnitId);
  if (!ok) throw Errors.contextInvalid('Switch to the unit of this voucher first.');
}

async function costOfGain(
  tx: Db,
  itemId: string,
  warehouseId: string,
  standard: Dec | null,
): Promise<Dec> {
  const r = await tx.$queryRaw<{ avg_rate: string }[]>`
    SELECT avg_rate::text FROM stock_balances WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  const avg = D(r[0]?.avg_rate ?? '0');
  if (avg.greaterThan(0)) return avg;
  if (standard && standard.greaterThan(0)) return standard;
  const last = await tx.$queryRaw<{ rate: string }[]>`
    SELECT rate::text FROM stock_ledger WHERE item_id = ${itemId}::uuid AND voucher_type IN ('RECEIPT','OPENING')
    ORDER BY posted_at DESC LIMIT 1`;
  if (last[0]) return D(last[0].rate);
  throw Errors.unitCostRequired(
    'There is no cost for this item yet: set a standard cost or post a receipt first.',
  );
}

interface MoveRecord {
  lineId: string;
  ledgerIds: string[];
  value: Dec;
  detail?: {
    id: string;
    batchId: string | null;
    binId: string | null;
    qty: string;
    rate: string;
    value: string;
  }[];
}

const slim = (e: {
  id: string;
  batchId: string | null;
  binId: string | null;
  qty: Dec;
  rate: Dec;
  value: Dec;
}) => ({
  id: e.id,
  batchId: e.batchId,
  binId: e.binId,
  qty: str(e.qty),
  rate: str(e.rate),
  value: str(e.value),
});

async function finish(
  c: Ctx,
  data: Prisma.StockVoucherUncheckedUpdateManyInput,
  audit: 'VOUCHER_POSTED' | 'VOUCHER_CANCELLED' | 'TRANSFER_DISPATCHED' | 'TRANSFER_RECEIVED',
  detail: Record<string, unknown>,
) {
  const ok = await voucherRepo.updateIfVersion(
    c.v.id,
    c.v.version,
    { ...data, updatedById: c.caller.auth.userId },
    c.tx,
  );
  if (!ok) throw Errors.versionConflict();
  await writeAudit(c.tx, c.caller, audit, c.v, c.info, detail);
}

function moveBase(c: Ctx, line: VoucherRow['lines'][number]) {
  return {
    postingDate: isoOf(c.v.postingDate),
    voucherId: c.v.id,
    voucherNo: c.v.number,
    createdById: c.caller.auth.userId,
    lineId: line.id,
    uom: line.uom,
    uomFactor: line.uomFactor ?? null,
    allowBackdate: c.backdateOk,
  };
}

async function doPost(c: Ctx): Promise<void> {
  const { v, info, tx } = c;
  if (v.status !== 'Approved') {
    throw Errors.conflict(
      v.status === 'Draft' || v.status === 'Rejected'
        ? 'Submit this voucher for approval first; only an Approved voucher can be posted.'
        : `A ${v.status} voucher cannot be posted.`,
    );
  }
  assertUnit(c.caller, v);
  const date = isoOf(v.postingDate);
  await assertCanPost(tx, {
    unitId: v.unitId,
    fyId: v.fyId,
    postingDate: v.postingDate,
    documentStatus: v.status,
    allowedStatuses: ['Approved'],
    action: 'post',
  });
  await StockService.lockInOrder(
    tx,
    v.lines.map((l) => ({ warehouseId: v.warehouseId, itemId: l.itemId })),
  );
  const countId =
    info.kind === 'ADJUSTMENT'
      ? ((
          await tx.stockCount.findFirst({
            where: { reconciliationVoucherId: v.id },
            select: { id: true },
          })
        )?.id ?? null)
      : null;
  const records: MoveRecord[] = [];
  const sysFigures = new Map<string, { system: Dec; variance: Dec; cost: Dec }>();

  for (const line of v.lines) {
    const base = moveBase(c, line);
    const qty = line.qty ?? ZERO;
    const common = {
      warehouseId: v.warehouseId,
      itemId: line.itemId,
      batchId: line.batchId,
      batch: line.batchNo
        ? {
            batchNo: line.batchNo,
            mfgDate: line.mfgDate ? isoOf(line.mfgDate) : null,
            expiryDate: line.expiryDate ? isoOf(line.expiryDate) : null,
            grnRef: v.reference,
          }
        : null,
      serialNos: Array.isArray(line.serialNos) ? (line.serialNos as string[]) : null,
      binId: line.binId,
      reasonCode: line.reasonCode,
      countId,
    };
    let inputs: StockMoveInput[] = [];
    if (info.kind === 'OPENING') {
      if ((await countLedgerRows(tx, line.itemId, v.warehouseId)) > 0) {
        throw Errors.conflict(
          `Opening stock of ${line.item.code} is allowed only when the item has no other stock movement in this warehouse.`,
        );
      }
      inputs = [
        {
          ...base,
          ...common,
          direction: 'IN',
          qty,
          voucherType: 'OPENING',
          rate: line.unitCost ?? ZERO,
          stockStatus: line.stockStatus as StockStatus,
        },
      ];
    } else if (info.kind === 'TRANSACTION') {
      inputs =
        v.txType === 'Receipt'
          ? [
              {
                ...base,
                ...common,
                direction: 'IN',
                qty,
                voucherType: 'RECEIPT',
                rate: line.unitCost ?? ZERO,
                stockStatus:
                  line.stockStatus === 'UNRESTRICTED'
                    ? undefined
                    : (line.stockStatus as StockStatus),
              },
            ]
          : [
              {
                ...base,
                ...common,
                direction: 'OUT',
                qty,
                voucherType: 'ISSUE',
                reservationId: line.reservationId,
                fromStatus: 'UNRESTRICTED',
              },
            ];
    } else {
      // Adjustment: count against the quantity as it is now (locked), post only the variance.
      const system = await systemQty(
        tx,
        line.itemId,
        v.warehouseId,
        line.batchId,
        line.batchNo,
        line.binId,
      );
      const counted = line.countedQty ?? ZERO;
      const variance = round3(counted.minus(system));
      const cost = variance.greaterThan(0)
        ? await costOfGain(tx, line.itemId, v.warehouseId, line.item.standardCost)
        : ZERO;
      sysFigures.set(line.id, { system, variance, cost });
      if (variance.greaterThan(0)) {
        inputs = [
          {
            ...base,
            ...common,
            direction: 'IN',
            qty: variance,
            voucherType: 'ADJUSTMENT',
            rate: cost,
            stockStatus: 'UNRESTRICTED',
          },
        ];
      } else if (variance.lessThan(0)) {
        inputs = [
          {
            ...base,
            ...common,
            direction: 'OUT',
            qty: variance.abs(),
            voucherType: 'ADJUSTMENT',
            corrective: true,
          },
        ];
      }
    }
    const rec: MoveRecord = { lineId: line.id, ledgerIds: [], value: ZERO };
    for (const m of inputs) {
      const r = await StockService.postMovement(tx, m);
      for (const e of r.entries) {
        rec.ledgerIds.push(e.id);
        rec.value = rec.value.plus(e.value);
      }
    }
    records.push(rec);
  }

  await StockService.assertEquality(
    tx,
    v.lines.map((l) => ({ warehouseId: v.warehouseId, itemId: l.itemId })),
  );
  const allIds = records.flatMap((r) => r.ledgerIds);
  const counter =
    info.kind === 'OPENING'
      ? 'OPENING_BALANCE_EQUITY'
      : info.kind === 'ADJUSTMENT'
        ? 'STOCK_ADJUSTMENT'
        : v.txType === 'Receipt'
          ? 'GRIR'
          : 'CONSUMPTION_EXPENSE';
  const journal = await StockGl.post(tx, {
    voucherId: v.id,
    voucherNo: v.number,
    unitId: v.unitId,
    postingDate: date,
    event: `STOCK_${info.kind}_POSTED`,
    voucherType:
      info.kind === 'OPENING'
        ? 'Opening'
        : info.kind === 'ADJUSTMENT'
          ? 'Stock Adjustment'
          : v.txType === 'Receipt'
            ? 'Goods Receipt'
            : 'Delivery',
    counter,
    ledgerIds: allIds,
    narration: `${info.title} ${v.number}`,
    actorId: c.caller.auth.userId,
  });
  let totalValue = ZERO;
  for (const r of records) {
    const f = sysFigures.get(r.lineId);
    // Adjustment value is signed: gains add, losses subtract.
    const val = f ? (f.variance.greaterThan(0) ? r.value : r.value.negated()) : r.value;
    totalValue = totalValue.plus(f ? val : r.value);
    await voucherRepo.setLine(
      r.lineId,
      {
        value: str(round2(val)),
        ledgerIds: r.ledgerIds,
        ...(f
          ? {
              systemQty: str(f.system),
              varianceQty: str(f.variance),
              unitCost: f.cost.isZero() ? null : str(f.cost),
            }
          : {}),
      },
      tx,
    );
  }
  const totalQty = v.lines.reduce((a, l) => a.plus(l.qty ?? ZERO), ZERO);
  await finish(
    c,
    {
      status: 'Posted',
      postedAt: new Date(),
      postedById: c.caller.auth.userId,
      journalId: journal?.id ?? null,
      totalValue: str(round2(totalValue)),
      totalQty: str(totalQty),
    },
    'VOUCHER_POSTED',
    { ledgerEntries: allIds.length, value: num(totalValue), journal: journal?.code ?? null },
  );
}

async function systemQty(
  tx: Db,
  itemId: string,
  warehouseId: string,
  batchId: string | null,
  batchNo: string | null,
  binId: string | null,
): Promise<Dec> {
  let bid = batchId;
  if (!bid && batchNo) {
    bid = (await tx.batch.findFirst({ where: { itemId, batchNo } }))?.id ?? null;
  }
  const r = await tx.$queryRaw<{ q: string }[]>`
    SELECT COALESCE(sum(qty),0)::text AS q FROM stock_slices
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid AND stock_status = 'UNRESTRICTED'
      AND (${bid}::uuid IS NULL OR batch_id = ${bid}::uuid)
      AND (${binId}::uuid IS NULL OR bin_id = ${binId}::uuid)`;
  return D(r[0]?.q ?? '0');
}

/** The unit's transit warehouse (created on first use): stock on the road sits here, valued, on STOCK_IN_TRANSIT. */
export async function transitWarehouseFor(tx: Db, unitId: string, userId: string) {
  const found = await tx.warehouse.findFirst({
    where: { unitId, isTransit: true, deletedAt: null },
  });
  if (found) return found;
  const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
  return tx.warehouse.create({
    data: {
      code: `${unit.code}-TRANSIT`.slice(0, 30),
      name: `${unit.name} Transit`,
      unitId,
      isTransit: true,
      transitForUnitId: unitId,
      createdById: userId,
    },
  });
}

async function doDispatch(c: Ctx): Promise<void> {
  const { v, tx } = c;
  if (v.status !== 'Approved') {
    throw Errors.conflict(
      ['Draft', 'Rejected'].includes(v.status)
        ? 'Submit this transfer for approval first; only an Approved transfer can be dispatched.'
        : `A ${v.status} voucher cannot be dispatched.`,
    );
  }
  assertUnit(c.caller, v);
  if (!v.toWarehouse || !v.toUnitId) throw Errors.notFound('Destination warehouse not found.');
  await assertSameGstin(tx, v.unitId, v.toUnitId);
  await assertCanPost(tx, {
    unitId: v.unitId,
    fyId: v.fyId,
    postingDate: v.postingDate,
    documentStatus: v.status,
    allowedStatuses: ['Approved'],
    action: 'dispatch',
  });
  const transit = await transitWarehouseFor(tx, v.unitId, c.caller.auth.userId);
  await StockService.lockInOrder(
    tx,
    v.lines.flatMap((l) => [
      { warehouseId: v.warehouseId, itemId: l.itemId },
      { warehouseId: transit.id, itemId: l.itemId },
    ]),
  );
  const ids: string[] = [];
  let total = ZERO;
  for (const line of v.lines) {
    const base = moveBase(c, line);
    const out = await StockService.postMovement(tx, {
      ...base,
      direction: 'OUT',
      qty: line.qty ?? ZERO,
      voucherType: 'TRANSFER_OUT',
      warehouseId: v.warehouseId,
      itemId: line.itemId,
      batchId: line.batchId,
      batch: line.batchNo ? { batchNo: line.batchNo } : null,
      binId: line.binId,
      serialNos: Array.isArray(line.serialNos) ? (line.serialNos as string[]) : null,
      reservationId: line.reservationId,
    });
    const detail = [];
    let lineValue = ZERO;
    for (const e of out.entries) {
      const inn = await StockService.postMovement(tx, {
        ...base,
        direction: 'IN',
        qty: e.qty,
        voucherType: 'TRANSFER_IN',
        warehouseId: transit.id,
        itemId: line.itemId,
        batchId: e.batchId,
        rate: e.rate,
        value: e.value,
        stockStatus: 'UNRESTRICTED',
        serialNos: null,
      });
      ids.push(e.id, ...inn.entries.map((x) => x.id));
      detail.push(slim(e));
      lineValue = lineValue.plus(e.value);
    }
    total = total.plus(lineValue);
    await voucherRepo.setLine(
      line.id,
      {
        dispatchedQty: str(line.qty ?? ZERO),
        dispatchRate: lineValue.isZero()
          ? null
          : str(lineValue.div(line.qty ?? 1).toDecimalPlaces(6)),
        dispatchValue: str(lineValue),
        value: str(lineValue),
        ledgerIds: { dispatch: detail },
      },
      tx,
    );
  }
  await StockService.assertEquality(
    tx,
    v.lines.flatMap((l) => [
      { warehouseId: v.warehouseId, itemId: l.itemId },
      { warehouseId: transit.id, itemId: l.itemId },
    ]),
  );
  const journal = await StockGl.post(tx, {
    voucherId: v.id,
    voucherNo: v.number,
    unitId: v.unitId,
    postingDate: isoOf(v.postingDate),
    event: 'STOCK_TRANSFER_DISPATCHED',
    voucherType: 'Other',
    counter: 'INTER_UNIT_CLEARING',
    ledgerIds: ids,
    narration: `Transfer ${v.number} dispatched`,
    actorId: c.caller.auth.userId,
  });
  await finish(
    c,
    {
      status: 'Dispatched',
      transitWarehouseId: transit.id,
      journalId: journal?.id ?? null,
      totalValue: str(round2(total)),
      postedAt: new Date(),
      postedById: c.caller.auth.userId,
    },
    'TRANSFER_DISPATCHED',
    { value: num(total), toUnitId: v.toUnitId },
  );
}

async function doReceive(c: Ctx): Promise<void> {
  const { v, tx } = c;
  if (v.status !== 'Dispatched') notAllowed(v, 'receive');
  assertUnit(c.caller, v, true);
  if (!v.toWarehouse || !v.transitWarehouseId)
    throw Errors.notFound('Destination warehouse not found.');
  if (v.toWarehouse.status !== 'ACTIVE')
    throw Errors.validation({ toWarehouseId: 'The destination warehouse is inactive.' });
  const date = clampToFy(v.fy);
  await assertCanPost(tx, {
    unitId: v.toWarehouse.unitId,
    fyId: v.fyId,
    postingDate: asDate(date),
    documentStatus: v.status,
    allowedStatuses: ['Dispatched'],
    action: 'receive',
  });
  await StockService.lockInOrder(
    tx,
    v.lines.flatMap((l) => [
      { warehouseId: v.transitWarehouseId!, itemId: l.itemId },
      { warehouseId: v.toWarehouseId!, itemId: l.itemId },
    ]),
  );
  const ids: string[] = [];
  for (const line of v.lines) {
    const detail =
      (line.ledgerIds as { dispatch?: ReturnType<typeof slim>[] } | null)?.dispatch ?? [];
    for (const d of detail) {
      const out = await StockService.postMovement(tx, {
        direction: 'OUT',
        qty: D(d.qty),
        voucherType: 'TRANSFER_OUT',
        warehouseId: v.transitWarehouseId,
        itemId: line.itemId,
        batchId: d.batchId,
        postingDate: date,
        voucherId: v.id,
        voucherNo: v.number,
        createdById: c.caller.auth.userId,
        lineId: line.id,
        allowBackdate: true,
        outValue: D(d.value),
        outRate: D(d.rate),
      });
      for (const e of out.entries) {
        const inn = await StockService.postMovement(tx, {
          direction: 'IN',
          qty: e.qty,
          voucherType: 'TRANSFER_IN',
          warehouseId: v.toWarehouseId!,
          itemId: line.itemId,
          batchId: e.batchId,
          rate: e.rate,
          value: e.value,
          stockStatus: 'UNRESTRICTED',
          postingDate: date,
          voucherId: v.id,
          voucherNo: v.number,
          createdById: c.caller.auth.userId,
          lineId: line.id,
          allowBackdate: true,
          serialNos: Array.isArray(line.serialNos) ? (line.serialNos as string[]) : null,
        });
        ids.push(e.id, ...inn.entries.map((x) => x.id));
      }
    }
    await voucherRepo.setLine(line.id, { receivedQty: str(line.dispatchedQty ?? ZERO) }, tx);
  }
  await StockService.assertEquality(
    tx,
    v.lines.flatMap((l) => [
      { warehouseId: v.transitWarehouseId!, itemId: l.itemId },
      { warehouseId: v.toWarehouseId!, itemId: l.itemId },
    ]),
  );
  await StockGl.post(tx, {
    voucherId: v.id,
    voucherNo: v.number,
    unitId: v.toWarehouse.unitId,
    postingDate: date,
    event: 'STOCK_TRANSFER_RECEIVED',
    voucherType: 'Other',
    counter: 'INTER_UNIT_CLEARING',
    ledgerIds: ids,
    narration: `Transfer ${v.number} received`,
    actorId: c.caller.auth.userId,
  });
  await finish(c, { status: 'Received' }, 'TRANSFER_RECEIVED', { toWarehouseId: v.toWarehouseId });
}

async function doCancel(c: Ctx): Promise<void> {
  const { v, info, tx } = c;
  const posted = v.status === 'Posted' || (info.kind === 'TRANSFER' && v.status === 'Dispatched');
  const open = ['Draft', 'Rejected', 'Approved'].includes(v.status);
  if (!posted && !open) {
    throw Errors.conflict(
      v.status === 'Pending Approval'
        ? 'Withdraw the approval request first, then cancel.'
        : `A ${v.status} voucher cannot be cancelled.`,
    );
  }
  assertUnit(c.caller, v);
  const reason = (c.body.reason ?? '').trim();
  if (posted && (reason.length < 5 || reason.length > 300)) {
    throw Errors.validation({ reason: 'Give a reason of 5 to 300 characters.' });
  }
  const cancelDate = c.body.cancelDate ?? clampToFy(v.fy);
  if (!isIsoDate(cancelDate)) throw Errors.validation({ cancelDate: 'Enter a valid date.' });
  assertDateInFy(cancelDate, v.fy);
  let reversed = 0;
  let cancelJournal: string | null = null;
  if (posted) {
    await assertCanPost(tx, {
      unitId: v.unitId,
      fyId: v.fyId,
      postingDate: asDate(cancelDate),
      documentStatus: v.status,
      allowedStatuses: ['Posted', 'Dispatched'],
      action: 'cancel',
    });
    const serialsByLine = new Map<string, string[]>();
    for (const l of v.lines)
      if (Array.isArray(l.serialNos)) serialsByLine.set(l.id, l.serialNos as string[]);
    const done = await StockService.reverseVoucher(tx, v.id, {
      voucherNo: v.number,
      postingDate: cancelDate,
      createdById: c.caller.auth.userId,
      serialsByLine,
    });
    reversed = done.length;
    await StockService.assertEquality(
      tx,
      done.map((d) => ({ warehouseId: d.warehouseId, itemId: d.itemId })),
    );
    if (v.journalId) {
      const j = await StockGl.reverse(tx, v.journalId, {
        reason,
        date: cancelDate,
        actorId: c.caller.auth.userId,
      });
      cancelJournal = j.id;
    }
  }
  await finish(
    c,
    {
      status: 'Cancelled',
      cancelledAt: new Date(),
      cancelledById: c.caller.auth.userId,
      cancelDate: asDate(cancelDate),
      cancelReason: reason || null,
      cancelJournalId: cancelJournal,
    },
    'VOUCHER_CANCELLED',
    { from: v.status, reversedEntries: reversed, cancelDate },
  );
}

// ---------------------------------------------------------------------------------------------
// Approval handlers (the ONLY code that writes Pending Approval / Approved / Rejected on a voucher)
// ---------------------------------------------------------------------------------------------
function approvalHandler(info: KindInfo): ApprovalDocHandler {
  const set = (tx: Db, id: string, status: string, userId: string) =>
    tx.$executeRaw`UPDATE stock_vouchers SET status = ${status}, version = version + 1, updated_at = now(),
      updated_by_id = ${userId}::uuid WHERE id = ${id}::uuid AND kind = ${info.kind}`;
  return {
    async snapshot(tx, docId) {
      const rows = await tx.$queryRaw<
        {
          number: string;
          status: string;
          version: number;
          total_value: string | null;
          department: string;
          unit_id: string;
          created_by_id: string;
          fy_status: string;
        }[]
      >`SELECT v.number, v.status, v.version, v.total_value::text, v.department, v.unit_id::text, v.created_by_id::text, fy.status AS fy_status
        FROM stock_vouchers v JOIN financial_years fy ON fy.id = v.fy_id
        WHERE v.id = ${docId}::uuid AND v.kind = ${info.kind} AND v.deleted_at IS NULL FOR UPDATE OF v`;
      const r = rows[0];
      if (!r) return null;
      return {
        code: r.number,
        title: info.title,
        amount: r.total_value,
        department: r.department,
        unitId: r.unit_id,
        createdBy: r.created_by_id,
        status: r.status,
        version: r.version,
        fyOpen: r.fy_status === 'OPEN',
      };
    },
    onSubmitted: async (tx, id, req) => void (await set(tx, id, 'Pending Approval', req.actorId)),
    onApproved: async (tx, id, req) => {
      await set(tx, id, 'Approved', req.actorId);
      await tx.$executeRaw`UPDATE stock_vouchers SET approved_at = now(), approved_by_id = ${req.actorId}::uuid WHERE id = ${id}::uuid`;
    },
    onRejected: async (tx, id, req) => void (await set(tx, id, 'Rejected', req.actorId)),
    onReturned: async (tx, id, req) => void (await set(tx, id, 'Draft', req.actorId)),
  };
}
for (const info of Object.values(KINDS))
  approvalService.register(info.pageId, approvalHandler(info));
