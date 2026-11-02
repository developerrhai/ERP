// The only code that touches generic_records, number_series and idempotency_keys. Lists and single
// reads share one visibility predicate (page, unit, FY, data scope, soft delete) written as
// parameterised SQL fragments; writes use optimistic locking on `version`. Codes are allocated from
// number_series with SELECT ... FOR UPDATE inside the caller's transaction (gap-free).
import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { escapeLike } from '../../core/http/query-safety';
import type { Scope } from '../../core/rbac/permission-model';
import type { FieldType } from '../../engine/field-types';
import type { PageSchema } from '../../engine/field-schema';

export interface RecordRow {
  id: string;
  pageId: string;
  code: string;
  status: string;
  unitId: string;
  unitCode: string;
  fyId: string;
  fyCode: string;
  fyStatus: 'OPEN' | 'CLOSED';
  department: string;
  data: Record<string, unknown>;
  version: number;
  amount: number | null;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Who is asking and what they may see; built by the service from req.ctx and the access decision. */
export interface Visibility {
  pageId: string;
  /** null = no unit filter (All units, ADMIN+) unless `noUnit`. */
  unitId: string | null;
  /** A non-admin with no active unit sees nothing. */
  noUnit: boolean;
  /** Only the lists filter by FY; reading one record by id does not. */
  fyId?: string;
  scope: Scope;
  userId: string;
  department: string | null;
  /** The page's owner department is the caller's own (scope DEPARTMENT sees all of the page). */
  ownerIsMine: boolean;
  deleted: 'no' | 'only' | 'any';
}

export interface ListFilters {
  q?: string;
  status?: string;
  ids?: string[];
  sort: string;
}

const COLUMNS = Prisma.sql`
  g.id, g.page_id AS "pageId", g.code, g.status, g.unit_id AS "unitId", un.code AS "unitCode",
  g.fy_id AS "fyId", f.code AS "fyCode", f.status::text AS "fyStatus", g.department, g.data, g.version, g.amount::float8 AS amount,
  g.created_by_id AS "createdById", u.name AS "createdByName", g.created_at AS "createdAt",
  g.updated_at AS "updatedAt", g.deleted_at AS "deletedAt"`;

const FROM = Prisma.sql`
  FROM generic_records g
  JOIN users u ON u.id = g.created_by_id
  JOIN financial_years f ON f.id = g.fy_id
  JOIN units un ON un.id = g.unit_id`;

function visibilitySql(v: Visibility): Prisma.Sql[] {
  const where: Prisma.Sql[] = [Prisma.sql`g.page_id = ${v.pageId}`];
  if (v.deleted === 'only') where.push(Prisma.sql`g.deleted_at IS NOT NULL`);
  else if (v.deleted === 'no') where.push(Prisma.sql`g.deleted_at IS NULL`);
  if (v.noUnit) where.push(Prisma.sql`false`);
  else if (v.unitId) where.push(Prisma.sql`g.unit_id = ${v.unitId}::uuid`);
  if (v.fyId) where.push(Prisma.sql`g.fy_id = ${v.fyId}::uuid`);
  if (v.scope === 'OWN') where.push(Prisma.sql`g.created_by_id = ${v.userId}::uuid`);
  if (v.scope === 'DEPARTMENT' && !v.ownerIsMine) {
    where.push(v.department ? Prisma.sql`g.department = ${v.department}` : Prisma.sql`false`);
  }
  return where;
}

function filterSql(f: ListFilters): Prisma.Sql[] {
  const where: Prisma.Sql[] = [];
  if (f.status) where.push(Prisma.sql`g.status = ${f.status}`);
  if (f.ids) where.push(Prisma.sql`g.id = ANY(${f.ids}::uuid[])`);
  if (f.q) {
    // Prefix full-text search over the code and every text value, plus ILIKE on the code.
    const tokens = (f.q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
    const like = `%${escapeLike(f.q)}%`;
    const parts: Prisma.Sql[] = [Prisma.sql`g.code ILIKE ${like} ESCAPE '\\'`];
    if (tokens.length > 0) {
      const tsquery = tokens.map((t) => `${t}:*`).join(' & ');
      parts.push(Prisma.sql`g.search @@ to_tsquery('simple', ${tsquery})`);
    }
    where.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  return where;
}

const NUMERIC_TYPES: ReadonlySet<FieldType> = new Set(['money', 'pct', 'qty']);

/** ORDER BY for a whitelisted sort ("field" or "-field"); null when the field is not sortable. */
export function orderSql(schema: PageSchema, sort: string): Prisma.Sql | null {
  const desc = sort.startsWith('-');
  const name = desc ? sort.slice(1) : sort;
  const dir = desc ? Prisma.raw('DESC') : Prisma.raw('ASC');
  const fixed: Record<string, Prisma.Sql> = {
    code: Prisma.sql`g.code`,
    createdAt: Prisma.sql`g.created_at`,
    updatedAt: Prisma.sql`g.updated_at`,
    status: Prisma.sql`g.status`,
  };
  const fixedExpr = fixed[name];
  let expr: Prisma.Sql | undefined = fixedExpr;
  if (!expr) {
    const field = schema.fields.find((f) => f.key === name && f.type !== 'status');
    if (!field) return null;
    expr = NUMERIC_TYPES.has(field.type)
      ? Prisma.sql`(g.data ->> ${name})::numeric`
      : Prisma.sql`g.data ->> ${name}`;
  }
  return Prisma.sql`${expr} ${dir} NULLS LAST, g.id ASC`;
}

function whereClause(parts: Prisma.Sql[]): Prisma.Sql {
  return Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}`;
}

export const recordRepository = {
  async list(
    v: Visibility,
    f: ListFilters,
    order: Prisma.Sql,
    page: { offset: number; limit: number },
  ): Promise<{ rows: RecordRow[]; total: number }> {
    const where = whereClause([...visibilitySql(v), ...filterSql(f)]);
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<RecordRow[]>`
        SELECT ${COLUMNS} ${FROM} ${where}
        ORDER BY ${order} LIMIT ${page.limit} OFFSET ${page.offset}`,
      prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total ${FROM} ${where}`,
    ]);
    return { rows, total: count[0]?.total ?? 0 };
  },

  /** Rows for an export: same filters, capped one above `limit` so the caller can detect overflow. */
  exportRows(
    v: Visibility,
    f: ListFilters,
    order: Prisma.Sql,
    limit: number,
  ): Promise<RecordRow[]> {
    const where = whereClause([...visibilitySql(v), ...filterSql(f)]);
    return prisma.$queryRaw<RecordRow[]>`
      SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${order} LIMIT ${limit}`;
  },

  async find(id: string, v: Visibility, db: Db = prisma): Promise<RecordRow | null> {
    const where = whereClause([...visibilitySql(v), Prisma.sql`g.id = ${id}::uuid`]);
    const rows = await db.$queryRaw<RecordRow[]>`SELECT ${COLUMNS} ${FROM} ${where}`;
    return rows[0] ?? null;
  },

  /**
   * Ids of the audit rows of the records the caller may see (same predicate as the lists, deleted
   * records included), newest first; optionally for one record.
   */
  async auditIds(
    v: Visibility,
    recordId: string | undefined,
    page: { offset: number; limit: number },
  ): Promise<{ ids: string[]; total: number }> {
    const where = whereClause([
      ...visibilitySql(v),
      Prisma.sql`a.target_type = 'Record'`,
      Prisma.sql`a.detail ->> 'pageId' = ${v.pageId}`,
      ...(recordId ? [Prisma.sql`g.id = ${recordId}::uuid`] : []),
    ]);
    const from = Prisma.sql`FROM audit_logs a JOIN generic_records g ON g.id::text = a.target_id`;
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id ${from} ${where}
        ORDER BY a.at DESC, a.id DESC LIMIT ${page.limit} OFFSET ${page.offset}`,
      prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from} ${where}`,
    ]);
    return { ids: rows.map((r) => r.id), total: count[0]?.total ?? 0 };
  },

  /** Takes the next number of (page, unit, FY) and bumps it; locks the series row until commit. */
  async nextNumber(pageId: string, unitId: string, fyId: string, db: Db): Promise<number> {
    await db.$executeRaw`
      INSERT INTO number_series (page_id, unit_id, fy_id, next_value)
      VALUES (${pageId}, ${unitId}::uuid, ${fyId}::uuid, 1)
      ON CONFLICT (page_id, unit_id, fy_id) DO NOTHING`;
    const rows = await db.$queryRaw<{ next_value: number }[]>`
      SELECT next_value FROM number_series
      WHERE page_id = ${pageId} AND unit_id = ${unitId}::uuid AND fy_id = ${fyId}::uuid
      FOR UPDATE`;
    const value = rows[0]?.next_value ?? 1;
    await db.$executeRaw`
      UPDATE number_series SET next_value = ${value + 1}
      WHERE page_id = ${pageId} AND unit_id = ${unitId}::uuid AND fy_id = ${fyId}::uuid`;
    return value;
  },

  create(data: Prisma.GenericRecordUncheckedCreateInput, db: Db): Promise<{ id: string }> {
    return db.genericRecord.create({ data, select: { id: true } });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.GenericRecordUncheckedUpdateManyInput,
    db: Db,
  ): Promise<boolean> {
    const result = await db.genericRecord.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async softDelete(id: string, actorId: string, at: Date, db: Db): Promise<boolean> {
    const result = await db.genericRecord.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: at, deletedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async restore(id: string, actorId: string, db: Db): Promise<boolean> {
    const result = await db.genericRecord.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null, updatedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async lockIdempotency(userId: string, key: string, db: Db): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`idem:${userId}:${key}`}))`;
  },

  findIdempotency(userId: string, key: string, db: Db) {
    return db.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
  },

  saveIdempotency(
    row: { userId: string; key: string; requestHash: string; recordId: string },
    db: Db,
  ) {
    return db.idempotencyKey.create({ data: row });
  },
};
