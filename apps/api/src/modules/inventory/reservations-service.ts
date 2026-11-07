// Reservations and holds (Phase 8 step 7). A reservation earmarks unrestricted stock for a demand (sales order,
// production order, ...): reserved_qty lives on stock_balances and the allocator serves waiting demands in
// priority order whenever stock arrives or is freed. A hold blocks a quantity from issue without a demand.
// Both honour BR-INV-03 (available = unrestricted - reserved - held), run under the balance row lock, and never
// touch the ledger: only an issue that names the reservation consumes it (StockService).
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { escapeLike } from '../../core/http/query-safety';
import { NumberingService } from '../../core/numbering';
import type { Caller } from '../records/service';
import { D, num, round3, str } from './money';
import { availability, lockInOrder, runAllocator } from './stock/stock-service';
import { concreteUnit, writeAudit } from './typed';

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
const isoOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function policyDays(db: Db): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: 'inventory.policy' } });
  const v = (s?.value ?? {}) as { reservationDays?: number };
  return v.reservationDays ?? 14;
}

export interface ReservationInput {
  itemId: string;
  warehouseId: string;
  batchId?: string | null;
  requiredQty: number | string;
  priority?: (typeof PRIORITIES)[number];
  reservedUntil?: string | null;
  demandType?: string;
  demandRef?: string | null;
}

function dto(
  r: Prisma.StockReservationGetPayload<object>,
  extra: { itemCode?: string; itemName?: string; warehouseCode?: string } = {},
) {
  return {
    id: r.id,
    code: r.code,
    unitId: r.unitId,
    itemId: r.itemId,
    warehouseId: r.warehouseId,
    batchId: r.batchId,
    demandType: r.demandType,
    demandRef: r.demandRef,
    priority: r.priority,
    requiredQty: num(r.requiredQty),
    reservedQty: num(r.reservedQty),
    fulfilledQty: num(r.fulfilledQty),
    reservedUntil: isoOf(r.reservedUntil),
    status: r.status,
    releaseReason: r.releaseReason,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    ...extra,
  };
}

