// Phase 13 v2 routings: DRAFT -> RELEASED -> OBSOLETE, one released routing per item. An operation can be flagged is_outside
// (subcontracting is not in this version): the flag is kept but an order with such an operation cannot be released.
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
import {
  TX,
  audit,
  checkVersion,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
  scopeSql,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { D } from './calc';
import { S, oneUnit } from './master-service';

export interface RoutingOpInput {
  seq: number;
  name: string;
  workCentreId: string;
  setupMinutes?: string | number | undefined;
  runMinutes?: string | number | undefined;
  queueMinutes?: string | number | undefined;
  moveMinutes?: string | number | undefined;
  qcRequired?: boolean | undefined;
  qmsPlanRef?: string | undefined;
  isOutside?: boolean | undefined;
  toolingNote?: string | undefined;
}
export interface RoutingInput {
  itemId: string;
  effectiveFrom?: string | undefined;
  notes?: string | undefined;
  ops: RoutingOpInput[];
}

async function checkOps(
  tx: Db,
  unitId: string,
  itemId: string,
  ops: RoutingOpInput[],
): Promise<void> {
  if (ops.length === 0) throw Errors.validation({ ops: 'Add at least one operation.' });
  const it = (
    await query(
      tx,
      `SELECT status::text AS status FROM items WHERE id=$1::uuid AND deleted_at IS NULL`,
      itemId,
    )
  )[0];
  if (S(it?.status) !== 'ACTIVE') throw Errors.validation({ itemId: 'The item is not active.' });
  const wc = await query(
    tx,
    `SELECT id::text, status FROM mfg_work_centres WHERE unit_id=$1::uuid AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    unitId,
    [...new Set(ops.map((o) => o.workCentreId))],
  );
  const ok = new Map(wc.map((w) => [S(w.id), S(w.status)]));
  const seqs = new Set<number>();
  const errs: Record<string, string> = {};
  ops.forEach((o, i) => {
    if (seqs.has(o.seq)) errs[`ops.${i}.seq`] = 'This operation number is used twice.';
    seqs.add(o.seq);
    if (ok.get(o.workCentreId) !== 'ACTIVE')
      errs[`ops.${i}.workCentreId`] = 'Choose an active work centre of this unit.';
    for (const k of ['setupMinutes', 'runMinutes', 'queueMinutes', 'moveMinutes'] as const)
      if (o[k] !== undefined && D(String(o[k])).lt(0))
        errs[`ops.${i}.${k}`] = 'Minutes cannot be negative.';
  });
  if (Object.keys(errs).length) throw Errors.validation(errs);
}
async function writeOps(tx: Db, routingId: string, ops: RoutingOpInput[]): Promise<void> {
  for (const o of [...ops].sort((a, b) => a.seq - b.seq))
    await insertRow(tx, 'mfg_routing_ops', {
      routingId,
      seq: o.seq,
      name: o.name.trim(),
      workCentreId: o.workCentreId,
      setupMinutes: D(String(o.setupMinutes ?? 0)).toFixed(2),
      runMinutes: D(String(o.runMinutes ?? 0)).toFixed(4),
      queueMin: D(String(o.queueMinutes ?? 0)).toFixed(2),
      moveMin: D(String(o.moveMinutes ?? 0)).toFixed(2),
      inspectionRequired: o.qcRequired === true,
      qmsPlanRef: o.qmsPlanRef ?? null,
      isOutside: o.isOutside === true,
      toolingNote: o.toolingNote ?? null,
    });
}
async function lockRouting(tx: Db, sc: { sql: string; args: unknown[] }, id: string): Promise<Row> {
  const cur = (
    await query(
      tx,
      `SELECT t.* FROM mfg_routings t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
      ...sc.args,
      id,
    )
  )[0];
  if (!cur) throw Errors.notFound('Routing not found.');
  return cur;
}

