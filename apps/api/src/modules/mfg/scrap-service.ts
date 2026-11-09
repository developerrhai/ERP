// Phase 13 v2 scrap entries (spec: scrap_entries, submit, cancel). A draft is made from a job card or by hand. Submitting posts
// the money: normal scrap (within the BOM allowance) stays inside the product cost and posts nothing; abnormal scrap is a loss,
// Dr SCRAP_LOSS / Cr INVENTORY_WIP, and is never capitalised; recovered material comes back to stock at its net realisable
// value, Dr stock / Cr INVENTORY_WIP. Above the approval value (a setting) the approver must submit.
import { randomUUID } from 'node:crypto';
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
import { D as ID } from '../inventory/money';
import { StockGl } from '../inventory/stock/gl';
import { StockService } from '../inventory/stock/stock-service';
import { TX, audit, exec, insertRow, norm, query, scopeSql, todayIst } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { D } from './calc';
import { costing } from './costing-service';
import { S, masterService } from './master-service';
import { lockOrder, nextMoveNo } from './order-service';

export interface ScrapInput {
  orderId: string;
  opId?: string | undefined;
  qty: string | number;
  reasonId?: string | undefined;
  reason?: string | undefined;
  isNormal?: boolean | undefined;
  recoverableQty?: string | number | undefined;
  recoveryItemId?: string | undefined;
  recoveryValue?: string | number | undefined;
  disposalMethod?: string | undefined;
}