export const reservationService = {
  async list(
    caller: Caller,
    q: {
      q?: string;
      status?: string;
      itemId?: string;
      warehouseId?: string;
      page: number;
      size: number;
    },
  ) {
    const unitId = caller.ctx.unitId;
    const where: Prisma.StockReservationWhereInput = {
      ...(unitId ? { unitId } : caller.ctx.allUnits ? {} : { id: { in: [] } }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.itemId ? { itemId: q.itemId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: escapeLike(q.q), mode: 'insensitive' } },
              { demandRef: { contains: escapeLike(q.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockReservation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.stockReservation.count({ where }),
    ]);
    const items = await prisma.item.findMany({
      where: { id: { in: rows.map((r) => r.itemId) } },
      select: { id: true, code: true, name: true },
    });
    const whs = await prisma.warehouse.findMany({
      where: { id: { in: rows.map((r) => r.warehouseId) } },
      select: { id: true, code: true },
    });
    return {
      rows: rows.map((r) =>
        dto(r, {
          itemCode: items.find((i) => i.id === r.itemId)?.code,
          itemName: items.find((i) => i.id === r.itemId)?.name,
          warehouseCode: whs.find((w) => w.id === r.warehouseId)?.code,
        }),
      ),
      total,
    };
  },

  async create(caller: Caller, p: ReservationInput) {
    const unitId = concreteUnit(caller);
    const required = round3(D(p.requiredQty));
    if (required.lessThanOrEqualTo(0))
      throw Errors.validation({ requiredQty: 'Enter a quantity greater than 0.' });
    const until = p.reservedUntil ?? null;
    if (until && until < todayIso())
      throw Errors.validation({ reservedUntil: 'The date cannot be in the past.' });
    const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
    if (!fy) throw Errors.contextInvalid('Unknown financial year.');
    const user = caller.auth.user;
    return prisma.$transaction(async (tx) => {
      const [item, wh] = await Promise.all([
        tx.item.findFirst({ where: { id: p.itemId, deletedAt: null } }),
        tx.warehouse.findFirst({ where: { id: p.warehouseId, deletedAt: null } }),
      ]);
      if (!item || item.status !== 'ACTIVE')
        throw Errors.validation({ itemId: 'Choose an active item.' });
      if (!wh || wh.status !== 'ACTIVE' || wh.isTransit)
        throw Errors.validation({ warehouseId: 'Choose an active warehouse.' });
      if (wh.unitId !== unitId)
        throw Errors.contextInvalid('This warehouse belongs to another unit. Switch unit first.');
      if (wh.frozenByCountId)
        throw Errors.warehouseFrozen(`Warehouse ${wh.code} is frozen for a physical count.`);
      if (p.batchId) {
        const b = await tx.batch.findFirst({ where: { id: p.batchId, itemId: p.itemId } });
        if (!b) throw Errors.validation({ batchId: 'This batch does not belong to the item.' });
        if (b.qcStatus !== 'Released' || b.recalled)
          throw Errors.batchBlocked(
            `Batch ${b.batchNo} is ${b.recalled ? 'recalled' : b.qcStatus}.`,
          );
        if (b.expiryDate && isoOf(b.expiryDate)! < todayIso())
          throw Errors.batchExpired(`Batch ${b.batchNo} has expired.`);
      }
      await lockInOrder(tx, [{ warehouseId: p.warehouseId, itemId: p.itemId }]);
      const code = await NumberingService.allocate(tx, {
        pageId: 'inv-reservation',
        unitId,
        fyId: fy.id,
        prefix: 'RES',
        padding: 4,
      });
      const days = await policyDays(tx);
      const created = await tx.stockReservation.create({
        data: {
          code,
          unitId,
          fyId: fy.id,
          department: user.department ?? 'Warehouse',
          itemId: p.itemId,
          warehouseId: p.warehouseId,
          batchId: p.batchId ?? null,
          demandType: p.demandType ?? 'Manual',
          demandRef: p.demandRef ?? null,
          priority: p.priority ?? 'Medium',
          requiredQty: str(required),
          reservedUntil: new Date(`${until ?? addDays(todayIso(), days)}T00:00:00Z`),
          status: 'Waiting',
          createdById: user.id,
        },
      });
      await runAllocator(tx, p.itemId, p.warehouseId);
      await writeAudit(
        tx,
        caller,
        'RESERVATION_CREATED',
        'Reservation',
        { id: created.id, code },
        'inv-reservation',
        { unitId, qty: str(required) },
      );
      return dto(await tx.stockReservation.findUniqueOrThrow({ where: { id: created.id } }));
    });
  },

  /** Release (user) or expire (job): the reserved quantity goes back to available and others are served. */
  async end(
    tx: Db,
    id: string,
    to: 'Released' | 'Expired',
    reason: string | null,
    actorId: string | null,
  ): Promise<void> {
    const rows = await tx.$queryRaw<
      { item_id: string; warehouse_id: string; reserved_qty: string; status: string }[]
    >`
      SELECT item_id::text, warehouse_id::text, reserved_qty::text, status FROM stock_reservations WHERE id = ${id}::uuid FOR UPDATE`;
    const r = rows[0];
    if (!r) throw Errors.notFound('Reservation not found.');
    if (!['Waiting', 'Partial', 'Reserved'].includes(r.status))
      throw Errors.conflict(`A ${r.status} reservation cannot be ${to.toLowerCase()}.`);
    await lockInOrder(tx, [{ warehouseId: r.warehouse_id, itemId: r.item_id }]);
    await tx.$executeRaw`UPDATE stock_reservations SET status = ${to}, release_reason = ${reason}, reserved_qty = 0,
      version = version + 1, updated_at = now(), updated_by_id = ${actorId}::uuid WHERE id = ${id}::uuid`;
    if (D(r.reserved_qty).greaterThan(0)) {
      await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = reserved_qty - ${r.reserved_qty}::numeric
        WHERE item_id = ${r.item_id}::uuid AND warehouse_id = ${r.warehouse_id}::uuid`;
    }
    await runAllocator(tx, r.item_id, r.warehouse_id);
  },

  async release(caller: Caller, id: string, version: number, reason: string) {
    const why = reason.trim();
    if (why.length < 3) throw Errors.validation({ reason: 'Give a reason.' });
    const cur = await prisma.stockReservation.findUnique({ where: { id } });
    if (!cur || (caller.ctx.unitId && cur.unitId !== caller.ctx.unitId))
      throw Errors.notFound('Reservation not found.');
    if (cur.version !== version) throw Errors.versionConflict();
    return prisma.$transaction(async (tx) => {
      await reservationService.end(tx, id, 'Released', why, caller.auth.userId);
      await writeAudit(
        tx,
        caller,
        'RESERVATION_RELEASED',
        'Reservation',
        { id, code: cur.code },
        'inv-reservation',
        { unitId: cur.unitId, reason: why },
      );
      return dto(await tx.stockReservation.findUniqueOrThrow({ where: { id } }));
    });
  },

  async extend(caller: Caller, id: string, version: number, days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 90)
      throw Errors.validation({ days: 'Choose 1 to 90 days.' });
    const cur = await prisma.stockReservation.findUnique({ where: { id } });
    if (!cur || (caller.ctx.unitId && cur.unitId !== caller.ctx.unitId))
      throw Errors.notFound('Reservation not found.');
    if (cur.version !== version) throw Errors.versionConflict();
    if (!['Waiting', 'Partial', 'Reserved'].includes(cur.status))
      throw Errors.conflict(`A ${cur.status} reservation cannot be extended.`);
    const from = isoOf(cur.reservedUntil) ?? todayIso();
    const base = from < todayIso() ? todayIso() : from;
    const r = await prisma.stockReservation.update({
      where: { id },
      data: {
        reservedUntil: new Date(`${addDays(base, days)}T00:00:00Z`),
        version: { increment: 1 },
        updatedById: caller.auth.userId,
      },
    });
    return dto(r);
  },

  /** Daily job: reservations past their date end as Expired (BR-INV-16). */
  async expireDue(asOf = todayIso()): Promise<number> {
    const due = await prisma.stockReservation.findMany({
      where: {
        status: { in: ['Waiting', 'Partial', 'Reserved'] },
        reservedUntil: { lt: new Date(`${asOf}T00:00:00Z`) },
      },
      select: { id: true },
    });
    for (const d of due)
      await prisma.$transaction((tx) =>
        reservationService.end(tx, d.id, 'Expired', 'Reservation period ended', null),
      );
    return due.length;
  },
};

// ---------------------------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------------------------
export const holdService = {
  async list(caller: Caller, q: { status?: string; itemId?: string; page: number; size: number }) {
    const where: Prisma.StockHoldWhereInput = {
      ...(caller.ctx.unitId
        ? { unitId: caller.ctx.unitId }
        : caller.ctx.allUnits
          ? {}
          : { id: { in: [] } }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.itemId ? { itemId: q.itemId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockHold.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.stockHold.count({ where }),
    ]);
    return {
      rows: rows.map((h) => ({
        id: h.id,
        code: h.code,
        itemId: h.itemId,
        warehouseId: h.warehouseId,
        batchId: h.batchId,
        qty: num(h.qty),
        reason: h.reason,
        status: h.status,
        version: h.version,
        createdAt: h.createdAt.toISOString(),
      })),
      total,
    };
  },

  async place(
    caller: Caller,
    p: {
      itemId: string;
      warehouseId: string;
      batchId?: string | null;
      qty: number | string;
      reason: string;
    },
  ) {
    const unitId = concreteUnit(caller);
    const qty = round3(D(p.qty));
    if (qty.lessThanOrEqualTo(0))
      throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    if (p.reason.trim().length < 3) throw Errors.validation({ reason: 'Give a reason.' });
    const fy = await prisma.financialYear.findUniqueOrThrow({ where: { id: caller.ctx.fyId } });
    return prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findFirst({ where: { id: p.warehouseId, deletedAt: null } });
      if (!wh || wh.unitId !== unitId)
        throw Errors.contextInvalid('This warehouse belongs to another unit. Switch unit first.');
      if (wh.frozenByCountId)
        throw Errors.warehouseFrozen(`Warehouse ${wh.code} is frozen for a physical count.`);
      await lockInOrder(tx, [{ warehouseId: p.warehouseId, itemId: p.itemId }]);
      const a = await availability(tx, p.itemId, p.warehouseId);
      if (qty.greaterThan(a.available)) {
        throw Errors.stockReserved(
          `Only ${str(a.available)} available (${str(a.reserved)} reserved, ${str(a.held)} already on hold).`,
        );
      }
      const code = await NumberingService.allocate(tx, {
        pageId: 'inv-reservation:hold',
        unitId,
        fyId: fy.id,
        prefix: 'HLD',
        padding: 4,
      });
      const h = await tx.stockHold.create({
        data: {
          code,
          unitId,
          itemId: p.itemId,
          warehouseId: p.warehouseId,
          batchId: p.batchId ?? null,
          qty: str(qty),
          reason: p.reason.trim(),
          createdById: caller.auth.userId,
        },
      });
      await writeAudit(
        tx,
        caller,
        'HOLD_PLACED',
        'Reservation',
        { id: h.id, code },
        'inv-reservation',
        { unitId, qty: str(qty) },
      );
      return h;
    });
  },

  async release(caller: Caller, id: string, version: number) {
    const cur = await prisma.stockHold.findUnique({ where: { id } });
    if (!cur || (caller.ctx.unitId && cur.unitId !== caller.ctx.unitId))
      throw Errors.notFound('Hold not found.');
    if (cur.version !== version) throw Errors.versionConflict();
    if (cur.status !== 'Active') throw Errors.conflict('This hold is already released.');
    return prisma.$transaction(async (tx) => {
      await lockInOrder(tx, [{ warehouseId: cur.warehouseId, itemId: cur.itemId }]);
      const r = await tx.stockHold.updateMany({
        where: { id, version, status: 'Active' },
        data: {
          status: 'Released',
          releasedAt: new Date(),
          releasedById: caller.auth.userId,
          version: { increment: 1 },
        },
      });
      if (r.count !== 1) throw Errors.versionConflict();
      await runAllocator(tx, cur.itemId, cur.warehouseId);
      await writeAudit(
        tx,
        caller,
        'HOLD_RELEASED',
        'Reservation',
        { id, code: cur.code },
        'inv-reservation',
        { unitId: cur.unitId },
      );
      return tx.stockHold.findUniqueOrThrow({ where: { id } });
    });
  },
};
