// Inventory reports and reorder (Phase 8 step 9): ageing (BR-INV-46), expiry bands (BR-INV-48), valuation buckets
// with the GL comparison (BR-INV-25/26), reorder policies + suggestions (BR-INV-40..44) and the integrity check
// (INV-1..INV-5). Everything is read from the ledger, balances and slices; nothing here posts stock.
import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { D, ZERO, num, round2, round3, str } from './money';
import type { Dec } from './money';
import { decide, eoq, reorderLevel, safetyStock, sampleSigma, zFor } from './reorder-calc';
import { writeAudit } from './typed';

const isoOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number =>
  Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );

const unitScope = (caller: Caller): Prisma.Sql =>
  caller.ctx.unitId
    ? Prisma.sql`w.unit_id = ${caller.ctx.unitId}::uuid`
    : caller.ctx.allUnits
      ? Prisma.sql`true`
      : Prisma.sql`false`;

// ---------------------------------------------------------------------------------------------
// Ageing: on-hand is attributed to the most recent inflows backwards (equivalent to FIFO consumption).
// ---------------------------------------------------------------------------------------------
export async function ageing(
  caller: Caller,
  q: { asOf?: string; warehouseId?: string; page: number; size: number },
) {
  const asOf = q.asOf ?? todayIso();
  const wh = q.warehouseId ? Prisma.sql`AND b.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    {
      item_id: string;
      item_code: string;
      item_name: string;
      warehouse_code: string;
      on_hand: string;
      f030: string;
      f3190: string;
      f91180: string;
      f180: string;
      age_days: string;
      last_issue: Date | null;
      total: number;
    }[]
  >`
    WITH inflow AS (
      SELECT l.item_id, l.warehouse_id, l.qty_in AS qty, l.posting_date,
             sum(l.qty_in) OVER (PARTITION BY l.item_id, l.warehouse_id ORDER BY l.posting_date DESC, l.posted_at DESC, l.id DESC
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before
      FROM stock_ledger l
      WHERE l.qty_in > 0 AND l.voucher_type IN ('OPENING','RECEIPT','TRANSFER_IN','ADJUSTMENT','RECONCILIATION')
        AND l.posting_date <= ${asOf}::date
        AND NOT EXISTS (SELECT 1 FROM stock_ledger r WHERE r.reverses_id = l.id)
    ), attr AS (
      SELECT b.item_id, b.warehouse_id, b.on_hand,
             LEAST(i.qty, GREATEST(0, b.on_hand - COALESCE(i.before, 0))) AS take,
             (${asOf}::date - i.posting_date) AS age
      FROM stock_balances b JOIN inflow i ON i.item_id = b.item_id AND i.warehouse_id = b.warehouse_id
      WHERE b.on_hand > 0 ${wh}
    )
    SELECT a.item_id::text, it.code AS item_code, it.name AS item_name, w.code AS warehouse_code, max(a.on_hand)::text AS on_hand,
           COALESCE(sum(a.take) FILTER (WHERE a.age <= 30),0)::text AS f030,
           COALESCE(sum(a.take) FILTER (WHERE a.age BETWEEN 31 AND 90),0)::text AS f3190,
           COALESCE(sum(a.take) FILTER (WHERE a.age BETWEEN 91 AND 180),0)::text AS f91180,
           COALESCE(sum(a.take) FILTER (WHERE a.age > 180),0)::text AS f180,
           CASE WHEN sum(a.take) > 0 THEN round(sum(a.take * a.age) / sum(a.take))::text ELSE '0' END AS age_days,
           (SELECT max(posting_date) FROM stock_ledger x WHERE x.item_id = a.item_id AND x.warehouse_id = a.warehouse_id AND x.voucher_type = 'ISSUE') AS last_issue,
           count(*) OVER()::int AS total
    FROM attr a JOIN items it ON it.id = a.item_id JOIN warehouses w ON w.id = a.warehouse_id
    WHERE ${unitScope(caller)}
    GROUP BY a.item_id, a.warehouse_id, it.code, it.name, w.code
    ORDER BY CASE WHEN sum(a.take) > 0 THEN round(sum(a.take * a.age) / sum(a.take)) ELSE 0 END DESC, it.code
    LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  return {
    asOf,
    rows: rows.map((r) => {
      const last = isoOf(r.last_issue);
      const since = last ? daysBetween(asOf, last) : null;
      const movement =
        since === null
          ? 'Dead Stock'
          : since <= 30
            ? 'Fast Moving'
            : since <= 90
              ? 'Normal'
              : since <= 180
                ? 'Slow Moving'
                : 'Dead Stock';
      return {
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        warehouse: r.warehouse_code,
        onHand: Number(r.on_hand),
        f030: Number(r.f030),
        f3190: Number(r.f3190),
        f91180: Number(r.f91180),
        f180Plus: Number(r.f180),
        ageDays: Number(r.age_days),
        lastIssue: last,
        movement,
      };
    }),
    total: rows[0]?.total ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------------------------
export function expiryBand(days: number): { band: string; status: string } {
  if (days <= 0) return { band: 'Expired', status: 'Expired' };
  if (days <= 30) return { band: 'Critical', status: 'Near Expiry' };
  if (days <= 60) return { band: 'High', status: 'Near Expiry' };
  if (days <= 90) return { band: 'Medium', status: 'OK' };
  return { band: 'Low', status: 'OK' };
}

export async function expiry(
  caller: Caller,
  q: { asOf?: string; band?: string; warehouseId?: string; page: number; size: number },
) {
  const asOf = q.asOf ?? todayIso();
  const wh = q.warehouseId ? Prisma.sql`AND s.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    {
      batch_id: string;
      batch_no: string;
      item_id: string;
      item_code: string;
      item_name: string;
      warehouse_code: string;
      expiry_date: Date;
      qty: string;
      qi: string;
      value: string;
      disposition: string | null;
      qc_status: string;
    }[]
  >`
    SELECT b.id::text AS batch_id, b.batch_no, i.id::text AS item_id, i.code AS item_code, i.name AS item_name, w.code AS warehouse_code,
           b.expiry_date, sum(s.qty)::text AS qty,
           COALESCE(sum(s.qty) FILTER (WHERE s.stock_status = 'QUALITY_INSPECTION'),0)::text AS qi,
           round(sum(s.qty) * COALESCE(sb.avg_rate, 0), 2)::text AS value, b.disposition, b.qc_status
    FROM stock_slices s
    JOIN batches b ON b.id = s.batch_id JOIN items i ON i.id = s.item_id JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN stock_balances sb ON sb.item_id = s.item_id AND sb.warehouse_id = s.warehouse_id
    WHERE s.qty > 0 AND b.expiry_date IS NOT NULL AND ${unitScope(caller)} ${wh}
    GROUP BY b.id, i.id, w.code, sb.avg_rate
    ORDER BY b.expiry_date ASC, i.code`;
  const all = rows.map((r) => {
    const exp = isoOf(r.expiry_date)!;
    const days = daysBetween(exp, asOf);
    return {
      batchId: r.batch_id,
      batchNo: r.batch_no,
      itemId: r.item_id,
      itemCode: r.item_code,
      itemName: r.item_name,
      warehouse: r.warehouse_code,
      expiryDate: exp,
      daysToExpiry: days,
      ...expiryBand(days),
      qty: Number(r.qty),
      qualityInspection: Number(r.qi),
      value: Number(r.value),
      disposition: r.disposition,
      qcStatus: r.qc_status,
    };
  });
  const filtered = q.band ? all.filter((r) => r.band === q.band) : all;
  return {
    asOf,
    rows: filtered.slice((q.page - 1) * q.size, q.page * q.size),
    total: filtered.length,
    expiredValue: round2(
      filtered.filter((r) => r.band === 'Expired').reduce((a, r) => a.plus(r.value), ZERO),
    ).toNumber(),
  };
}

// ---------------------------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------------------------
export async function valuation(
  caller: Caller,
  q: { from: string; to: string; warehouseId?: string; page: number; size: number },
) {
  if (q.to < q.from)
    throw Errors.validation({ to: 'The end date must not be before the start date.' });
  const wh = q.warehouseId ? Prisma.sql`AND l.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    {
      item_id: string;
      item_code: string;
      item_name: string;
      warehouse_code: string;
      open_val: string;
      rec: string;
      iss: string;
      adj: string;
      close_val: string;
      close_qty: string;
      total: number;
    }[]
  >`
    WITH base AS (
      SELECT l.item_id, l.warehouse_id, l.posting_date, l.value, l.qty_in, l.qty_out,
             CASE WHEN l.voucher_type = 'REVERSAL' THEN (SELECT o.voucher_type FROM stock_ledger o WHERE o.id = l.reverses_id) ELSE l.voucher_type END AS bucket_type
      FROM stock_ledger l JOIN warehouses w ON w.id = l.warehouse_id
      WHERE ${unitScope(caller)} ${wh} AND l.posting_date <= ${q.to}::date
    )
    SELECT b.item_id::text, i.code AS item_code, i.name AS item_name, w.code AS warehouse_code,
      COALESCE(sum(b.value) FILTER (WHERE b.posting_date < ${q.from}::date),0)::text AS open_val,
      COALESCE(sum(b.value) FILTER (WHERE b.posting_date >= ${q.from}::date AND b.bucket_type IN ('OPENING','RECEIPT','TRANSFER_IN')),0)::text AS rec,
      COALESCE(-sum(b.value) FILTER (WHERE b.posting_date >= ${q.from}::date AND b.bucket_type IN ('ISSUE','TRANSFER_OUT')),0)::text AS iss,
      COALESCE(sum(b.value) FILTER (WHERE b.posting_date >= ${q.from}::date AND b.bucket_type NOT IN ('OPENING','RECEIPT','TRANSFER_IN','ISSUE','TRANSFER_OUT')),0)::text AS adj,
      COALESCE(sum(b.value),0)::text AS close_val, COALESCE(sum(b.qty_in - b.qty_out),0)::text AS close_qty, count(*) OVER()::int AS total
    FROM base b JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id
    GROUP BY b.item_id, b.warehouse_id, i.code, i.name, w.code
    HAVING COALESCE(sum(b.value),0) <> 0 OR COALESCE(sum(b.value) FILTER (WHERE b.posting_date >= ${q.from}::date),0) <> 0
    ORDER BY i.code, w.code LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
  return {
    from: q.from,
    to: q.to,
    rows: rows.map((r) => {
      const open = D(r.open_val),
        rec = D(r.rec),
        iss = D(r.iss),
        adj = D(r.adj),
        close = D(r.close_val);
      return {
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        warehouse: r.warehouse_code,
        opening: open.toNumber(),
        receipts: rec.toNumber(),
        issues: iss.toNumber(),
        adjustments: adj.toNumber(),
        closing: close.toNumber(),
        closingQty: Number(r.close_qty),
        // closing = opening + receipts - issues + adjustments (BR-INV-25)
        balanced: open.plus(rec).minus(iss).plus(adj).equals(close),
      };
    }),
    total: rows[0]?.total ?? 0,
  };
}

/** Stock value per inventory account key against the GL balance of that key (BR-INV-26). */
export async function glCompare(caller: Caller, asOf = todayIso()) {
  const stock = await prisma.$queryRaw<
    { unit_id: string; unit_code: string; k: string; v: string }[]
  >`
    SELECT w.unit_id::text, u.code AS unit_code,
           CASE WHEN w.is_transit THEN 'STOCK_IN_TRANSIT' ELSE COALESCE(m.inventory_key, 'INVENTORY_RM') END AS k,
           COALESCE(sum(l.value),0)::text AS v
    FROM stock_ledger l JOIN warehouses w ON w.id = l.warehouse_id JOIN units u ON u.id = w.unit_id
    JOIN items i ON i.id = l.item_id LEFT JOIN item_type_accounts m ON m.item_type = i.item_type
    WHERE l.posting_date <= ${asOf}::date AND ${unitScope(caller)}
    GROUP BY w.unit_id, u.code, k`;
  const defaults = await prisma.accountDefault.findMany({
    where: { key: { in: ['INVENTORY_RM', 'INVENTORY_WIP', 'INVENTORY_FG', 'STOCK_IN_TRANSIT'] } },
  });
  const out = [];
  for (const s of stock) {
    const def = defaults.find((d) => d.key === s.k);
    let glBal: Dec | null = null;
    if (def) {
      const r = await prisma.glEntry.aggregate({
        where: {
          unitId: s.unit_id,
          accountId: def.accountId,
          postingDate: { lte: new Date(`${asOf}T00:00:00Z`) },
        },
        _sum: { debit: true, credit: true },
      });
      glBal = D(r._sum.debit ?? 0).minus(r._sum.credit ?? 0);
    }
    const sv = D(s.v);
    out.push({
      unit: s.unit_code,
      key: s.k,
      stockValue: sv.toNumber(),
      glBalance: glBal ? glBal.toNumber() : null,
      variance: glBal ? round2(sv.minus(glBal)).toNumber() : null,
    });
  }
  return { asOf, rows: out, inBalance: out.every((r) => r.variance === 0) };
}

// ---------------------------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------------------------
export interface PolicyInput {
  itemId: string;
  warehouseId: string;
  method?: 'MIN_MAX' | 'ROP_EOQ';
  minQty?: number | string;
  maxQty?: number | string;
  leadTimeDays?: number;
  serviceLevelPct?: number | string;
  orderingCost?: number | string;
  holdingCostPct?: number | string;
  orderMultiple?: number | string;
  preferredSupplierId?: string | null;
  status?: 'Active' | 'Inactive';
}

async function dailyUsage(
  db: Db,
  itemId: string,
  warehouseId: string,
  days: number,
): Promise<Dec[]> {
  const r = await db.$queryRaw<{ q: string }[]>`
    SELECT COALESCE((SELECT sum(l.qty_out) FROM stock_ledger l WHERE l.item_id = ${itemId}::uuid AND l.warehouse_id = ${warehouseId}::uuid
        AND l.voucher_type = 'ISSUE' AND l.posting_date = d::date
        AND NOT EXISTS (SELECT 1 FROM stock_ledger x WHERE x.reverses_id = l.id)), 0)::text AS q
    FROM generate_series(current_date - ${days - 1}::int, current_date, interval '1 day') d`;
  return r.map((x) => D(x.q));
}

export async function calcPolicy(
  db: Db,
  p: Prisma.ReorderPolicyGetPayload<object>,
  usageWindowDays = 90,
) {
  const daily = await dailyUsage(db, p.itemId, p.warehouseId, usageWindowDays);
  const adu = round3(daily.reduce((a, b) => a.plus(b), ZERO).div(usageWindowDays));
  const sigma = sampleSigma(daily);
  const z = zFor(Number(p.serviceLevelPct));
  const ss = safetyStock(z, sigma, p.leadTimeDays, adu);
  const rop = reorderLevel(adu, p.leadTimeDays, ss);
  const bal = await db.$queryRaw<{ on_hand: string; reserved_qty: string; avg_rate: string }[]>`
    SELECT on_hand::text, reserved_qty::text, avg_rate::text FROM stock_balances WHERE item_id = ${p.itemId}::uuid AND warehouse_id = ${p.warehouseId}::uuid`;
  const unrestricted = await db.$queryRaw<{ q: string }[]>`
    SELECT COALESCE(sum(qty),0)::text AS q FROM stock_slices WHERE item_id = ${p.itemId}::uuid AND warehouse_id = ${p.warehouseId}::uuid AND stock_status = 'UNRESTRICTED'`;
  const held = await db.$queryRaw<{ q: string }[]>`
    SELECT COALESCE(sum(qty),0)::text AS q FROM stock_holds WHERE item_id = ${p.itemId}::uuid AND warehouse_id = ${p.warehouseId}::uuid AND status = 'Active'`;
  const transit = await db.$queryRaw<{ q: string }[]>`
    SELECT COALESCE(sum(l.dispatched_qty),0)::text AS q FROM stock_voucher_lines l JOIN stock_vouchers v ON v.id = l.voucher_id
    WHERE v.kind = 'TRANSFER' AND v.status = 'Dispatched' AND v.to_warehouse_id = ${p.warehouseId}::uuid AND l.item_id = ${p.itemId}::uuid`;
  const avail = D(unrestricted[0]?.q ?? '0')
    .minus(D(bal[0]?.reserved_qty ?? '0'))
    .minus(D(held[0]?.q ?? '0'));
  const available = avail.greaterThan(0) ? avail : ZERO;
  const item = await db.item.findUniqueOrThrow({
    where: { id: p.itemId },
    select: { standardCost: true },
  });
  const avg = D(bal[0]?.avg_rate ?? '0');
  const unitCost = avg.greaterThan(0) ? avg : D(item.standardCost ?? 0);
  const position = available.plus(D(transit[0]?.q ?? '0'));
  const eoqQty = eoq(adu, D(p.orderingCost), D(p.holdingCostPct), unitCost);
  const d = decide({
    method: p.method as 'MIN_MAX' | 'ROP_EOQ',
    minQty: D(p.minQty),
    maxQty: D(p.maxQty),
    multiple: D(p.orderMultiple),
    rop,
    eoq: eoqQty,
    position,
    available,
  });
  return { adu, sigma, safetyStock: ss, reorderLevel: rop, eoq: eoqQty, available, position, ...d };
}

export const reorderService = {
  async list(
    caller: Caller,
    q: { status?: string; warehouseId?: string; page: number; size: number },
  ) {
    const where: Prisma.ReorderPolicyWhereInput = {
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      warehouse: caller.ctx.unitId
        ? { unitId: caller.ctx.unitId }
        : caller.ctx.allUnits
          ? {}
          : { id: { in: [] } },
    } as never;
    // reorder_policies has no relation to warehouses in Prisma (scalar models): scope by warehouse ids of the unit.
    const whs = await prisma.warehouse.findMany({
      where: {
        deletedAt: null,
        ...(caller.ctx.unitId
          ? { unitId: caller.ctx.unitId }
          : caller.ctx.allUnits
            ? {}
            : { id: { in: [] } }),
      },
      select: { id: true, code: true },
    });
    const policies = await prisma.reorderPolicy.findMany({
      where: { warehouseId: q.warehouseId ? q.warehouseId : { in: whs.map((w) => w.id) } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.size,
      take: q.size,
    });
    void where;
    const total = await prisma.reorderPolicy.count({
      where: { warehouseId: q.warehouseId ? q.warehouseId : { in: whs.map((w) => w.id) } },
    });
    const items = await prisma.item.findMany({
      where: { id: { in: policies.map((p) => p.itemId) } },
      select: { id: true, code: true, name: true },
    });
    const rows = [];
    for (const p of policies) {
      const c = p.status === 'Active' ? await calcPolicy(prisma, p) : null;
      const it = items.find((i) => i.id === p.itemId);
      rows.push({
        id: p.id,
        itemId: p.itemId,
        itemCode: it?.code,
        itemName: it?.name,
        warehouseId: p.warehouseId,
        warehouse: whs.find((w) => w.id === p.warehouseId)?.code,
        method: p.method,
        minQty: num(p.minQty),
        maxQty: num(p.maxQty),
        leadTimeDays: p.leadTimeDays,
        serviceLevelPct: num(p.serviceLevelPct),
        orderingCost: num(p.orderingCost),
        holdingCostPct: num(p.holdingCostPct),
        orderMultiple: num(p.orderMultiple),
        status: p.status,
        version: p.version,
        calc: c
          ? {
              adu: num(c.adu),
              safetyStock: num(c.safetyStock),
              reorderLevel: num(c.reorderLevel),
              eoq: num(c.eoq),
              available: num(c.available),
              position: num(c.position),
              trigger: num(c.trigger),
              suggested: num(c.suggested),
              status: c.status,
            }
          : null,
      });
    }
    return {
      rows: q.status ? rows.filter((r) => (r.calc?.status ?? 'Inactive') === q.status) : rows,
      total,
    };
  },

  async save(caller: Caller, id: string | null, version: number | null, p: PolicyInput) {
    const [item, wh] = await Promise.all([
      prisma.item.findFirst({ where: { id: p.itemId, deletedAt: null } }),
      prisma.warehouse.findFirst({ where: { id: p.warehouseId, deletedAt: null } }),
    ]);
    if (!item) throw Errors.validation({ itemId: 'Choose an item.' });
    if (!wh || wh.isTransit) throw Errors.validation({ warehouseId: 'Choose a warehouse.' });
    const min = D(p.minQty ?? 0),
      max = D(p.maxQty ?? 0);
    if (min.lessThan(0) || max.lessThan(min))
      throw Errors.validation({ maxQty: 'The maximum must not be below the minimum.' });
    const sl = Number(p.serviceLevelPct ?? 95);
    if (sl < 50 || sl > 99.9)
      throw Errors.validation({ serviceLevelPct: 'Use a service level between 50 and 99.9.' });
    const data = {
      method: p.method ?? 'MIN_MAX',
      minQty: str(min),
      maxQty: str(max),
      leadTimeDays: p.leadTimeDays ?? 7,
      serviceLevelPct: String(sl),
      orderingCost: str(D(p.orderingCost ?? 0)),
      holdingCostPct: str(D(p.holdingCostPct ?? 20)),
      orderMultiple: str(D(p.orderMultiple ?? 1)),
      preferredSupplierId: p.preferredSupplierId ?? null,
      status: p.status ?? 'Active',
    };
    if (D(data.orderMultiple).lessThanOrEqualTo(0))
      throw Errors.validation({ orderMultiple: 'Must be more than 0.' });
    return prisma.$transaction(async (tx) => {
      if (id) {
        const r = await tx.reorderPolicy.updateMany({
          where: { id, version: version ?? -1 },
          data: { ...data, version: { increment: 1 }, updatedById: caller.auth.userId },
        });
        if (r.count !== 1) {
          if (!(await tx.reorderPolicy.findUnique({ where: { id } })))
            throw Errors.notFound('Policy not found.');
          throw Errors.versionConflict();
        }
      } else if (
        await tx.reorderPolicy.findUnique({
          where: { itemId_warehouseId: { itemId: p.itemId, warehouseId: p.warehouseId } },
        })
      ) {
        throw Errors.duplicate({ itemId: 'This item already has a policy in this warehouse.' });
      }
      const row = id
        ? await tx.reorderPolicy.findUniqueOrThrow({ where: { id } })
        : await tx.reorderPolicy.create({
            data: {
              itemId: p.itemId,
              warehouseId: p.warehouseId,
              ...data,
              createdById: caller.auth.userId,
            },
          });
      await writeAudit(
        tx,
        caller,
        'REORDER_POLICY_CHANGED',
        'Policy',
        { id: row.id, code: item.code },
        'inv-reorder',
        { warehouseId: p.warehouseId },
      );
      return row;
    });
  },

  /** Recalculate every active policy and keep ONE open suggestion for each that is triggered (the job and the button). */
  async recalculate(db: Db = prisma, caller?: Caller): Promise<{ checked: number; open: number }> {
    const policies = await db.reorderPolicy.findMany({ where: { status: 'Active' } });
    let open = 0;
    for (const p of policies) {
      const c = await calcPolicy(db, p);
      const existing = await db.reorderSuggestion.findFirst({
        where: { policyId: p.id, status: 'Open' },
      });
      if (c.triggered && c.suggested.greaterThan(0)) {
        const data = {
          suggestedQty: str(c.suggested),
          positionQty: str(c.position),
          triggerQty: str(c.trigger),
        };
        if (existing) await db.reorderSuggestion.update({ where: { id: existing.id }, data });
        else await db.reorderSuggestion.create({ data: { policyId: p.id, ...data } });
        open += 1;
      } else if (existing) {
        await db.reorderSuggestion.update({
          where: { id: existing.id },
          data: { status: 'Dismissed', dismissReason: 'No longer needed' },
        });
      }
    }
    void caller;
    return { checked: policies.length, open };
  },

  async suggestions(caller: Caller, q: { status?: string; page: number; size: number }) {
    const whs = await prisma.warehouse.findMany({
      where: {
        deletedAt: null,
        ...(caller.ctx.unitId
          ? { unitId: caller.ctx.unitId }
          : caller.ctx.allUnits
            ? {}
            : { id: { in: [] } }),
      },
      select: { id: true, code: true },
    });
    const policies = await prisma.reorderPolicy.findMany({
      where: { warehouseId: { in: whs.map((w) => w.id) } },
    });
    const where = {
      policyId: { in: policies.map((p) => p.id) },
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.reorderSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.reorderSuggestion.count({ where }),
    ]);
    const items = await prisma.item.findMany({
      where: { id: { in: policies.map((p) => p.itemId) } },
      select: { id: true, code: true, name: true },
    });
    return {
      rows: rows.map((s) => {
        const p = policies.find((x) => x.id === s.policyId)!;
        const it = items.find((i) => i.id === p.itemId);
        return {
          id: s.id,
          policyId: s.policyId,
          itemCode: it?.code,
          itemName: it?.name,
          warehouse: whs.find((w) => w.id === p.warehouseId)?.code,
          suggestedQty: num(s.suggestedQty),
          positionQty: num(s.positionQty),
          triggerQty: num(s.triggerQty),
          status: s.status,
          prRef: s.prRef,
          createdAt: s.createdAt.toISOString(),
        };
      }),
      total,
    };
  },

  async resolve(caller: Caller, id: string, action: 'convert' | 'dismiss', text: string) {
    const t = text.trim();
    if (t.length < 2)
      throw Errors.validation({
        text: action === 'convert' ? 'Enter the purchase request number.' : 'Give a reason.',
      });
    const r = await prisma.reorderSuggestion.updateMany({
      where: { id, status: 'Open' },
      data:
        action === 'convert'
          ? { status: 'Converted', prRef: t }
          : { status: 'Dismissed', dismissReason: t },
    });
    if (r.count !== 1) throw Errors.conflict('This suggestion is no longer open.');
    void caller;
    return prisma.reorderSuggestion.findUniqueOrThrow({ where: { id } });
  },
};

// ---------------------------------------------------------------------------------------------
// Integrity (INV-1..INV-5), used by GET /inventory/integrity and the PHASE-08 report
// ---------------------------------------------------------------------------------------------
export interface IntegrityCheck {
  id: string;
  name: string;
  ok: boolean;
  mismatches: { ref: string; expected: string; actual: string }[];
}

export async function integrity(
  db: Db = prisma,
): Promise<{ ok: boolean; checks: IntegrityCheck[] }> {
  const q = <T>(s: Prisma.Sql) => db.$queryRaw<T[]>(s);
  const inv1 = await q<{ ref: string; e: string; a: string }>(Prisma.sql`
    SELECT b.item_id::text || '/' || b.warehouse_id::text AS ref, COALESCE(s.q,0)::text || ' / ' || COALESCE(s.v,0)::text AS e, b.on_hand::text || ' / ' || b.value::text AS a
    FROM stock_balances b LEFT JOIN (SELECT item_id, warehouse_id, sum(qty_in - qty_out) q, sum(value) v FROM stock_ledger GROUP BY 1,2) s
      ON s.item_id = b.item_id AND s.warehouse_id = b.warehouse_id
    WHERE b.on_hand <> COALESCE(s.q,0) OR b.value <> COALESCE(s.v,0) LIMIT 50`);
  const inv2 = await q<{ ref: string; e: string; a: string }>(Prisma.sql`
    WITH r AS (SELECT id, item_id, warehouse_id, balance_qty, balance_value,
                      sum(qty_in - qty_out) OVER w AS rq, sum(value) OVER w AS rv
               FROM stock_ledger WINDOW w AS (PARTITION BY item_id, warehouse_id ORDER BY posted_at, id))
    SELECT id::text AS ref, rq::text || ' / ' || rv::text AS e, balance_qty::text || ' / ' || balance_value::text AS a
    FROM r WHERE balance_qty <> rq OR balance_value <> rv LIMIT 50`);
  const inv3 = await q<{ ref: string; e: string; a: string }>(Prisma.sql`
    SELECT b.item_id::text || '/' || b.warehouse_id::text AS ref, b.on_hand::text AS e, COALESCE(s.q,0)::text AS a
    FROM stock_balances b LEFT JOIN (SELECT item_id, warehouse_id, sum(qty) q FROM stock_slices GROUP BY 1,2) s
      ON s.item_id = b.item_id AND s.warehouse_id = b.warehouse_id
    WHERE b.on_hand <> COALESCE(s.q,0) LIMIT 50`);
  const inv4 = await q<{ ref: string; e: string; a: string }>(Prisma.sql`
    SELECT b.item_id::text || '/' || b.warehouse_id::text AS ref, 'reserved <= on hand' AS e, b.reserved_qty::text || ' > ' || b.on_hand::text AS a
    FROM stock_balances b WHERE b.reserved_qty > b.on_hand LIMIT 50`);
  const inv5 = await q<{ ref: string; e: string; a: string }>(Prisma.sql`
    SELECT i.code AS ref, 'serials in stock = on hand' AS e, (COALESCE(sn.c,0))::text || ' vs ' || COALESCE(sb.q,0)::text AS a
    FROM items i LEFT JOIN (SELECT item_id, count(*) c FROM serial_numbers WHERE status IN ('In Stock','Reserved') GROUP BY 1) sn ON sn.item_id = i.id
    LEFT JOIN (SELECT b.item_id, sum(b.on_hand) q FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id AND NOT w.is_transit GROUP BY 1) sb ON sb.item_id = i.id
    WHERE i.serial_tracked AND COALESCE(sn.c,0) <> COALESCE(sb.q,0) LIMIT 50`);
  const inv6 = await q<{ ref: string; e: string; a: string }>(Prisma.sql`
    SELECT i.code AS ref, 'stock carries a batch' AS e, sl.q::text || ' un-batched' AS a
    FROM items i JOIN (SELECT item_id, sum(qty) q FROM stock_slices WHERE batch_id = '00000000-0000-0000-0000-000000000000' GROUP BY 1) sl ON sl.item_id = i.id
    WHERE i.batch_tracked AND sl.q > 0 LIMIT 50`);
  const inv7 = await q<{ ref: string; e: string; a: string }>(Prisma.sql`
    SELECT l.challan_no || ' / ' || i.code AS ref, COALESCE(g.q,0)::text AS e, l.balance_qty::text AS a
    FROM customer_material_lots l JOIN items i ON i.id = l.item_id
    LEFT JOIN (SELECT lot_id, sum(qty) q FROM customer_material_ledger GROUP BY 1) g ON g.lot_id = l.id
    WHERE l.balance_qty <> COALESCE(g.q,0) LIMIT 50`);
  const mk = (
    id: string,
    name: string,
    rows: { ref: string; e: string; a: string }[],
  ): IntegrityCheck => ({
    id,
    name,
    ok: rows.length === 0,
    mismatches: rows.map((r) => ({ ref: r.ref, expected: r.e, actual: r.a })),
  });
  const checks = [
    mk('INV-1', 'Balance = sum of the ledger (quantity and value)', inv1),
    mk('INV-2', 'Every ledger row carries the running balance', inv2),
    mk('INV-3', 'Slices (batch / bin / status) add up to the balance', inv3),
    mk('INV-4', 'Reserved never exceeds on hand', inv4),
    mk('INV-5', 'Serial numbers in stock = on hand (serial items)', inv5),
    mk('INV-6', 'Batch-tracked items hold no un-batched stock', inv6),
    mk('INV-7', 'Customer material: lot balance = its ledger', inv7),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
