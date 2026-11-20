// Engineering Change Notice/Order (docs2 RHAI_V40_A3 p.1, "Design fail or customer change": "create ECN/ECO
// if design was frozen"; same page's EMAIL/ALERT line: "rejection / ECN -> Sales, Purchase, Production").
// Raised automatically by bomService.revise() whenever it copies a RELEASED/OBSOLETE BOM into a new draft -
// never created directly by a user action. An immutable log (no edit, no approval chain of its own: the new
// BOM draft goes through the existing BOM DRAFT -> PENDING_APPROVAL -> RELEASED chain; this is the paper
// trail plus the cross-department alert).
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { audit, departmentRecipients, fyOfCaller, insertRow, norm, query, scopeSql } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { notificationService } from '../notifications/service';
import { oneUnit } from './master-service';

/** Departments the PDF names on a frozen-design change. */
const ALERT_DEPARTMENTS = ['Sales', 'Purchase', 'Production'] as const;

export const ecnService = {
  /** Called by bomService.revise(); not exposed as its own create route. */
  async raise(
    caller: Caller,
    params: {
      itemId: string;
      fromBomId: string;
      fromRevision: number;
      toBomId: string;
      toRevision: number;
      reason: string;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      const number = await NumberingService.allocate(tx, { pageId: 'mfg-ecn', unitId, fyId: fy.id });
      const rid = await insertRow(tx, 'engineering_change_orders', {
        unitId,
        fyId: fy.id,
        number,
        itemId: params.itemId,
        fromBomId: params.fromBomId,
        fromRevision: params.fromRevision,
        toBomId: params.toBomId,
        toRevision: params.toRevision,
        reason: params.reason,
        createdById: caller.auth.userId,
      });
      const recipients = await departmentRecipients(tx, ALERT_DEPARTMENTS);
      await notificationService.notify(tx, recipients, {
        type: 'MFG_ECN_RAISED',
        title: `${number}: engineering change on a frozen BOM`,
        body: params.reason,
        link: `/m/mfg-ecn?id=${rid}`,
        entityType: 'EngineeringChangeOrder',
        entityId: rid,
        dedupeKey: `ecn:${rid}`,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ECN_RAISED',
        'engineering_change_order',
        { id: rid, code: number },
        'mfg-ecn',
        { reason: params.reason, fromBomId: params.fromBomId, toBomId: params.toBomId },
      );
      return rid;
    });
    return ecnService.get(caller, 'mfg-ecn', id);
  },

  async list(
    caller: Caller,
    pageId: string,
    q: { itemId?: string | undefined; page: number; size: number },
  ): Promise<{ rows: Row[]; total: number }> {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.itemId) {
      args.push(q.itemId);
      where.push(`t.item_id=$${args.length}::uuid`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM engineering_change_orders t WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name,
              fb.number AS from_bom_no, tb.number AS to_bom_no, u.name AS raised_by_name
         FROM engineering_change_orders t
         JOIN items i ON i.id = t.item_id
         JOIN mfg_boms fb ON fb.id = t.from_bom_id
         JOIN mfg_boms tb ON tb.id = t.to_bom_id
         LEFT JOIN users u ON u.id = t.created_by_id
        WHERE ${w}
        ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const row = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name,
                fb.number AS from_bom_no, tb.number AS to_bom_no, u.name AS raised_by_name
           FROM engineering_change_orders t
           JOIN items i ON i.id = t.item_id
           JOIN mfg_boms fb ON fb.id = t.from_bom_id
           JOIN mfg_boms tb ON tb.id = t.to_bom_id
           LEFT JOIN users u ON u.id = t.created_by_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!row) throw Errors.notFound('Engineering change order not found.');
    return norm<Row>(row);
  },
};
