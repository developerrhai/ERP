// What every Phase 9 document shares (STANDARDS §6): row helpers, numbering, audit, the approval handler,
// the Draft/Rejected edit rule, scoped loading (a document of another unit is a 404) and soft delete.
// Raw SQL lives here and in the *-service files of this folder: it is the repository layer of this module.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { recordAudit } from '../../core/audit/audit-service';
import type { AuditAction } from '../../core/audit/audit-service';
import { NumberingService } from '../../core/numbering';
import { approvalService } from '../approvals/service';
import type { ApprovalDocHandler } from '../approvals/handlers';
import type { Caller } from '../records/service';
import { concreteUnit } from '../inventory/typed';
import { notificationService } from '../notifications/service';
import { scopeFor, accessUserOf } from '../../core/rbac/access';

export const TX = { maxWait: 20_000, timeout: 30_000 };
export type Row = Record<string, unknown>;
export type Actor = { userId: string };

export const camel = (s: string): string =>
  s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
export const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Raw row -> API shape: camelCase keys, Decimals as strings, `date` columns as YYYY-MM-DD, `_at` as ISO. */
export function norm<T = Row>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    let val: unknown = v;
    if (v && typeof v === 'object' && 'toFixed' in v && !(v instanceof Date))
      val = (v as { toFixed(): string }).toFixed();
    else if (v instanceof Date)
      val = k.endsWith('_at') ? v.toISOString() : v.toISOString().slice(0, 10);
    else if (typeof v === 'bigint') val = Number(v);
    out[camel(k)] = val;
  }
  return out as T;
}

export interface DocDef {
  /** page id = approval doc type = numbering series */
  pageId: string;
  /** status of a new record (default 'Draft'); records in this status can be edited and deleted */
  draftStatus?: string;
  table: string;
  title: string;
  /** header column holding the approval amount (null = no amount) */
  amountCol: string | null;
  linesTable?: string;
  parentCol?: string;
  /** first statement of the approval transaction: take a serialising lock (e.g. per PO) before any row lock */
  preLock?: (tx: Db, docId: string) => Promise<void>;
  /** called inside the approval transaction right after the document became Approved (auto-post) */
  afterApproved?: (tx: Db, id: string, actor: Actor) => Promise<void>;
}

export const fyOfCaller = async (
  caller: Caller,
): Promise<{ id: string; code: string; status: string }> => {
  const fy = await prisma.financialYear.findUnique({ where: { id: caller.ctx.fyId } });
  if (!fy) throw Errors.contextInvalid('Unknown financial year.');
  if (fy.status !== 'OPEN') throw Errors.periodClosed(`Financial year ${fy.code} is closed.`);
  return fy;
};

export async function scopeSql(
  caller: Caller,
  pageId: string,
  alias = 't',
): Promise<{ sql: string; args: unknown[] }> {
  const parts: string[] = [`${alias}.deleted_at IS NULL`];
  const args: unknown[] = [];
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    parts.push(`${alias}.unit_id = $${args.length}::uuid`);
  } else if (!caller.ctx.allUnits) parts.push('false');
  const scope = await scopeFor(accessUserOf(caller.auth.user), pageId);
  if (scope === 'OWN') {
    args.push(caller.auth.userId);
    parts.push(`${alias}.created_by_id = $${args.length}::uuid`);
  }
  return { sql: parts.join(' AND '), args };
}

export async function query(db: Db, sql: string, ...args: unknown[]): Promise<Row[]> {
  return db.$queryRawUnsafe<Row[]>(sql, ...args);
}
export async function exec(db: Db, sql: string, ...args: unknown[]): Promise<number> {
  return db.$executeRawUnsafe(sql, ...args);
}

const typeCache = new Map<string, Map<string, string>>();
const CAST: Record<string, string> = {
  uuid: '::uuid',
  date: '::date',
  numeric: '::numeric',
  'timestamp with time zone': '::timestamptz',
  jsonb: '::jsonb',
  boolean: '::boolean',
  integer: '::int',
  smallint: '::smallint',
  ARRAY: '::text[]',
};
async function castsOf(db: Db, table: string): Promise<Map<string, string>> {
  const hit = typeCache.get(table);
  if (hit) return hit;
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const rows = await db.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    table,
  );
  const m = new Map(rows.map((r) => [r.column_name, CAST[r.data_type] ?? '']));
  typeCache.set(table, m);
  return m;
}

