// Phase 41: BOM & Material Approval (flow-bom-approval). One flow = one released BOM built in a quantity for a sales order:
// BOM Selection -> Sales Approval -> Stock Verification (required vs available in the plant) -> Purchase Shortage ("Raise PR")
// -> Manufacturing Release -> Traceability. Shortage becomes a Draft purchase requisition through the existing
// PurchaseRequestGateway; nothing here creates a requisition by hand.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering/numbering-service';
import { D, round3 } from '../inventory/money';
import { query, TX } from '../procurement/core';
import type { Row } from '../procurement/core';
import { PurchaseRequestGateway } from '../procurement/reports-service';
import type { Caller } from '../records/service';
import { bomRequired, shortageOf } from './calc';
import { assertPhase41Schema } from './transfer-service';

const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function scope(caller: Caller): { sql: string; args: unknown[] } {
  const ids = caller.ctx.unitIds.length > 0 ? caller.ctx.unitIds : caller.ctx.unitId ? [caller.ctx.unitId] : [];
  if (ids.length === 0) return caller.ctx.allUnits ? { sql: 'true', args: [] } : { sql: 'false', args: [] };
  return { sql: 'f.unit_id = ANY($1::uuid[])', args: [ids] };
}

const SELECT = `
  SELECT f.id::text AS id, f.flow_no, f.unit_id::text AS unit_id, un.code AS unit_code, f.sales_order_no, f.sales_order_id::text AS sales_order_id,
         f.bom_id::text AS bom_id, b.number AS bom_number, f.part_code, f.part_name, f.bom_revision, f.qty::text AS qty,
         f.sales_approval, f.purchase_status, f.manufacturing_release, f.status, f.pr_id::text AS pr_id, pr.number AS pr_number,
         f.sales_approved_at, sa.name AS sales_approved_by, f.released_at, rb.name AS released_by, f.created_at, cb.name AS created_by,
         (SELECT count(*)::int FROM bom_material_flow_lines l WHERE l.flow_id = f.id) AS line_count,
         (SELECT count(*)::int FROM bom_material_flow_lines l WHERE l.flow_id = f.id AND l.shortage_qty > 0) AS short_lines
    FROM bom_material_flows f
    JOIN units un ON un.id = f.unit_id
    LEFT JOIN mfg_boms b ON b.id = f.bom_id
    LEFT JOIN purchase_requisitions pr ON pr.id = f.pr_id
    LEFT JOIN users sa ON sa.id = f.sales_approved_by_id
    LEFT JOIN users rb ON rb.id = f.released_by_id
    LEFT JOIN users cb ON cb.id = f.created_by_id`;

async function load(db: Db, caller: Caller, id: string, lock = false): Promise<Row> {
  const sc = scope(caller);
  const rows = await query(db, `${SELECT} WHERE f.id = $${sc.args.length + 1}::uuid AND ${sc.sql}${lock ? ' FOR UPDATE OF f' : ''}`, ...sc.args, id);
  if (!rows[0]) throw Errors.notFound('BOM flow not found.');
  return rows[0];
}

/** Stock the plant can use now: on hand minus reserved, over its normal active warehouses (transit stock is not usable). */
async function availableIn(db: Db, unitId: string, itemId: string): Promise<string> {
  const r = await query(
    db,
    `SELECT COALESCE(sum(GREATEST(b.on_hand - b.reserved_qty, 0)), 0)::text AS q
       FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.item_id = $1::uuid AND w.unit_id = $2::uuid AND NOT w.is_transit AND w.status = 'ACTIVE' AND w.deleted_at IS NULL`,
    itemId,
    unitId,
  );
  return S(r[0]?.q ?? '0');
}

