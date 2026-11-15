// Phase 41: Material Transfer Note between plants. Stock moves only through StockService / StockGl, the same way the
// inv-transfer voucher does it: Send = source warehouse -> the sending plant's transit warehouse (value kept), Receive =
// transit -> receiving warehouse for the quantity that arrived. A short receipt leaves the missing quantity in transit and
// opens a dispute; Reconcile sends it back to the source warehouse. Nothing here writes stock rows by hand.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering/numbering-service';
import { assertCanPost } from '../../core/posting';
import { query, TX } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { StockGl } from '../inventory/stock/gl';
import { StockService } from '../inventory/stock/stock-service';
import { assertSameGstin, transitWarehouseFor } from '../inventory/vouchers/voucher-service';
import { D, ZERO, round2, round3, str } from '../inventory/money';
import type { Dec } from '../inventory/money';
import { allocateReceipt, receiptSplit } from './calc';

export interface NoteInput {
  fromUnitId?: string | null;
  toUnitId: string;
  quantity: string | number;
  jobCardNo?: string | null;
  orderId?: string | null;
  itemId?: string | null;
  partCode?: string | null;
  partName?: string | null;
  uom?: string | null;
  fromProcess?: string | null;
  toProcess?: string | null;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  vehiclePerson?: string | null;
  remarks?: string | null;
  transferDate?: string | null;
  /** Send the stock to transit as part of the same save (needs item + both warehouses). */
  dispatch?: boolean;
}

interface Entry {
  batchId: string | null;
  qty: string;
  rate: string;
  value: string;
}
interface Detail {
  entries: Entry[];
  remaining: Entry[];
}

const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const isoToday = (): string => new Date().toISOString().slice(0, 10);

let ready = false;
/** True once phase41_routing_transfer.sql was applied (only a positive answer is cached). */
export async function phase41Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  const r = await query(
    db,
    `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'transfer_notes' AND column_name = 'stock_state')::int AS a,
            (SELECT count(*) FROM information_schema.columns WHERE table_name = 'plant_route_steps' AND column_name = 'approval_required')::int AS c,
            (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('transfer_disputes','bom_material_flow_lines'))::int AS b`,
  );
  ready = Number(r[0]?.a) >= 1 && Number(r[0]?.b) >= 2 && Number(r[0]?.c) >= 1;
  return ready;
}

/** The columns this module needs exist only after phase41_routing_transfer.sql: say so instead of failing with SQL text. */
export async function assertPhase41Schema(db: Db): Promise<void> {
  if (!(await phase41Ready(db))) {
    throw Errors.conflict('This action needs the Phase 41 database update (apps/api/prisma/pending/phase41_routing_transfer.sql). Ask the owner to apply it.');
  }
}

const SELECT = `
  SELECT t.id::text AS id, t.note_no, t.unit_id::text AS unit_id, t.job_card_no, t.order_id::text AS order_id, t.part_code, t.part_name,
         t.item_id::text AS item_id, t.uom, t.from_unit_id::text AS from_unit_id, fu.code AS from_unit_code, fu.name AS from_unit_name, t.from_process,
         t.to_unit_id::text AS to_unit_id, tu.code AS to_unit_code, tu.name AS to_unit_name, t.to_process,
         t.from_warehouse_id::text AS from_warehouse_id, t.to_warehouse_id::text AS to_warehouse_id,
         t.transfer_date::text AS transfer_date, t.quantity::text AS sent_qty, t.received_qty::text AS received_qty, t.short_qty::text AS short_qty,
         t.short_reason, t.vehicle_person, t.receipt_status, t.stock_state, t.remarks, t.dispatched_at, t.received_at, t.reconciled_at, t.created_at,
         t.dispatch_detail, sb.name AS sent_by, rb.name AS received_by,
         (SELECT count(*)::int FROM transfer_disputes d WHERE d.note_id = t.id AND d.status = 'OPEN') AS open_disputes
    FROM transfer_notes t
    LEFT JOIN units fu ON fu.id = t.from_unit_id
    LEFT JOIN units tu ON tu.id = t.to_unit_id
    LEFT JOIN users sb ON sb.id = t.sent_by_id
    LEFT JOIN users rb ON rb.id = t.received_by_id`;