export async function insertRow(db: Db, table: string, row: Row): Promise<string> {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const casts = await castsOf(db, table);
  const sql = `INSERT INTO "${table}" (${keys.map((k) => `"${snake(k)}"`).join(',')}) VALUES (${keys
    .map((k, i) => `$${i + 1}${casts.get(snake(k)) ?? ''}`)
    .join(',')}) RETURNING id::text AS id`;
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(sql, ...keys.map((k) => prep(row[k])));
  return (rows[0] as { id: string }).id;
}
export async function updateRow(db: Db, table: string, id: string, patch: Row): Promise<void> {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  const casts = await castsOf(db, table);
  const sql = `UPDATE "${table}" SET ${keys.map((k, i) => `"${snake(k)}" = $${i + 1}${casts.get(snake(k)) ?? ''}`).join(', ')} WHERE id = $${keys.length + 1}::uuid`;
  await db.$executeRawUnsafe(sql, ...keys.map((k) => prep(patch[k])), id);
}
const prep = (v: unknown): unknown =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  !(v instanceof Date) &&
  !('toFixed' in v)
    ? JSON.stringify(v)
    : v && typeof v === 'object' && 'toFixed' in v
      ? (v as { toFixed(): string }).toFixed()
      : v;

export async function allocateNumber(
  tx: Db,
  def: DocDef,
  unitId: string,
  fyId: string,
  series?: string,
  pattern?: string,
): Promise<string> {
  return NumberingService.allocate(tx, {
    pageId: series ?? def.pageId,
    unitId,
    fyId,
    ...(pattern ? { pattern } : {}),
  });
}

export async function audit(
  db: Db,
  caller: Caller | null,
  actorId: string,
  action: AuditAction,
  target: string,
  row: { id: string; code: string },
  pageId: string,
  detail: Prisma.InputJsonObject = {},
): Promise<void> {
  await recordAudit(
    {
      action,
      actorId,
      targetType: target,
      targetId: row.id,
      ...(caller ? { meta: caller.meta } : {}),
      detail: { pageId, code: row.code, ...detail },
    },
    db,
  );
}

/** Header (+ optional lock) scoped to the caller. 404 when absent / other unit / deleted. */
export async function loadDoc(
  db: Db,
  caller: Caller,
  def: DocDef,
  id: string,
  opts: { lock?: boolean } = {},
): Promise<Row> {
  const sc = await scopeSql(caller, def.pageId);
  const rows = await query(
    db,
    `SELECT t.* FROM "${def.table}" t WHERE t.id = $${sc.args.length + 1}::uuid AND ${sc.sql}${opts.lock ? ' FOR UPDATE OF t' : ''}`,
    ...sc.args,
    id,
  );
  if (!rows[0]) throw Errors.notFound('Record not found.');
  return rows[0];
}

export async function loadLines(db: Db, def: DocDef, id: string): Promise<Row[]> {
  if (!def.linesTable || !def.parentCol) return [];
  const casts = await castsOf(db, def.linesTable);
  const order = casts.has('line_no') ? 'l.line_no' : 'l.created_at, l.id';
  // Phase 37 C1: a line never shows a bare uuid. Lines that point at an item also carry the item's
  // code, name, unit and HSN/SAC (the line's own uom / hsn_sac wins when it has one).
  if (!casts.has('item_id')) {
    return query(
      db,
      `SELECT * FROM "${def.linesTable}" l WHERE l."${def.parentCol}" = $1::uuid ORDER BY ${order}`,
      id,
    );
  }
  const rows = await query(
    db,
    `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom AS item_uom, i.hsn_sac AS item_hsn_sac
       FROM "${def.linesTable}" l LEFT JOIN items i ON i.id = l.item_id
      WHERE l."${def.parentCol}" = $1::uuid ORDER BY ${order}`,
    id,
  );
  for (const r of rows) {
    if (casts.has('uom') && !r.uom) r.uom = r.item_uom;
    else if (!casts.has('uom')) r.uom = r.item_uom;
    if (casts.has('hsn_sac') ? !r.hsn_sac : true) r.hsn_sac = r.item_hsn_sac;
    delete r.item_uom;
    delete r.item_hsn_sac;
  }
  return rows;
}

export function assertEditable(row: Row, what = 'record', draft = 'Draft'): void {
  if (row.status !== draft && row.status !== 'Rejected')
    throw Errors.conflict(
      `Only Draft or Rejected records can be edited. This ${what} is ${S(row.status)}.`,
    );
}
export function checkVersion(row: Row, ifMatch: number | undefined): void {
  if (ifMatch !== undefined && ifMatch !== Number(row.version)) throw Errors.versionConflict();
}