async function verifyInTx(tx: Db, flow: Row): Promise<Row[]> {
  const bom = (await query(tx, `SELECT base_qty::text AS base_qty FROM mfg_boms WHERE id = $1::uuid`, S(flow.bom_id)))[0];
  if (!bom) throw Errors.conflict('The BOM of this flow no longer exists.');
  const lines = await query(
    tx,
    `SELECT l.item_id::text AS item_id, l.qty_per::text AS qty_per, l.conversion_factor::text AS conversion_factor, l.scrap_pct::text AS scrap_pct, i.base_uom
       FROM mfg_bom_lines l JOIN items i ON i.id = l.item_id
      WHERE l.bom_id = $1::uuid AND NOT l.is_phantom AND (l.effective_from IS NULL OR l.effective_from <= current_date) AND (l.effective_to IS NULL OR l.effective_to >= current_date)
      ORDER BY l.line_no`,
    S(flow.bom_id),
  );
  await tx.$executeRawUnsafe(`DELETE FROM bom_material_flow_lines WHERE flow_id = $1::uuid`, S(flow.id));
  let n = 0;
  for (const l of lines) {
    n += 1;
    const required = bomRequired(S(l.qty_per), S(l.scrap_pct), S(flow.qty), S(bom.base_qty), S(l.conversion_factor));
    const available = round3(D(await availableIn(tx, S(flow.unit_id), S(l.item_id))));
    await tx.$executeRawUnsafe(
      `INSERT INTO bom_material_flow_lines (flow_id, line_no, item_id, uom, required_qty, available_qty) VALUES ($1::uuid, $2, $3::uuid, $4, $5::numeric, $6::numeric)`,
      S(flow.id),
      n,
      S(l.item_id),
      S(l.base_uom),
      required.toFixed(),
      available.toFixed(),
    );
  }
  return linesOf(tx, S(flow.id));
}

async function linesOf(db: Db, flowId: string): Promise<Row[]> {
  return query(
    db,
    `SELECT l.id::text AS id, l.line_no, l.item_id::text AS item_id, i.code AS item_code, i.name AS item_name, l.uom,
            l.required_qty::text AS required_qty, l.available_qty::text AS available_qty, l.shortage_qty::text AS shortage_qty
       FROM bom_material_flow_lines l JOIN items i ON i.id = l.item_id WHERE l.flow_id = $1::uuid ORDER BY l.line_no`,
    flowId,
  );
}

