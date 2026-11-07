// Customer-supplied material (Phase 8, client requirement 4 / ERRATA E-32). The customer's own material kept in our
// stores is tracked in separate tables with NO value: it never enters stock_balances, stock_ledger, stock_slices
// or the GL, so "stock value = GL" cannot be disturbed and our production can never use it by accident.
//   Receipt (customer sends material on their challan) -> creates one lot per line.
//   Issue   (we take material from a lot for the customer's job)  -> needs a reference (job / work order).
//   Return  (we send material back on OUR challan)              -> needs a challan number.
// Posted documents are never edited; Cancel posts the reverse movements dated the cancel date.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { escapeLike } from '../../core/http/query-safety';
import { NumberingService } from '../../core/numbering';
import type { Caller } from '../records/service';
import { D, num, round3, str } from './money';
import { concreteUnit, writeAudit } from './typed';

export type DocType = 'RECEIPT' | 'ISSUE' | 'RETURN';
const PREFIX: Record<DocType, string> = { RECEIPT: 'CMR', ISSUE: 'CMI', RETURN: 'CMT' };
const PAGE = 'inv-transactions';

const isoOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

export interface ReceiptLineInput {
  itemId: string;
  qty: number | string;
  batchNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  remarks?: string | null;
}
export interface PickLineInput {
  lotId: string;
  qty: number | string;
  remarks?: string | null;
}
export interface DocHeaderInput {
  customerId: string;
  warehouseId: string;
  docDate: string;
  challanNo?: string | null;
  challanDate?: string | null;
  vehicleNo?: string | null;
  reference?: string | null;
  remarks?: string | null;
}

export interface LotQuery {
  q?: string;
  customerId?: string;
  itemId?: string;
  warehouseId?: string;
  withBalanceOnly?: boolean;
  page: number;
  size: number;
}
export interface DocQuery {
  q?: string;
  type?: string;
  customerId?: string;
  status?: string;
  page: number;
  size: number;
}

function expiryState(expiry: string | null, balance: number): string {
  if (!expiry || balance <= 0) return 'none';
  const days = Math.round((at(expiry).getTime() - at(todayIso()).getTime()) / 86_400_000);
  if (days < 0) return 'expired';
  return days <= 30 ? 'soon' : 'ok';
}

interface LotRow {
  id: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string | null;
  warehouse_id: string;
  warehouse_code: string;
  batch_no: string | null;
  mfg_date: Date | null;
  expiry_date: Date | null;
  challan_no: string;
  challan_date: Date;
  received_qty: string;
  balance_qty: string;
  created_at: Date;
}

const lotDto = (r: LotRow) => ({
  id: r.id,
  customerId: r.customer_id,
  customerCode: r.customer_code,
  customerName: r.customer_name,
  itemId: r.item_id,
  itemCode: r.item_code,
  itemName: r.item_name,
  uom: r.uom,
  warehouseId: r.warehouse_id,
  warehouseCode: r.warehouse_code,
  batchNo: r.batch_no,
  mfgDate: isoOf(r.mfg_date),
  expiryDate: isoOf(r.expiry_date),
  expiry: expiryState(isoOf(r.expiry_date), Number(r.balance_qty)),
  challanNo: r.challan_no,
  challanDate: isoOf(r.challan_date),
  receivedQty: Number(r.received_qty),
  balanceQty: Number(r.balance_qty),
  receivedAt: r.created_at.toISOString(),
});

const LOT_SELECT = `
  SELECT l.id::text, l.customer_id::text, c.code AS customer_code, c.name AS customer_name,
         l.item_id::text, i.code AS item_code, i.name AS item_name, i.base_uom AS uom,
         l.warehouse_id::text, w.code AS warehouse_code, l.batch_no, l.mfg_date, l.expiry_date,
         l.challan_no, l.challan_date, l.received_qty::text, l.balance_qty::text, l.created_at
    FROM customer_material_lots l
    JOIN customers c ON c.id = l.customer_id
    JOIN items i ON i.id = l.item_id
    JOIN warehouses w ON w.id = l.warehouse_id`;

