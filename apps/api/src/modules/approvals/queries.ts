// Reads for the Approval Center (docs/phases/PHASE-05.md §6): the inbox, the scoped list, one request
// and the three counters. Scope is applied in the SQL, never only in the UI: a request is visible to
// Administrators, its requester / creator, anybody who is (or was) assigned to one of its levels, and
// people of the document's department (everybody of level >= 70) who can work in its unit.
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../core/auth/auth-context';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { istDate } from './errors';
import { COMPANY_WIDE_LEVEL } from './pool';
import { REQUEST_INCLUDE, buildRequestDtos } from './view';
import type { RequestDto } from './view';

async function unitIdsOf(auth: AuthContext): Promise<string[]> {
  if (auth.allUnits) return [];
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const rows = await prisma.userUnit.findMany({
    where: { userId: auth.userId },
    select: { unitId: true },
  });
  return rows.map((r) => r.unitId);
}

/** SQL predicate over `r` (approval_requests) and `d` (departments). */
async function scopeSql(auth: AuthContext): Promise<Prisma.Sql> {
  if (auth.level >= ADMIN_LEVEL) return Prisma.sql`TRUE`;
  const unitIds = await unitIdsOf(auth);
  const unitOk = auth.allUnits ? Prisma.sql`TRUE` : Prisma.sql`r.unit_id = ANY(${unitIds}::uuid[])`;
  const deptOk =
    auth.level >= COMPANY_WIDE_LEVEL
      ? Prisma.sql`TRUE`
      : Prisma.sql`d.name = ANY(${auth.departments}::text[])`;
  return Prisma.sql`(
    r.requested_by = ${auth.userId}::uuid
    OR r.created_by_id = ${auth.userId}::uuid
    OR EXISTS (
      SELECT 1 FROM approval_steps s JOIN approval_step_assignees a ON a.step_id = s.id
       WHERE s.request_id = r.id AND a.user_id = ${auth.userId}::uuid)
    OR (${deptOk} AND ${unitOk})
  )`;
}

export interface Paged<T> {
  rows: T[];
  total: number;
}