export const scrapService = {
  /** A draft scrap entry, inside the caller's transaction. */
  async createDraft(
    tx: Db,
    caller: Caller,
    order: Row,
    b: Omit<ScrapInput, 'orderId'>,
  ): Promise<string> {
    const qty = D(String(b.qty));
    if (qty.lte(0)) throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    let reasonText = (b.reason ?? '').trim();
    let normal = b.isNormal === true;
    if (b.reasonId) {
      const r = (
        await query(
          tx,
          `SELECT name, normal FROM mfg_scrap_reasons WHERE id=$1::uuid AND status='ACTIVE'`,
          b.reasonId,
        )
      )[0];
      if (!r) throw Errors.validation({ reasonId: 'Choose an active scrap reason.' });
      reasonText = reasonText || S(r.name);
      normal = b.isNormal ?? r.normal === true;
    }
    if (reasonText.length < 3)
      throw Errors.validation({ reason: 'Write why the pieces were scrapped.' });
    const rec = D(String(b.recoverableQty ?? 0));
    if (rec.gt(qty))
      throw Errors.validation({
        recoverableQty: 'The recoverable quantity cannot be more than the scrap.',
      });
    if (rec.gt(0) && (!b.recoveryItemId || D(String(b.recoveryValue ?? 0)).lte(0)))
      throw Errors.validation({
        recoveryItemId: 'Choose the recovered item and its value (net realisable value).',
      });
    const no = await NumberingService.allocate(tx, {
      pageId: 'mfg:SCR',
      unitId: S(order.unit_id),
      fyId: S(order.fy_id),
      prefix: 'SCR',
    });
    if (b.opId)
      await exec(
        tx,
        `UPDATE mfg_order_ops SET qty_scrap=qty_scrap+$1::numeric WHERE id=$2::uuid`,
        qty.toFixed(3),
        b.opId,
      );
    return insertRow(tx, 'mfg_scrap', {
      unitId: S(order.unit_id),
      fyId: S(order.fy_id),
      number: no,
      scrapDate: todayIst(),
      orderId: S(order.id),
      opId: b.opId ?? null,
      itemId: S(order.item_id),
      qty: qty.toFixed(3),
      reason: reasonText.slice(0, 200),
      reasonId: b.reasonId ?? null,
      source: 'OPERATION',
      status: 'Draft',
      isNormal: normal,
      recoverableQty: rec.toFixed(3),
      recoveryItemId: rec.gt(0) ? b.recoveryItemId : null,
      recoveryValue: rec.gt(0) ? D(String(b.recoveryValue)).toFixed(2) : '0',
      disposalMethod: b.disposalMethod ?? null,
      createdById: caller.auth.userId,
      updatedById: caller.auth.userId,
    });
  },

  async create(caller: Caller, pageId: string, b: ScrapInput): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const id = await prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, sc, b.orderId);
      if (['Cancelled', 'Closed'].includes(S(order.status)))
        throw Errors.conflict('This order is closed.');
      if (
        b.opId &&
        !(
          await query(
            tx,
            `SELECT 1 FROM mfg_order_ops WHERE id=$1::uuid AND order_id=$2::uuid`,
            b.opId,
            b.orderId,
          )
        ).length
      )
        throw Errors.validation({ opId: 'That operation is not on this order.' });
      const sid = await scrapService.createDraft(tx, caller, order, b);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_SCRAP_DRAFTED',
        'mfg_scrap',
        { id: sid, code: S(order.number) },
        pageId,
        {},
      );
      return sid;
    }, TX);
    return scrapService.get(caller, pageId, id);
  },

  async list(
    caller: Caller,
    pageId: string,
    q: {
      orderId?: string | undefined;
      status?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.orderId) {
      args.push(q.orderId);
      where.push(`t.order_id=$${args.length}::uuid`);
    }
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.from) {
      args.push(q.from);
      where.push(`t.scrap_date >= $${args.length}::date`);
    }
    if (q.to) {
      args.push(q.to);
      where.push(`t.scrap_date <= $${args.length}::date`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.number ILIKE $${args.length} OR t.reason ILIKE $${args.length} OR i.name ILIKE $${args.length} OR o.number ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const base = `FROM mfg_scrap t JOIN items i ON i.id=t.item_id JOIN mfg_orders o ON o.id=t.order_id LEFT JOIN mfg_order_ops p ON p.id=t.op_id WHERE ${w}`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n ${base}`, ...args))[0]!.n);
    const sum = (
      await query(
        prisma,
        `SELECT COALESCE(sum(t.qty) FILTER (WHERE t.status <> 'Cancelled'),0)::text AS q, COALESCE(sum(t.loss_value) FILTER (WHERE t.status='Submitted'),0)::text AS v ${base}`,
        ...args,
      )
    )[0]!;
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, o.number AS order_number, p.name AS op_name ${base}
        ORDER BY t.scrap_date DESC, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total, totalQty: S(sum.q), totalLoss: S(sum.v) };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name, o.number AS order_number, p.name AS op_name
           FROM mfg_scrap t JOIN items i ON i.id=t.item_id JOIN mfg_orders o ON o.id=t.order_id LEFT JOIN mfg_order_ops p ON p.id=t.op_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Scrap entry not found.');
    return norm<Row>(r);
  },

  /** Posts a draft. Normal scrap posts nothing; abnormal scrap is a loss; recovery returns material to stock. */
  async submit(caller: Caller, pageId: string, id: string, canApprove: boolean): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    await prisma.$transaction(async (tx) => {
      const s = (
        await query(
          tx,
          `SELECT t.* FROM mfg_scrap t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!s) throw Errors.notFound('Scrap entry not found.');
      if (S(s.status) !== 'Draft')
        throw Errors.conflict('Only a draft scrap entry can be submitted.');
      const order = await lockOrder(tx, { sql: 'true', args: [] }, S(s.order_id));
      if (['Cancelled', 'Closed'].includes(S(order.status)))
        throw Errors.conflict('This order is closed.');
      const settings = await masterService.settings(S(order.unit_id));
      let loss = D(0);
      let journalId: string | null = null;
      if (!(s.is_normal === true)) {
        const wipNow = D(await costing.wip(tx, S(order.id)));
        const est = D(S(order.qty)).gt(0) ? wipNow.mul(S(s.qty)).div(S(order.qty)) : D(0);
        if (
          settings.SCRAP_APPROVAL_VALUE !== undefined &&
          est.gt(settings.SCRAP_APPROVAL_VALUE) &&
          !canApprove
        )
          throw Errors.forbidden(
            `This scrap is worth about ₹${est.toFixed(2)}, above the approval value. An approver must submit it.`,
          );
        const ab = await costing.abnormalScrap(tx, caller, {
          orderId: S(order.id),
          opId: s.op_id ? S(s.op_id) : null,
          qty: S(s.qty),
          scrapId: id,
          date,
        });
        loss = D(ab.amount);
        journalId = ab.journalId;
      }
      // recovery: the recovered material returns to the raw-material warehouse at its net realisable value
      if (D(S(s.recoverable_qty)).gt(0) && s.recovery_item_id) {
        const mv = await nextMoveNo(tx, order, 'SCRAP_RECOVERY');
        const moveId = randomUUID();
        const res = await StockService.postMovement(tx, {
          warehouseId: S(order.rm_warehouse_id),
          itemId: S(s.recovery_item_id),
          direction: 'IN',
          qty: ID(S(s.recoverable_qty)),
          postingDate: date,
          voucherType: 'SCRAP',
          voucherId: moveId,
          voucherNo: mv.number,
          createdById: caller.auth.userId,
          value: ID(S(s.recovery_value)),
          stockStatus: 'UNRESTRICTED',
          reasonCode: 'SCRAP_RECOVERY',
        });
        const j = await StockGl.post(tx, {
          voucherId: moveId,
          voucherNo: mv.number,
          unitId: S(order.unit_id),
          postingDate: date,
          event: 'MFG_SCRAP_RECOVERY',
          voucherType: 'Goods Receipt',
          counter: 'INVENTORY_WIP',
          ledgerIds: res.entries.map((e) => e.id),
          narration: `Scrap recovery ${S(order.number)}`,
          actorId: caller.auth.userId,
        });
        await insertRow(tx, 'mfg_order_moves', {
          id: moveId,
          unitId: S(order.unit_id),
          orderId: S(order.id),
          kind: 'SCRAP_RECOVERY',
          seq: mv.seq,
          number: mv.number,
          moveDate: date,
          journalId: j?.id ?? null,
          totalQty: S(s.recoverable_qty),
          totalValue: D(S(s.recovery_value)).toFixed(2),
          detail: JSON.stringify([{ scrapId: id }]),
          createdById: caller.auth.userId,
        });
        await costing.ledger(tx, caller, {
          unitId: S(order.unit_id),
          orderId: S(order.id),
          event: 'RECOVERY',
          element: 'SCRAP',
          amount: D(S(s.recovery_value)).negated().toFixed(2),
          journalId: j?.id ?? null,
          refType: 'scrap',
          refId: id,
          date,
        });
      }
      await exec(
        tx,
        `UPDATE mfg_scrap SET status='Submitted', loss_value=$1::numeric, journal_id=$2::uuid, approved_by_id=$3::uuid, updated_by_id=$3::uuid, updated_at=now(), version=version+1 WHERE id=$4::uuid`,
        loss.toFixed(2),
        journalId,
        caller.auth.userId,
        id,
      );
      await exec(
        tx,
        `UPDATE mfg_orders SET qty_scrapped=qty_scrapped+$1::numeric, updated_at=now() WHERE id=$2::uuid`,
        S(s.qty),
        S(order.id),
      );
      // the quality register of Phase 12 shows every scrapped piece
      const fy = S(order.fy_id);
      const item = (
        await query(tx, `SELECT name FROM items WHERE id=$1::uuid`, S(order.item_id))
      )[0]!;
      const no = await NumberingService.allocate(tx, {
        pageId: 'qms:REJ',
        unitId: S(order.unit_id),
        fyId: fy,
        prefix: 'REJ',
      });
      const rid = await insertRow(tx, 'qms_rejections', {
        unitId: S(order.unit_id),
        fyId: fy,
        number: no,
        rejectDate: date,
        process: 'Production',
        itemId: S(order.item_id),
        part: S(item.name).slice(0, 150),
        holdQty: S(s.qty),
        defect: S(s.reason).slice(0, 200),
        defectType: 'PRODUCTION',
        disposition: 'SCRAP',
        dispositionNote: `Scrapped on ${S(order.number)}`,
        status: 'Closed',
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE mfg_scrap SET rejection_id=$1::uuid WHERE id=$2::uuid`, rid, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_SCRAP_SUBMITTED',
        'mfg_scrap',
        { id, code: S(s.number) },
        pageId,
        { loss: loss.toFixed(2), normal: s.is_normal === true },
      );
    }, TX);
    return scrapService.get(caller, pageId, id);
  },

  /** A draft is simply cancelled; a submitted entry is reversed (journal, recovery stock and ledger). */
  async cancel(caller: Caller, pageId: string, id: string, reason: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    await prisma.$transaction(async (tx) => {
      const s = (
        await query(
          tx,
          `SELECT t.* FROM mfg_scrap t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!s) throw Errors.notFound('Scrap entry not found.');
      if (S(s.status) === 'Cancelled')
        throw Errors.conflict('This scrap entry is already cancelled.');
      const order = await lockOrder(tx, { sql: 'true', args: [] }, S(s.order_id));
      if (S(s.status) === 'Submitted') {
        if (S(order.status) === 'Closed') throw Errors.conflict('This order is closed.');
        if (s.journal_id) await costing.reverseJournal(tx, caller, S(s.journal_id), reason, date);
        const rows = await query(
          tx,
          `SELECT id::text, amount::text, event FROM mfg_cost_ledger WHERE ref_type='scrap' AND ref_id=$1::uuid AND reversal_of_id IS NULL`,
          id,
        );
        for (const r of rows) {
          if (S(r.event) === 'RECOVERY') {
            const mv = (
              await query(
                tx,
                `SELECT * FROM mfg_order_moves WHERE order_id=$1::uuid AND kind='SCRAP_RECOVERY' AND status='Posted' AND detail::jsonb @> $2::jsonb ORDER BY created_at DESC LIMIT 1`,
                S(order.id),
                JSON.stringify([{ scrapId: id }]),
              )
            )[0];
            if (mv) {
              await StockService.reverseVoucher(tx, S(mv.id), {
                voucherNo: `${S(mv.number)}-X`,
                postingDate: date,
                createdById: caller.auth.userId,
              });
              if (mv.journal_id)
                await StockGl.reverse(tx, S(mv.journal_id), {
                  reason,
                  date,
                  actorId: caller.auth.userId,
                });
              await exec(
                tx,
                `UPDATE mfg_order_moves SET status='Cancelled' WHERE id=$1::uuid`,
                S(mv.id),
              );
            }
          }
          await costing.ledger(tx, caller, {
            unitId: S(order.unit_id),
            orderId: S(order.id),
            event: 'REVERSAL',
            element: 'SCRAP',
            amount: D(S(r.amount)).negated().toFixed(2),
            journalId: null,
            refType: 'scrap',
            refId: id,
            date,
            reversalOfId: S(r.id),
          });
        }
        await exec(
          tx,
          `UPDATE mfg_orders SET qty_scrapped=qty_scrapped-$1::numeric, updated_at=now() WHERE id=$2::uuid`,
          S(s.qty),
          S(order.id),
        );
        if (s.rejection_id)
          await exec(
            tx,
            `UPDATE qms_rejections SET status='Cancelled', updated_at=now(), version=version+1 WHERE id=$1::uuid`,
            S(s.rejection_id),
          );
      }
      if (s.op_id)
        await exec(
          tx,
          `UPDATE mfg_order_ops SET qty_scrap=qty_scrap-$1::numeric WHERE id=$2::uuid`,
          S(s.qty),
          S(s.op_id),
        );
      await exec(
        tx,
        `UPDATE mfg_scrap SET status='Cancelled', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_SCRAP_CANCELLED',
        'mfg_scrap',
        { id, code: S(s.number) },
        pageId,
        { reason },
      );
    }, TX);
    return scrapService.get(caller, pageId, id);
  },
};
