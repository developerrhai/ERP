// Phase 13 masters: work centres, bills of materials and routings. A BOM and a routing are versioned: edit a Draft, make it
// Active (the old Active one is retired in the same step), never edit an Active or Retired one. Activating a BOM refuses a
// loop (A needs B needs A) so the explosion always ends.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import type { Caller } from '../records/service';
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
import { D, findCycle } from './logic';
import type { Bom } from './logic';

export const S = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.toString === Object.prototype.toString) return JSON.stringify(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v as string);
};
/** A date column as YYYY-MM-DD (raw queries return a JS Date for a date column). */
export const dateOf = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : S(v);
export const oneUnit = (caller: Caller): string => {
  if (!caller.ctx.unitId)
    throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
  return caller.ctx.unitId;
};
export const WORK_CENTRE_KINDS = ['MACHINE', 'LINE', 'MANUAL', 'OUTSIDE'] as const;

async function itemsExist(db: Db, ids: string[]): Promise<Map<string, Row>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const rows = await query(
    db,
    `SELECT id::text, code, name, base_uom, status::text AS status, item_type, is_customer_supplied FROM items WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    uniq,
  );
  const m = new Map(rows.map((r) => [S(r.id), norm<Row>(r)]));
  for (const id of uniq)
    if (!m.has(id)) throw Errors.validation({ item: 'An item was not found.' });
  return m;
}

// ------------------------------------------------------------------------------------------------ work centres
export interface WorkCentreInput {
  code: string;
  name: string;
  kind?: (typeof WORK_CENTRE_KINDS)[number] | undefined;
  capacityHours?: string | number | undefined;
  costPerHour?: string | number | undefined;
  notes?: string | undefined;
  assetRef?: string | undefined;
}

export const masterService = {
  async listWorkCentres(
    caller: Caller,
    pageId: string,
    q: { q?: string | undefined; status?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(t.code ILIKE $${args.length} OR t.name ILIKE $${args.length})`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM mfg_work_centres t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.* FROM mfg_work_centres t WHERE ${w} ORDER BY t.code LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async createWorkCentre(caller: Caller, pageId: string, b: WorkCentreInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const code = b.code.trim().toUpperCase();
    const id = await prisma.$transaction(async (tx) => {
      const dup = await query(
        tx,
        `SELECT 1 FROM mfg_work_centres WHERE unit_id=$1::uuid AND code=$2 AND deleted_at IS NULL`,
        unitId,
        code,
      );
      if (dup.length) throw Errors.validation({ code: `Work centre ${code} already exists.` });
      const rid = await insertRow(tx, 'mfg_work_centres', {
        unitId,
        code,
        name: b.name.trim(),
        kind: b.kind ?? 'MACHINE',
        capacityHours: String(b.capacityHours ?? 8),
        costPerHour: String(b.costPerHour ?? 0),
        notes: b.notes ?? null,
        assetRef: b.assetRef ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_WORKCENTRE_CREATED',
        'mfg_work_centre',
        { id: rid, code },
        pageId,
        {},
      );
      return rid;
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_work_centres WHERE id=$1::uuid`, id))[0]!,
    );
  },

  async updateWorkCentre(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: Partial<WorkCentreInput> & { status?: 'ACTIVE' | 'INACTIVE' | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_work_centres t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Work centre not found.');
      checkVersion(norm<Row>(cur), version);
      if (b.status === 'INACTIVE') {
        const live = await query(
          tx,
          `SELECT 1 FROM mfg_order_ops o JOIN mfg_orders d ON d.id=o.order_id WHERE o.work_centre_id=$1::uuid AND d.status IN ('Released','In Progress') LIMIT 1`,
          id,
        );
        if (live.length)
          throw Errors.conflict('Open production orders still use this work centre.');
      }
      await exec(
        tx,
        `UPDATE mfg_work_centres SET name=COALESCE($1,name), kind=COALESCE($2,kind), capacity_hours=COALESCE($3::numeric,capacity_hours),
           cost_per_hour=COALESCE($4::numeric,cost_per_hour), status=COALESCE($5,status), notes=COALESCE($6,notes), asset_ref=COALESCE($9,asset_ref),
           updated_by_id=$7::uuid, updated_at=now(), version=version+1 WHERE id=$8::uuid`,
        b.name?.trim() ?? null,
        b.kind ?? null,
        b.capacityHours === undefined ? null : String(b.capacityHours),
        b.costPerHour === undefined ? null : String(b.costPerHour),
        b.status ?? null,
        b.notes ?? null,
        caller.auth.userId,
        id,
        b.assetRef ?? null,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_WORKCENTRE_UPDATED',
        'mfg_work_centre',
        { id, code: S(cur.code) },
        pageId,
        {},
      );
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_work_centres WHERE id=$1::uuid`, id))[0]!,
    );
  },

  // ---------------------------------------------------------------------------------------------- BOM
  async listBoms(
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
          `SELECT count(*)::int AS n FROM mfg_boms t JOIN items i ON i.id=t.item_id WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom,
              (SELECT count(*)::int FROM mfg_bom_lines l WHERE l.bom_id=t.id) AS line_count
         FROM mfg_boms t JOIN items i ON i.id=t.item_id WHERE ${w}
        ORDER BY i.code, t.version_no DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getBom(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom FROM mfg_boms t JOIN items i ON i.id=t.item_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('Bill of materials not found.');
    const lines = await query(
      prisma,
      `SELECT l.id::text, l.line_no, l.item_id::text, l.qty_per::text, l.scrap_pct::text, l.notes, i.code AS item_code, i.name AS item_name,
              i.base_uom AS uom, i.is_customer_supplied
         FROM mfg_bom_lines l JOIN items i ON i.id=l.item_id WHERE l.bom_id=$1::uuid ORDER BY l.line_no`,
      id,
    );
    return { ...norm<Row>(h), lines: lines.map((r) => norm<Row>(r)) };
  },

  async createBom(
    caller: Caller,
    pageId: string,
    b: {
      itemId: string;
      baseQty?: string | number | undefined;
      notes?: string | undefined;
      lines: {
        itemId: string;
        qtyPer: string | number;
        scrapPct?: string | number | undefined;
        notes?: string | undefined;
      }[];
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      await checkBomLines(tx, b.itemId, b.lines);
      const v = (
        await query(
          tx,
          `SELECT COALESCE(max(version_no),0)+1 AS n FROM mfg_boms WHERE unit_id=$1::uuid AND item_id=$2::uuid`,
          unitId,
          b.itemId,
        )
      )[0]!;
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:BOM',
        unitId,
        fyId: fy.id,
        prefix: 'BOM',
      });
      const rid = await insertRow(tx, 'mfg_boms', {
        unitId,
        fyId: fy.id,
        number,
        itemId: b.itemId,
        versionNo: Number(v.n),
        status: 'DRAFT',
        baseQty: String(b.baseQty ?? 1),
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await writeBomLines(tx, rid, b.lines);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_CREATED',
        'mfg_bom',
        { id: rid, code: number },
        pageId,
        {},
      );
      return rid;
    }, TX);
    return masterService.getBom(caller, pageId, id);
  },

  async updateBom(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: {
      baseQty?: string | number | undefined;
      notes?: string | undefined;
      lines?:
        | {
            itemId: string;
            qtyPer: string | number;
            scrapPct?: string | number | undefined;
            notes?: string | undefined;
          }[]
        | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_boms t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Bill of materials not found.');
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT')
        throw Errors.conflict('Only a draft BOM can be edited. Make a new version instead.');
      if (b.lines) {
        await checkBomLines(tx, S(cur.item_id), b.lines);
        await exec(tx, `DELETE FROM mfg_bom_lines WHERE bom_id=$1::uuid`, id);
        await writeBomLines(tx, id, b.lines);
      }
      await exec(
        tx,
        `UPDATE mfg_boms SET base_qty=COALESCE($1::numeric,base_qty), notes=COALESCE($2,notes), updated_by_id=$3::uuid, updated_at=now(), version=version+1 WHERE id=$4::uuid`,
        b.baseQty === undefined ? null : String(b.baseQty),
        b.notes ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_UPDATED',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return masterService.getBom(caller, pageId, id);
  },

  /** Draft -> Active. The Active BOM of the same item is retired. A loop through other Active BOMs is refused. */
  async activateBom(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_boms t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Bill of materials not found.');
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT') throw Errors.conflict('Only a draft BOM can be activated.');
      const lines = await query(
        tx,
        `SELECT 1 FROM mfg_bom_lines WHERE bom_id=$1::uuid LIMIT 1`,
        id,
      );
      if (!lines.length) throw Errors.validation({ lines: 'Add at least one component.' });
      const boms = await activeBoms(tx, S(cur.unit_id), id);
      const cyc = findCycle(boms);
      if (cyc) {
        const names = await query(tx, `SELECT code FROM items WHERE id = ANY($1::uuid[])`, cyc);
        throw Errors.validation({
          lines: `This BOM makes a loop (${names.map((n) => S(n.code)).join(' > ')}). A part cannot need itself.`,
        });
      }
      await exec(
        tx,
        `UPDATE mfg_boms SET status='RETIRED', updated_at=now(), version=version+1 WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='ACTIVE' AND deleted_at IS NULL`,
        S(cur.unit_id),
        S(cur.item_id),
      );
      await exec(
        tx,
        `UPDATE mfg_boms SET status='ACTIVE', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_ACTIVATED',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return masterService.getBom(caller, pageId, id);
  },

  /** Copies a BOM (any status) into a new Draft version of the same item. */
  async newBomVersion(caller: Caller, pageId: string, id: string): Promise<Row> {
    const src = await masterService.getBom(caller, pageId, id);
    return masterService.createBom(caller, pageId, {
      itemId: S(src.itemId),
      baseQty: S(src.baseQty),
      notes: S(src.notes) || undefined,
      lines: (src.lines as Row[]).map((l) => ({
        itemId: S(l.itemId),
        qtyPer: S(l.qtyPer),
        scrapPct: S(l.scrapPct),
        notes: S(l.notes) || undefined,
      })),
    });
  },

  async retireBom(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_boms t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Bill of materials not found.');
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) === 'RETIRED') throw Errors.conflict('This BOM is already retired.');
      await exec(
        tx,
        `UPDATE mfg_boms SET status='RETIRED', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_RETIRED',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return masterService.getBom(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- routing
  async listRoutings(
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
      `SELECT t.*, i.code AS item_code, i.name AS item_name,
              (SELECT count(*)::int FROM mfg_routing_ops o WHERE o.routing_id=t.id) AS op_count
         FROM mfg_routings t JOIN items i ON i.id=t.item_id WHERE ${w}
        ORDER BY i.code, t.version_no DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getRouting(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name FROM mfg_routings t JOIN items i ON i.id=t.item_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('Routing not found.');
    const ops = await query(
      prisma,
      `SELECT o.id::text, o.seq, o.name, o.work_centre_id::text, o.setup_minutes::text, o.run_minutes::text, o.inspection_required,
              w.code AS work_centre_code, w.name AS work_centre_name
         FROM mfg_routing_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.routing_id=$1::uuid ORDER BY o.seq`,
      id,
    );
    return { ...norm<Row>(h), ops: ops.map((r) => norm<Row>(r)) };
  },

  async createRouting(
    caller: Caller,
    pageId: string,
    b: { itemId: string; notes?: string | undefined; ops: RoutingOpInput[] },
  ): Promise<Row> {
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
        prefix: 'RTG',
      });
      const rid = await insertRow(tx, 'mfg_routings', {
        unitId,
        fyId: fy.id,
        number,
        itemId: b.itemId,
        versionNo: Number(v.n),
        status: 'DRAFT',
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
    return masterService.getRouting(caller, pageId, id);
  },

  async updateRouting(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: { notes?: string | undefined; ops?: RoutingOpInput[] | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_routings t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Routing not found.');
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT')
        throw Errors.conflict('Only a draft routing can be edited. Make a new version instead.');
      if (b.ops) {
        await checkOps(tx, S(cur.unit_id), S(cur.item_id), b.ops);
        await exec(tx, `DELETE FROM mfg_routing_ops WHERE routing_id=$1::uuid`, id);
        await writeOps(tx, id, b.ops);
      }
      await exec(
        tx,
        `UPDATE mfg_routings SET notes=COALESCE($1,notes), updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
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
    return masterService.getRouting(caller, pageId, id);
  },

  async activateRouting(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_routings t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Routing not found.');
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT')
        throw Errors.conflict('Only a draft routing can be activated.');
      const ops = await query(
        tx,
        `SELECT 1 FROM mfg_routing_ops WHERE routing_id=$1::uuid LIMIT 1`,
        id,
      );
      if (!ops.length) throw Errors.validation({ ops: 'Add at least one operation.' });
      await exec(
        tx,
        `UPDATE mfg_routings SET status='RETIRED', updated_at=now(), version=version+1 WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='ACTIVE' AND deleted_at IS NULL`,
        S(cur.unit_id),
        S(cur.item_id),
      );
      await exec(
        tx,
        `UPDATE mfg_routings SET status='ACTIVE', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ROUTING_ACTIVATED',
        'mfg_routing',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return masterService.getRouting(caller, pageId, id);
  },

  async newRoutingVersion(caller: Caller, pageId: string, id: string): Promise<Row> {
    const src = await masterService.getRouting(caller, pageId, id);
    return masterService.createRouting(caller, pageId, {
      itemId: S(src.itemId),
      notes: S(src.notes) || undefined,
      ops: (src.ops as Row[]).map((o) => ({
        seq: Number(o.seq),
        name: S(o.name),
        workCentreId: S(o.workCentreId),
        setupMinutes: S(o.setupMinutes),
        runMinutes: S(o.runMinutes),
        inspectionRequired: o.inspectionRequired === true,
      })),
    });
  },

  async retireRouting(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_routings t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Routing not found.');
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) === 'RETIRED') throw Errors.conflict('This routing is already retired.');
      await exec(
        tx,
        `UPDATE mfg_routings SET status='RETIRED', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ROUTING_RETIRED',
        'mfg_routing',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return masterService.getRouting(caller, pageId, id);
  },
};

// ------------------------------------------------------------------------------------------------ helpers
export interface RoutingOpInput {
  seq: number;
  name: string;
  workCentreId: string;
  setupMinutes?: string | number | undefined;
  runMinutes?: string | number | undefined;
  inspectionRequired?: boolean | undefined;
}
type LineIn = {
  itemId: string;
  qtyPer: string | number;
  scrapPct?: string | number | undefined;
  notes?: string | undefined;
};

async function checkBomLines(tx: Db, parentId: string, lines: LineIn[]): Promise<void> {
  if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one component.' });
  const seen = new Set<string>();
  const errs: Record<string, string> = {};
  const items = await itemsExist(tx, [parentId, ...lines.map((l) => l.itemId)]);
  if (S(items.get(parentId)?.status) !== 'ACTIVE')
    errs.itemId = 'The item to be made is not active.';
  lines.forEach((l, i) => {
    if (l.itemId === parentId) errs[`lines.${i}`] = 'An item cannot be a component of itself.';
    else if (seen.has(l.itemId)) errs[`lines.${i}`] = 'This component is listed twice.';
    seen.add(l.itemId);
    if (S(items.get(l.itemId)?.status) !== 'ACTIVE')
      errs[`lines.${i}`] = 'This component is not active.';
    if (D(String(l.qtyPer)).lte(0)) errs[`lines.${i}.qtyPer`] = 'Enter a quantity greater than 0.';
    const sp = D(String(l.scrapPct ?? 0));
    if (sp.lt(0) || sp.gte(100))
      errs[`lines.${i}.scrapPct`] = 'Scrap % must be from 0 to below 100.';
  });
  if (Object.keys(errs).length) throw Errors.validation(errs);
}
async function writeBomLines(tx: Db, bomId: string, lines: LineIn[]): Promise<void> {
  let n = 0;
  for (const l of lines) {
    n += 1;
    await insertRow(tx, 'mfg_bom_lines', {
      bomId,
      lineNo: n,
      itemId: l.itemId,
      qtyPer: String(l.qtyPer),
      scrapPct: String(l.scrapPct ?? 0),
      notes: l.notes ?? null,
    });
  }
}
/** All Active BOMs of the unit as a graph, with `includeId` (a draft being activated) taking the place of its item's Active one. */
export async function activeBoms(
  db: Db,
  unitId: string,
  includeId?: string,
): Promise<Map<string, Bom>> {
  const rows = await query(
    db,
    `SELECT b.id::text, b.item_id::text, b.base_qty::text, l.item_id::text AS comp, l.qty_per::text, l.scrap_pct::text
       FROM mfg_boms b LEFT JOIN mfg_bom_lines l ON l.bom_id=b.id
      WHERE b.unit_id=$1::uuid AND b.deleted_at IS NULL AND (b.status='ACTIVE' OR b.id=$2::uuid)
      ORDER BY b.item_id, (b.id=$2::uuid) DESC, l.line_no`,
    unitId,
    includeId ?? '00000000-0000-0000-0000-000000000000',
  );
  const out = new Map<string, Bom>();
  const picked = new Map<string, string>();
  for (const r of rows) {
    const item = S(r.item_id);
    const bomId = S(r.id);
    const first = picked.get(item);
    if (first && first !== bomId) continue; // the draft being activated wins over the old Active one
    picked.set(item, bomId);
    const b = out.get(item) ?? { itemId: item, baseQty: S(r.base_qty), lines: [] };
    if (r.comp) b.lines.push({ itemId: S(r.comp), qtyPer: S(r.qty_per), scrapPct: S(r.scrap_pct) });
    out.set(item, b);
  }
  return out;
}
async function checkOps(
  tx: Db,
  unitId: string,
  itemId: string,
  ops: RoutingOpInput[],
): Promise<void> {
  if (ops.length === 0) throw Errors.validation({ ops: 'Add at least one operation.' });
  const items = await itemsExist(tx, [itemId]);
  if (S(items.get(itemId)?.status) !== 'ACTIVE')
    throw Errors.validation({ itemId: 'The item is not active.' });
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
      setupMinutes: String(o.setupMinutes ?? 0),
      runMinutes: String(o.runMinutes ?? 0),
      inspectionRequired: o.inspectionRequired === true,
    });
}
