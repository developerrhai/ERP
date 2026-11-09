// Generic "header + lines" document CRUD for the Phase 9 documents (Draft -> ... lifecycle of STANDARDS §6).
// A document supplies: which header / line fields the API may write and a `prepare` hook that validates and
// derives columns (totals, tax, links). Everything else (numbering, audit, scoping, versions) is here.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { concreteUnit } from '../inventory/typed';
import {
  TX,
  allocateNumber,
  assertEditable,
  audit,
  checkVersion,
  departmentOf,
  exec,
  fyOfCaller,
  insertRow,
  loadDoc,
  loadLines,
  norm,
  query,
  replaceLines,
  scopeSql,
  snake,
  updateRow,
} from './core';
import { S } from './core';
import type { DocDef, Row } from './core';

export interface PrepareCtx {
  tx: Db;
  caller: Caller;
  unitId: string;
  fyId: string;
  header: Row;
  lines: Row[];
  existing: Row | null;
}
export interface CrudSpec {
  def: DocDef;
  headerKeys: string[];
  lineKeys: string[];
  /** joins a supplier name into list / get */
  hasSupplier?: boolean;
  /** joins a customer name into list / get */
  hasCustomer?: boolean;
  prepare?: (
    c: PrepareCtx,
  ) => Promise<{ header: Row; lines: Row[] }> | { header: Row; lines: Row[] };
  afterSave?: (c: PrepareCtx & { id: string }) => Promise<void>;
  /** replaces the default delete+insert of lines (documents whose lines are referenced elsewhere, e.g. PO) */
  saveLines?: (c: PrepareCtx & { id: string }) => Promise<void>;
  /** records that are not approval documents decide themselves when they can still be edited */
  canEdit?: (row: Row) => boolean;
  /** numbering series override */
  series?: string;
}

const pick = (src: Row, keys: string[]): Row => {
  const out: Row = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
};

export interface ListQuery {
  q?: string | undefined;
  status?: string | undefined;
  supplierId?: string | undefined;
  customerId?: string | undefined;
  page: number;
  size: number;
  sort?: string | undefined;
}

/** A unique-index violation inside a save is a plain 409, not a 500. */
function uniqueToConflict(err: unknown): never {
  const m = S((err as { message?: unknown }).message);
  if (m.includes('already exists') && m.includes('Key ('))
    throw Errors.conflict('A record with the same reference already exists.');
  throw err;
}