type Tx = Prisma.TransactionClient;

async function checkBase(tx: Tx, caller: Caller, h: DocHeaderInput, unitId: string) {
  if (h.docDate > todayIso())
    throw Errors.validation({ docDate: 'The date cannot be in the future.' });
  const [cust, wh] = await Promise.all([
    tx.customer.findFirst({ where: { id: h.customerId, deletedAt: null } }),
    tx.warehouse.findFirst({ where: { id: h.warehouseId, deletedAt: null } }),
  ]);
  if (!cust || cust.status !== 'ACTIVE')
    throw Errors.validation({ customerId: 'Choose an active customer.' });
  if (!wh || wh.status !== 'ACTIVE' || wh.isTransit)
    throw Errors.validation({ warehouseId: 'Choose an active warehouse.' });
  if (wh.unitId !== unitId)
    throw Errors.contextInvalid('This warehouse belongs to another unit. Switch unit first.');
  if (wh.frozenByCountId)
    throw Errors.warehouseFrozen(
      `Warehouse ${wh.code} is frozen for a physical count. Try again after the count is posted.`,
    );
  void caller;
  return { cust, wh };
}

async function ledgerRow(
  tx: Tx,
  p: {
    lotId: string;
    docId: string;
    lineId: string;
    type: string;
    qty: Prisma.Decimal;
    balanceAfter: Prisma.Decimal;
    date: string;
    userId: string;
  },
) {
  await tx.customerMaterialLedger.create({
    data: {
      lotId: p.lotId,
      docId: p.docId,
      lineId: p.lineId,
      entryType: p.type,
      qty: str(p.qty),
      balanceAfter: str(p.balanceAfter),
      entryDate: at(p.date),
      createdById: p.userId,
    },
  });
}

