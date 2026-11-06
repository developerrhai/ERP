// Read-only queries over audit_logs (the table itself is append-only by DB trigger). Filtering and
// paging run as one parameterised SQL statement (Prisma.sql fragments, never string concatenation)
// so the free-text `q` can also search `detail::text`; rows are then loaded with the actor joined.
import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { escapeLike } from '../../core/http/query-safety';
import type { ListAuditLogsQuery } from './schemas';

const include = { actor: { select: { id: true, name: true, loginId: true } } } as const;

export type AuditLogWithActor = Prisma.AuditLogGetPayload<{ include: typeof include }>;

function whereSql(query: ListAuditLogsQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (query.fromDate) conditions.push(Prisma.sql`a.at >= ${query.fromDate}`);
  if (query.toDate) {
    conditions.push(
      query.toInclusive ? Prisma.sql`a.at <= ${query.toDate}` : Prisma.sql`a.at < ${query.toDate}`,
    );
  }
  if (query.actorId) conditions.push(Prisma.sql`a.actor_id = ${query.actorId}::uuid`);
  if (query.preset === 'login_events') {
    const loginActions = [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
      'LOGOUT',
      'LOGOUT_ALL',
      'MFA_CHALLENGE_ISSUED',
      'MFA_SUCCESS',
      'MFA_FAILED',
      'MFA_RECOVERY_CODE_USED',
      'MFA_ENABLED',
      'MFA_DISABLED',
      'MFA_RECOVERY_REGENERATED',
      'MFA_RESET_BY_ADMIN',
      'SESSION_REVOKED',
      'SESSIONS_REVOKED_OTHERS',
      'SESSIONS_REVOKED_BY_ADMIN',
      'SESSION_IDLE_EXPIRED',
      'PASSWORD_RESET_REQUESTED',
      'PASSWORD_RESET_COMPLETED',
      'PASSWORD_CHANGED',
      'USER_PASSWORD_RESET',
    ];
    conditions.push(Prisma.sql`a.action IN (${Prisma.join(loginActions)})`);
  } else if (query.action) {
    const actions = query.action.split(',').map((s) => s.trim()).filter(Boolean);
    if (actions.length > 1) {
      conditions.push(Prisma.sql`a.action IN (${Prisma.join(actions)})`);
    } else {
      conditions.push(Prisma.sql`a.action = ${query.action}`);
    }
  }
  // Case-insensitive: the web asks for `record`, the audit rows say `Record`.
  if (query.targetType) {
    conditions.push(Prisma.sql`lower(a.target_type) = lower(${query.targetType})`);
  }
  if (query.pageId) conditions.push(Prisma.sql`a.detail ->> 'pageId' = ${query.pageId}`);
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(Prisma.sql`(
      a.action ILIKE ${pattern} ESCAPE '\\'
      OR a.target_type ILIKE ${pattern} ESCAPE '\\'
      OR a.target_id ILIKE ${pattern} ESCAPE '\\'
      OR a.ip ILIKE ${pattern} ESCAPE '\\'
      OR a.detail::text ILIKE ${pattern} ESCAPE '\\'
      OR u.name ILIKE ${pattern} ESCAPE '\\'
      OR u.login_id ILIKE ${pattern} ESCAPE '\\'
    )`);
  }
  return conditions.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;
}

export const auditLogRepository = {
  async list(query: ListAuditLogsQuery): Promise<{ rows: AuditLogWithActor[]; total: number }> {
    const where = whereSql(query);
    const offset = (query.page - 1) * query.size;
    const [ids, counted] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        ${where}
        ORDER BY a.at DESC, a.id DESC
        LIMIT ${query.size} OFFSET ${offset}`,
      prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        ${where}`,
    ]);
    const order = ids.map((r) => r.id);
    const rows = order.length
      ? await prisma.auditLog.findMany({ where: { id: { in: order } }, include })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      rows: order.map((id) => byId.get(id)).filter((r): r is AuditLogWithActor => r !== undefined),
      total: counted[0]?.total ?? 0,
    };
  },

  /** Rows by id with their actor, in the order of `ids` (rows that no longer exist are skipped). */
  async findByIds(ids: readonly string[]): Promise<AuditLogWithActor[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.auditLog.findMany({ where: { id: { in: [...ids] } }, include });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is AuditLogWithActor => r !== undefined);
  },

  findById(id: string): Promise<AuditLogWithActor | null> {
    return prisma.auditLog.findUnique({ where: { id }, include });
  },
};
