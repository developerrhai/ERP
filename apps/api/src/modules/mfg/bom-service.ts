// Phase 13 v2: bills of materials and routings to docs/phases/PHASE-13.md. A BOM goes DRAFT -> PENDING_APPROVAL -> RELEASED ->
// OBSOLETE; a released one never changes (Revise makes the next version); exactly one default released BOM per item; phantom
// lines, alternates, effectivity, units of measure and the issue method are kept on the line; a loop is refused on save, on
// submit and on release with its path. Low-level codes are recomputed on every release.
import { AppError, Errors } from '../../core/http/errors';
import type { ErrorCode } from '../../core/http/errors';
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
import { D, detectCycle, explode, lowLevelCodes, r2, r3 } from './calc';
import type { BomIn, BomLineIn, Requirement } from './calc';
import { S, dateOf, oneUnit } from './master-service';

export const mfgError = (
  code: ErrorCode,
  message: string,
  fields?: Record<string, string>,
  status = 422,
): AppError => new AppError(status, code, message, fields);

export interface BomLineInput {
  itemId: string;
  qtyPer: string | number;
  uom?: string | undefined;
  conversionFactor?: string | number | undefined;
  scrapPct?: string | number | undefined;
  issueMethod?: 'MANUAL' | 'BACKFLUSH' | undefined;
  operationSeq?: number | undefined;
  effectiveFrom?: string | undefined;
  effectiveTo?: string | undefined;
  isPhantom?: boolean | undefined;
  referenceDesignator?: string | undefined;
  remarks?: string | undefined;
  alternates?:
    | { altItemId: string; priority?: number | undefined; ratio?: string | number | undefined }[]
    | undefined;
}
export interface BomInput {
  itemId: string;
  baseQty?: string | number | undefined;
  bomType?: 'STANDARD' | 'ENGINEERING' | 'REWORK' | undefined;
  effectiveFrom?: string | undefined;
  effectiveTo?: string | undefined;
  routingId?: string | undefined;
  notes?: string | undefined;
  lines: BomLineInput[];
}

async function activeItems(db: Db, ids: string[]): Promise<Map<string, Row>> {
  const uniq = [...new Set(ids)];
  const rows = await query(
    db,
    `SELECT id::text, code, name, base_uom, status::text AS status, standard_cost::text AS standard_cost FROM items WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    uniq,
  );
  const m = new Map(rows.map((r) => [S(r.id), norm<Row>(r)]));
  for (const id of uniq)
    if (!m.has(id)) throw Errors.validation({ item: 'An item was not found.' });
  return m;
}

/** The released default BOMs of a unit as an explosion map; `include` adds a BOM that is not released yet (draft being checked). */
export async function releasedBoms(
  db: Db,
  unitId: string,
  include?: string,
): Promise<Map<string, BomIn>> {
  const rows = await query(
    db,
    `SELECT b.id::text AS bom_id, b.item_id::text, b.base_qty::text, b.status, l.item_id::text AS comp, l.qty_per::text, l.conversion_factor::text,
            l.scrap_pct::text, l.is_phantom, l.effective_from::text AS ef, l.effective_to::text AS et, l.issue_method, l.operation_seq
       FROM mfg_boms b LEFT JOIN mfg_bom_lines l ON l.bom_id=b.id
      WHERE b.unit_id=$1::uuid AND b.deleted_at IS NULL
        AND ((b.status='RELEASED' AND b.is_default AND b.bom_type='STANDARD') OR b.id=$2::uuid)
      ORDER BY b.item_id, (b.id=$2::uuid) DESC, l.line_no`,
    unitId,
    include ?? '00000000-0000-0000-0000-000000000000',
  );
  const out = new Map<string, BomIn>();
  const picked = new Map<string, string>();
  for (const r of rows) {
    const item = S(r.item_id);
    const bomId = S(r.bom_id);
    const first = picked.get(item);
    if (first && first !== bomId) continue; // the BOM being checked replaces the released one of its item
    picked.set(item, bomId);
    const b = out.get(item) ?? { itemId: item, baseQty: S(r.base_qty), lines: [] };
    if (r.comp)
      b.lines.push({
        itemId: S(r.comp),
        qtyPerBase: S(r.qty_per),
        conversionFactor: S(r.conversion_factor),
        scrapPct: S(r.scrap_pct),
        isPhantom: r.is_phantom === true,
        effectiveFrom: r.ef ? S(r.ef) : null,
        effectiveTo: r.et ? S(r.et) : null,
        issueMethod: S(r.issue_method) === 'BACKFLUSH' ? 'BACKFLUSH' : 'MANUAL',
        operationSeq:
          r.operation_seq === null || r.operation_seq === undefined
            ? null
            : Number(r.operation_seq),
      } satisfies BomLineIn);
    out.set(item, b);
  }
  return out;
}

async function assertNoCycle(db: Db, unitId: string, bomId: string): Promise<void> {
  const path = detectCycle(await releasedBoms(db, unitId, bomId));
  if (!path) return;
  const names = await query(db, `SELECT id::text, code FROM items WHERE id = ANY($1::uuid[])`, [
    ...new Set(path),
  ]);
  const code = new Map(names.map((n) => [S(n.id), S(n.code)]));
  const shown = path.map((p) => code.get(p) ?? p).join(' > ');
  throw mfgError('BOM_CYCLE', `BOM loop: ${shown}. A part can't contain itself.`, {
    lines: `BOM loop: ${shown}`,
  });
}

