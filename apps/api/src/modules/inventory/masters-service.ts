// Batch, serial and bin masters (Phase 8 step 6). Batches and serials are created by stock postings, never typed in
// by hand; here they are viewed, quality-controlled (Pending QC / Released / On Hold / Rejected), extended,
// recalled and given a disposition. Bins are real masters with their own CRUD. Posted history is never edited.
import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { escapeLike } from '../../core/http/query-safety';
import type { Caller } from '../records/service';
import { StockService } from './stock/stock-service';
import { writeAudit } from './typed';

const isoOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const daysBetween = (a: string, b: string): number =>
  Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );

const QC_TRANSITIONS: Record<string, string[]> = {
  'Pending QC': ['Released', 'On Hold', 'Rejected'],
  'On Hold': ['Released', 'Rejected'],
  Rejected: ['On Hold'],
  Released: ['On Hold'],
};
export const DISPOSITIONS = [
  'Use First',
  'Discount Sale',
  'Return to Supplier',
  'Rework',
  'Scrap',
  'Donate',
];

// ---------------------------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------------------------
export interface BatchQuery {
  q?: string;
  itemId?: string;
  qcStatus?: string;
  warehouseId?: string;
  withStockOnly?: boolean;
  page: number;
  size: number;
}

interface BatchListRow {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  batch_no: string;
  mfg_date: Date | null;
  expiry_date: Date | null;
  qc_status: string;
  recalled: boolean;
  disposition: string | null;
  supplier_name: string | null;
  grn_ref: string | null;
  notes: string | null;
  status: string;
  version: number;
  on_hand: string;
  quality_inspection: string;
  total: number;
}

