// Counts and reconciliation (Phase 8 step 8): cycle counts, full physical verification (warehouse freeze) and the
// weekly Powder Stock Monitoring Sheet (client requirement 1). One state machine:
//   Planned -> Counting -> Under Review -> Approved -> Posted -> Closed        (Cancelled from any open state)
// Counting: count 1; outside tolerance -> a DIFFERENT user enters count 2 (recount is final). A line is Stale when
// stock moved since the snapshot. Approve needs the `approve` right and a user who did not create the count.
// Post turns the confirmed differences into ONE Adjustment voucher (the normal reconciliation flow: stock + GL,
// reversible by cancelling that voucher) and unfreezes the warehouse.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { escapeLike } from '../../core/http/query-safety';
import { NumberingService } from '../../core/numbering';
import { accessUserOf, can } from '../../core/rbac/access';
import type { Caller } from '../records/service';
import { D, ZERO, num, round2, round3, str } from './money';
import type { Dec } from './money';
import { KINDS, voucherService } from './vouchers/voucher-service';
import { voucherRepo } from './vouchers/voucher-repository';
import { concreteUnit, writeAudit } from './typed';

const isoOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const OPEN = ['Planned', 'Counting', 'Under Review', 'Approved'];

export interface CountInput {
  countType: 'CYCLE' | 'PHYSICAL' | 'POWDER_WEEKLY';
  warehouseId: string;
  plannedDate?: string;
  itemIds?: string[];
  monthLabel?: string | null;
  frequency?: 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly' | null;
  blind?: boolean;
  freezeWarehouse?: boolean;
  tolerancePct?: number;
  toleranceValue?: number;
}

type CountRow = Prisma.StockCountGetPayload<object>;
type LineRow = Prisma.StockCountLineGetPayload<object>;

function lineDto(l: LineRow, hide: boolean) {
  return {
    id: l.id,
    lineNo: l.lineNo,
    itemId: l.itemId,
    batchId: l.batchId,
    binId: l.binId,
    systemQty: hide ? null : num(l.systemQty),
    count1Qty: num(l.count1Qty),
    count2Qty: num(l.count2Qty),
    finalQty: num(l.finalQty),
    status: l.status,
    weekNo: l.weekNo,
    remarks: l.remarks,
    checkedById: l.checkedById,
    checkedOn: isoOf(l.checkedOn),
    variance: hide || l.finalQty === null ? null : num(l.finalQty.minus(l.systemQty)),
  };
}

function head(c: CountRow) {
  return {
    id: c.id,
    code: c.code,
    countType: c.countType,
    unitId: c.unitId,
    warehouseId: c.warehouseId,
    status: c.status,
    plannedDate: isoOf(c.plannedDate),
    monthLabel: c.monthLabel,
    frequency: c.frequency,
    blind: c.blind,
    freezeWarehouse: c.freezeWarehouse,
    tolerancePct: num(c.tolerancePct),
    toleranceValue: num(c.toleranceValue),
    accuracyPct: num(c.accuracyPct),
    reconciliationVoucherId: c.reconciliationVoucherId,
    closureNote: c.closureNote,
    version: c.version,
    createdById: c.createdById,
    createdAt: c.createdAt.toISOString(),
  };
}

async function loadCount(caller: Caller, id: string, db: Db = prisma): Promise<CountRow> {
  const c = await db.stockCount.findFirst({ where: { id, deletedAt: null } });
  if (
    !c ||
    (caller.ctx.unitId && c.unitId !== caller.ctx.unitId) ||
    (!caller.ctx.unitId && !caller.ctx.allUnits)
  ) {
    throw Errors.notFound('Count not found.');
  }
  return c;
}