function checkLines(parent: string, lines: BomLineInput[], items: Map<string, Row>): void {
  if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one component.' });
  const errs: Record<string, string> = {};
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (l.itemId === parent) errs[`lines.${i}`] = 'An item cannot be a component of itself.';
    if (S(items.get(l.itemId)?.status) !== 'ACTIVE')
      errs[`lines.${i}`] = 'This component is not active.';
    if (D(String(l.qtyPer)).lte(0)) errs[`lines.${i}.qtyPer`] = 'Enter a quantity greater than 0.';
    const sp = D(String(l.scrapPct ?? 0));
    if (sp.lt(0) || sp.gt(50)) errs[`lines.${i}.scrapPct`] = 'Scrap % must be 0–50.';
    if (D(String(l.conversionFactor ?? 1)).lte(0))
      errs[`lines.${i}.conversionFactor`] = 'The conversion factor must be greater than 0.';
    if (l.effectiveFrom && l.effectiveTo && l.effectiveTo < l.effectiveFrom)
      errs[`lines.${i}.effectiveTo`] = 'The end date is before the start date.';
    if (!l.effectiveFrom && !l.effectiveTo) {
      if (seen.has(l.itemId) && !errs[`lines.${i}`])
        errs[`lines.${i}`] = 'This component is listed twice.';
      seen.add(l.itemId);
    }
    for (const a of l.alternates ?? []) {
      if (a.altItemId === parent || a.altItemId === l.itemId)
        errs[`lines.${i}`] = 'An alternate must be a different item.';
      if (D(String(a.ratio ?? 1)).lte(0))
        errs[`lines.${i}`] = 'An alternate ratio must be greater than 0.';
    }
  });
  if (Object.keys(errs).length) {
    const scrap = Object.keys(errs).find((k) => k.endsWith('.scrapPct'));
    if (scrap) throw mfgError('SCRAP_PCT_RANGE', 'Scrap % must be 0–50.', errs);
    throw Errors.validation(errs);
  }
}