export const batchService = {
  async list(q: BatchQuery) {
    const where: Prisma.Sql[] = [Prisma.sql`b.deleted_at IS NULL`];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(
        Prisma.sql`(b.batch_no ILIKE ${like} OR i.code ILIKE ${like} OR i.name ILIKE ${like})`,
      );
    }
    if (q.itemId) where.push(Prisma.sql`b.item_id = ${q.itemId}::uuid`);
    if (q.qcStatus) where.push(Prisma.sql`b.qc_status = ${q.qcStatus}`);
    const wh = q.warehouseId
      ? Prisma.sql`AND s.warehouse_id = ${q.warehouseId}::uuid`
      : Prisma.empty;
    const having = q.withStockOnly ? Prisma.sql`HAVING COALESCE(sum(s.qty),0) > 0` : Prisma.empty;
    const rows = await prisma.$queryRaw<BatchListRow[]>`
      SELECT b.id::text, b.item_id::text, i.code AS item_code, i.name AS item_name, b.batch_no, b.mfg_date, b.expiry_date,
             b.qc_status, b.recalled, b.disposition, b.supplier_name, b.grn_ref, b.notes, b.status, b.version,
             COALESCE(sum(s.qty),0)::text AS on_hand,
             COALESCE(sum(s.qty) FILTER (WHERE s.stock_status = 'QUALITY_INSPECTION'),0)::text AS quality_inspection,
             count(*) OVER()::int AS total
      FROM batches b JOIN items i ON i.id = b.item_id
      LEFT JOIN stock_slices s ON s.batch_id = b.id ${wh}
      WHERE ${Prisma.join(where, ' AND ')}
      GROUP BY b.id, i.code, i.name ${having}
      ORDER BY b.expiry_date ASC NULLS LAST, b.created_at DESC
      LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
    const today = new Date().toISOString().slice(0, 10);
    return {
      rows: rows.map((r) => {
        const exp = isoOf(r.expiry_date);
        const days = exp ? daysBetween(exp, today) : null;
        return {
          id: r.id,
          itemId: r.item_id,
          itemCode: r.item_code,
          itemName: r.item_name,
          batchNo: r.batch_no,
          mfgDate: isoOf(r.mfg_date),
          expiryDate: exp,
          daysToExpiry: days,
          qcStatus: r.qc_status,
          recalled: r.recalled,
          disposition: r.disposition,
          supplierName: r.supplier_name,
          grnRef: r.grn_ref,
          notes: r.notes,
          status: r.status,
          version: r.version,
          onHand: Number(r.on_hand),
          qualityInspection: Number(r.quality_inspection),
        };
      }),
      total: rows[0]?.total ?? 0,
    };
  },

  async get(id: string) {
    const b = await prisma.batch.findFirst({ where: { id, deletedAt: null } });
    if (!b) throw Errors.notFound('Batch not found.');
    const [events, slices, moves] = await Promise.all([
      // unpaginated: rows of one parent (batchId)
      prisma.batchEvent.findMany({ where: { batchId: id }, orderBy: { createdAt: 'desc' } }),
      // unpaginated: rows of one parent (batch_id)
      prisma.$queryRaw<{ warehouse_code: string; stock_status: string; qty: string }[]>`
        SELECT w.code AS warehouse_code, s.stock_status, s.qty::text FROM stock_slices s
        JOIN warehouses w ON w.id = s.warehouse_id WHERE s.batch_id = ${id}::uuid AND s.qty > 0 ORDER BY w.code`,
      prisma.$queryRaw<
        {
          posting_date: Date;
          voucher_no: string;
          voucher_type: string;
          qty_in: string;
          qty_out: string;
        }[]
      >`
        SELECT posting_date, voucher_no, voucher_type, qty_in::text, qty_out::text FROM stock_ledger
        WHERE batch_id = ${id}::uuid ORDER BY posted_at DESC LIMIT 100`,
    ]);
    return {
      id: b.id,
      itemId: b.itemId,
      batchNo: b.batchNo,
      mfgDate: isoOf(b.mfgDate),
      expiryDate: isoOf(b.expiryDate),
      qcStatus: b.qcStatus,
      recalled: b.recalled,
      disposition: b.disposition,
      supplierName: b.supplierName,
      grnRef: b.grnRef,
      notes: b.notes,
      status: b.status,
      version: b.version,
      events: events.map((e) => ({
        at: e.createdAt.toISOString(),
        event: e.event,
        from: e.fromValue,
        to: e.toValue,
        reason: e.reason,
      })),
      stock: slices.map((s) => ({
        warehouse: s.warehouse_code,
        stockStatus: s.stock_status,
        qty: Number(s.qty), // eslint-disable-line no-restricted-syntax -- DTO only
      })),
      movements: moves.map((m) => ({
        date: isoOf(m.posting_date),
        voucherNo: m.voucher_no,
        type: m.voucher_type,
        qtyIn: Number(m.qty_in),
        qtyOut: Number(m.qty_out),
      })),
    };
  },

  /** Supplier, GRN ref, notes and disposition stay editable; item, number and manufacturing date never change (BR-INV-08). */
  async patch(
    caller: Caller,
    id: string,
    version: number,
    p: {
      supplierName?: string | null;
      grnRef?: string | null;
      notes?: string | null;
      disposition?: string | null;
    },
  ) {
    if (p.disposition && !DISPOSITIONS.includes(p.disposition)) {
      throw Errors.validation({ disposition: `Choose one of: ${DISPOSITIONS.join(', ')}.` });
    }
    return prisma.$transaction(async (tx) => {
      const r = await tx.batch.updateMany({
        where: { id, version, deletedAt: null },
        data: { ...p, version: { increment: 1 }, updatedById: caller.auth.userId },
      });
      if (r.count !== 1) {
        if (!(await tx.batch.findFirst({ where: { id, deletedAt: null } })))
          throw Errors.notFound('Batch not found.');
        throw Errors.versionConflict();
      }
      const b = await tx.batch.findUniqueOrThrow({ where: { id } });
      if (p.disposition) {
        await tx.batchEvent.create({
          data: {
            batchId: id,
            event: 'DISPOSITION',
            toValue: p.disposition,
            createdById: caller.auth.userId,
          },
        });
      }
      await writeAudit(
        tx,
        caller,
        'BATCH_UPDATED',
        'Batch',
        { id, code: b.batchNo },
        'inv-batch',
        {},
      );
      return b;
    });
  },

  async setQc(caller: Caller, id: string, version: number, to: string, reason: string) {
    const why = reason.trim();
    if (why.length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 characters.' });
    return prisma.$transaction(async (tx) => {
      const b = await tx.batch.findFirst({ where: { id, deletedAt: null } });
      if (!b) throw Errors.notFound('Batch not found.');
      if (b.version !== version) throw Errors.versionConflict();
      if (!(QC_TRANSITIONS[b.qcStatus] ?? []).includes(to)) {
        throw Errors.conflict(`A ${b.qcStatus} batch cannot become ${to}.`);
      }
      await tx.batch.update({
        where: { id },
        data: { qcStatus: to, version: { increment: 1 }, updatedById: caller.auth.userId },
      });
      await tx.batchEvent.create({
        data: {
          batchId: id,
          event: 'QC',
          fromValue: b.qcStatus,
          toValue: to,
          reason: why,
          createdById: caller.auth.userId,
        },
      });
      await writeAudit(
        tx,
        caller,
        'BATCH_QC_CHANGED',
        'Batch',
        { id, code: b.batchNo },
        'inv-batch',
        { from: b.qcStatus, to, reason: why },
      );
      if (to === 'Released') await rerunAllocator(tx, id);
      return tx.batch.findUniqueOrThrow({ where: { id } });
    });
  },

  /** Expiry can only be extended, with a reason (BR-INV-08). */
  async extendExpiry(caller: Caller, id: string, version: number, newDate: string, reason: string) {
    const why = reason.trim();
    if (why.length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 characters.' });
    return prisma.$transaction(async (tx) => {
      const b = await tx.batch.findFirst({ where: { id, deletedAt: null } });
      if (!b) throw Errors.notFound('Batch not found.');
      if (b.version !== version) throw Errors.versionConflict();
      const old = isoOf(b.expiryDate);
      if (old && newDate <= old)
        throw Errors.validation({ expiryDate: `The new expiry must be after ${old}.` });
      await tx.batch.update({
        where: { id },
        data: {
          expiryDate: new Date(`${newDate}T00:00:00Z`),
          version: { increment: 1 },
          updatedById: caller.auth.userId,
        },
      });
      await tx.batchEvent.create({
        data: {
          batchId: id,
          event: 'EXPIRY_EXTENDED',
          fromValue: old,
          toValue: newDate,
          reason: why,
          createdById: caller.auth.userId,
        },
      });
      await writeAudit(
        tx,
        caller,
        'BATCH_EXPIRY_EXTENDED',
        'Batch',
        { id, code: b.batchNo },
        'inv-batch',
        { from: old, to: newDate, reason: why },
      );
      return tx.batch.findUniqueOrThrow({ where: { id } });
    });
  },

  /** Recall: all remaining stock of the batch is blocked from issue; closing it releases or rejects the batch. */
  async recall(
    caller: Caller,
    id: string,
    version: number,
    action: 'start' | 'close',
    reason: string,
    closeTo?: 'Released' | 'Rejected',
  ) {
    const why = reason.trim();
    if (why.length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 characters.' });
    return prisma.$transaction(async (tx) => {
      const b = await tx.batch.findFirst({ where: { id, deletedAt: null } });
      if (!b) throw Errors.notFound('Batch not found.');
      if (b.version !== version) throw Errors.versionConflict();
      if (action === 'start') {
        if (b.recalled) throw Errors.conflict('This batch is already recalled.');
        await tx.batch.update({
          where: { id },
          data: {
            recalled: true,
            qcStatus: 'On Hold',
            version: { increment: 1 },
            updatedById: caller.auth.userId,
          },
        });
        await tx.batchEvent.create({
          data: {
            batchId: id,
            event: 'RECALL_STARTED',
            reason: why,
            createdById: caller.auth.userId,
          },
        });
      } else {
        if (!b.recalled) throw Errors.conflict('This batch is not recalled.');
        if (!closeTo) throw Errors.validation({ closeTo: 'Choose Released or Rejected.' });
        await tx.batch.update({
          where: { id },
          data: {
            recalled: false,
            qcStatus: closeTo,
            version: { increment: 1 },
            updatedById: caller.auth.userId,
          },
        });
        await tx.batchEvent.create({
          data: {
            batchId: id,
            event: 'RECALL_CLOSED',
            toValue: closeTo,
            reason: why,
            createdById: caller.auth.userId,
          },
        });
        if (closeTo === 'Released') await rerunAllocator(tx, id);
      }
      await writeAudit(
        tx,
        caller,
        'BATCH_RECALLED',
        'Batch',
        { id, code: b.batchNo },
        'inv-batch',
        { action, reason: why },
      );
      // The affected documents: every ledger outflow of the batch.
      // unpaginated: rows of one parent (batch_id)
      const affected = await tx.$queryRaw<
        { voucher_no: string; voucher_type: string; posting_date: Date; qty_out: string }[]
      >`
        SELECT voucher_no, voucher_type, posting_date, qty_out::text FROM stock_ledger
        WHERE batch_id = ${id}::uuid AND qty_out > 0 AND voucher_type <> 'REVERSAL' ORDER BY posted_at`;
      return {
        batch: await tx.batch.findUniqueOrThrow({ where: { id } }),
        affected: affected.map((a) => ({
          voucherNo: a.voucher_no,
          type: a.voucher_type,
          date: isoOf(a.posting_date),
          qty: Number(a.qty_out),
        })),
      };
    });
  },
};

async function rerunAllocator(tx: Db, batchId: string) {
  // unpaginated: rows of one parent (batch_id)
  const pairs = await tx.$queryRaw<{ item_id: string; warehouse_id: string }[]>`
    SELECT DISTINCT item_id::text, warehouse_id::text FROM stock_slices WHERE batch_id = ${batchId}::uuid AND qty > 0`;
  for (const p of pairs) await StockService.runAllocator(tx, p.item_id, p.warehouse_id);
}

// ---------------------------------------------------------------------------------------------
// Serials
// ---------------------------------------------------------------------------------------------
export const serialService = {
  async list(q: {
    q?: string;
    itemId?: string;
    status?: string;
    warehouseId?: string;
    page: number;
    size: number;
  }) {
    const where: Prisma.Sql[] = [Prisma.sql`true`];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(
        Prisma.sql`(s.serial_no ILIKE ${like} OR i.code ILIKE ${like} OR i.name ILIKE ${like})`,
      );
    }
    if (q.itemId) where.push(Prisma.sql`s.item_id = ${q.itemId}::uuid`);
    if (q.status) where.push(Prisma.sql`s.status = ${q.status}`);
    if (q.warehouseId) where.push(Prisma.sql`s.warehouse_id = ${q.warehouseId}::uuid`);
    const rows = await prisma.$queryRaw<
      {
        id: string;
        serial_no: string;
        item_code: string;
        item_name: string;
        warehouse_code: string | null;
        status: string;
        current_owner: string | null;
        last_movement_at: Date | null;
        total: number;
      }[]
    >`
      SELECT s.id::text, s.serial_no, i.code AS item_code, i.name AS item_name, w.code AS warehouse_code, s.status,
             s.current_owner, s.last_movement_at, count(*) OVER()::int AS total
      FROM serial_numbers s JOIN items i ON i.id = s.item_id LEFT JOIN warehouses w ON w.id = s.warehouse_id
      WHERE ${Prisma.join(where, ' AND ')} ORDER BY s.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`;
    return {
      rows: rows.map((r) => ({
        id: r.id,
        serialNo: r.serial_no,
        itemCode: r.item_code,
        itemName: r.item_name,
        warehouse: r.warehouse_code,
        status: r.status,
        currentOwner: r.current_owner,
        lastMovementAt: r.last_movement_at?.toISOString() ?? null,
      })),
      total: rows[0]?.total ?? 0,
    };
  },

  async history(id: string) {
    const s = await prisma.serialNumber.findUnique({ where: { id } });
    if (!s) throw Errors.notFound('Serial number not found.');
    // unpaginated: rows of one parent (serialId)
    const ev = await prisma.serialEvent.findMany({
      where: { serialId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: s.id,
      serialNo: s.serialNo,
      status: s.status,
      events: ev.map((e) => ({
        at: e.createdAt.toISOString(),
        event: e.event,
        voucherNo: e.voucherNo,
      })),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------------------------
export interface BinInput {
  warehouseId: string;
  code: string;
  name?: string | null;
  zone?: string | null;
  binType?: 'Storage' | 'Staging' | 'Quarantine' | 'Pick Face';
  capacity?: number | null;
}

export const binService = {
  async list(q: { q?: string; warehouseId?: string; status?: string; page: number; size: number }) {
    const where: Prisma.WmsBinWhereInput = {
      deletedAt: null,
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: escapeLike(q.q), mode: 'insensitive' } },
              { name: { contains: escapeLike(q.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.wmsBin.findMany({
        where,
        orderBy: [{ warehouseId: 'asc' }, { code: 'asc' }],
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.wmsBin.count({ where }),
    ]);
    // unpaginated: rows of one parent (bin_id)
    const stock = await prisma.$queryRaw<{ bin_id: string; q: string }[]>`
      SELECT bin_id::text, sum(qty)::text AS q FROM stock_slices WHERE bin_id = ANY(${rows.map((r) => r.id)}::uuid[]) GROUP BY bin_id`;
    const by = new Map(stock.map((s) => [s.bin_id, Number(s.q)]));
    return {
      rows: rows.map((b) => ({
        id: b.id,
        warehouseId: b.warehouseId,
        code: b.code,
        name: b.name,
        zone: b.zone,
        binType: b.binType,
        capacity: b.capacity ? Number(b.capacity) : null,
        status: b.status,
        version: b.version,
        onHand: by.get(b.id) ?? 0,
      })),
      total,
    };
  },

  async create(caller: Caller, p: BinInput) {
    const wh = await prisma.warehouse.findFirst({ where: { id: p.warehouseId, deletedAt: null } });
    if (!wh || wh.status !== 'ACTIVE')
      throw Errors.validation({ warehouseId: 'Choose an active warehouse.' });
    const code = p.code.trim().toUpperCase();
    if (!/^[A-Z0-9_/-]{1,30}$/.test(code))
      throw Errors.validation({ code: 'Use letters, digits, - _ / (up to 30).' });
    if (
      await prisma.wmsBin.findUnique({
        where: { warehouseId_code: { warehouseId: p.warehouseId, code } },
      })
    ) {
      throw Errors.duplicate({ code: 'This bin code already exists in the warehouse.' });
    }
    return prisma.$transaction(async (tx) => {
      const b = await tx.wmsBin.create({
        data: {
          warehouseId: p.warehouseId,
          code,
          name: p.name ?? null,
          zone: p.zone ?? null,
          binType: p.binType ?? 'Storage',
          capacity: p.capacity ?? null,
          createdById: caller.auth.userId,
        },
      });
      await writeAudit(tx, caller, 'LOCATION_CREATED', 'Location', { id: b.id, code }, 'wms-bins', {
        warehouseId: p.warehouseId,
      });
      return b;
    });
  },

  async update(
    caller: Caller,
    id: string,
    version: number,
    p: Partial<Pick<BinInput, 'name' | 'zone' | 'binType' | 'capacity'>> & {
      status?: 'Active' | 'Inactive';
    },
  ) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.wmsBin.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Bin not found.');
      if (cur.version !== version) throw Errors.versionConflict();
      if (p.status === 'Inactive') {
        const held = await tx.$queryRaw<
          { q: string | null }[]
        >`SELECT sum(qty)::text AS q FROM stock_slices WHERE bin_id = ${id}::uuid`;
        if (Number(held[0]?.q ?? 0) > 0)
          throw Errors.binNotEmpty(`Bin ${cur.code} still holds stock; move it out first.`);
      }
      const b = await tx.wmsBin.update({
        where: { id },
        data: { ...p, version: { increment: 1 }, updatedById: caller.auth.userId },
      });
      await writeAudit(
        tx,
        caller,
        p.status ? 'LOCATION_STATUS_CHANGED' : 'LOCATION_UPDATED',
        'Location',
        { id, code: cur.code },
        'wms-bins',
        {},
      );
      return b;
    });
  },

  async remove(caller: Caller, id: string) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.wmsBin.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Bin not found.');
      const used = await tx.stockLedger.count({ where: { binId: id } });
      const held = await tx.stockSlice.count({ where: { binId: id, qty: { gt: 0 } } });
      if (used > 0 || held > 0)
        throw Errors.inUse(`Bin ${cur.code} has stock history; deactivate it instead.`);
      await tx.wmsBin.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: caller.auth.userId },
      });
      await writeAudit(
        tx,
        caller,
        'LOCATION_DELETED',
        'Location',
        { id, code: cur.code },
        'wms-bins',
        {},
      );
    });
  },
};