export function makeCrud(spec: CrudSpec) {
  const { def } = spec;

  async function get(db: Db, caller: Caller, id: string): Promise<Row & { lines: Row[] }> {
    const h = await loadDoc(db, caller, def, id);
    const lines = await loadLines(db, def, id);
    let supplierName: string | undefined;
    if (spec.hasSupplier && h.supplier_id) {
      const s = await query(db, `SELECT name FROM suppliers WHERE id = $1::uuid`, h.supplier_id);
      supplierName = s[0]?.name as string | undefined;
    }
    let customerName: string | undefined;
    if (spec.hasCustomer && h.customer_id) {
      const c = await query(db, `SELECT name FROM customers WHERE id = $1::uuid`, h.customer_id);
      customerName = c[0]?.name as string | undefined;
    }
    return {
      ...norm<Row>(h),
      ...(supplierName ? { supplierName } : {}),
      ...(customerName ? { customerName } : {}),
      lines: lines.map((l) => norm<Row>(l)),
    };
  }

  return {
    spec,
    get: (caller: Caller, id: string) => get(prisma, caller, id),
    getIn: get,

    async list(caller: Caller, q: ListQuery) {
      const sc = await scopeSql(caller, def.pageId);
      const args = [...sc.args];
      const where = [sc.sql];
      if (q.q) {
        args.push(`%${q.q}%`);
        where.push(`t.number ILIKE $${args.length}`);
      }
      if (q.status) {
        args.push(q.status);
        where.push(`t.status = $${args.length}`);
      }
      if (q.customerId && spec.hasCustomer) {
        args.push(q.customerId);
        where.push(`t.customer_id = $${args.length}::uuid`);
      }
      if (q.supplierId && spec.hasSupplier) {
        args.push(q.supplierId);
        where.push(`t.supplier_id = $${args.length}::uuid`);
      }
      const desc = !q.sort || q.sort.startsWith('-');
      const col = snake((q.sort ?? '-createdAt').replace(/^-/, ''));
      const safe = /^[a-z_]+$/.test(col) ? col : 'created_at';
      const total = Number(
        (
          await query(
            prisma,
            `SELECT count(*)::int AS n FROM "${def.table}" t WHERE ${where.join(' AND ')}`,
            ...args,
          )
        )[0]?.n ?? 0,
      );
      const rows = await query(
        prisma,
        `SELECT t.*${spec.hasSupplier ? ', s.name AS supplier_name' : ''}${spec.hasCustomer ? ', cu.name AS customer_name' : ''} FROM "${def.table}" t
          ${spec.hasSupplier ? 'LEFT JOIN suppliers s ON s.id = t.supplier_id' : ''}
          ${spec.hasCustomer ? 'LEFT JOIN customers cu ON cu.id = t.customer_id' : ''}
          WHERE ${where.join(' AND ')} ORDER BY t.${safe} ${desc ? 'DESC' : 'ASC'}, t.id
          LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
        ...args,
      );
      return { rows: rows.map((r) => norm(r)), total };
    },

    async create(caller: Caller, body: { header: Row; lines: Row[] }) {
      const unitId = concreteUnit(caller);
      const fy = await fyOfCaller(caller);
      const id = await prisma
        .$transaction(async (tx) => {
          let header = pick(body.header, spec.headerKeys);
          let lines = body.lines.map((l) => pick(l, spec.lineKeys));
          if (spec.prepare)
            ({ header, lines } = await spec.prepare({
              tx,
              caller,
              unitId,
              fyId: fy.id,
              header,
              lines,
              existing: null,
            }));
          const number = await allocateNumber(tx, def, unitId, fy.id, spec.series);
          const newId = await insertRow(tx, def.table, {
            ...header,
            unitId,
            fyId: fy.id,
            number,
            department: await departmentOf(tx, def.pageId, caller),
            status: def.draftStatus ?? 'Draft',
            createdById: caller.auth.userId,
            updatedById: caller.auth.userId,
          });
          if (spec.saveLines)
            await spec.saveLines({
              tx,
              caller,
              unitId,
              fyId: fy.id,
              header,
              lines,
              existing: null,
              id: newId,
            });
          else await replaceLines(tx, def, newId, lines);
          if (spec.afterSave)
            await spec.afterSave({
              tx,
              caller,
              unitId,
              fyId: fy.id,
              header,
              lines,
              existing: null,
              id: newId,
            });
          await audit(
            tx,
            caller,
            caller.auth.userId,
            'SCM_CREATED',
            def.title,
            { id: newId, code: number },
            def.pageId,
            { unitId },
          );
          return newId;
        }, TX)
        .catch(uniqueToConflict);
      return get(prisma, caller, id);
    },

    async update(
      caller: Caller,
      id: string,
      ifMatch: number | undefined,
      body: { header: Row; lines?: Row[] },
    ) {
      const fy = await fyOfCaller(caller);
      await prisma
        .$transaction(async (tx) => {
          const cur = await loadDoc(tx, caller, def, id, { lock: true });
          if (spec.canEdit) {
            if (!spec.canEdit(cur))
              throw Errors.conflict(
                `This ${def.title.toLowerCase()} is ${S(cur.status)} and can no longer be edited.`,
              );
          } else assertEditable(cur, def.title.toLowerCase(), def.draftStatus ?? 'Draft');
          checkVersion(cur, ifMatch);
          let header = pick(body.header, spec.headerKeys);
          let lines = body.lines ? body.lines.map((l) => pick(l, spec.lineKeys)) : null;
          if (spec.prepare) {
            const existingLines = lines ?? (await loadLines(tx, def, id)).map((l) => norm(l));
            const out = await spec.prepare({
              tx,
              caller,
              unitId: S(cur.unit_id),
              fyId: fy.id,
              header,
              lines: existingLines,
              existing: cur,
            });
            header = out.header;
            lines = lines ? out.lines : null;
          }
          await updateRow(tx, def.table, id, {
            ...header,
            updatedAt: new Date(),
            updatedById: caller.auth.userId,
          });
          await exec(tx, `UPDATE "${def.table}" SET version = version + 1 WHERE id = $1::uuid`, id);
          if (lines) {
            if (spec.saveLines)
              await spec.saveLines({
                tx,
                caller,
                unitId: S(cur.unit_id),
                fyId: fy.id,
                header,
                lines,
                existing: cur,
                id,
              });
            else await replaceLines(tx, def, id, lines);
          }
          if (spec.afterSave && lines)
            await spec.afterSave({
              tx,
              caller,
              unitId: S(cur.unit_id),
              fyId: fy.id,
              header,
              lines,
              existing: cur,
              id,
            });
          await audit(
            tx,
            caller,
            caller.auth.userId,
            'SCM_UPDATED',
            def.title,
            { id, code: S(cur.number) },
            def.pageId,
          );
        }, TX)
        .catch(uniqueToConflict);
      return get(prisma, caller, id);
    },
  };
}

export type Crud = ReturnType<typeof makeCrud>;

/** Reads a decimal-ish field as a string, refusing junk. */
export function needText(v: unknown, field: string): string {
  if (v === undefined || v === null || v === '')
    throw Errors.validation({ [field]: 'This field is required.' });
  return S(v);
}