async function writeLines(
  tx: Db,
  bomId: string,
  lines: BomLineInput[],
  items: Map<string, Row>,
): Promise<void> {
  let n = 0;
  for (const l of lines) {
    n += 1;
    const lid = await insertRow(tx, 'mfg_bom_lines', {
      bomId,
      lineNo: n,
      itemId: l.itemId,
      qtyPer: D(String(l.qtyPer)).toFixed(6),
      uom: l.uom ?? S(items.get(l.itemId)?.baseUom),
      conversionFactor: D(String(l.conversionFactor ?? 1)).toFixed(6),
      scrapPct: D(String(l.scrapPct ?? 0)).toFixed(4),
      issueMethod: l.issueMethod ?? 'MANUAL',
      operationSeq: l.operationSeq ?? null,
      effectiveFrom: l.effectiveFrom ?? null,
      effectiveTo: l.effectiveTo ?? null,
      isPhantom: l.isPhantom === true,
      referenceDesignator: l.referenceDesignator ?? null,
      notes: l.remarks ?? null,
    });
    for (const a of l.alternates ?? [])
      await insertRow(tx, 'mfg_bom_line_alternates', {
        lineId: lid,
        altItemId: a.altItemId,
        priority: a.priority ?? 1,
        ratio: D(String(a.ratio ?? 1)).toFixed(6),
      });
  }
}

/** Recomputes the low-level codes of every item in the released BOMs and records the default BOM / routing of each item. */
async function refreshPlanning(tx: Db, unitId: string, userId: string): Promise<void> {
  const map = await releasedBoms(tx, unitId);
  const llc = lowLevelCodes(map);
  for (const [item, code] of llc)
    await exec(
      tx,
      `INSERT INTO mfg_item_planning (item_id, make_or_buy, low_level_code, updated_by_id) VALUES ($1::uuid, CASE WHEN $4::boolean THEN 'MAKE' ELSE 'BUY' END, $2, $3::uuid)
       ON CONFLICT (item_id) DO UPDATE SET low_level_code=$2, make_or_buy=CASE WHEN $4::boolean THEN 'MAKE' ELSE mfg_item_planning.make_or_buy END, updated_at=now()`,
      item,
      code,
      userId,
      map.has(item),
    );
  await exec(
    tx,
    `UPDATE mfg_item_planning p SET default_bom_id = NULL WHERE p.default_bom_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM mfg_boms b WHERE b.id=p.default_bom_id AND b.status='RELEASED' AND b.is_default AND b.deleted_at IS NULL)`,
  );
  await exec(
    tx,
    `UPDATE mfg_item_planning p SET default_bom_id=b.id FROM mfg_boms b
      WHERE b.item_id=p.item_id AND b.unit_id=$1::uuid AND b.status='RELEASED' AND b.is_default AND b.bom_type='STANDARD' AND b.deleted_at IS NULL`,
    unitId,
  );
  await exec(
    tx,
    `UPDATE mfg_item_planning p SET default_routing_id=r.id FROM mfg_routings r
      WHERE r.item_id=p.item_id AND r.unit_id=$1::uuid AND r.status='RELEASED' AND r.deleted_at IS NULL`,
    unitId,
  );
}