export async function setStatus(
  tx: Db,
  table: string,
  id: string,
  status: string,
  actorId: string,
  extra: Row = {},
): Promise<void> {
  await updateRow(tx, table, id, {
    status,
    updatedAt: new Date(),
    updatedById: actorId,
    ...extra,
  });
  await exec(tx, `UPDATE "${table}" SET version = version + 1 WHERE id = $1::uuid`, id);
}

/** Replace the lines of a draft document (delete + insert; the document row lock serialises writers). */
export async function replaceLines(tx: Db, def: DocDef, id: string, lines: Row[]): Promise<void> {
  if (!def.linesTable || !def.parentCol) return;
  await exec(tx, `DELETE FROM "${def.linesTable}" WHERE "${def.parentCol}" = $1::uuid`, id);
  let n = 0;
  for (const l of lines) {
    n += 1;
    await insertRow(tx, def.linesTable, { ...l, lineNo: n, [camel(def.parentCol)]: id });
  }
}

export async function departmentOf(tx: Db, pageId: string, caller: Caller): Promise<string> {
  const control = await tx.moduleControl.findUnique({
    where: { pageId },
    select: { ownerDepartment: true },
  });
  return control?.ownerDepartment || caller.auth.user.department || '';
}

export async function softDelete(
  caller: Caller,
  def: DocDef,
  id: string,
  ifMatch: number | undefined,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await loadDoc(tx, caller, def, id, { lock: true });
    if (row.status !== (def.draftStatus ?? 'Draft'))
      throw Errors.conflict(`Only ${def.draftStatus ?? 'Draft'} records can be deleted.`);
    checkVersion(row, ifMatch);
    await exec(
      tx,
      `UPDATE "${def.table}" SET deleted_at = now(), deleted_by_id = $1::uuid, version = version + 1 WHERE id = $2::uuid`,
      caller.auth.userId,
      id,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'SCM_DELETED',
      def.title,
      { id, code: S(row.number ?? id) },
      def.pageId,
    );
  }, TX);
}

export async function submitDoc(
  caller: Caller,
  def: DocDef,
  id: string,
  ifMatch: number | undefined,
): Promise<void> {
  concreteUnit(caller);
  await loadDoc(prisma, caller, def, id);
  await approvalService.submit(caller, def.pageId, id, { docVersion: ifMatch });
}

/** The approval handler of a document table. Only this code writes Pending Approval / Approved / Rejected. */
export function approvalHandler(def: DocDef): ApprovalDocHandler {
  const set = (tx: Db, id: string, status: string, actor: string) =>
    setStatus(tx, def.table, id, status, actor);
  return {
    async snapshot(tx, docId) {
      if (def.preLock) await def.preLock(tx, docId);
      const amount = def.amountCol ? `t.${def.amountCol}::text` : 'NULL::text';
      const rows = await query(
        tx,
        `SELECT COALESCE(t.number, t.id::text) AS number, t.status, t.version, ${amount} AS amount, t.department,
                t.unit_id::text AS unit_id, t.created_by_id::text AS created_by_id, fy.status AS fy_status
           FROM "${def.table}" t JOIN financial_years fy ON fy.id = t.fy_id
          WHERE t.id = $1::uuid AND t.deleted_at IS NULL FOR UPDATE OF t`,
        docId,
      );
      const r = rows[0];
      if (!r) return null;
      return {
        code: S(r.number),
        title: def.title,
        amount: (r.amount as string | null) ?? null,
        department: S(r.department ?? ''),
        unitId: S(r.unit_id),
        createdBy: S(r.created_by_id),
        status: S(r.status),
        version: Number(r.version),
        fyOpen: r.fy_status === 'OPEN',
      };
    },
    onSubmitted: (tx, id, req) => set(tx, id, 'Pending Approval', req.actorId),
    onApproved: async (tx, id, req) => {
      await set(tx, id, 'Approved', req.actorId);
      if (def.afterApproved) await def.afterApproved(tx, id, { userId: req.actorId });
    },
    onRejected: (tx, id, req) => set(tx, id, 'Rejected', req.actorId),
    onReturned: (tx, id, req) => set(tx, id, 'Draft', req.actorId),
  };
}

export function registerDoc(def: DocDef): void {
  approvalService.register(def.pageId, approvalHandler(def));
}