function visible(caller: Caller): { sql: string; args: unknown[] } {
  const ids = caller.ctx.unitIds.length > 0 ? caller.ctx.unitIds : caller.ctx.unitId ? [caller.ctx.unitId] : [];
  if (ids.length === 0) return caller.ctx.allUnits ? { sql: 'true', args: [] } : { sql: 'false', args: [] };
  return { sql: `(t.unit_id = ANY($1::uuid[]) OR t.from_unit_id = ANY($1::uuid[]) OR t.to_unit_id = ANY($1::uuid[]))`, args: [ids] };
}

function postingDate(fy: { startDate: Date; endDate: Date }): string {
  const t = isoToday();
  const a = fy.startDate.toISOString().slice(0, 10);
  const b = fy.endDate.toISOString().slice(0, 10);
  return t < a ? a : t > b ? b : t;
}

async function loadNote(tx: Db, caller: Caller, id: string, lock = true): Promise<Row> {
  const v = visible(caller);
  const rows = await query(tx, `${SELECT} WHERE t.id = $${v.args.length + 1}::uuid AND ${v.sql}${lock ? ' FOR UPDATE OF t' : ''}`, ...v.args, id);
  if (!rows[0]) throw Errors.notFound('Transfer note not found.');
  return rows[0];
}

function inScope(caller: Caller, unitId: string): boolean {
  if (caller.ctx.allUnits && caller.ctx.unitId === null) return true;
  return (caller.ctx.unitIds.length > 0 ? caller.ctx.unitIds : caller.ctx.unitId ? [caller.ctx.unitId] : []).includes(unitId);
}

async function dispatchStock(tx: Db, caller: Caller, n: Row): Promise<Detail> {
  const itemId = S(n.item_id);
  const fromWh = S(n.from_warehouse_id);
  const toWh = S(n.to_warehouse_id);
  if (!itemId || !fromWh || !toWh) throw Errors.validation({ itemId: 'Choose the item and both warehouses to send stock.' });
  const wh = await query(tx, `SELECT id::text AS id, unit_id::text AS unit_id, status, is_transit FROM warehouses WHERE id = ANY($1::uuid[])`, [fromWh, toWh]);
  const src = wh.find((w) => w.id === fromWh);
  const dst = wh.find((w) => w.id === toWh);
  if (!src || !dst) throw Errors.notFound('Warehouse not found.');
  if (S(src.unit_id) !== S(n.from_unit_id)) throw Errors.validation({ fromWarehouseId: 'The source warehouse is not in the sending plant.' });
  if (S(dst.unit_id) !== S(n.to_unit_id)) throw Errors.validation({ toWarehouseId: 'The receiving warehouse is not in the receiving plant.' });
  if (src.is_transit || dst.is_transit) throw Errors.validation({ toWarehouseId: 'Choose a normal warehouse, not a transit one.' });
  await assertSameGstin(tx, S(n.from_unit_id), S(n.to_unit_id));
  const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: caller.ctx.fyId } });
  const date = postingDate(fy);
  await assertCanPost(tx, { unitId: S(n.from_unit_id), fyId: fy.id, postingDate: date, documentStatus: 'Approved', allowedStatuses: ['Approved'], action: 'dispatch' });
  const transit = await transitWarehouseFor(tx, S(n.from_unit_id), caller.auth.userId);
  await StockService.lockInOrder(tx, [
    { warehouseId: fromWh, itemId },
    { warehouseId: transit.id, itemId },
  ]);
  const base = { postingDate: date, voucherId: S(n.id), voucherNo: S(n.note_no), createdById: caller.auth.userId, itemId, allowBackdate: true };
  const out = await StockService.postMovement(tx, { ...base, direction: 'OUT', qty: D(S(n.sent_qty)), voucherType: 'TRANSFER_OUT', warehouseId: fromWh });
  const ids: string[] = [];
  const entries: Entry[] = [];
  for (const e of out.entries) {
    const inn = await StockService.postMovement(tx, { ...base, direction: 'IN', qty: e.qty, voucherType: 'TRANSFER_IN', warehouseId: transit.id, batchId: e.batchId, rate: e.rate, value: e.value, stockStatus: 'UNRESTRICTED' });
    ids.push(e.id, ...inn.entries.map((x) => x.id));
    entries.push({ batchId: e.batchId, qty: str(e.qty), rate: str(e.rate), value: str(e.value) });
  }
  await StockService.assertEquality(tx, [
    { warehouseId: fromWh, itemId },
    { warehouseId: transit.id, itemId },
  ]);
  await StockGl.post(tx, {
    voucherId: S(n.id),
    voucherNo: S(n.note_no),
    unitId: S(n.from_unit_id),
    postingDate: date,
    event: 'STOCK_TRANSFER_DISPATCHED',
    voucherType: 'Other',
    counter: 'INTER_UNIT_CLEARING',
    ledgerIds: ids,
    narration: `Transfer note ${S(n.note_no)} sent`,
    actorId: caller.auth.userId,
  });
  return { entries, remaining: entries.map((e) => ({ ...e })) };
}