async function lockBom(tx: Db, sc: { sql: string; args: unknown[] }, id: string): Promise<Row> {
  const cur = (
    await query(
      tx,
      `SELECT t.* FROM mfg_boms t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
      ...sc.args,
      id,
    )
  )[0];
  if (!cur) throw Errors.notFound('Bill of materials not found.');
  return cur;
}

export const bomService = {
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

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom, r.number AS routing_no
           FROM mfg_boms t JOIN items i ON i.id=t.item_id LEFT JOIN mfg_routings r ON r.id=t.routing_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('Bill of materials not found.');
    const lines = await query(
      prisma,
      `SELECT l.id::text, l.line_no, l.item_id::text, l.qty_per::text AS qty_per_base, l.uom, l.conversion_factor::text, l.scrap_pct::text, l.issue_method,
              l.operation_seq, l.effective_from, l.effective_to, l.is_phantom, l.reference_designator, l.notes AS remarks,
              i.code AS item_code, i.name AS item_name, i.base_uom, i.is_customer_supplied
         FROM mfg_bom_lines l JOIN items i ON i.id=l.item_id WHERE l.bom_id=$1::uuid ORDER BY l.line_no`,
      id,
    );
    const alts = await query(
      prisma,
      `SELECT a.line_id::text, a.alt_item_id::text, a.priority, a.ratio::text, i.code AS alt_code, i.name AS alt_name
         FROM mfg_bom_line_alternates a JOIN items i ON i.id=a.alt_item_id JOIN mfg_bom_lines l ON l.id=a.line_id WHERE l.bom_id=$1::uuid ORDER BY a.priority`,
      id,
    );
    const snap = (
      await query(
        prisma,
        `SELECT * FROM mfg_bom_cost_snapshots WHERE bom_id=$1::uuid ORDER BY rolled_at DESC LIMIT 1`,
        id,
      )
    )[0];
    return {
      ...norm<Row>(h),
      lines: lines.map((r) => ({
        ...norm<Row>(r),
        alternates: alts.filter((a) => S(a.line_id) === S(r.id)).map((a) => norm<Row>(a)),
      })),
      costSnapshot: snap ? norm<Row>(snap) : null,
    };
  },

  async create(caller: Caller, pageId: string, b: BomInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    if (b.baseQty !== undefined && D(String(b.baseQty)).lte(0))
      throw Errors.validation({ baseQty: 'Enter a base quantity greater than 0.' });
    const id = await prisma.$transaction(async (tx) => {
      const items = await activeItems(tx, [
        b.itemId,
        ...b.lines.map((l) => l.itemId),
        ...b.lines.flatMap((l) => (l.alternates ?? []).map((a) => a.altItemId)),
      ]);
      if (S(items.get(b.itemId)?.status) !== 'ACTIVE')
        throw Errors.validation({ itemId: 'The item to be made is not active.' });
      checkLines(b.itemId, b.lines, items);
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
        baseQty: D(String(b.baseQty ?? 1)).toFixed(3),
        bomType: b.bomType ?? 'STANDARD',
        effectiveFrom: b.effectiveFrom ?? null,
        effectiveTo: b.effectiveTo ?? null,
        routingId: b.routingId ?? null,
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await writeLines(tx, rid, b.lines, items);
      await assertNoCycle(tx, unitId, rid);
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
    return bomService.get(caller, pageId, id);
  },

  async update(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: Partial<Omit<BomInput, 'itemId'>>,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockBom(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT') {
        if (S(cur.status) === 'RELEASED')
          throw mfgError(
            'BOM_RELEASED_LOCKED',
            `Released BOM v${S(cur.version_no)} can't be edited. Use Revise to create v${Number(cur.version_no) + 1}.`,
            undefined,
            409,
          );
        throw Errors.conflict('Only a draft BOM can be edited.');
      }
      if (b.lines) {
        const items = await activeItems(tx, [
          S(cur.item_id),
          ...b.lines.map((l) => l.itemId),
          ...b.lines.flatMap((l) => (l.alternates ?? []).map((a) => a.altItemId)),
        ]);
        checkLines(S(cur.item_id), b.lines, items);
        await exec(tx, `DELETE FROM mfg_bom_lines WHERE bom_id=$1::uuid`, id);
        await writeLines(tx, id, b.lines, items);
        await assertNoCycle(tx, S(cur.unit_id), id);
      }
      await exec(
        tx,
        `UPDATE mfg_boms SET base_qty=COALESCE($1::numeric,base_qty), bom_type=COALESCE($2,bom_type), effective_from=COALESCE($3::date,effective_from),
           effective_to=COALESCE($4::date,effective_to), routing_id=COALESCE($5::uuid,routing_id), notes=COALESCE($6,notes),
           updated_by_id=$7::uuid, updated_at=now(), version=version+1 WHERE id=$8::uuid`,
        b.baseQty === undefined ? null : D(String(b.baseQty)).toFixed(3),
        b.bomType ?? null,
        b.effectiveFrom ?? null,
        b.effectiveTo ?? null,
        b.routingId ?? null,
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
    return bomService.get(caller, pageId, id);
  },

  /** DRAFT -> PENDING_APPROVAL. */
  async submit(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockBom(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT') throw Errors.conflict('Only a draft BOM can be submitted.');
      if (
        !(await query(tx, `SELECT 1 FROM mfg_bom_lines WHERE bom_id=$1::uuid LIMIT 1`, id)).length
      )
        throw Errors.validation({ lines: 'Add at least one component.' });
      await assertNoCycle(tx, S(cur.unit_id), id);
      await exec(
        tx,
        `UPDATE mfg_boms SET status='PENDING_APPROVAL', submitted_by_id=$1::uuid, updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_SUBMITTED',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return bomService.get(caller, pageId, id);
  },

  /** PENDING_APPROVAL -> DRAFT, with the reason. */
  async reject(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    reason: string,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockBom(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'PENDING_APPROVAL')
        throw Errors.conflict('Only a BOM waiting for approval can be sent back.');
      await exec(
        tx,
        `UPDATE mfg_boms SET status='DRAFT', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_REJECTED',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        { reason },
      );
    }, TX);
    return bomService.get(caller, pageId, id);
  },

  /** PENDING_APPROVAL -> RELEASED (the approval). It becomes the default; the previous default of the item becomes OBSOLETE. */
  async release(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockBom(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'PENDING_APPROVAL')
        throw Errors.conflict('Submit the BOM for approval first.');
      const unitId = S(cur.unit_id);
      await assertNoCycle(tx, unitId, id);
      const standard = S(cur.bom_type) === 'STANDARD';
      if (standard)
        await exec(
          tx,
          `UPDATE mfg_boms SET status='OBSOLETE', is_default=false, updated_at=now(), version=version+1
            WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='RELEASED' AND is_default AND bom_type='STANDARD' AND deleted_at IS NULL`,
          unitId,
          S(cur.item_id),
        );
      await exec(
        tx,
        `UPDATE mfg_boms SET status='RELEASED', is_default=$1, approved_by_id=$2::uuid, approved_at=now(), updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        standard,
        caller.auth.userId,
        id,
      );
      await refreshPlanning(tx, unitId, caller.auth.userId);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_RELEASED',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return bomService.get(caller, pageId, id);
  },

  /** A new DRAFT version copied from any BOM (a released one is never edited). */
  async revise(caller: Caller, pageId: string, id: string): Promise<Row> {
    const src = await bomService.get(caller, pageId, id);
    if (S(src.status) === 'DRAFT' || S(src.status) === 'PENDING_APPROVAL')
      throw Errors.conflict('This BOM is not released yet. Edit it instead.');
    const created = await bomService.create(caller, pageId, {
      itemId: S(src.itemId),
      baseQty: S(src.baseQty),
      bomType: S(src.bomType) as BomInput['bomType'],
      ...(src.routingId ? { routingId: S(src.routingId) } : {}),
      ...(src.notes ? { notes: S(src.notes) } : {}),
      lines: (src.lines as Row[]).map((l) => ({
        itemId: S(l.itemId),
        qtyPer: S(l.qtyPerBase),
        uom: S(l.uom),
        conversionFactor: S(l.conversionFactor),
        scrapPct: S(l.scrapPct),
        issueMethod: S(l.issueMethod) as 'MANUAL' | 'BACKFLUSH',
        ...(l.operationSeq === null || l.operationSeq === undefined
          ? {}
          : { operationSeq: Number(l.operationSeq) }),
        ...(l.effectiveFrom ? { effectiveFrom: dateOf(l.effectiveFrom) } : {}),
        ...(l.effectiveTo ? { effectiveTo: dateOf(l.effectiveTo) } : {}),
        isPhantom: l.isPhantom === true,
        ...(l.referenceDesignator ? { referenceDesignator: S(l.referenceDesignator) } : {}),
        ...(l.remarks ? { remarks: S(l.remarks) } : {}),
        alternates: (l.alternates as Row[]).map((a) => ({
          altItemId: S(a.altItemId),
          priority: Number(a.priority),
          ratio: S(a.ratio),
        })),
      })),
    });
    await exec(
      prisma,
      `UPDATE mfg_boms SET revision=$1 WHERE id=$2::uuid`,
      Number(src.revision) + 1,
      S(created.id),
    );
    return bomService.get(caller, pageId, S(created.id));
  },

  async obsolete(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockBom(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'RELEASED')
        throw Errors.conflict('Only a released BOM can be made obsolete.');
      await exec(
        tx,
        `UPDATE mfg_boms SET status='OBSOLETE', is_default=false, updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await refreshPlanning(tx, S(cur.unit_id), caller.auth.userId);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_OBSOLETE',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return bomService.get(caller, pageId, id);
  },

  /** Among released standard BOMs of an item, make this one the default. */
  async setDefault(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockBom(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'RELEASED' || S(cur.bom_type) !== 'STANDARD')
        throw Errors.conflict('Only a released standard BOM can be the default.');
      await exec(
        tx,
        `UPDATE mfg_boms SET is_default=false, updated_at=now(), version=version+1 WHERE unit_id=$1::uuid AND item_id=$2::uuid AND is_default AND id<>$3::uuid AND deleted_at IS NULL`,
        S(cur.unit_id),
        S(cur.item_id),
        id,
      );
      await exec(
        tx,
        `UPDATE mfg_boms SET is_default=true, updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await refreshPlanning(tx, S(cur.unit_id), caller.auth.userId);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_BOM_DEFAULT',
        'mfg_bom',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return bomService.get(caller, pageId, id);
  },

  /** Flat requirement of `qty` pieces on `date` (phantoms exploded through). */
  async explodeBom(
    caller: Caller,
    pageId: string,
    id: string,
    qty: string,
    date: string,
  ): Promise<{ requirements: Row[] }> {
    const bom = await bomService.get(caller, pageId, id);
    const map = await releasedBoms(prisma, S(bom.unitId), id);
    let req: Requirement[];
    try {
      req = explode(S(bom.itemId), qty, date, map);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('BOM_CYCLE'))
        throw mfgError(
          'BOM_CYCLE',
          `BOM loop: ${e.message.slice(10)}. A part can't contain itself.`,
        );
      throw e;
    }
    const items = await query(
      prisma,
      `SELECT id::text, code, name, base_uom FROM items WHERE id = ANY($1::uuid[])`,
      req.map((r) => r.itemId),
    );
    const info = new Map(items.map((i) => [S(i.id), i]));
    return {
      requirements: req.map((r) => ({
        itemId: r.itemId,
        itemCode: S(info.get(r.itemId)?.code),
        itemName: S(info.get(r.itemId)?.name),
        uom: S(info.get(r.itemId)?.base_uom),
        qty: r.qty,
        issueMethod: r.issueMethod,
        operationSeq: r.operationSeq,
      })),
    };
  },

  /** The BOM as an indented tree at the chosen quantity: sub-assemblies open into their own released BOM. */
  async tree(caller: Caller, pageId: string, id: string, qty: string, date: string): Promise<Row> {
    const bom = await bomService.get(caller, pageId, id);
    const unitId = S(bom.unitId);
    const map = await releasedBoms(prisma, unitId, id);
    const ids = new Set<string>();
    for (const b of map.values()) {
      ids.add(b.itemId);
      for (const l of b.lines) ids.add(l.itemId);
    }
    const items = await query(
      prisma,
      `SELECT id::text, code, name, base_uom FROM items WHERE id = ANY($1::uuid[])`,
      [...ids],
    );
    const info = new Map(items.map((i) => [S(i.id), i]));
    const lineRows = new Map<string, Row[]>();
    for (const l of bom.lines as Row[])
      lineRows.set(S(l.itemId), [...(lineRows.get(S(l.itemId)) ?? []), l]);
    const node = (item: string, q: string, depth: number, extra: Row): Row => {
      const b = map.get(item);
      const children: Row[] = [];
      if (b && depth < 12) {
        for (const l of b.lines) {
          if (
            !(
              (!l.effectiveFrom || l.effectiveFrom <= date) &&
              (!l.effectiveTo || l.effectiveTo >= date)
            )
          )
            continue;
          const need = explodeOne(q, b.baseQty, l);
          children.push(
            node(l.itemId, need, depth + 1, {
              isPhantom: l.isPhantom,
              issueMethod: l.issueMethod,
              scrapPct: l.scrapPct,
              operationSeq: l.operationSeq,
            }),
          );
        }
      }
      return {
        itemId: item,
        itemCode: S(info.get(item)?.code),
        itemName: S(info.get(item)?.name),
        uom: S(info.get(item)?.base_uom),
        qty: q,
        ...extra,
        children,
      };
    };
    return node(S(bom.itemId), D(qty).toFixed(3), 0, {});
  },

  /** Material (from the item standard costs) + labour + overhead (from the routing and the work-centre rates); kept as a snapshot. */
  async costRollup(caller: Caller, pageId: string, id: string): Promise<Row> {
    const bom = await bomService.get(caller, pageId, id);
    const unitId = S(bom.unitId);
    const map = await releasedBoms(prisma, unitId, id);
    const baseQty = D(S(bom.baseQty));
    const today = new Date().toISOString().slice(0, 10);
    const detail: Row[] = [];
    let material = D(0);
    let labour = D(0);
    let overhead = D(0);
    const rt = async (item: string, qty: string): Promise<void> => {
      const r = await query(
        prisma,
        `SELECT o.setup_minutes::text AS s, o.run_minutes::text AS m, w.labour_rate_per_hr::text AS lr, w.overhead_rate_per_hr::text AS orr, o.name
             FROM mfg_routing_ops o JOIN mfg_routings g ON g.id=o.routing_id JOIN mfg_work_centres w ON w.id=o.work_centre_id
            WHERE g.item_id=$1::uuid AND g.unit_id=$2::uuid AND g.status='RELEASED' AND g.deleted_at IS NULL ORDER BY o.seq`,
        item,
        unitId,
      );
      for (const o of r) {
        const hrs = D(S(o.s))
          .plus(D(S(o.m)).mul(qty))
          .div(60);
        labour = labour.plus(r2(hrs.mul(S(o.lr ?? 0))));
        overhead = overhead.plus(r2(hrs.mul(S(o.orr ?? 0))));
        detail.push({ kind: 'OPERATION', item, name: S(o.name), hours: hrs.toFixed(4) });
      }
    };
    const walk = async (item: string, qty: string, depth: number): Promise<void> => {
      const b = map.get(item);
      if (!b || depth > 12) return;
      await rt(item, qty);
      for (const l of b.lines) {
        if (
          !(
            (!l.effectiveFrom || l.effectiveFrom <= today) &&
            (!l.effectiveTo || l.effectiveTo >= today)
          )
        )
          continue;
        const need = explodeOne(qty, b.baseQty, l);
        if (map.has(l.itemId) && !l.isPhantom) await walk(l.itemId, need, depth + 1);
        else if (l.isPhantom) await walk(l.itemId, need, depth + 1);
        else {
          const it = (
            await query(
              prisma,
              `SELECT code, standard_cost::text AS c FROM items WHERE id=$1::uuid`,
              l.itemId,
            )
          )[0];
          const cost = r2(D(need).mul(S(it?.c ?? 0)));
          material = material.plus(cost);
          detail.push({
            kind: 'MATERIAL',
            item: l.itemId,
            code: S(it?.code),
            qty: need,
            rate: S(it?.c ?? 0),
            amount: cost.toFixed(2),
            missingRate: it?.c === null || it?.c === undefined,
          });
        }
      }
    };
    await walk(S(bom.itemId), baseQty.toFixed(3), 0);
    const total = material.plus(labour).plus(overhead);
    const sid = await insertRow(prisma, 'mfg_bom_cost_snapshots', {
      bomId: id,
      material: r2(material).toFixed(2),
      labour: r2(labour).toFixed(2),
      overhead: r2(overhead).toFixed(2),
      total: r2(total).toFixed(2),
      perUnit: total.div(baseQty).toDecimalPlaces(6).toFixed(6),
      detail: JSON.stringify(detail),
      rolledById: caller.auth.userId,
    });
    await exec(
      prisma,
      `UPDATE mfg_boms SET std_material_cost=$1::numeric WHERE id=$2::uuid`,
      r2(material).toFixed(2),
      id,
    );
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_bom_cost_snapshots WHERE id=$1::uuid`, sid))[0]!,
    );
  },

  /** Bulk import of draft BOMs by item code. Every BOM is checked on its own; the result says which were created. */
  async importBoms(
    caller: Caller,
    pageId: string,
    rows: {
      itemCode: string;
      baseQty?: string | number;
      lines: {
        componentCode: string;
        qtyPerBase: string | number;
        uom?: string;
        scrapPct?: string | number;
        isPhantom?: boolean;
        issueMethod?: 'MANUAL' | 'BACKFLUSH';
      }[];
    }[],
  ): Promise<{
    created: { itemCode: string; number: string }[];
    failed: { itemCode: string; error: string }[];
  }> {
    const created: { itemCode: string; number: string }[] = [];
    const failed: { itemCode: string; error: string }[] = [];
    for (const r of rows) {
      try {
        const codes = [r.itemCode, ...r.lines.map((l) => l.componentCode)];
        const items = await query(
          prisma,
          `SELECT id::text, code FROM items WHERE code = ANY($1::text[]) AND deleted_at IS NULL`,
          [...new Set(codes)],
        );
        const id = new Map(items.map((i) => [S(i.code), S(i.id)]));
        for (const c of codes) if (!id.has(c)) throw new Error(`Item ${c} was not found.`);
        const bom = await bomService.create(caller, pageId, {
          itemId: id.get(r.itemCode)!,
          ...(r.baseQty === undefined ? {} : { baseQty: r.baseQty }),
          lines: r.lines.map((l) => ({
            itemId: id.get(l.componentCode)!,
            qtyPer: l.qtyPerBase,
            ...(l.uom ? { uom: l.uom } : {}),
            ...(l.scrapPct === undefined ? {} : { scrapPct: l.scrapPct }),
            ...(l.isPhantom ? { isPhantom: true } : {}),
            ...(l.issueMethod ? { issueMethod: l.issueMethod } : {}),
          })),
        });
        created.push({ itemCode: r.itemCode, number: S(bom.number) });
      } catch (e) {
        const msg =
          e instanceof AppError
            ? `${e.message} ${Object.values(e.fields ?? {}).join(' ')}`.trim()
            : e instanceof Error
              ? e.message
              : 'Failed';
        failed.push({ itemCode: r.itemCode, error: msg });
      }
    }
    return { created, failed };
  },
};

/** qty x qty per base x conversion x (1 + scrap %), 3 decimals half-up (the spec formula). */
function explodeOne(qty: string, baseQty: string, l: BomLineIn): string {
  const base = D(baseQty);
  if (base.lte(0)) return '0.000';
  return r3(
    D(qty)
      .div(base)
      .mul(l.qtyPerBase)
      .mul(l.conversionFactor)
      .mul(D(1).plus(D(l.scrapPct).div(100))),
  ).toFixed(3);
}
