// The four stock vouchers (docs/phase3-4 C2): Opening Stock, Receipt / Issue, Adjustment, Transfer.
// A voucher is a Draft (editable, deletable) until an action posts it: post, dispatch, receive or
// cancel. Actions run in ONE transaction that locks the voucher, writes the ledger entries and
// balances (posting.ts) and the audit row, and honour an Idempotency-Key. Rules: the posting date is
// inside the voucher's financial year and that year is OPEN (409 PERIOD_CLOSED), the warehouse is in
// the context unit (a transfer checks its source; the destination may be any active unit), inactive
// items and warehouses are refused, stock never goes negative (409 INSUFFICIENT_STOCK).
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Db } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import type { FieldErrors } from '../../../core/http/errors';
import { accessUserOf, can, scopeFor } from '../../../core/rbac/access';
import type { PageSchema } from '../../../engine/field-schema';
import { validateRecordInput } from '../../../engine/record-input';
import { isIsoDate } from '../../../engine/validators';
import { recordRepository } from '../../records/repository';
import type { Caller } from '../../records/service';
import { TYPED_SCHEMAS } from '../definitions';
import type { InventoryPageId } from '../definitions';
import { D, ZERO, num, round2, round3, str } from '../money';
import type { Dec } from '../money';
import {
  countLedgerRows,
  lockBalance,
  postMovement,
  readBalance,
  reverseVoucher,
} from '../stock/posting';
import { concreteUnit, undoTokenOf, unitFilter, userNames, writeAudit } from '../typed';
import type {
  ActionBody,
  ListResult,
  TypedHandler,
  TypedListQuery,
  TypedRecordDto,
} from '../typed';
import { voucherRepository as repo, whereOf } from './repository';
import type { VoucherFull } from './repository';

type Kind = 'OPENING' | 'TRANSACTION' | 'ADJUSTMENT' | 'TRANSFER';

interface KindInfo {
  kind: Kind;
  prefix: string;
  numberKey: string;
  schema: PageSchema;
}

const KINDS: Record<string, KindInfo> = {
  'inv-opening': kindInfo('OPENING', 'OPN', 'openingRef', 'inv-opening'),
  'inv-transactions': kindInfo('TRANSACTION', 'TXN', 'transactionNo', 'inv-transactions'),
  'inv-adjustment': kindInfo('ADJUSTMENT', 'ADJ', 'adjustmentNo', 'inv-adjustment'),
  'inv-transfer': kindInfo('TRANSFER', 'TRF', 'transferNo', 'inv-transfer'),
};

function kindInfo(kind: Kind, prefix: string, numberKey: string, page: InventoryPageId): KindInfo {
  return { kind, prefix, numberKey, schema: TYPED_SCHEMAS[page] as unknown as PageSchema };
}

const TX = { maxWait: 15_000, timeout: 15_000 };

// ---------------------------------------------------------------------------------------------
// Dates and the financial year
// ---------------------------------------------------------------------------------------------
const isoOf = (d: Date): string => d.toISOString().slice(0, 10);

/** Today, moved into the financial year when it falls outside (a default posting date). */
function clampToFy(fy: { startDate: Date; endDate: Date }, today = new Date()): string {
  const t = isoOf(today);
  if (t < isoOf(fy.startDate)) return isoOf(fy.startDate);
  if (t > isoOf(fy.endDate)) return isoOf(fy.endDate);
  return t;
}

async function loadContextFy(caller: Caller) {
  const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
  if (!fy) throw Errors.contextInvalid('Unknown financial year.');
  return fy;
}

function assertOpen(fy: { code: string; status: string }): void {
  if (fy.status !== 'OPEN') throw Errors.periodClosed(`Financial year ${fy.code} is closed.`);
}