async function hydrate(auth: AuthContext, ids: readonly string[]): Promise<RequestDto[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.approvalRequest.findMany({
    where: { id: { in: [...ids] } },
    include: REQUEST_INCLUDE,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  return buildRequestDtos(prisma, ordered, auth.userId);
}

function like(q: string | undefined): Prisma.Sql {
  if (!q) return Prisma.sql`TRUE`;
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return Prisma.sql`(r.doc_code ILIKE ${pattern} OR r.doc_title ILIKE ${pattern})`;
}

export const approvalQueries = {
  /** Requests waiting on the caller right now (their own level or a live delegation). */
  async inbox(
    auth: AuthContext,
    q: { docType?: string | undefined; q?: string | undefined; page: number; size: number },
  ): Promise<Paged<RequestDto>> {
    const today = istDate();
    const where = Prisma.sql`
      r.status = 'PENDING' AND s.status = 'PENDING'
      AND (${q.docType ?? null}::text IS NULL OR r.doc_type = ${q.docType ?? null})
      AND ${like(q.q)}
      AND (a.via <> 'DELEGATION' OR EXISTS (
        SELECT 1 FROM approval_delegations dg
         WHERE dg.from_user_id = a.on_behalf_of AND dg.to_user_id = a.user_id AND dg.status = 'ACTIVE'
           AND dg.from_date <= ${today}::date AND dg.to_date >= ${today}::date
           AND (dg.department_id IS NULL OR dg.department_id = r.department_id)))`;
    const from = Prisma.sql`FROM approval_requests r
      JOIN approval_steps s ON s.request_id = r.id
      JOIN approval_step_assignees a ON a.step_id = s.id AND a.user_id = ${auth.userId}::uuid`;
    const [ids, count] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT r.id ${from} WHERE ${where}
        ORDER BY s.due_at ASC NULLS LAST, r.requested_at ASC, r.id
        LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from} WHERE ${where}`,
    ]);
    return {
      rows: await hydrate(
        auth,
        ids.map((r) => r.id),
      ),
      total: count[0]?.total ?? 0,
    };
  },

  /** Requests in the caller's scope, newest first. `mine=submitted` limits to what they raised. */
  async list(
    auth: AuthContext,
    q: {
      status?: string | undefined;
      docType?: string | undefined;
      department?: string | undefined;
      mine?: 'submitted' | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ): Promise<Paged<RequestDto>> {
    const scope = await scopeSql(auth);
    const where = Prisma.sql`
      ${scope}
      AND (${q.status ?? null}::text IS NULL OR r.status = ${q.status ?? null})
      AND (${q.docType ?? null}::text IS NULL OR r.doc_type = ${q.docType ?? null})
      AND (${q.department ?? null}::text IS NULL OR d.name = ${q.department ?? null})
      AND (${q.mine === 'submitted'} = FALSE OR r.requested_by = ${auth.userId}::uuid)
      AND ${like(q.q)}`;
    const from = Prisma.sql`FROM approval_requests r JOIN departments d ON d.id = r.department_id`;
    const [ids, count] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT r.id ${from} WHERE ${where}
        ORDER BY r.requested_at DESC, r.id DESC
        LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from} WHERE ${where}`,
    ]);
    return {
      rows: await hydrate(
        auth,
        ids.map((r) => r.id),
      ),
      total: count[0]?.total ?? 0,
    };
  },

  /** 404 when the request does not exist or is outside the caller's scope. */
  async get(auth: AuthContext, id: string): Promise<RequestDto> {
    const scope = await scopeSql(auth);
    // unpaginated: rows of one parent (id)
    const visible = await prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM approval_requests r JOIN departments d ON d.id = r.department_id
       WHERE r.id = ${id}::uuid AND ${scope}`;
    if (!visible[0]) throw Errors.notFound('Request not found.');
    return (await hydrate(auth, [id]))[0] as RequestDto;
  },

  /** The requests of one document that the caller may see. */
  async forDocument(auth: AuthContext, docType: string, docId: string): Promise<RequestDto[]> {
    const scope = await scopeSql(auth);
    // unpaginated: rows of one parent (doc_id)
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM approval_requests r JOIN departments d ON d.id = r.department_id
       WHERE r.doc_type = ${docType} AND r.doc_id = ${docId}::uuid AND ${scope}
       ORDER BY r.cycle DESC`;
    return hydrate(
      auth,
      ids.map((r) => r.id),
    );
  },

  async counts(auth: AuthContext, now: Date = new Date()) {
    const today = istDate(now);
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const rows = await prisma.$queryRaw<{ waiting: number; overdue: number; submitted: number }[]>`
      SELECT
        (SELECT count(*)::int FROM approval_requests r
           JOIN approval_steps s ON s.request_id = r.id AND s.status = 'PENDING'
           JOIN approval_step_assignees a ON a.step_id = s.id AND a.user_id = ${auth.userId}::uuid
          WHERE r.status = 'PENDING'
            AND (a.via <> 'DELEGATION' OR EXISTS (
              SELECT 1 FROM approval_delegations dg
               WHERE dg.from_user_id = a.on_behalf_of AND dg.to_user_id = a.user_id
                 AND dg.status = 'ACTIVE' AND dg.from_date <= ${today}::date AND dg.to_date >= ${today}::date
                 AND (dg.department_id IS NULL OR dg.department_id = r.department_id)))) AS waiting,
        (SELECT count(*)::int FROM approval_requests r
           JOIN approval_steps s ON s.request_id = r.id AND s.status = 'PENDING'
           JOIN approval_step_assignees a ON a.step_id = s.id AND a.user_id = ${auth.userId}::uuid
          WHERE r.status = 'PENDING' AND s.due_at < ${now}) AS overdue,
        (SELECT count(*)::int FROM approval_requests r
          WHERE r.requested_by = ${auth.userId}::uuid AND r.status = 'PENDING') AS submitted`;
    const row = rows[0];
    return {
      waitingForMe: row?.waiting ?? 0,
      submittedPending: row?.submitted ?? 0,
      overdue: row?.overdue ?? 0,
    };
  },
};