export const bomFlowService = {
  async options(caller: Caller) {
    const sc = caller.ctx.unitIds.length > 0 ? caller.ctx.unitIds : caller.ctx.unitId ? [caller.ctx.unitId] : [];
    const boms = await query(
      prisma,
      `SELECT b.id::text AS id, b.number, b.version_no, i.code AS item_code, i.name AS item_name, b.unit_id::text AS unit_id
         FROM mfg_boms b JOIN items i ON i.id = b.item_id
        WHERE b.status = 'RELEASED' AND b.deleted_at IS NULL AND ($1::uuid[] IS NULL OR b.unit_id = ANY($1::uuid[])) ORDER BY i.name LIMIT 300`,
      caller.ctx.allUnits && sc.length === 0 ? null : sc,
    );
    const orders = await query(
      prisma,
      `SELECT s.id::text AS id, s.number FROM sales_orders s WHERE s.deleted_at IS NULL AND ($1::uuid[] IS NULL OR s.unit_id = ANY($1::uuid[])) ORDER BY s.created_at DESC LIMIT 200`,
      caller.ctx.allUnits && sc.length === 0 ? null : sc,
    );
    return { boms, salesOrders: orders };
  },

  async list(caller: Caller, p: { tab?: string; q?: string }): Promise<Row[]> {
    await assertPhase41Schema(prisma);
    const sc = scope(caller);
    const args = [...sc.args];
    const w = [sc.sql];
    const tab = p.tab ?? 'selection';
    if (tab === 'sales') w.push(`f.sales_approval = 'PENDING'`);
    if (tab === 'shortage') w.push(`EXISTS (SELECT 1 FROM bom_material_flow_lines l WHERE l.flow_id = f.id AND l.shortage_qty > 0)`);
    if (tab === 'release') w.push(`f.sales_approval = 'APPROVED'`);
    if (p.q) {
      args.push(`%${p.q}%`);
      w.push(`(f.flow_no ILIKE $${args.length} OR f.part_name ILIKE $${args.length} OR f.sales_order_no ILIKE $${args.length})`);
    }
    return query(prisma, `${SELECT} WHERE ${w.join(' AND ')} ORDER BY f.created_at DESC LIMIT 200`, ...args);
  },

  async get(caller: Caller, id: string): Promise<Row> {
    await assertPhase41Schema(prisma);
    const f = await load(prisma, caller, id);
    return { ...f, lines: await linesOf(prisma, id) };
  },

  async create(caller: Caller, input: { bomId: string; qty: number | string; salesOrderId?: string | null }): Promise<Row> {
    await assertPhase41Schema(prisma);
    const unitId = caller.ctx.unitId;
    if (!unitId) throw Errors.validation({ bomId: 'Choose one plant at the top before starting a BOM flow.' });
    const qty = D(input.qty);
    if (qty.lessThanOrEqualTo(0)) throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    const id = await prisma.$transaction(async (tx) => {
      const b = (
        await query(
          tx,
          `SELECT b.id::text AS id, b.unit_id::text AS unit_id, b.version_no, b.status, i.code, i.name FROM mfg_boms b JOIN items i ON i.id = b.item_id WHERE b.id = $1::uuid AND b.deleted_at IS NULL`,
          input.bomId,
        )
      )[0];
      if (!b || S(b.unit_id) !== unitId) throw Errors.validation({ bomId: 'Choose a BOM of this plant.' });
      if (b.status !== 'RELEASED') throw Errors.validation({ bomId: 'Only a released BOM can start a material flow.' });
      let soNo: string | null = null;
      if (input.salesOrderId) {
        const so = (await query(tx, `SELECT number FROM sales_orders WHERE id = $1::uuid AND deleted_at IS NULL`, input.salesOrderId))[0];
        if (!so) throw Errors.validation({ salesOrderId: 'Sales order not found.' });
        soNo = S(so.number);
      }
      const flowNo = await NumberingService.allocate(tx, { pageId: 'flow-bom-approval', unitId, fyId: caller.ctx.fyId, prefix: 'BMA', padding: 4 });
      const rows = await query(
        tx,
        `INSERT INTO bom_material_flows (flow_no, unit_id, sales_order_no, sales_order_id, part_code, part_name, bom_revision, bom_id, qty, created_by_id)
         VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7, $8::uuid, $9::numeric, $10::uuid) RETURNING id::text AS id`,
        flowNo, unitId, soNo, input.salesOrderId ?? null, S(b.code), S(b.name), `Rev ${S(b.version_no)}`, input.bomId, round3(qty).toFixed(), caller.auth.userId,
      );
      const fid = S(rows[0]?.id);
      await verifyInTx(tx, await load(tx, caller, fid));
      await recordAudit({ action: 'bomflow.create', actorId: caller.auth.userId, targetType: 'bom_material_flow', targetId: fid, detail: { flowNo } }, tx);
      return fid;
    }, TX);
    return bomFlowService.get(caller, id);
  },

  /** Re-reads the plant's stock and rewrites the required / available / shortage lines. */
  async verify(caller: Caller, id: string): Promise<Row> {
    await assertPhase41Schema(prisma);
    await prisma.$transaction(async (tx) => {
      const f = await load(tx, caller, id, true);
      if (f.status === 'RELEASED') throw Errors.conflict('This flow is already released to manufacturing.');
      await verifyInTx(tx, f);
      await recordAudit({ action: 'bomflow.verify', actorId: caller.auth.userId, targetType: 'bom_material_flow', targetId: id, detail: {} }, tx);
    }, TX);
    return bomFlowService.get(caller, id);
  },

  async salesDecision(caller: Caller, id: string, approve: boolean): Promise<Row> {
    await assertPhase41Schema(prisma);
    await prisma.$transaction(async (tx) => {
      const f = await load(tx, caller, id, true);
      if (f.status === 'RELEASED') throw Errors.conflict('This flow is already released to manufacturing.');
      await tx.$executeRawUnsafe(
        `UPDATE bom_material_flows SET sales_approval = $2, sales_approved_by_id = $3::uuid, sales_approved_at = now() WHERE id = $1::uuid`,
        id, approve ? 'APPROVED' : 'REJECTED', caller.auth.userId,
      );
      await recordAudit({ action: approve ? 'bomflow.sales_approve' : 'bomflow.sales_reject', actorId: caller.auth.userId, targetType: 'bom_material_flow', targetId: id, detail: {} }, tx);
    }, TX);
    return bomFlowService.get(caller, id);
  },

  /** Raise PR: every shortage line becomes one line of a Draft requisition (required - available, e.g. 82.000 - 60.000 = 22.000). */
  async raisePr(caller: Caller, id: string): Promise<Row> {
    await assertPhase41Schema(prisma);
    const out = await prisma.$transaction(async (tx) => {
      const f = await load(tx, caller, id, true);
      if (f.pr_id) throw Errors.conflict(`Requisition ${S(f.pr_number)} was already raised for this flow.`);
      if (f.status === 'RELEASED') throw Errors.conflict('This flow is already released to manufacturing.');
      const lines = await verifyInTx(tx, f);
      const short = lines
        .map((l) => ({ itemId: S(l.item_id), uom: S(l.uom), qty: shortageOf(S(l.required_qty), S(l.available_qty)) }))
        .filter((l) => l.qty.greaterThan(0));
      if (short.length === 0) throw Errors.conflict('Nothing is short, so no requisition is needed.');
      const pr = await PurchaseRequestGateway.create(tx, {
        unitId: S(f.unit_id),
        fyId: caller.ctx.fyId,
        userId: caller.auth.userId,
        department: caller.auth.user.department ?? 'Production',
        purpose: `Material shortage for ${S(f.flow_no)}`,
        lines: short.map((l) => ({ itemId: l.itemId, qty: l.qty.toFixed(), uom: l.uom })),
      });
      await tx.$executeRawUnsafe(`UPDATE bom_material_flows SET pr_id = $2::uuid, purchase_status = 'PR_DRAFT' WHERE id = $1::uuid`, id, pr.id);
      await recordAudit({ action: 'bomflow.raise_pr', actorId: caller.auth.userId, targetType: 'bom_material_flow', targetId: id, detail: { pr: pr.number, lines: short.length } }, tx);
      return pr;
    }, TX);
    return { ...(await bomFlowService.get(caller, id)), pr: out };
  },

  async release(caller: Caller, id: string): Promise<Row> {
    await assertPhase41Schema(prisma);
    await prisma.$transaction(async (tx) => {
      const f = await load(tx, caller, id, true);
      if (f.status === 'RELEASED') throw Errors.conflict('This flow is already released to manufacturing.');
      if (f.sales_approval !== 'APPROVED') throw Errors.conflict('Sales must approve this flow before manufacturing release.');
      const lines = await verifyInTx(tx, f);
      const short = lines.filter((l) => D(S(l.shortage_qty)).greaterThan(0));
      if (short.length > 0) {
        const first = short[0]!;
        throw Errors.conflict(`Stock is short for ${short.length} material(s), for example ${S(first.item_code)} by ${S(first.shortage_qty)} ${S(first.uom)}. Raise a PR and receive the stock first.`);
      }
      await tx.$executeRawUnsafe(
        `UPDATE bom_material_flows SET manufacturing_release = true, status = 'RELEASED', released_by_id = $2::uuid, released_at = now() WHERE id = $1::uuid`,
        id, caller.auth.userId,
      );
      await recordAudit({ action: 'bomflow.release', actorId: caller.auth.userId, targetType: 'bom_material_flow', targetId: id, detail: {} }, tx);
    }, TX);
    return bomFlowService.get(caller, id);
  },

  /** Traceability: the chain and every recorded step, plus the production orders that use the same BOM. */
  async trace(caller: Caller, id: string): Promise<Row> {
    await assertPhase41Schema(prisma);
    const f = await load(prisma, caller, id);
    const events = await query(
      prisma,
      `SELECT a.action, a.at, u.name AS actor, a.detail FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.target_type = 'bom_material_flow' AND a.target_id::text = $1 ORDER BY a.at`,
      id,
    );
    const orders = await query(
      prisma,
      `SELECT o.id::text AS id, o.number, o.status, o.qty::text AS qty FROM mfg_orders o WHERE o.bom_id = $1::uuid AND o.unit_id = $2::uuid AND o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 20`,
      S(f.bom_id),
      S(f.unit_id),
    );
    return { flow: f, events, orders };
  },
};