async function systemQtyOf(
  tx: Db,
  itemId: string,
  warehouseId: string,
  batchId: string | null,
  binId: string | null,
): Promise<Dec> {
  // unpaginated: rows of one parent (item_id)
  const r = await tx.$queryRaw<{ q: string }[]>`
    SELECT COALESCE(sum(qty),0)::text AS q FROM stock_slices
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid AND stock_status = 'UNRESTRICTED'
      AND (${batchId}::uuid IS NULL OR batch_id = ${batchId}::uuid) AND (${binId}::uuid IS NULL OR bin_id = ${binId}::uuid)`;
  return D(r[0]?.q ?? '0');
}

async function unitCost(tx: Db, itemId: string, warehouseId: string): Promise<Dec> {
  // unpaginated: rows of one parent (item_id)
  const r = await tx.$queryRaw<{ avg_rate: string }[]>`
    SELECT avg_rate::text FROM stock_balances WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  return D(r[0]?.avg_rate ?? '0');
}

/** Within tolerance: |c - system| <= system x pct/100 AND |c - system| x cost <= value; a system of 0 allows no difference. */
export function withinTolerance(
  system: Dec,
  counted: Dec,
  pct: Dec,
  valueTol: Dec,
  cost: Dec,
): boolean {
  const diff = counted.minus(system).abs();
  if (diff.isZero()) return true;
  if (system.isZero()) return false;
  return (
    diff.lessThanOrEqualTo(system.times(pct).div(100)) &&
    diff.times(cost).lessThanOrEqualTo(valueTol)
  );
}

export const countService = {
  async list(
    caller: Caller,
    q: { q?: string; status?: string; countType?: string; page: number; size: number },
  ) {
    const where: Prisma.StockCountWhereInput = {
      deletedAt: null,
      ...(caller.ctx.unitId
        ? { unitId: caller.ctx.unitId }
        : caller.ctx.allUnits
          ? {}
          : { id: { in: [] } }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.countType ? { countType: q.countType } : {}),
      ...(q.q ? { code: { contains: escapeLike(q.q), mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockCount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.stockCount.count({ where }),
    ]);
    return { rows: rows.map(head), total };
  },

  async get(caller: Caller, id: string) {
    const c = await loadCount(caller, id);
    // unpaginated: rows of one parent (countId)
    const lines = await prisma.stockCountLine.findMany({
      where: { countId: id },
      orderBy: { lineNo: 'asc' },
    });
    const hide = c.blind && c.status === 'Counting';
    const items = await prisma.item.findMany({
      where: { id: { in: lines.map((l) => l.itemId) } },
      select: { id: true, code: true, name: true, itemType: true, category: true },
    });
    return {
      ...head(c),
      lines: lines.map((l) => ({
        ...lineDto(l, hide),
        item: items.find((i) => i.id === l.itemId) ?? null,
      })),
      review: c.status === 'Counting' ? null : reviewOf(c, lines, items),
    };
  },

  async create(caller: Caller, p: CountInput) {
    const unitId = concreteUnit(caller);
    const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
    if (!fy) throw Errors.contextInvalid('Unknown financial year.');
    const planned = p.plannedDate ?? todayIso();
    const user = caller.auth.user;
    if (p.countType === 'POWDER_WEEKLY' && !/^\d{4}-\d{2}$/.test(p.monthLabel ?? '')) {
      throw Errors.validation({ monthLabel: 'Choose the month of the sheet (YYYY-MM).' });
    }
    return prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findFirst({ where: { id: p.warehouseId, deletedAt: null } });
      if (!wh || wh.status !== 'ACTIVE' || wh.isTransit)
        throw Errors.validation({ warehouseId: 'Choose an active warehouse.' });
      if (wh.unitId !== unitId)
        throw Errors.contextInvalid('This warehouse belongs to another unit. Switch unit first.');
      const prefix =
        p.countType === 'PHYSICAL' ? 'PHY' : p.countType === 'POWDER_WEEKLY' ? 'PWD' : 'CYC';
      const code = await NumberingService.allocate(tx, {
        pageId: `inv-count:${p.countType}`,
        unitId,
        fyId: fy.id,
        prefix,
        padding: 4,
      });
      const c = await tx.stockCount.create({
        data: {
          code,
          countType: p.countType,
          unitId,
          fyId: fy.id,
          department: user.department ?? 'Warehouse',
          warehouseId: p.warehouseId,
          plannedDate: asDate(planned),
          monthLabel: p.monthLabel ?? null,
          frequency: p.countType === 'POWDER_WEEKLY' ? 'Weekly' : (p.frequency ?? null),
          blind: p.blind ?? p.countType !== 'POWDER_WEEKLY',
          freezeWarehouse: p.countType === 'PHYSICAL' ? (p.freezeWarehouse ?? true) : false,
          tolerancePct: p.tolerancePct ?? 2,
          toleranceValue: p.toleranceValue ?? 500,
          createdById: user.id,
        },
      });
      if (p.countType === 'POWDER_WEEKLY') {
        // One row per powder item and week (1-5). The powder list comes from the item category; the client confirms it.
        const items = p.itemIds?.length
          ? await tx.item.findMany({
              where: { id: { in: p.itemIds }, deletedAt: null, status: 'ACTIVE' },
            })
          // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
          : await tx.item.findMany({
              where: {
                deletedAt: null,
                status: 'ACTIVE',
                category: { equals: 'Powder', mode: 'insensitive' },
              },
              orderBy: { code: 'asc' },
            });
        if (items.length === 0)
          throw Errors.validation({
            itemIds:
              'No powder items found. Choose the items of the sheet, or set the item category to "Powder".',
          });
        let n = 0;
        const data = [];
        for (const it of items)
          for (let w = 1; w <= 5; w++)
            data.push({
              countId: c.id,
              lineNo: (n += 1),
              itemId: it.id,
              weekNo: w,
              systemQty: '0',
            });
        await tx.stockCountLine.createMany({ data });
      } else if (p.itemIds?.length) {
        let n = 0;
        await tx.stockCountLine.createMany({
          data: p.itemIds.map((itemId) => ({
            countId: c.id,
            lineNo: (n += 1),
            itemId,
            systemQty: '0',
          })),
        });
      } else if (p.countType === 'CYCLE') {
        throw Errors.validation({ itemIds: 'Choose the items to count.' });
      }
      await writeAudit(
        tx,
        caller,
        'COUNT_STATUS_CHANGED',
        'Count',
        { id: c.id, code },
        'wms-cycle',
        { unitId, to: 'Planned' },
      );
      return head(c);
    });
  },

  /** Planned -> Counting: snapshot the system quantity, optionally freeze the warehouse. */
  async start(caller: Caller, id: string, version: number) {
    return prisma.$transaction(async (tx) => {
      const c = await loadCount(caller, id, tx);
      if (c.version !== version) throw Errors.versionConflict();
      if (c.status !== 'Planned') throw Errors.conflict(`A ${c.status} count cannot be started.`);
      const wh = await tx.warehouse.findUniqueOrThrow({ where: { id: c.warehouseId } });
      if (c.freezeWarehouse) {
        if (wh.frozenByCountId)
          throw Errors.warehouseFrozen(`Warehouse ${wh.code} is already frozen by another count.`);
        await tx.warehouse.update({ where: { id: wh.id }, data: { frozenByCountId: c.id } });
        await writeAudit(
          tx,
          caller,
          'WAREHOUSE_FROZEN',
          'Count',
          { id, code: c.code },
          'wms-physical',
          { warehouseId: wh.id },
        );
      }
      await tx.$executeRaw`SELECT 1 FROM stock_balances WHERE warehouse_id = ${c.warehouseId}::uuid FOR UPDATE`;
      if (
        c.countType === 'PHYSICAL' &&
        (await tx.stockCountLine.count({ where: { countId: id } })) === 0
      ) {
        // unpaginated: rows of one parent (warehouse_id)
        const slices = await tx.$queryRaw<
          { item_id: string; batch_id: string; bin_id: string; q: string }[]
        >`
          SELECT item_id::text, batch_id::text, bin_id::text, sum(qty)::text AS q FROM stock_slices
          WHERE warehouse_id = ${c.warehouseId}::uuid AND stock_status = 'UNRESTRICTED' AND qty > 0
          GROUP BY item_id, batch_id, bin_id ORDER BY item_id, batch_id`;
        const NIL = '00000000-0000-0000-0000-000000000000';
        let n = 0;
        await tx.stockCountLine.createMany({
          data: slices.map((s) => ({
            countId: id,
            lineNo: (n += 1),
            itemId: s.item_id,
            batchId: s.batch_id === NIL ? null : s.batch_id,
            binId: s.bin_id === NIL ? null : s.bin_id,
            systemQty: s.q,
          })),
        });
      } else {
        // unpaginated: rows of one parent (countId)
        const lines = await tx.stockCountLine.findMany({ where: { countId: id } });
        for (const l of lines) {
          await tx.stockCountLine.update({
            where: { id: l.id },
            data: {
              systemQty: str(await systemQtyOf(tx, l.itemId, c.warehouseId, l.batchId, l.binId)),
              unitCost: str(await unitCost(tx, l.itemId, c.warehouseId)),
            },
          });
        }
      }
      if ((await tx.stockCountLine.count({ where: { countId: id } })) === 0)
        throw Errors.validation({ lines: 'There is nothing to count in this warehouse.' });
      await tx.stockCount.update({
        where: { id },
        data: {
          status: 'Counting',
          snapshotAt: new Date(),
          version: { increment: 1 },
          updatedById: caller.auth.userId,
        },
      });
      await writeAudit(
        tx,
        caller,
        'COUNT_STATUS_CHANGED',
        'Count',
        { id, code: c.code },
        'wms-cycle',
        { unitId: c.unitId, from: 'Planned', to: 'Counting' },
      );
      return head(await tx.stockCount.findUniqueOrThrow({ where: { id } }));
    });
  },

  /** Enter a count for one line (count 1, or the recount by a different user). */
  async enter(
    caller: Caller,
    id: string,
    lineId: string,
    qty: number | string,
    remarks?: string | null,
  ) {
    const counted = round3(D(qty));
    if (counted.lessThan(0)) throw Errors.validation({ qty: 'Enter 0 or more.' });
    return prisma.$transaction(async (tx) => {
      const c = await loadCount(caller, id, tx);
      if (c.status !== 'Counting')
        throw Errors.conflict(`A ${c.status} count cannot take new quantities.`);
      const l = await tx.stockCountLine.findFirst({ where: { id: lineId, countId: id } });
      if (!l) throw Errors.notFound('Count line not found.');
      const user = caller.auth.userId;
      // Stale: stock moved after the snapshot (not for a frozen physical count).
      if (!c.freezeWarehouse && c.snapshotAt && c.countType !== 'POWDER_WEEKLY') {
        const moved = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM stock_ledger WHERE item_id = ${l.itemId}::uuid AND warehouse_id = ${c.warehouseId}::uuid
            AND posted_at > ${c.snapshotAt}::timestamptz`;
        if ((moved[0]?.n ?? 0) > 0) {
          const fresh = await systemQtyOf(tx, l.itemId, c.warehouseId, l.batchId, l.binId);
          await tx.stockCountLine.update({
            where: { id: l.id },
            data: {
              systemQty: str(fresh),
              count1Qty: null,
              count1ById: null,
              count2Qty: null,
              count2ById: null,
              finalQty: null,
              status: 'Stale',
            },
          });
          throw Errors.countStale(
            'Stock moved since the count started. The system quantity was refreshed; count this line again.',
          );
        }
      }
      const cost = l.unitCost ?? ZERO;
      const data: Prisma.StockCountLineUncheckedUpdateInput = {
        remarks: remarks ?? l.remarks,
        checkedById: user,
        checkedOn: asDate(todayIso()),
      };
      const powder = c.countType === 'POWDER_WEEKLY';
      if (l.status === 'Recount') {
        if (l.count1ById === user) throw Errors.sameCounter();
        Object.assign(data, {
          count2Qty: str(counted),
          count2ById: user,
          finalQty: str(counted),
          status: 'Accepted',
        });
      } else if (
        l.status === 'Open' ||
        l.status === 'Counted' ||
        l.status === 'Stale' ||
        l.status === 'Accepted'
      ) {
        if (powder) {
          // The weekly sheet records the stock check; the difference is confirmed later by the reconciliation.
          const sys = await systemQtyOf(tx, l.itemId, c.warehouseId, null, null);
          Object.assign(data, {
            systemQty: str(sys),
            count1Qty: str(counted),
            count1ById: user,
            finalQty: str(counted),
            status: 'Accepted',
          });
        } else {
          const ok = withinTolerance(l.systemQty, counted, c.tolerancePct, c.toleranceValue, cost);
          Object.assign(data, {
            count1Qty: str(counted),
            count1ById: user,
            count2Qty: null,
            count2ById: null,
            finalQty: ok ? str(counted) : null,
            status: ok ? 'Accepted' : 'Recount',
          });
        }
      }
      const upd = await tx.stockCountLine.update({ where: { id: l.id }, data });
      return lineDto(upd, false);
    });
  },

  /** Counting -> Under Review: every line counted; accuracy computed (BR-INV-33). */
  async submitForReview(caller: Caller, id: string, version: number) {
    return prisma.$transaction(async (tx) => {
      const c = await loadCount(caller, id, tx);
      if (c.version !== version) throw Errors.versionConflict();
      if (c.status !== 'Counting')
        throw Errors.conflict(`A ${c.status} count cannot be sent for review.`);
      // unpaginated: rows of one parent (countId)
      const lines = await tx.stockCountLine.findMany({ where: { countId: id } });
      const powder = c.countType === 'POWDER_WEEKLY';
      const open = lines.filter(
        (l) => l.status === 'Open' || l.status === 'Recount' || l.status === 'Stale',
      );
      if (!powder && open.length > 0) {
        throw Errors.validation({
          lines: `${open.length} line(s) still need a count${open.some((l) => l.status === 'Recount') ? ' or a recount by another person' : ''}.`,
        });
      }
      const counted = lines.filter((l) => l.finalQty !== null);
      if (counted.length === 0) throw Errors.validation({ lines: 'Enter at least one count.' });
      let within = 0;
      let absVar = ZERO;
      let sysVal = ZERO;
      for (const l of counted) {
        const cost = l.unitCost ?? ZERO;
        const diff = l.finalQty!.minus(l.systemQty);
        if (diff.abs().lessThanOrEqualTo(l.systemQty.times(c.tolerancePct).div(100))) within += 1;
        absVar = absVar.plus(diff.abs().times(cost));
        sysVal = sysVal.plus(l.systemQty.times(cost));
      }
      const acc = round2(D(within).div(counted.length).times(100));
      void absVar;
      void sysVal;
      await tx.stockCount.update({
        where: { id },
        data: {
          status: 'Under Review',
          accuracyPct: str(acc),
          version: { increment: 1 },
          updatedById: caller.auth.userId,
        },
      });
      await writeAudit(
        tx,
        caller,
        'COUNT_STATUS_CHANGED',
        'Count',
        { id, code: c.code },
        'wms-cycle',
        { from: 'Counting', to: 'Under Review', accuracyPct: str(acc) },
      );
      return head(await tx.stockCount.findUniqueOrThrow({ where: { id } }));
    });
  },

  async approve(caller: Caller, id: string, version: number) {
    const c0 = await loadCount(caller, id);
    const page = c0.countType === 'PHYSICAL' ? 'wms-physical' : 'wms-cycle';
    if (!(await can(accessUserOf(caller.auth.user), page, 'approve'))) throw Errors.forbidden();
    return prisma.$transaction(async (tx) => {
      const c = await loadCount(caller, id, tx);
      if (c.version !== version) throw Errors.versionConflict();
      if (c.status !== 'Under Review')
        throw Errors.conflict(`A ${c.status} count cannot be approved.`);
      if (c.createdById === caller.auth.userId)
        throw Errors.makerChecker('A different person must approve a count you created.');
      await tx.stockCount.update({
        where: { id },
        data: { status: 'Approved', version: { increment: 1 }, updatedById: caller.auth.userId },
      });
      await writeAudit(tx, caller, 'COUNT_STATUS_CHANGED', 'Count', { id, code: c.code }, page, {
        from: 'Under Review',
        to: 'Approved',
      });
      return head(await tx.stockCount.findUniqueOrThrow({ where: { id } }));
    });
  },

  /** Approved -> Posted: one Adjustment voucher for the lines with a difference, posted at once. */
  async post(caller: Caller, id: string, version: number, lineIds?: string[]) {
    const unitId = concreteUnit(caller);
    const c0 = await loadCount(caller, id);
    if (c0.version !== version) throw Errors.versionConflict();
    if (c0.status !== 'Approved') throw Errors.conflict(`A ${c0.status} count cannot be posted.`);
    const info = KINDS.adjustment!;
    const user = caller.auth.user;
    const fy = await prisma.financialYear.findUniqueOrThrow({ where: { id: c0.fyId } });
    const voucherId = await prisma.$transaction(async (tx) => {
      // unpaginated: rows of one parent (countId)
      const lines = await tx.stockCountLine.findMany({
        where: {
          countId: id,
          finalQty: { not: null },
          ...(lineIds?.length ? { id: { in: lineIds } } : {}),
        },
        orderBy: { lineNo: 'asc' },
      });
      // Merge by item + batch + bin (the powder sheet has 5 week rows per item: the latest week with a count wins).
      const merged = new Map<string, LineRow>();
      for (const l of lines) merged.set(`${l.itemId}|${l.batchId ?? ''}|${l.binId ?? ''}`, l);
      const diffs: LineRow[] = [];
      for (const l of merged.values()) {
        const sys = await systemQtyOf(tx, l.itemId, c0.warehouseId, l.batchId, l.binId);
        if (!l.finalQty!.equals(sys)) diffs.push(l);
      }
      if (diffs.length === 0) return null;
      const number = await NumberingService.allocate(tx, {
        pageId: info.pageId,
        unitId,
        fyId: fy.id,
        prefix: info.prefix,
        padding: 4,
      });
      const v = await voucherRepo.create(
        {
          kind: 'ADJUSTMENT',
          number,
          status: 'Approved',
          unitId,
          fyId: fy.id,
          department: user.department ?? 'Warehouse',
          postingDate: asDate(
            todayIso() < isoOf(fy.startDate)!
              ? isoOf(fy.startDate)!
              : todayIso() > isoOf(fy.endDate)!
                ? isoOf(fy.endDate)!
                : todayIso(),
          ),
          warehouseId: c0.warehouseId,
          reference: c0.code,
          narration: `Reconciliation of ${c0.code}`,
          hasLines: true,
          approvedById: user.id,
          approvedAt: new Date(),
          createdById: user.id,
          lines: {
            create: diffs.map((l, i) => ({
              lineNo: i + 1,
              itemId: l.itemId,
              warehouseId: c0.warehouseId,
              qty: '0',
              batchId: l.batchId,
              binId: l.binId,
              countedQty: str(l.finalQty!),
              reasonCode: 'Count Correction',
              remarks: `Count ${c0.code}`,
            })),
          },
        },
        tx,
      );
      await tx.stockCount.update({ where: { id }, data: { reconciliationVoucherId: v.id } });
      return v.id;
    });
    if (voucherId) {
      // Posted through the normal voucher flow (stock + GL); the frozen warehouse admits this count's own posting.
      await voucherService.action(caller, info, voucherId, 'post', {}, undefined);
    }
    return prisma.$transaction(async (tx) => {
      const c = await loadCount(caller, id, tx);
      await tx.stockCount.update({
        where: { id },
        data: { status: 'Posted', version: { increment: 1 }, updatedById: caller.auth.userId },
      });
      await unfreeze(tx, caller, c);
      await writeAudit(
        tx,
        caller,
        'COUNT_POSTED',
        'Count',
        { id, code: c.code },
        c.countType === 'PHYSICAL' ? 'wms-physical' : 'wms-cycle',
        { voucherId },
      );
      return head(await tx.stockCount.findUniqueOrThrow({ where: { id } }));
    });
  },

  async close(caller: Caller, id: string, version: number, note: string) {
    if (note.trim().length < 3)
      throw Errors.validation({ closureNote: 'Write a short closing note.' });
    return prisma.$transaction(async (tx) => {
      const c = await loadCount(caller, id, tx);
      if (c.version !== version) throw Errors.versionConflict();
      if (c.status !== 'Posted') throw Errors.conflict(`A ${c.status} count cannot be closed.`);
      await tx.stockCount.update({
        where: { id },
        data: {
          status: 'Closed',
          closureNote: note.trim(),
          version: { increment: 1 },
          updatedById: caller.auth.userId,
        },
      });
      await writeAudit(
        tx,
        caller,
        'COUNT_STATUS_CHANGED',
        'Count',
        { id, code: c.code },
        'wms-cycle',
        { from: 'Posted', to: 'Closed' },
      );
      return head(await tx.stockCount.findUniqueOrThrow({ where: { id } }));
    });
  },

  async cancel(caller: Caller, id: string, version: number) {
    return prisma.$transaction(async (tx) => {
      const c = await loadCount(caller, id, tx);
      if (c.version !== version) throw Errors.versionConflict();
      if (!OPEN.includes(c.status))
        throw Errors.conflict(`A ${c.status} count cannot be cancelled.`);
      await tx.stockCount.update({
        where: { id },
        data: { status: 'Cancelled', version: { increment: 1 }, updatedById: caller.auth.userId },
      });
      await unfreeze(tx, caller, c);
      await writeAudit(
        tx,
        caller,
        'COUNT_STATUS_CHANGED',
        'Count',
        { id, code: c.code },
        'wms-cycle',
        { from: c.status, to: 'Cancelled' },
      );
      return head(await tx.stockCount.findUniqueOrThrow({ where: { id } }));
    });
  },
};