export interface ScmSettings {
  tolQtyPct: string;
  tolPricePct: string;
  tolTaxAmount: string;
  overReceiptPct: string;
  rfqMinSuppliersAbove: string | null;
  msmeAlertDays: number;
  itc180AlertDays: number;
  evalWQuality: string;
  evalWDelivery: string;
  evalWCost: string;
  evalWResponse: string;
  gradeAMin: string;
  gradeBMin: string;
  gradeCMin: string;
  deliveryFloor: string;
  msmeBankRatePct: string | null;
  postOnApprove: boolean;
}
export async function settings(db: Db = prisma): Promise<ScmSettings> {
  const r = (await query(db, `SELECT * FROM scm_settings WHERE id = 1`))[0] as Row;
  const n = norm(r);
  return {
    tolQtyPct: S(n.toleranceQtyPct),
    tolPricePct: S(n.tolerancePricePct),
    tolTaxAmount: S(n.toleranceTaxAmount),
    overReceiptPct: S(n.overReceiptPct),
    rfqMinSuppliersAbove: (n.rfqMinSuppliersAbove as string | null) ?? null,
    msmeAlertDays: Number(n.msmeAlertDays),
    itc180AlertDays: Number(n.itc180AlertDays),
    evalWQuality: S(n.evalWQuality),
    evalWDelivery: S(n.evalWDelivery),
    evalWCost: S(n.evalWCost),
    evalWResponse: S(n.evalWResponse),
    gradeAMin: S(n.gradeAMin),
    gradeBMin: S(n.gradeBMin),
    gradeCMin: S(n.gradeCMin),
    deliveryFloor: S(n.deliveryFloor),
    msmeBankRatePct: (n.msmeBankRatePct as string | null) ?? null,
    postOnApprove: n.postOnApprove === true,
  };
}

export interface SupplierRow {
  id: string;
  name: string;
  stateCode: string;
  gstin: string | null;
  supplierType: string;
  purchaseHold: boolean;
  approvalStatus: string;
  status: string;
  msmeCategory: string | null;
  msmeAgreedDays: number | null;
  msme45: boolean;
  paymentTermId: string | null;
  tdsSectionCode: string | null;
  pan: string | null;
}
export async function loadSupplier(db: Db, id: string): Promise<SupplierRow> {
  const r = (
    await query(
      db,
      `SELECT id::text, name, state_code, gstin, supplier_type, purchase_hold, approval_status, status, msme_category,
              msme_agreed_days, msme_45day_applies AS msme45, payment_term_id::text, tds_section_code, pan
         FROM suppliers WHERE id = $1::uuid AND deleted_at IS NULL`,
      id,
    )
  )[0];
  if (!r) throw Errors.validation({ supplierId: 'Choose a supplier.' });
  return norm<SupplierRow>(r);
}
/** A supplier can be bought from only when approved, active and not on purchase hold. */
export function assertBuyable(s: SupplierRow): void {
  if (s.approvalStatus !== 'APPROVED' || s.status !== 'ACTIVE')
    throw new AppError(422, 'SUPPLIER_NOT_APPROVED', 'Supplier is not approved yet.', {
      supplierId: 'Supplier is not approved yet.',
    });
  if (s.purchaseHold)
    throw new AppError(422, 'SUPPLIER_ON_HOLD', `Supplier ${s.name} is on purchase hold.`, {
      supplierId: `Supplier ${s.name} is on purchase hold.`,
    });
}

export const todayIst = (): string =>
  new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Users who own a page (its owner department) plus administrators, for system alerts. */
export async function pageRecipients(tx: Db, pageId: string): Promise<string[]> {
  const control = await tx.moduleControl.findUnique({
    where: { pageId },
    select: { ownerDepartment: true },
  });
  const dept = control?.ownerDepartment;
  const ids = dept
    ? (
        // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
        await tx.user.findMany({
          where: { status: 'ACTIVE', department: dept },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];
  const admins = await notificationService.usersAtLevel(tx, 95);
  return [...new Set([...ids, ...admins])];
}

/** Safe stringify for loosely typed row values (null/undefined -> ''). */
export const S = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : v === null || v === undefined
      ? ''
      : typeof v === 'object'
        ? (v as { toString(): string }).toString()
        : (v as number | boolean | bigint).toString();

/**
 * State code (first 2 digits of the GSTIN, or units.state_code) of the plant a document belongs to. It decides
 * CGST/SGST or IGST. Phase 37 C3: one shared check, one plain message.
 */
export async function unitState(tx: Db, unitId: string): Promise<string> {
  const u = (await query(tx, `SELECT name, state_code, gstin FROM units WHERE id=$1::uuid`, unitId))[0];
  const st = (u?.state_code as string | null) || ((u?.gstin as string | null)?.slice(0, 2) ?? null);
  if (!st)
    throw Errors.validation({
      unitId: `Plant ${(u?.name as string | undefined) ?? ''} has no state set. Ask Admin to complete it.`.replace('Plant  has', 'This plant has'),
    });
  return st;
}