function assertDateInFy(date: string, fy: { startDate: Date; endDate: Date; code: string }): void {
  if (date < isoOf(fy.startDate) || date > isoOf(fy.endDate)) {
    throw Errors.validation({
      postingDate: `The posting date must lie inside financial year ${fy.code}.`,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Form data <-> columns
// ---------------------------------------------------------------------------------------------
type Form = Record<string, unknown>;

interface Parsed {
  postingDate: string;
  itemId: string;
  warehouseId: string;
  toWarehouseId: string | null;
  txType: string | null;
  reference: string | null;
  batchSerial: string | null;
  qty: Dec;
  countedQty: Dec | null;
  unitCost: Dec | null;
  reasonCode: string | null;
  approver: string | null;
  vehicleRef: string | null;
  expectedReceipt: string | null;
}

const str0 = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const dec0 = (v: unknown): Dec | null => (typeof v === 'number' ? D(v) : null);

/** The form (field keys) of a stored voucher, for edits and for the DTO. */
function formOf(info: KindInfo, v: VoucherFull): Form {
  const date = isoOf(v.postingDate);
  switch (info.kind) {
    case 'OPENING':
      return {
        postingDate: date,
        warehouse: v.warehouseId,
        item: v.itemId,
        batchSerial: v.batchSerial,
        openingQty: num(v.qty),
        unitCost: num(v.unitCost),
      };
    case 'TRANSACTION':
      return {
        postingDate: date,
        transactionType: v.txType,
        reference: v.reference,
        item: v.itemId,
        warehouse: v.warehouseId,
        batchSerial: v.batchSerial,
        qty: num(v.qty),
        unitCost: v.txType === 'Receipt' ? num(v.unitCost) : null,
      };
    case 'ADJUSTMENT':
      return {
        postingDate: date,
        warehouse: v.warehouseId,
        item: v.itemId,
        countedQty: num(v.countedQty),
        reasonCode: v.reasonCode,
        approver: v.approver,
      };
    default:
      return {
        postingDate: date,
        sourceWarehouse: v.warehouseId,
        destinationWarehouse: v.toWarehouseId,
        item: v.itemId,
        requestedQty: num(v.qty),
        vehicleRef: v.vehicleRef,
        expectedReceipt: v.expectedReceipt ? isoOf(v.expectedReceipt) : null,
      };
  }
}

function parseForm(info: KindInfo, f: Form, defaultDate: string): Parsed {
  const p: Parsed = {
    postingDate: str0(f.postingDate) ?? defaultDate,
    itemId: str0(f.item) ?? '',
    warehouseId: '',
    toWarehouseId: null,
    txType: null,
    reference: null,
    batchSerial: str0(f.batchSerial),
    qty: ZERO,
    countedQty: null,
    unitCost: null,
    reasonCode: null,
    approver: null,
    vehicleRef: null,
    expectedReceipt: null,
  };
  switch (info.kind) {
    case 'OPENING':
      p.warehouseId = str0(f.warehouse) ?? '';
      p.qty = dec0(f.openingQty) ?? ZERO;
      p.unitCost = dec0(f.unitCost);
      break;
    case 'TRANSACTION':
      p.warehouseId = str0(f.warehouse) ?? '';
      p.txType = str0(f.transactionType);
      p.reference = str0(f.reference);
      p.qty = dec0(f.qty) ?? ZERO;
      p.unitCost = p.txType === 'Receipt' ? dec0(f.unitCost) : null;
      break;
    case 'ADJUSTMENT':
      p.warehouseId = str0(f.warehouse) ?? '';
      p.countedQty = dec0(f.countedQty);
      p.qty = p.countedQty ?? ZERO;
      p.reasonCode = str0(f.reasonCode);
      p.approver = str0(f.approver);
      break;
    default:
      p.warehouseId = str0(f.sourceWarehouse) ?? '';
      p.toWarehouseId = str0(f.destinationWarehouse);
      p.qty = dec0(f.requestedQty) ?? ZERO;
      p.vehicleRef = str0(f.vehicleRef);
      p.expectedReceipt = str0(f.expectedReceipt);
  }
  return p;
}

/** Field key that carries each column, for error messages. */
const KEY = {
  OPENING: { qty: 'openingQty', warehouse: 'warehouse' },
  TRANSACTION: { qty: 'qty', warehouse: 'warehouse' },
  ADJUSTMENT: { qty: 'countedQty', warehouse: 'warehouse' },
  TRANSFER: { qty: 'requestedQty', warehouse: 'sourceWarehouse' },
} as const;

/**
 * Checks a parsed voucher against the master data and the context: active item, active warehouses,
 * the (source) warehouse in the context unit, qty > 0, a unit cost where it is needed, the posting
 * date inside the FY. Returns what the row needs (unit ids).
 */
async function checkParsed(
  info: KindInfo,
  p: Parsed,
  ctxUnitId: string,
  fy: { startDate: Date; endDate: Date; code: string },
) {
  const keys = KEY[info.kind];
  const errors: FieldErrors = {};
  if (!isIsoDate(p.postingDate)) errors.postingDate = 'Enter a valid date (YYYY-MM-DD).';
  else {
    try {
      assertDateInFy(p.postingDate, fy);
    } catch {
      errors.postingDate = `The posting date must lie inside financial year ${fy.code}.`;
    }
  }
  if (info.kind === 'ADJUSTMENT') {
    if (p.countedQty === null || p.countedQty.lessThan(0))
      errors.countedQty = 'Enter the counted quantity (0 or more).';
  } else if (p.qty.lessThanOrEqualTo(0)) {
    errors[keys.qty] = 'Enter a quantity greater than 0.';
  }
  if (info.kind === 'OPENING' && (p.unitCost === null || p.unitCost.lessThan(0))) {
    errors.unitCost = 'Enter the unit cost (0 or more).';
  }
  if (info.kind === 'TRANSACTION') {
    if (p.txType === 'Receipt' && (p.unitCost === null || p.unitCost.lessThan(0))) {
      errors.unitCost = 'Enter the unit cost of the receipt (0 or more).';
    }
  }
  const [item, warehouse, toWarehouse] = await Promise.all([
    prisma.item.findFirst({ where: { id: p.itemId, deletedAt: null } }),
    prisma.warehouse.findFirst({ where: { id: p.warehouseId, deletedAt: null } }),
    p.toWarehouseId
      ? prisma.warehouse.findFirst({ where: { id: p.toWarehouseId, deletedAt: null } })
      : Promise.resolve(null),
  ]);
  if (!item || item.status !== 'ACTIVE') errors.item = 'Choose an active item.';
  if (!warehouse || warehouse.status !== 'ACTIVE')
    errors[keys.warehouse] = 'Choose an active warehouse.';
  else if (warehouse.unitId !== ctxUnitId) {
    errors[keys.warehouse] = 'This warehouse belongs to another unit. Switch unit first.';
  }
  if (info.kind === 'TRANSFER') {
    if (!toWarehouse || toWarehouse.status !== 'ACTIVE') {
      errors.destinationWarehouse = 'Choose an active destination warehouse.';
    } else if (toWarehouse.id === p.warehouseId) {
      errors.destinationWarehouse = 'The destination must differ from the source.';
    }
  }
  if (Object.keys(errors).length > 0) throw Errors.validation(errors);
  return { item: item!, warehouse: warehouse!, toWarehouse };
}

// ---------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------
async function toDtos(info: KindInfo, rows: VoucherFull[]): Promise<TypedRecordDto[]> {
  const names = await userNames(rows.map((r) => r.createdById));
  const out: TypedRecordDto[] = [];
  for (const v of rows) {
    const form = formOf(info, v);
    const data: Form = { ...form, status: v.status };
    switch (info.kind) {
      case 'OPENING':
        data.openingRef = v.number;
        data.financialYear = v.fy.label;
        data.openingValue =
          v.value !== null ? num(v.value) : num(round2(v.qty.times(v.unitCost ?? ZERO)));
        data.valuationMethod = 'Moving Average';
        break;
      case 'TRANSACTION':
        data.transactionNo = v.number;
        data.unitCost = num(v.unitCost);
        data.value = num(v.value);
        break;
      case 'ADJUSTMENT': {
        data.adjustmentNo = v.number;
        if (v.status === 'Draft') {
          const live = await liveAdjustment(v);
          data.systemQty = num(live.system);
          data.varianceQty = num(live.variance);
          data.unitCost = num(live.cost);
          data.valueImpact = num(live.impact);
        } else {
          data.systemQty = num(v.systemQty);
          data.varianceQty = num(v.varianceQty);
          data.unitCost = num(v.unitCost);
          data.valueImpact = num(v.value);
        }
        break;
      }
      default:
        data.transferNo = v.number;
        data.dispatchedQty = num(v.dispatchedQty);
        data.receivedQty = num(v.receivedQty);
        data.inTransit =
          v.status === 'Dispatched' ? num(v.dispatchedQty) : v.status === 'Received' ? 0 : null;
    }
    const refs: TypedRecordDto['refs'] = {
      item: { id: v.item.id, code: v.item.code, name: v.item.name },
    };
    const wKey = KEY[info.kind].warehouse;
    refs[wKey] = { id: v.warehouse.id, code: v.warehouse.code, name: v.warehouse.name };
    if (v.toWarehouse) {
      refs.destinationWarehouse = {
        id: v.toWarehouse.id,
        code: v.toWarehouse.code,
        name: v.toWarehouse.name,
      };
    }
    out.push({
      id: v.id,
      code: v.number,
      status: v.status,
      unitId: v.unitId,
      fyId: v.fyId,
      department: v.department,
      data,
      version: v.version,
      amount: num(v.value),
      createdAt: v.createdAt.toISOString(),
      createdBy: { id: v.createdById, name: names.get(v.createdById) ?? '' },
      updatedAt: v.updatedAt.toISOString(),
      deletedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
      refs,
    });
  }
  return out;
}

/** For a Draft adjustment: the figures it would post right now. */
async function liveAdjustment(
  v: Pick<VoucherFull, 'itemId' | 'warehouseId' | 'countedQty' | 'item'>,
) {
  const bal = await readBalance(prisma, v.itemId, v.warehouseId);
  const counted = v.countedQty ?? ZERO;
  const variance = round3(counted.minus(bal.onHand));
  const cost = adjustmentCost(bal.avgRate, v.item.standardCost);
  const impact = round2(variance.times(cost));
  return { system: bal.onHand, variance, cost, impact };
}

/** Variance > 0 comes in at the average rate, or at the standard cost when there is no average yet. */
function adjustmentCost(avgRate: Dec, standardCost: Dec | null): Dec {
  return avgRate.greaterThan(0) ? avgRate : (standardCost ?? ZERO);
}

// ---------------------------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------------------------
async function filterFor(caller: Caller, info: KindInfo, pageId: string, deleted: boolean) {
  const user = caller.auth.user;
  const [scope, control] = await Promise.all([
    scopeFor(accessUserOf(user), pageId),
    prisma.moduleControl.findUnique({ where: { pageId }, select: { ownerDepartment: true } }),
  ]);
  const units = unitFilter(caller);
  return {
    kind: info.kind,
    unitId: units.unitId,
    none: units.none,
    deleted,
    scope: {
      ...(scope === 'OWN' ? { ownUserId: user.id } : {}),
      department: user.department,
      anyDepartment:
        scope === 'ALL' || (scope === 'DEPARTMENT' && control?.ownerDepartment === user.department),
    },
  };
}

async function load(
  caller: Caller,
  info: KindInfo,
  pageId: string,
  id: string,
  deleted = false,
  db: Db = prisma,
): Promise<VoucherFull> {
  const filter = await filterFor(caller, info, pageId, deleted);
  const where = { AND: [whereOf(filter), { id }] };
  const row = await repo.find(where, db);
  if (!row) throw Errors.notFound('Record not found.');
  return row;
}

const SORT_COLUMNS: Record<string, string> = {
  code: 'number',
  postingDate: 'postingDate',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  amount: 'value',
};

function orderBy(info: KindInfo, sort: string): Prisma.StockVoucherOrderByWithRelationInput[] {
  const desc = sort.startsWith('-');
  const name = desc ? sort.slice(1) : sort;
  const column = name === info.numberKey ? 'number' : SORT_COLUMNS[name];
  if (!column) {
    throw Errors.validation({
      sort: 'Sort by the number, postingDate, status, amount, createdAt or updatedAt.',
    });
  }
  return [{ [column]: desc ? 'desc' : 'asc' }, { id: 'asc' }];
}

// ---------------------------------------------------------------------------------------------
// The handler (list / get / create / patch / delete / restore)
// ---------------------------------------------------------------------------------------------
function numbered(info: KindInfo, unitCode: string, fyCode: string, n: number): string {
  return `${info.prefix}/${unitCode}/${fyCode.slice(2)}/${String(n).padStart(4, '0')}`;
}

function columnsOf(info: KindInfo, p: Parsed, extra: { toUnitId: string | null }) {
  return {
    postingDate: new Date(`${p.postingDate}T00:00:00Z`),
    itemId: p.itemId,
    warehouseId: p.warehouseId,
    toWarehouseId: p.toWarehouseId,
    toUnitId: extra.toUnitId,
    txType: p.txType,
    reference: p.reference,
    batchSerial: p.batchSerial,
    qty: info.kind === 'ADJUSTMENT' ? ZERO : p.qty,
    countedQty: p.countedQty,
    unitCost: p.unitCost,
    reasonCode: p.reasonCode,
    approver: p.approver,
    vehicleRef: p.vehicleRef,
    expectedReceipt: p.expectedReceipt ? new Date(`${p.expectedReceipt}T00:00:00Z`) : null,
  };
}

async function one(info: KindInfo, row: VoucherFull): Promise<TypedRecordDto> {
  const [dto] = await toDtos(info, [row]);
  if (!dto) throw Errors.notFound('Record not found.');
  return dto;
}

function makeHandler(pageId: string): TypedHandler {
  const info = KINDS[pageId];
  if (!info) throw new Error(`No voucher kind for ${pageId}`);
  return {
    pageId,

    async list(caller, query: TypedListQuery): Promise<ListResult> {
      const filter = await filterFor(caller, info, pageId, query.deleted === true);
      const where = whereOf({
        ...filter,
        ...(query.q ? { q: query.q } : {}),
        ...(query.status ? { status: query.status } : {}),
      });
      const { rows, total } = await repo.list(where, orderBy(info, query.sort), {
        skip: (query.page - 1) * query.size,
        take: query.size,
      });
      return { rows: await toDtos(info, rows), total };
    },

    async get(caller, id) {
      return one(info, await load(caller, info, pageId, id));
    },

    async create(caller, input) {
      const unitId = concreteUnit(caller);
      const fy = await loadContextFy(caller);
      assertOpen(fy);
      const v = validateRecordInput(info.schema, input, 'create');
      const parsed = parseForm(info, v.values, clampToFy(fy));
      const found = await checkParsed(info, parsed, unitId, fy);
      const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } });
      const user = caller.auth.user;
      const created = await prisma.$transaction(async (tx) => {
        const n = await recordRepository.nextNumber(pageId, unitId, fy.id, tx);
        const number = numbered(info, unit.code, fy.code, n);
        const row = await repo.create(
          {
            ...columnsOf(info, parsed, { toUnitId: found.toWarehouse?.unitId ?? null }),
            kind: info.kind,
            number,
            status: 'Draft',
            unitId,
            fyId: fy.id,
            department: user.department ?? 'Administration',
            createdById: user.id,
          } as Prisma.StockVoucherUncheckedCreateInput,
          tx,
        );
        await writeAudit(
          tx,
          caller,
          'VOUCHER_CREATED',
          'Voucher',
          { id: row.id, code: number },
          pageId,
          {
            unitId,
            after: JSON.parse(JSON.stringify(v.values)) as Prisma.InputJsonObject,
          },
        );
        return row.id;
      }, TX);
      return one(info, await load(caller, info, pageId, created));
    },

    async update(caller, id, version, input) {
      const unitId = concreteUnit(caller);
      const current = await load(caller, info, pageId, id);
      if (current.status !== 'Draft') {
        throw Errors.recordLocked(`A ${current.status} voucher cannot be edited.`);
      }
      if (version !== current.version) throw Errors.versionConflict();
      const fy = current.fy;
      assertOpen(fy);
      const v = validateRecordInput(info.schema, input, 'patch');
      const form = { ...formOf(info, current), ...v.values };
      for (const key of v.cleared) form[key] = null;
      const parsed = parseForm(info, form, isoOf(current.postingDate));
      const found = await checkParsed(info, parsed, unitId, fy);
      const before = formOf(info, current);
      const changed = Object.keys(form).filter(
        (k) => JSON.stringify(form[k]) !== JSON.stringify(before[k]),
      );
      if (changed.length === 0) return one(info, current);
      const updated = await prisma.$transaction(async (tx) => {
        const ok = await repo.updateIfVersion(
          id,
          version,
          {
            ...columnsOf(info, parsed, { toUnitId: found.toWarehouse?.unitId ?? null }),
            updatedById: caller.auth.userId,
          } as Prisma.StockVoucherUncheckedUpdateManyInput,
          tx,
        );
        if (!ok) throw Errors.versionConflict();
        await writeAudit(
          tx,
          caller,
          'VOUCHER_UPDATED',
          'Voucher',
          { id, code: current.number },
          pageId,
          {
            unitId: current.unitId,
            before: Object.fromEntries(
              changed.map((k) => [k, before[k] ?? null]),
            ) as Prisma.InputJsonObject,
            after: Object.fromEntries(
              changed.map((k) => [k, form[k] ?? null]),
            ) as Prisma.InputJsonObject,
          },
        );
        return load(caller, info, pageId, id, false, tx);
      }, TX);
      return one(info, updated);
    },

    async remove(caller, id, version) {
      concreteUnit(caller);
      const current = await load(caller, info, pageId, id);
      if (current.status !== 'Draft') {
        throw Errors.recordLocked(`A ${current.status} voucher cannot be deleted.`);
      }
      if (version !== undefined && version !== current.version) throw Errors.versionConflict();
      assertOpen(current.fy);
      const at = new Date();
      await prisma.$transaction(async (tx) => {
        if (!(await repo.softDelete(id, caller.auth.userId, at, tx))) {
          throw Errors.recordLocked('Only a Draft voucher can be deleted.');
        }
        await writeAudit(
          tx,
          caller,
          'VOUCHER_DELETED',
          'Voucher',
          { id, code: current.number },
          pageId,
          {
            unitId: current.unitId,
          },
        );
      }, TX);
      return { undoToken: undoTokenOf(id, at) };
    },

    async restore(caller, id, token) {
      concreteUnit(caller);
      const current = await load(caller, info, pageId, id, true);
      if (
        token !== undefined &&
        current.deletedAt &&
        token !== undoTokenOf(id, current.deletedAt)
      ) {
        throw Errors.validation({
          undoToken: 'This undo token does not match the deleted voucher.',
        });
      }
      assertOpen(current.fy);
      const restored = await prisma.$transaction(async (tx) => {
        if (!(await repo.restore(id, caller.auth.userId, tx)))
          throw Errors.notFound('Record not found.');
        await writeAudit(
          tx,
          caller,
          'VOUCHER_RESTORED',
          'Voucher',
          { id, code: current.number },
          pageId,
          {
            unitId: current.unitId,
          },
        );
        return load(caller, info, pageId, id, false, tx);
      }, TX);
      return one(info, restored);
    },

    async action(caller, id, actionKey, body, idempotencyKey) {
      return runAction(caller, info, pageId, id, actionKey, body, idempotencyKey);
    },

    async exportRows(caller, query) {
      return this.list(caller, { ...query, page: 1, size: 10_000 });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------
const ACTIONS_OF: Record<Kind, readonly string[]> = {
  OPENING: ['post', 'cancel'],
  TRANSACTION: ['post', 'cancel'],
  ADJUSTMENT: ['post', 'cancel'],
  TRANSFER: ['dispatch', 'receive', 'cancel'],
};

interface Ctx {
  caller: Caller;
  info: KindInfo;
  pageId: string;
  tx: Db;
  v: VoucherFull;
  body: ActionBody;
}

function notAllowed(v: VoucherFull, action: string): never {
  throw Errors.conflict(
    `A ${v.status} voucher cannot be ${action === 'cancel' ? 'cancelled' : `${action}ed`}.`,
  );
}

/** The context unit must be the voucher's unit (receiving a transfer: either end). */
function assertUnit(caller: Caller, v: VoucherFull, allowDestination = false): void {
  const unitId = concreteUnit(caller);
  const ok =
    unitId === v.unitId || (allowDestination && v.toUnitId !== null && unitId === v.toUnitId);
  if (!ok) throw Errors.contextInvalid('Switch to the unit of this voucher first.');
}

function assertUsable(v: VoucherFull, which: { destination?: boolean } = {}): void {
  if (v.item.status !== 'ACTIVE' || v.item.deletedAt) {
    throw Errors.validation({ item: 'This item is inactive.' });
  }
  const w = which.destination ? v.toWarehouse : v.warehouse;
  if (!w || w.status !== 'ACTIVE' || w.deletedAt) {
    throw Errors.validation({
      [which.destination ? 'destinationWarehouse' : KEY[v.kind as Kind].warehouse]:
        'This warehouse is inactive.',
    });
  }
}

async function finish(
  c: Ctx,
  data: Prisma.StockVoucherUncheckedUpdateManyInput,
  auditAction: 'VOUCHER_POSTED' | 'VOUCHER_CANCELLED' | 'TRANSFER_DISPATCHED' | 'TRANSFER_RECEIVED',
  detail: Prisma.InputJsonObject,
): Promise<void> {
  const ok = await repo.updateIfVersion(
    c.v.id,
    c.v.version,
    { ...data, updatedById: c.caller.auth.userId },
    c.tx,
  );
  if (!ok) throw Errors.versionConflict();
  await writeAudit(
    c.tx,
    c.caller,
    auditAction,
    'Voucher',
    { id: c.v.id, code: c.v.number },
    c.pageId,
    {
      unitId: c.v.unitId,
      ...detail,
    },
  );
}

async function doPost(c: Ctx): Promise<void> {
  const { v, info, tx } = c;
  if (v.status !== 'Draft') notAllowed(v, 'post');
  assertUnit(c.caller, v);
  assertUsable(v);
  const date = isoOf(v.postingDate);
  const base = {
    unitId: v.unitId,
    warehouseId: v.warehouseId,
    itemId: v.itemId,
    postingDate: date,
    voucherId: v.id,
    voucherNo: v.number,
    createdById: c.caller.auth.userId,
  };
  const now = new Date();
  const posted = { status: 'Posted', postedAt: now, postedById: c.caller.auth.userId };

  if (info.kind === 'OPENING') {
    // Opening stock is allowed only before any other movement of the item in the warehouse.
    if ((await countLedgerRows(tx, v.itemId, v.warehouseId)) > 0) {
      throw Errors.conflict(
        'Opening stock is allowed only when the item has no other stock movement in this warehouse.',
      );
    }
    const e = await postMovement(tx, {
      ...base,
      voucherType: 'OPENING',
      qtyIn: v.qty,
      rate: v.unitCost ?? ZERO,
    });
    await finish(c, { ...posted, value: str(e.value) }, 'VOUCHER_POSTED', {
      ledgerEntries: 1,
      value: num(e.value),
    });
    return;
  }
  if (info.kind === 'TRANSACTION') {
    if (v.txType === 'Receipt') {
      const e = await postMovement(tx, {
        ...base,
        voucherType: 'RECEIPT',
        qtyIn: v.qty,
        rate: v.unitCost ?? ZERO,
      });
      await finish(c, { ...posted, value: str(e.value) }, 'VOUCHER_POSTED', {
        ledgerEntries: 1,
        value: num(e.value),
      });
    } else {
      const e = await postMovement(tx, { ...base, voucherType: 'ISSUE', qtyOut: v.qty });
      await finish(c, { ...posted, unitCost: str(e.rate), value: str(e.value) }, 'VOUCHER_POSTED', {
        ledgerEntries: 1,
        value: num(e.value),
      });
    }
    return;
  }
  // Adjustment: count against the balance as it is right now (locked), then post only the variance.
  const bal = await lockBalance(tx, v.itemId, v.warehouseId);
  const counted = v.countedQty ?? ZERO;
  const variance = round3(counted.minus(bal.onHand));
  const cost = adjustmentCost(bal.avgRate, v.item.standardCost);
  let impact = ZERO;
  if (variance.greaterThan(0)) {
    const e = await postMovement(tx, {
      ...base,
      voucherType: 'ADJUSTMENT',
      qtyIn: variance,
      rate: cost,
    });
    impact = e.value;
  } else if (variance.lessThan(0)) {
    const e = await postMovement(tx, {
      ...base,
      voucherType: 'ADJUSTMENT',
      qtyOut: variance.abs(),
    });
    impact = e.value.negated();
  }
  await finish(
    c,
    {
      ...posted,
      systemQty: str(bal.onHand),
      varianceQty: str(variance),
      unitCost: str(cost),
      value: str(impact),
    },
    'VOUCHER_POSTED',
    {
      ledgerEntries: variance.isZero() ? 0 : 1,
      systemQty: num(bal.onHand),
      varianceQty: num(variance),
      value: num(impact),
    },
  );
}

async function doDispatch(c: Ctx): Promise<void> {
  const { v, tx, body } = c;
  if (v.status !== 'Draft') notAllowed(v, 'dispatch');
  assertUnit(c.caller, v);
  assertUsable(v);
  const requested = v.qty;
  const qty = body.dispatchedQty !== undefined ? round3(D(body.dispatchedQty)) : requested;
  if (qty.lessThanOrEqualTo(0) || qty.greaterThan(requested)) {
    throw Errors.validation({
      dispatchedQty: `Dispatch more than 0 and at most the requested ${str(requested)}.`,
    });
  }
  const e = await postMovement(tx, {
    unitId: v.unitId,
    warehouseId: v.warehouseId,
    itemId: v.itemId,
    postingDate: isoOf(v.postingDate),
    voucherType: 'TRANSFER_OUT',
    voucherId: v.id,
    voucherNo: v.number,
    createdById: c.caller.auth.userId,
    qtyOut: qty,
  });
  await finish(
    c,
    {
      status: 'Dispatched',
      dispatchedQty: str(qty),
      dispatchRate: str(e.rate),
      dispatchValue: str(e.value),
      value: str(e.value),
      postedAt: new Date(),
      postedById: c.caller.auth.userId,
    },
    'TRANSFER_DISPATCHED',
    { dispatchedQty: num(qty), value: num(e.value), toUnitId: v.toUnitId },
  );
}

async function doReceive(c: Ctx): Promise<void> {
  const { v, tx, body } = c;
  if (v.status !== 'Dispatched') notAllowed(v, 'receive');
  assertUnit(c.caller, v, true);
  assertUsable(v, { destination: true });
  const dispatched = v.dispatchedQty ?? ZERO;
  const received = body.receivedQty !== undefined ? round3(D(body.receivedQty)) : dispatched;
  if (!received.equals(dispatched)) {
    throw Errors.validation({
      receivedQty: `Received Qty must equal the dispatched ${str(dispatched)}.`,
    });
  }
  const destination = v.toWarehouse;
  if (!destination || !v.toWarehouseId) throw Errors.notFound('Destination warehouse not found.');
  // Received into the destination at the dispatch rate and value; dated today inside the voucher's FY.
  const e = await postMovement(tx, {
    unitId: destination.unitId,
    warehouseId: v.toWarehouseId,
    itemId: v.itemId,
    postingDate: clampToFy(v.fy),
    voucherType: 'TRANSFER_IN',
    voucherId: v.id,
    voucherNo: v.number,
    createdById: c.caller.auth.userId,
    qtyIn: dispatched,
    rate: v.dispatchRate ?? ZERO,
    value: v.dispatchValue ?? ZERO,
  });
  await finish(c, { status: 'Received', receivedQty: str(received) }, 'TRANSFER_RECEIVED', {
    receivedQty: num(received),
    value: num(e.value),
    toWarehouseId: v.toWarehouseId,
  });
}

async function doCancel(c: Ctx): Promise<void> {
  const { v, info, tx } = c;
  const cancellable =
    info.kind === 'TRANSFER' ? ['Draft', 'Dispatched'].includes(v.status) : v.status === 'Posted';
  if (!cancellable) notAllowed(v, 'cancel');
  assertUnit(c.caller, v);
  let reversed = 0;
  if (v.status !== 'Draft') {
    reversed = await reverseVoucher(tx, v.id, {
      voucherNo: v.number,
      postingDate: clampToFy(v.fy),
      createdById: c.caller.auth.userId,
    });
  }
  await finish(c, { status: 'Cancelled' }, 'VOUCHER_CANCELLED', {
    from: v.status,
    reversedEntries: reversed,
  });
}

async function runAction(
  caller: Caller,
  info: KindInfo,
  pageId: string,
  id: string,
  actionKey: string,
  body: ActionBody,
  idempotencyKey: string | undefined,
): Promise<{ record: TypedRecordDto; replay: boolean }> {
  if (!ACTIONS_OF[info.kind].includes(actionKey)) throw Errors.notFound('Unknown action.');
  const user = caller.auth.user;
  const requestHash = createHash('sha256')
    .update(JSON.stringify([pageId, id, actionKey, body]))
    .digest('hex');
  const result = await prisma.$transaction(async (tx) => {
    // Visible to the caller? (404 otherwise.) Then serialise everything that touches this voucher.
    await load(caller, info, pageId, id, false, tx);
    await repo.lock(id, tx);
    if (idempotencyKey) {
      await recordRepository.lockIdempotency(user.id, idempotencyKey, tx);
      const seen = await recordRepository.findIdempotency(user.id, idempotencyKey, tx);
      if (seen) {
        if (seen.requestHash !== requestHash) {
          throw Errors.conflict('This Idempotency-Key was already used for a different request.');
        }
        return { replay: true as const, voucher: await load(caller, info, pageId, id, false, tx) };
      }
    }
    const v = await load(caller, info, pageId, id, false, tx);
    // Undoing stock that already moved (cancel of anything but a Draft) needs `delete` on the page.
    if (actionKey === 'cancel' && v.status !== 'Draft') {
      const user = caller.auth.user;
      if (!(await can(accessUserOf(user), pageId, 'delete'))) throw Errors.forbidden();
    }
    // The financial year of the voucher must be open for every action, cancel included.
    assertOpen(v.fy);
    assertDateInFy(isoOf(v.postingDate), v.fy);
    const c: Ctx = { caller, info, pageId, tx, v, body };
    if (actionKey === 'post') await doPost(c);
    else if (actionKey === 'dispatch') await doDispatch(c);
    else if (actionKey === 'receive') await doReceive(c);
    else await doCancel(c);
    if (idempotencyKey) {
      await recordRepository.saveIdempotency(
        { userId: user.id, key: idempotencyKey, requestHash, recordId: id },
        tx,
      );
    }
    return { replay: false as const, voucher: await load(caller, info, pageId, id, false, tx) };
  }, TX);
  return { record: await one(info, result.voucher), replay: result.replay };
}

export const openingHandler = makeHandler('inv-opening');
export const transactionHandler = makeHandler('inv-transactions');
export const adjustmentHandler = makeHandler('inv-adjustment');
export const transferHandler = makeHandler('inv-transfer');