async function unfreeze(tx: Db, caller: Caller, c: CountRow) {
  const r = await tx.warehouse.updateMany({
    where: { id: c.warehouseId, frozenByCountId: c.id },
    data: { frozenByCountId: null },
  });
  if (r.count === 1)
    await writeAudit(
      tx,
      caller,
      'WAREHOUSE_UNFROZEN',
      'Count',
      { id: c.id, code: c.code },
      'wms-physical',
      { warehouseId: c.warehouseId },
    );
}

/** Net variance per inventory class; a class at >= 10 % of book value is flagged for the auditor (BR-INV-36). */
function reviewOf(c: CountRow, lines: LineRow[], items: { id: string; itemType: string }[]) {
  const byClass = new Map<string, { sys: Dec; net: Dec }>();
  for (const l of lines) {
    if (l.finalQty === null) continue;
    const t = items.find((i) => i.id === l.itemId)?.itemType ?? 'Other';
    const cost = l.unitCost ?? ZERO;
    const e = byClass.get(t) ?? { sys: ZERO, net: ZERO };
    e.sys = e.sys.plus(l.systemQty.times(cost));
    e.net = e.net.plus(l.finalQty.minus(l.systemQty).times(cost));
    byClass.set(t, e);
  }
  return {
    accuracyPct: num(c.accuracyPct),
    classes: [...byClass.entries()].map(([itemType, e]) => {
      const pct = e.sys.isZero() ? ZERO : e.net.abs().div(e.sys).times(100);
      return {
        itemType,
        bookValue: num(round2(e.sys)),
        netVariance: num(round2(e.net)),
        netVariancePct: num(round2(pct)),
        caroFlag: pct.greaterThanOrEqualTo(10),
      };
    }),
  };
}