export const transferService = {
  async options(caller: Caller) {
    const units = await query(prisma, `SELECT id::text AS id, code, name FROM units WHERE status = 'ACTIVE' ORDER BY code`);
    const warehouses = await query(
      prisma,
      `SELECT id::text AS id, code, name, unit_id::text AS unit_id FROM warehouses WHERE deleted_at IS NULL AND status = 'ACTIVE' AND NOT is_transit ORDER BY code`,
    );
    const items = await query(prisma, `SELECT id::text AS id, code, name, base_uom FROM items WHERE status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code LIMIT 500`);
    return { units, warehouses, items, defaultUnitId: caller.ctx.unitId };
  },

  async cards(caller: Caller) {
    const v = visible(caller);
    const r = await query(
      prisma,
      `SELECT count(*) FILTER (WHERE t.receipt_status = 'PENDING')::int AS pending_receipt,
              count(*) FILTER (WHERE t.stock_state = 'IN_TRANSIT')::int AS in_transit,
              count(*) FILTER (WHERE t.receipt_status IN ('RECEIVED','SHORT'))::int AS received,
              (SELECT count(*)::int FROM transfer_disputes d JOIN transfer_notes t2 ON t2.id = d.note_id WHERE d.status = 'OPEN' AND ${v.sql.replaceAll('t.', 't2.')}) AS open_disputes
         FROM transfer_notes t WHERE ${v.sql}`,
      ...v.args,
    );
    return r[0] ?? {};
  },

  async list(caller: Caller, p: { tab?: string; q?: string }): Promise<Row[]> {
    const v = visible(caller);
    const args = [...v.args];
    const w: string[] = [v.sql];
    const tab = p.tab ?? 'register';
    if (tab === 'in_transit') w.push(`t.stock_state = 'IN_TRANSIT'`);
    if (tab === 'pending') w.push(`t.receipt_status = 'PENDING'`);
    if (tab === 'received') w.push(`t.receipt_status IN ('RECEIVED','SHORT')`);
    if (tab === 'disputes') w.push(`t.short_qty > 0`);
    if (p.q) {
      args.push(`%${p.q}%`);
      w.push(`(t.note_no ILIKE $${args.length} OR t.job_card_no ILIKE $${args.length} OR t.part_name ILIKE $${args.length})`);
    }
    return query(prisma, `${SELECT} WHERE ${w.join(' AND ')} ORDER BY t.created_at DESC LIMIT 200`, ...args);
  },

  async disputes(caller: Caller): Promise<Row[]> {
    const v = visible(caller);
    return query(
      prisma,
      `SELECT d.id::text AS id, d.dispute_no, d.note_id::text AS note_id, t.note_no, d.qty::text AS qty, d.reason, d.status, d.resolution_note,
              d.created_at, d.resolved_at, cb.name AS created_by, rb.name AS resolved_by, fu.code AS from_unit_code, tu.code AS to_unit_code
         FROM transfer_disputes d JOIN transfer_notes t ON t.id = d.note_id
         LEFT JOIN units fu ON fu.id = t.from_unit_id LEFT JOIN units tu ON tu.id = t.to_unit_id
         LEFT JOIN users cb ON cb.id = d.created_by_id LEFT JOIN users rb ON rb.id = d.resolved_by_id
        WHERE ${v.sql} ORDER BY d.created_at DESC LIMIT 200`,
      ...v.args,
    );
  },

  async audit(caller: Caller): Promise<Row[]> {
    const v = visible(caller);
    return query(
      prisma,
      `SELECT a.id::text AS id, a.action, a.at, u.name AS actor, t.note_no, a.detail
         FROM audit_logs a JOIN transfer_notes t ON t.id::text = a.target_id::text AND a.target_type = 'transfer_note'
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${v.sql} ORDER BY a.at DESC LIMIT 200`,
      ...v.args,
    );
  },

  async get(caller: Caller, id: string): Promise<Row> {
    return loadNote(prisma, caller, id, false);
  },

  async create(caller: Caller, input: NoteInput): Promise<Row> {
    await assertPhase41Schema(prisma);
    return prisma.$transaction(async (tx) => transferService.createInTx(tx, caller, input), TX);
  },

  /** Creates the note (and sends the stock when `dispatch`). Runs inside the caller's transaction. */
  async createInTx(tx: Db, caller: Caller, input: NoteInput): Promise<Row> {
    const fromUnit = input.fromUnitId ?? caller.ctx.unitId;
    if (!fromUnit) throw Errors.validation({ fromUnitId: 'Choose the sending plant.' });
    if (!inScope(caller, fromUnit)) throw Errors.forbidden('You can only send from a plant you work in.');
    if (fromUnit === input.toUnitId) throw Errors.validation({ toUnitId: 'A transfer note moves material to a different plant.' });
    const qty = D(input.quantity);
    if (qty.lessThanOrEqualTo(0)) throw Errors.validation({ quantity: 'Enter a quantity greater than 0.' });
    const u = await query(tx, `SELECT id::text AS id, status FROM units WHERE id = ANY($1::uuid[])`, [fromUnit, input.toUnitId]);
    if (u.length < 2 || u.some((x) => x.status !== 'ACTIVE')) throw Errors.validation({ toUnitId: 'Both plants must exist and be active.' });
    let itemId = input.itemId ?? null;
    let partCode = input.partCode ?? null;
    let partName = input.partName ?? null;
    let uom = input.uom ?? null;
    if (itemId) {
      const it = (await query(tx, `SELECT code, name, base_uom FROM items WHERE id = $1::uuid`, itemId))[0];
      if (!it) throw Errors.validation({ itemId: 'Item not found.' });
      partCode = S(it.code);
      partName = S(it.name);
      uom = S(it.base_uom);
    }
    const noteNo = await NumberingService.allocate(tx, { pageId: 'mfg-transfer-note', unitId: fromUnit, fyId: caller.ctx.fyId, prefix: 'MTN', padding: 4 });
    const rows = await query(
      tx,
      `INSERT INTO transfer_notes (note_no, unit_id, job_card_no, order_id, part_code, part_name, item_id, uom, from_unit_id, from_process, to_unit_id, to_process,
                                   from_warehouse_id, to_warehouse_id, transfer_date, quantity, vehicle_person, sent_by_id, remarks)
       VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7::uuid, $8, $2::uuid, $9, $10::uuid, $11, $12::uuid, $13::uuid, COALESCE($14::date, current_date), $15::numeric, $16, $17::uuid, $18)
       RETURNING id::text AS id`,
      noteNo,
      fromUnit,
      input.jobCardNo ?? null,
      input.orderId ?? null,
      partCode,
      partName,
      itemId,
      uom,
      input.fromProcess ?? null,
      input.toUnitId,
      input.toProcess ?? null,
      input.fromWarehouseId ?? null,
      input.toWarehouseId ?? null,
      input.transferDate ?? null,
      round3(qty).toFixed(),
      input.vehiclePerson ?? null,
      caller.auth.userId,
      input.remarks ?? null,
    );
    const id = S(rows[0]?.id);
    await recordAudit({ action: 'transfer.create', actorId: caller.auth.userId, targetType: 'transfer_note', targetId: id, detail: { noteNo, qty: round3(qty).toFixed(), to: input.toUnitId } }, tx);
    if (input.dispatch) await transferService.dispatchInTx(tx, caller, id);
    return { id, noteNo };
  },

  async dispatch(caller: Caller, id: string): Promise<Row> {
    await assertPhase41Schema(prisma);
    await prisma.$transaction(async (tx) => transferService.dispatchInTx(tx, caller, id), TX);
    return transferService.get(caller, id);
  },

  async dispatchInTx(tx: Db, caller: Caller, id: string): Promise<void> {
    const n = await loadNote(tx, caller, id);
    if (!inScope(caller, S(n.from_unit_id))) throw Errors.forbidden('Only the sending plant can send this note.');
    if (S(n.stock_state) !== 'NONE') throw Errors.conflict('The stock of this note was already sent.');
    if (S(n.receipt_status) !== 'PENDING') throw Errors.conflict('This note is already received.');
    const detail = await dispatchStock(tx, caller, n);
    await tx.$executeRawUnsafe(`UPDATE transfer_notes SET stock_state = 'IN_TRANSIT', dispatch_detail = $2::jsonb, dispatched_at = now() WHERE id = $1::uuid`, id, JSON.stringify(detail));
    await recordAudit({ action: 'transfer.send', actorId: caller.auth.userId, targetType: 'transfer_note', targetId: id, detail: { noteNo: S(n.note_no) } }, tx);
  },

  /** Choose the destination warehouse of a note that was raised without one (a route advance), before sending. */
  async setRouting(caller: Caller, id: string, p: { fromWarehouseId?: string | null; toWarehouseId?: string | null; itemId?: string | null }): Promise<Row> {
    await assertPhase41Schema(prisma);
    await prisma.$transaction(async (tx) => {
      const n = await loadNote(tx, caller, id);
      if (S(n.stock_state) !== 'NONE') throw Errors.conflict('The stock of this note was already sent.');
      await tx.$executeRawUnsafe(
        `UPDATE transfer_notes SET from_warehouse_id = COALESCE($2::uuid, from_warehouse_id), to_warehouse_id = COALESCE($3::uuid, to_warehouse_id), item_id = COALESCE($4::uuid, item_id) WHERE id = $1::uuid`,
        id,
        p.fromWarehouseId ?? null,
        p.toWarehouseId ?? null,
        p.itemId ?? null,
      );
    }, TX);
    return transferService.get(caller, id);
  },

  /** Receive in the receiving plant. Fewer pieces than sent needs a reason; the short quantity stays in transit and opens a dispute. */
  async receive(caller: Caller, id: string, input: { receivedQty?: number | string; shortReason?: string | null }): Promise<Row> {
    await assertPhase41Schema(prisma);
    await prisma.$transaction(async (tx) => {
      const n = await loadNote(tx, caller, id);
      if (S(n.receipt_status) !== 'PENDING') throw Errors.conflict(`This note is already ${S(n.receipt_status).toLowerCase()}.`);
      if (!inScope(caller, S(n.to_unit_id))) throw Errors.forbidden('Only the receiving plant can receive this note.');
      const sent = D(S(n.sent_qty));
      const want = input.receivedQty === undefined ? sent : D(input.receivedQty);
      let split: { received: Dec; short: Dec };
      try {
        split = receiptSplit(sent, want);
      } catch {
        throw Errors.validation({ receivedQty: `Received quantity must be between 0 and ${sent.toFixed()}.` });
      }
      const reason = (input.shortReason ?? '').trim();
      if (split.short.greaterThan(0) && reason.length < 3) throw Errors.validation({ shortReason: `Enter a reason for the short quantity (${split.short.toFixed()}).` });
      const stockMoved = S(n.stock_state) === 'IN_TRANSIT';
      let detail = n.dispatch_detail as Detail | null;
      if (stockMoved && detail) {
        const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: caller.ctx.fyId } });
        const date = postingDate(fy);
        await assertCanPost(tx, { unitId: S(n.to_unit_id), fyId: fy.id, postingDate: date, documentStatus: 'Dispatched', allowedStatuses: ['Dispatched'], action: 'receive' });
        const transit = await transitWarehouseFor(tx, S(n.from_unit_id), caller.auth.userId);
        const itemId = S(n.item_id);
        const toWh = S(n.to_warehouse_id);
        await StockService.lockInOrder(tx, [
          { warehouseId: transit.id, itemId },
          { warehouseId: toWh, itemId },
        ]);
        const ids: string[] = [];
        const left: Entry[] = [];
        const plan = allocateReceipt(detail.remaining, split.received);
        for (const e of detail.remaining) {
          const hit = plan.find((x) => x.entry === e);
          const take = hit ? hit.qty : ZERO;
          const eq = D(e.qty);
          const takeValue = take.greaterThanOrEqualTo(eq) ? D(e.value) : round2(D(e.value).mul(take).div(eq));
          if (take.greaterThan(0)) {
            const out = await StockService.postMovement(tx, {
              direction: 'OUT', qty: take, voucherType: 'TRANSFER_OUT', warehouseId: transit.id, itemId, batchId: e.batchId, postingDate: date,
              voucherId: S(n.id), voucherNo: S(n.note_no), createdById: caller.auth.userId, allowBackdate: true, outValue: takeValue, outRate: D(e.rate),
            });
            for (const o of out.entries) {
              const inn = await StockService.postMovement(tx, {
                direction: 'IN', qty: o.qty, voucherType: 'TRANSFER_IN', warehouseId: toWh, itemId, batchId: o.batchId, rate: o.rate, value: o.value,
                stockStatus: 'UNRESTRICTED', postingDate: date, voucherId: S(n.id), voucherNo: S(n.note_no), createdById: caller.auth.userId, allowBackdate: true,
              });
              ids.push(o.id, ...inn.entries.map((x) => x.id));
            }
          }
          const rest = eq.minus(take);
          if (rest.greaterThan(0)) left.push({ ...e, qty: str(rest), value: str(D(e.value).minus(takeValue)) });
        }
        if (ids.length > 0) {
          await StockService.assertEquality(tx, [
            { warehouseId: transit.id, itemId },
            { warehouseId: toWh, itemId },
          ]);
          await StockGl.post(tx, {
            voucherId: S(n.id), voucherNo: S(n.note_no), unitId: S(n.to_unit_id), postingDate: date, event: 'STOCK_TRANSFER_RECEIVED', voucherType: 'Other',
            counter: 'INTER_UNIT_CLEARING', ledgerIds: ids, narration: `Transfer note ${S(n.note_no)} received`, actorId: caller.auth.userId,
          });
        }
        detail = { entries: detail.entries, remaining: left };
      }
      const status = split.short.greaterThan(0) ? 'SHORT' : 'RECEIVED';
      await tx.$executeRawUnsafe(
        `UPDATE transfer_notes SET receipt_status = $2, received_qty = $3::numeric, short_qty = $4::numeric, short_reason = $5, received_by_id = $6::uuid, received_at = now(),
                stock_state = CASE WHEN stock_state = 'IN_TRANSIT' AND $4::numeric = 0 THEN 'RECEIVED' ELSE stock_state END,
                dispatch_detail = COALESCE($7::jsonb, dispatch_detail)
          WHERE id = $1::uuid`,
        id,
        status,
        split.received.toFixed(),
        split.short.toFixed(),
        split.short.greaterThan(0) ? reason : null,
        caller.auth.userId,
        detail ? JSON.stringify(detail) : null,
      );
      if (split.short.greaterThan(0)) {
        const disputeNo = `Short receipt ${split.short.toFixed()} - ${S(n.note_no)}`;
        await tx.$executeRawUnsafe(
          `INSERT INTO transfer_disputes (dispute_no, note_id, unit_id, qty, reason, created_by_id) VALUES ($1, $2::uuid, $3::uuid, $4::numeric, $5, $6::uuid)`,
          disputeNo, id, S(n.to_unit_id), split.short.toFixed(), reason, caller.auth.userId,
        );
      }
      await recordAudit({ action: 'transfer.receive', actorId: caller.auth.userId, targetType: 'transfer_note', targetId: id, detail: { noteNo: S(n.note_no), received: split.received.toFixed(), short: split.short.toFixed() } }, tx);
    }, TX);
    return transferService.get(caller, id);
  },

  /** Reconcile a short receipt: the missing quantity goes from transit back to the source warehouse and the dispute closes. */
  async reconcile(caller: Caller, id: string, input: { note?: string | null }): Promise<Row> {
    await assertPhase41Schema(prisma);
    await prisma.$transaction(async (tx) => {
      const n = await loadNote(tx, caller, id);
      if (S(n.receipt_status) !== 'SHORT' || D(S(n.short_qty)).lessThanOrEqualTo(0)) throw Errors.conflict('There is no short quantity to reconcile on this note.');
      if (n.reconciled_at) throw Errors.conflict('This note is already reconciled.');
      if (!inScope(caller, S(n.from_unit_id)) && !inScope(caller, S(n.to_unit_id))) throw Errors.forbidden('Only the sending or receiving plant can reconcile this note.');
      const detail = n.dispatch_detail as Detail | null;
      if (S(n.stock_state) === 'IN_TRANSIT' && detail && detail.remaining.length > 0) {
        const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: caller.ctx.fyId } });
        const date = postingDate(fy);
        await assertCanPost(tx, { unitId: S(n.from_unit_id), fyId: fy.id, postingDate: date, documentStatus: 'Dispatched', allowedStatuses: ['Dispatched'], action: 'receive' });
        const transit = await transitWarehouseFor(tx, S(n.from_unit_id), caller.auth.userId);
        const itemId = S(n.item_id);
        const srcWh = S(n.from_warehouse_id);
        await StockService.lockInOrder(tx, [
          { warehouseId: transit.id, itemId },
          { warehouseId: srcWh, itemId },
        ]);
        const ids: string[] = [];
        for (const e of detail.remaining) {
          const out = await StockService.postMovement(tx, {
            direction: 'OUT', qty: D(e.qty), voucherType: 'TRANSFER_OUT', warehouseId: transit.id, itemId, batchId: e.batchId, postingDate: date,
            voucherId: S(n.id), voucherNo: S(n.note_no), createdById: caller.auth.userId, allowBackdate: true, outValue: D(e.value), outRate: D(e.rate),
          });
          for (const o of out.entries) {
            const inn = await StockService.postMovement(tx, {
              direction: 'IN', qty: o.qty, voucherType: 'TRANSFER_IN', warehouseId: srcWh, itemId, batchId: o.batchId, rate: o.rate, value: o.value,
              stockStatus: 'UNRESTRICTED', postingDate: date, voucherId: S(n.id), voucherNo: S(n.note_no), createdById: caller.auth.userId, allowBackdate: true,
            });
            ids.push(o.id, ...inn.entries.map((x) => x.id));
          }
        }
        await StockService.assertEquality(tx, [
          { warehouseId: transit.id, itemId },
          { warehouseId: srcWh, itemId },
        ]);
        await StockGl.post(tx, {
          voucherId: S(n.id), voucherNo: S(n.note_no), unitId: S(n.from_unit_id), postingDate: date, event: 'STOCK_TRANSFER_RETURNED', voucherType: 'Other',
          counter: 'INTER_UNIT_CLEARING', ledgerIds: ids, narration: `Transfer note ${S(n.note_no)} short quantity returned`, actorId: caller.auth.userId,
        });
      }
      await tx.$executeRawUnsafe(
        `UPDATE transfer_notes SET reconciled_at = now(), stock_state = CASE WHEN stock_state = 'IN_TRANSIT' THEN 'RETURNED' ELSE stock_state END,
                dispatch_detail = CASE WHEN dispatch_detail IS NULL THEN NULL ELSE jsonb_set(dispatch_detail, '{remaining}', '[]'::jsonb) END WHERE id = $1::uuid`,
        id,
      );
      await tx.$executeRawUnsafe(
        `UPDATE transfer_disputes SET status = 'RETURNED', resolution_note = $2, resolved_by_id = $3::uuid, resolved_at = now() WHERE note_id = $1::uuid AND status = 'OPEN'`,
        id, input.note?.trim() || 'Short quantity returned to the sending warehouse', caller.auth.userId,
      );
      await recordAudit({ action: 'transfer.reconcile', actorId: caller.auth.userId, targetType: 'transfer_note', targetId: id, detail: { noteNo: S(n.note_no), short: S(n.short_qty) } }, tx);
    }, TX);
    return transferService.get(caller, id);
  },
};