async function lockLots(tx: Tx, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  const rows = await tx.$queryRaw<
    {
      id: string;
      customer_id: string;
      item_id: string;
      warehouse_id: string;
      unit_id: string;
      received_qty: string;
      balance_qty: string;
      expiry_date: Date | null;
      batch_no: string | null;
    }[]
  >`
    SELECT id::text, customer_id::text, item_id::text, warehouse_id::text, unit_id::text,
           received_qty::text, balance_qty::text, expiry_date, batch_no
      FROM customer_material_lots WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, r]));
}

export const customerMaterialService = {
  // ------------------------------------------------------------------ reads
  async lots(caller: Caller, q: LotQuery) {
    const unitId = caller.ctx.unitId;
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      args.push(v);
      where.push(sql.replace('?', `$${args.length}`));
    };
    if (unitId) add('l.unit_id = ?::uuid', unitId);
    if (q.customerId) add('l.customer_id = ?::uuid', q.customerId);
    if (q.itemId) add('l.item_id = ?::uuid', q.itemId);
    if (q.warehouseId) add('l.warehouse_id = ?::uuid', q.warehouseId);
    if (q.withBalanceOnly) where.push('l.balance_qty > 0');
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      args.push(like);
      const n = `$${args.length}`;
      where.push(
        `(c.name ILIKE ${n} OR c.code ILIKE ${n} OR i.name ILIKE ${n} OR i.code ILIKE ${n} OR l.challan_no ILIKE ${n} OR l.batch_no ILIKE ${n})`,
      );
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await prisma.$queryRawUnsafe<LotRow[]>(
      `${LOT_SELECT} ${clause} ORDER BY l.created_at DESC, l.id LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const cnt = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM customer_material_lots l JOIN customers c ON c.id = l.customer_id JOIN items i ON i.id = l.item_id ${clause}`,
      ...args,
    );
    return { rows: rows.map(lotDto), total: cnt[0]?.n ?? 0 };
  },

  /** Active customers for the pickers (so store staff need no rights on the customer master). */
  async customers() {
    const rows = await prisma.customer.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return rows;
  },

  /** Customer-wise register: quantity per customer and item (no rupees: the material is not ours). */
  async balances(caller: Caller) {
    const unitId = caller.ctx.unitId;
    const rows = await prisma.$queryRaw<
      {
        customer_id: string;
        customer_name: string;
        item_id: string;
        item_code: string;
        item_name: string;
        warehouse_code: string;
        lots: number;
        received: string;
        balance: string;
        next_expiry: Date | null;
      }[]
    >`
      SELECT l.customer_id::text, c.name AS customer_name, l.item_id::text, i.code AS item_code, i.name AS item_name,
             w.code AS warehouse_code, count(*)::int AS lots, sum(l.received_qty)::text AS received,
             sum(l.balance_qty)::text AS balance,
             min(l.expiry_date) FILTER (WHERE l.balance_qty > 0) AS next_expiry
        FROM customer_material_lots l
        JOIN customers c ON c.id = l.customer_id
        JOIN items i ON i.id = l.item_id
        JOIN warehouses w ON w.id = l.warehouse_id
       WHERE (${unitId}::uuid IS NULL OR l.unit_id = ${unitId}::uuid)
       GROUP BY l.customer_id, c.name, l.item_id, i.code, i.name, w.code
      HAVING sum(l.balance_qty) > 0 OR sum(l.received_qty) > 0
       ORDER BY c.name, i.code`;
    return rows.map((r) => ({
      customerId: r.customer_id,
      customerName: r.customer_name,
      itemId: r.item_id,
      itemCode: r.item_code,
      itemName: r.item_name,
      warehouseCode: r.warehouse_code,
      lots: r.lots,
      receivedQty: Number(r.received),
      balanceQty: Number(r.balance),
      nextExpiry: isoOf(r.next_expiry),
      expiry: expiryState(isoOf(r.next_expiry), Number(r.balance)),
    }));
  },

  async docs(caller: Caller, q: DocQuery) {
    const unitId = caller.ctx.unitId;
    const where: Prisma.CustomerMaterialDocWhereInput = {
      ...(unitId ? { unitId } : {}),
      ...(q.type ? { docType: q.type } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { challanNo: { contains: q.q, mode: 'insensitive' } },
              { reference: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.customerMaterialDoc.findMany({
        where,
        orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.customerMaterialDoc.count({ where }),
    ]);
    const [custs, whs, lineAgg] = await Promise.all([
      prisma.customer.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } },
        select: { id: true, name: true },
      }),
      prisma.warehouse.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.warehouseId))] } },
        select: { id: true, code: true },
      }),
      prisma.customerMaterialLine.groupBy({
        by: ['docId'],
        where: { docId: { in: rows.map((r) => r.id) } },
        _sum: { qty: true },
        _count: { _all: true },
      }),
    ]);
    return {
      rows: rows.map((d) => ({
        ...docHead(d),
        customerName: custs.find((c) => c.id === d.customerId)?.name ?? '',
        warehouseCode: whs.find((w) => w.id === d.warehouseId)?.code ?? '',
        lines: lineAgg.find((a) => a.docId === d.id)?._count._all ?? 0,
        totalQty: num(lineAgg.find((a) => a.docId === d.id)?._sum.qty ?? null) ?? 0,
      })),
      total,
    };
  },

  async get(caller: Caller, id: string) {
    const d = await prisma.customerMaterialDoc.findFirst({
      where: { id, ...(caller.ctx.unitId ? { unitId: caller.ctx.unitId } : {}) },
    });
    if (!d) throw Errors.notFound('Document not found.');
    const [lines, cust, wh] = await Promise.all([
      prisma.customerMaterialLine.findMany({ where: { docId: id }, orderBy: { lineNo: 'asc' } }),
      prisma.customer.findUnique({
        where: { id: d.customerId },
        select: { name: true, code: true },
      }),
      prisma.warehouse.findUnique({ where: { id: d.warehouseId }, select: { code: true } }),
    ]);
    const lotIds = lines.map((l) => l.lotId);
    const lots = lotIds.length
      ? await prisma.$queryRawUnsafe<LotRow[]>(`${LOT_SELECT} WHERE l.id = ANY($1::uuid[])`, lotIds)
      : [];
    return {
      ...docHead(d),
      customerName: cust?.name ?? '',
      customerCode: cust?.code ?? '',
      warehouseCode: wh?.code ?? '',
      lines: lines.map((l) => {
        const lot = lots.find((x) => x.id === l.lotId);
        return {
          id: l.id,
          lineNo: l.lineNo,
          lotId: l.lotId,
          itemId: l.itemId,
          itemCode: lot?.item_code ?? '',
          itemName: lot?.item_name ?? '',
          batchNo: lot?.batch_no ?? null,
          expiryDate: isoOf(lot?.expiry_date ?? null),
          challanNo: lot?.challan_no ?? '',
          qty: num(l.qty),
          remarks: l.remarks,
        };
      }),
    };
  },

  /** Every movement of one lot, newest first (for the "History" button). */
  async history(caller: Caller, lotId: string) {
    const lot = await prisma.customerMaterialLot.findFirst({
      where: { id: lotId, ...(caller.ctx.unitId ? { unitId: caller.ctx.unitId } : {}) },
    });
    if (!lot) throw Errors.notFound('Lot not found.');
    const rows = await prisma.$queryRaw<
      {
        id: string;
        entry_type: string;
        qty: string;
        balance_after: string;
        entry_date: Date;
        code: string;
        doc_id: string;
        user_name: string | null;
      }[]
    >`
      SELECT e.id::text, e.entry_type, e.qty::text, e.balance_after::text, e.entry_date, d.code, d.id::text AS doc_id,
             u.name AS user_name
        FROM customer_material_ledger e
        JOIN customer_material_docs d ON d.id = e.doc_id
        LEFT JOIN users u ON u.id = e.created_by_id
       WHERE e.lot_id = ${lotId}::uuid ORDER BY e.created_at DESC, e.id DESC`;
    return rows.map((r) => ({
      id: r.id,
      type: r.entry_type,
      qty: Number(r.qty),
      balanceAfter: Number(r.balance_after),
      date: isoOf(r.entry_date),
      docCode: r.code,
      docId: r.doc_id,
      by: r.user_name ?? '',
    }));
  },

  // ------------------------------------------------------------------ posting
  async receipt(caller: Caller, h: DocHeaderInput, lines: ReceiptLineInput[]) {
    const unitId = concreteUnit(caller);
    const challanNo = (h.challanNo ?? '').trim();
    if (!challanNo)
      throw Errors.validation({
        challanNo: 'Enter the customer challan number that came with the material.',
      });
    if (!h.challanDate)
      throw Errors.validation({ challanDate: 'Enter the date of the customer challan.' });
    if (h.challanDate > h.docDate)
      throw Errors.validation({
        challanDate: 'The challan date cannot be after the receipt date.',
      });
    if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one item.' });
    const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
    if (!fy) throw Errors.contextInvalid('Unknown financial year.');

    return prisma
      .$transaction(async (tx) => {
        await checkBase(tx, caller, h, unitId);
        const seen = new Set<string>();
        const prepared: {
          itemId: string;
          qty: Prisma.Decimal;
          batchNo: string | null;
          mfg: string | null;
          exp: string | null;
          remarks: string | null;
        }[] = [];
        for (const [i, l] of lines.entries()) {
          const key = `lines.${i}`;
          const qty = round3(D(l.qty));
          if (qty.lessThanOrEqualTo(0))
            throw Errors.validation({ [`${key}.qty`]: 'Enter a quantity greater than 0.' });
          const item = await tx.item.findFirst({ where: { id: l.itemId, deletedAt: null } });
          if (!item || item.status !== 'ACTIVE')
            throw Errors.validation({ [`${key}.itemId`]: 'Choose an active item.' });
          const batchNo = l.batchNo?.trim() || null;
          if (item.batchTracked && !batchNo)
            throw Errors.validation({
              [`${key}.batchNo`]: `Item ${item.code} is batch tracked: enter the batch number printed on the pack.`,
            });
          if (l.mfgDate && l.expiryDate && l.expiryDate <= l.mfgDate)
            throw Errors.validation({
              [`${key}.expiryDate`]: 'Expiry must be after the manufacturing date.',
            });
          if (l.expiryDate && l.expiryDate < h.docDate)
            throw Errors.validation({
              [`${key}.expiryDate`]:
                'This material has already expired; do not accept it into the store.',
            });
          const dupKey = `${l.itemId}|${batchNo ?? ''}`;
          if (seen.has(dupKey))
            throw Errors.validation({
              [`${key}.itemId`]: 'This item and batch is already on another line.',
            });
          seen.add(dupKey);
          const clash = await tx.customerMaterialLot.findFirst({
            where: { unitId, customerId: h.customerId, challanNo, itemId: l.itemId, batchNo },
          });
          if (clash)
            throw Errors.duplicate({
              [`${key}.itemId`]: `Challan ${challanNo} already brought this item${batchNo ? ` (batch ${batchNo})` : ''}. It looks like a double entry.`,
            });
          prepared.push({
            itemId: l.itemId,
            qty,
            batchNo,
            mfg: l.mfgDate ?? null,
            exp: l.expiryDate ?? null,
            remarks: l.remarks ?? null,
          });
        }
        const code = await NumberingService.allocate(tx, {
          pageId: 'inv-custmat-receipt',
          unitId,
          fyId: fy.id,
          prefix: PREFIX.RECEIPT,
          padding: 4,
        });
        const doc = await tx.customerMaterialDoc.create({
          data: {
            code,
            unitId,
            fyId: fy.id,
            docType: 'RECEIPT',
            docDate: at(h.docDate),
            customerId: h.customerId,
            warehouseId: h.warehouseId,
            challanNo,
            challanDate: at(h.challanDate!),
            vehicleNo: h.vehicleNo?.trim() || null,
            remarks: h.remarks?.trim() || null,
            createdById: caller.auth.userId,
          },
        });
        for (const [i, p] of prepared.entries()) {
          const lot = await tx.customerMaterialLot.create({
            data: {
              unitId,
              customerId: h.customerId,
              itemId: p.itemId,
              warehouseId: h.warehouseId,
              batchNo: p.batchNo,
              mfgDate: p.mfg ? at(p.mfg) : null,
              expiryDate: p.exp ? at(p.exp) : null,
              challanNo,
              challanDate: at(h.challanDate!),
              receivedQty: str(p.qty),
              balanceQty: str(p.qty),
              createdById: caller.auth.userId,
            },
          });
          const line = await tx.customerMaterialLine.create({
            data: {
              docId: doc.id,
              lineNo: i + 1,
              lotId: lot.id,
              itemId: p.itemId,
              qty: str(p.qty),
              remarks: p.remarks,
            },
          });
          await ledgerRow(tx, {
            lotId: lot.id,
            docId: doc.id,
            lineId: line.id,
            type: 'RECEIPT',
            qty: p.qty,
            balanceAfter: p.qty,
            date: h.docDate,
            userId: caller.auth.userId,
          });
        }
        await writeAudit(
          tx,
          caller,
          'CUSTOMER_MATERIAL_RECEIVED',
          'Voucher',
          { id: doc.id, code },
          PAGE,
          {
            unitId,
            customerId: h.customerId,
            challanNo,
            lines: prepared.length,
          },
        );
        return doc.id;
      })
      .then((id) => customerMaterialService.get(caller, id));
  },

  async take(caller: Caller, type: 'ISSUE' | 'RETURN', h: DocHeaderInput, lines: PickLineInput[]) {
    const unitId = concreteUnit(caller);
    if (type === 'ISSUE' && !(h.reference ?? '').trim())
      throw Errors.validation({
        reference: 'Write why the material is taken, for example the job or work order number.',
      });
    if (type === 'RETURN') {
      if (!(h.challanNo ?? '').trim())
        throw Errors.validation({
          challanNo: 'Enter the challan number of the return (our challan).',
        });
      if (!h.challanDate)
        throw Errors.validation({ challanDate: 'Enter the date of the return challan.' });
      if (h.challanDate > h.docDate)
        throw Errors.validation({
          challanDate: 'The challan date cannot be after the return date.',
        });
    }
    if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one lot.' });
    const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
    if (!fy) throw Errors.contextInvalid('Unknown financial year.');

    return prisma
      .$transaction(async (tx) => {
        await checkBase(tx, caller, h, unitId);
        const locked = await lockLots(
          tx,
          lines.map((l) => l.lotId),
        );
        const used = new Set<string>();
        const prepared: {
          lotId: string;
          itemId: string;
          qty: Prisma.Decimal;
          remarks: string | null;
          after: Prisma.Decimal;
        }[] = [];
        for (const [i, l] of lines.entries()) {
          const key = `lines.${i}`;
          const lot = locked.get(l.lotId);
          if (!lot || lot.unit_id !== unitId)
            throw Errors.validation({ [`${key}.lotId`]: 'Choose a lot from the list.' });
          if (lot.customer_id !== h.customerId)
            throw Errors.validation({ [`${key}.lotId`]: 'This lot belongs to another customer.' });
          if (lot.warehouse_id !== h.warehouseId)
            throw Errors.validation({ [`${key}.lotId`]: 'This lot is kept in another warehouse.' });
          if (used.has(l.lotId))
            throw Errors.validation({ [`${key}.lotId`]: 'This lot is already on another line.' });
          used.add(l.lotId);
          const qty = round3(D(l.qty));
          if (qty.lessThanOrEqualTo(0))
            throw Errors.validation({ [`${key}.qty`]: 'Enter a quantity greater than 0.' });
          const bal = D(lot.balance_qty);
          if (qty.greaterThan(bal))
            throw Errors.insufficientStock(
              `Only ${bal.toFixed()} is left in this lot; you asked for ${qty.toFixed()}.`,
            );
          if (type === 'ISSUE' && lot.expiry_date && isoOf(lot.expiry_date)! < h.docDate)
            throw Errors.batchExpired(
              `Batch ${lot.batch_no ?? ''} expired on ${isoOf(lot.expiry_date)}. Return it to the customer instead of using it.`,
            );
          prepared.push({
            lotId: l.lotId,
            itemId: lot.item_id,
            qty,
            remarks: l.remarks ?? null,
            after: bal.minus(qty),
          });
        }
        const code = await NumberingService.allocate(tx, {
          pageId: type === 'ISSUE' ? 'inv-custmat-issue' : 'inv-custmat-return',
          unitId,
          fyId: fy.id,
          prefix: PREFIX[type],
          padding: 4,
        });
        const doc = await tx.customerMaterialDoc.create({
          data: {
            code,
            unitId,
            fyId: fy.id,
            docType: type,
            docDate: at(h.docDate),
            customerId: h.customerId,
            warehouseId: h.warehouseId,
            challanNo: h.challanNo?.trim() || null,
            challanDate: h.challanDate ? at(h.challanDate) : null,
            vehicleNo: h.vehicleNo?.trim() || null,
            reference: h.reference?.trim() || null,
            remarks: h.remarks?.trim() || null,
            createdById: caller.auth.userId,
          },
        });
        for (const [i, p] of prepared.entries()) {
          const line = await tx.customerMaterialLine.create({
            data: {
              docId: doc.id,
              lineNo: i + 1,
              lotId: p.lotId,
              itemId: p.itemId,
              qty: str(p.qty),
              remarks: p.remarks,
            },
          });
          await tx.customerMaterialLot.update({
            where: { id: p.lotId },
            data: { balanceQty: str(p.after), updatedAt: new Date() },
          });
          await ledgerRow(tx, {
            lotId: p.lotId,
            docId: doc.id,
            lineId: line.id,
            type,
            qty: p.qty.negated(),
            balanceAfter: p.after,
            date: h.docDate,
            userId: caller.auth.userId,
          });
        }
        await writeAudit(
          tx,
          caller,
          type === 'ISSUE' ? 'CUSTOMER_MATERIAL_ISSUED' : 'CUSTOMER_MATERIAL_RETURNED',
          'Voucher',
          { id: doc.id, code },
          PAGE,
          { unitId, customerId: h.customerId, lines: prepared.length },
        );
        return doc.id;
      })
      .then((id) => customerMaterialService.get(caller, id));
  },

  /** Cancel = reverse movements dated the cancel date. Nothing is edited or deleted. */
  async cancel(caller: Caller, id: string, version: number, reason: string, date: string) {
    const unitId = concreteUnit(caller);
    const why = reason.trim();
    if (why.length < 5)
      throw Errors.validation({ reason: 'Write the reason (at least 5 characters).' });
    if (date > todayIso())
      throw Errors.validation({ date: 'The cancel date cannot be in the future.' });
    return prisma
      .$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM customer_material_docs WHERE id = ${id}::uuid AND unit_id = ${unitId}::uuid FOR UPDATE`;
        if (!rows[0]) throw Errors.notFound('Document not found.');
        const doc = await tx.customerMaterialDoc.findUniqueOrThrow({ where: { id } });
        if (doc.version !== version) throw Errors.versionConflict();
        if (doc.status !== 'Posted') throw Errors.conflict('This document is already cancelled.');
        if (date < isoOf(doc.docDate)!)
          throw Errors.validation({ date: 'The cancel date cannot be before the document date.' });
        const lines = await tx.customerMaterialLine.findMany({
          where: { docId: id },
          orderBy: { lineNo: 'asc' },
        });
        const locked = await lockLots(
          tx,
          lines.map((l) => l.lotId),
        );
        for (const l of lines) {
          const lot = locked.get(l.lotId)!;
          const bal = D(lot.balance_qty);
          const q = D(l.qty);
          let after: Prisma.Decimal;
          let signed: Prisma.Decimal;
          if (doc.docType === 'RECEIPT') {
            if (!bal.equals(D(lot.received_qty)))
              throw Errors.conflict(
                `Part of this material (item lot ${lot.batch_no ?? lot.id.slice(0, 8)}) was already issued or returned. Cancel those documents first.`,
              );
            after = D(0);
            signed = q.negated();
          } else {
            after = bal.plus(q);
            signed = q;
            const receipt = await tx.$queryRaw<{ id: string }[]>`
            SELECT d.id::text FROM customer_material_lines ln JOIN customer_material_docs d ON d.id = ln.doc_id
             WHERE ln.lot_id = ${l.lotId}::uuid AND d.doc_type = 'RECEIPT' AND d.status = 'Cancelled' LIMIT 1`;
            if (receipt.length > 0)
              throw Errors.conflict(
                'The receipt of this material was cancelled, so this document cannot be reversed.',
              );
          }
          await tx.customerMaterialLot.update({
            where: { id: l.lotId },
            data: { balanceQty: str(after), updatedAt: new Date() },
          });
          await ledgerRow(tx, {
            lotId: l.lotId,
            docId: id,
            lineId: l.id,
            type: 'REVERSAL',
            qty: signed,
            balanceAfter: after,
            date,
            userId: caller.auth.userId,
          });
        }
        const upd = await tx.customerMaterialDoc.updateMany({
          where: { id, version },
          data: {
            status: 'Cancelled',
            cancelReason: why,
            cancelDate: at(date),
            cancelledById: caller.auth.userId,
            cancelledAt: new Date(),
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (upd.count !== 1) throw Errors.versionConflict();
        await writeAudit(
          tx,
          caller,
          'CUSTOMER_MATERIAL_CANCELLED',
          'Voucher',
          { id, code: doc.code },
          PAGE,
          {
            unitId,
            reason: why,
            date,
          },
        );
      })
      .then(() => customerMaterialService.get(caller, id));
  },
};

function docHead(d: Prisma.CustomerMaterialDocGetPayload<object>) {
  return {
    id: d.id,
    code: d.code,
    type: d.docType,
    date: isoOf(d.docDate),
    customerId: d.customerId,
    warehouseId: d.warehouseId,
    challanNo: d.challanNo,
    challanDate: isoOf(d.challanDate),
    vehicleNo: d.vehicleNo,
    reference: d.reference,
    remarks: d.remarks,
    status: d.status,
    cancelReason: d.cancelReason,
    cancelDate: isoOf(d.cancelDate),
    version: d.version,
    createdAt: d.createdAt.toISOString(),
  };
}

export type CustomerMaterialDb = Db;