export const routingService = {
  async list(
    caller: Caller,
    pageId: string,
    q: {
      itemId?: string | undefined;
      status?: string | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.itemId) {
      args.push(q.itemId);
      where.push(`t.item_id=$${args.length}::uuid`);
    }
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(i.code ILIKE $${args.length} OR i.name ILIKE $${args.length} OR t.number ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM mfg_routings t JOIN items i ON i.id=t.item_id WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, (SELECT count(*)::int FROM mfg_routing_ops o WHERE o.routing_id=t.id) AS op_count
         FROM mfg_routings t JOIN items i ON i.id=t.item_id WHERE ${w}
        ORDER BY i.code, t.version_no DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name FROM mfg_routings t JOIN items i ON i.id=t.item_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('Routing not found.');
    const ops = await query(
      prisma,
      `SELECT o.id::text, o.seq, o.name, o.work_centre_id::text, o.setup_minutes::text, o.run_minutes::text, o.queue_min::text AS queue_minutes,
              o.move_min::text AS move_minutes, o.inspection_required AS qc_required, o.qms_plan_ref, o.is_outside, o.tooling_note,
              w.code AS work_centre_code, w.name AS work_centre_name
         FROM mfg_routing_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.routing_id=$1::uuid ORDER BY o.seq`,
      id,
    );
    return { ...norm<Row>(h), ops: ops.map((r) => norm<Row>(r)) };
  },

  async create(caller: Caller, pageId: string, b: RoutingInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      await checkOps(tx, unitId, b.itemId, b.ops);
      const v = (
        await query(
          tx,
          `SELECT COALESCE(max(version_no),0)+1 AS n FROM mfg_routings WHERE unit_id=$1::uuid AND item_id=$2::uuid`,
          unitId,
          b.itemId,
        )
      )[0]!;
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:RTG',
        unitId,
        fyId: fy.id,
        prefix: 'RT',
      });
      const rid = await insertRow(tx, 'mfg_routings', {
        unitId,
        fyId: fy.id,
        number,
        itemId: b.itemId,
        versionNo: Number(v.n),
        status: 'DRAFT',
        effectiveFrom: b.effectiveFrom ?? null,
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await writeOps(tx, rid, b.ops);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ROUTING_CREATED',
        'mfg_routing',
        { id: rid, code: number },
        pageId,
        {},
      );
      return rid;
    }, TX);
    return routingService.get(caller, pageId, id);
  },

  async update(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: {
      effectiveFrom?: string | undefined;
      notes?: string | undefined;
      ops?: RoutingOpInput[] | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockRouting(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT')
        throw Errors.conflict(
          `Released routing v${S(cur.version_no)} can't be edited. Use Revise to create v${Number(cur.version_no) + 1}.`,
        );
      if (b.ops) {
        await checkOps(tx, S(cur.unit_id), S(cur.item_id), b.ops);
        await exec(tx, `DELETE FROM mfg_routing_ops WHERE routing_id=$1::uuid`, id);
        await writeOps(tx, id, b.ops);
      }
      await exec(
        tx,
        `UPDATE mfg_routings SET effective_from=COALESCE($1::date,effective_from), notes=COALESCE($2,notes), updated_by_id=$3::uuid, updated_at=now(), version=version+1 WHERE id=$4::uuid`,
        b.effectiveFrom ?? null,
        b.notes ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ROUTING_UPDATED',
        'mfg_routing',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return routingService.get(caller, pageId, id);
  },

  /** DRAFT -> RELEASED; the previous released routing of the item becomes OBSOLETE. */
  async release(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockRouting(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT') throw Errors.conflict('Only a draft routing can be released.');
      if (
        !(await query(tx, `SELECT 1 FROM mfg_routing_ops WHERE routing_id=$1::uuid LIMIT 1`, id))
          .length
      )
        throw Errors.validation({ ops: 'Add at least one operation.' });
      await exec(
        tx,
        `UPDATE mfg_routings SET status='OBSOLETE', updated_at=now(), version=version+1 WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='RELEASED' AND deleted_at IS NULL`,
        S(cur.unit_id),
        S(cur.item_id),
      );
      await exec(
        tx,
        `UPDATE mfg_routings SET status='RELEASED', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await exec(
        tx,
        `UPDATE mfg_item_planning SET default_routing_id=$1::uuid, updated_at=now() WHERE item_id=$2::uuid`,
        id,
        S(cur.item_id),
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ROUTING_RELEASED',
        'mfg_routing',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return routingService.get(caller, pageId, id);
  },

  async revise(caller: Caller, pageId: string, id: string): Promise<Row> {
    const src = await routingService.get(caller, pageId, id);
    if (S(src.status) === 'DRAFT')
      throw Errors.conflict('This routing is a draft. Edit it instead.');
    return routingService.create(caller, pageId, {
      itemId: S(src.itemId),
      ...(src.notes ? { notes: S(src.notes) } : {}),
      ops: (src.ops as Row[]).map((o) => ({
        seq: Number(o.seq),
        name: S(o.name),
        workCentreId: S(o.workCentreId),
        setupMinutes: S(o.setupMinutes),
        runMinutes: S(o.runMinutes),
        queueMinutes: S(o.queueMinutes),
        moveMinutes: S(o.moveMinutes),
        qcRequired: o.qcRequired === true,
        ...(o.qmsPlanRef ? { qmsPlanRef: S(o.qmsPlanRef) } : {}),
        isOutside: o.isOutside === true,
        ...(o.toolingNote ? { toolingNote: S(o.toolingNote) } : {}),
      })),
    });
  },

  async obsolete(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockRouting(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'RELEASED')
        throw Errors.conflict('Only a released routing can be made obsolete.');
      await exec(
        tx,
        `UPDATE mfg_routings SET status='OBSOLETE', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await exec(
        tx,
        `UPDATE mfg_item_planning SET default_routing_id=NULL, updated_at=now() WHERE default_routing_id=$1::uuid`,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ROUTING_OBSOLETE',
        'mfg_routing',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return routingService.get(caller, pageId, id);
  },
};
