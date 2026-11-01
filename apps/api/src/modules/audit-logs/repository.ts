// Read-only queries over audit_logs (the table itself is append-only by DB trigger). Newest first,
// with the actor's name and login ID joined in.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { ListAuditLogsQuery } from './schemas';

const include = { actor: { select: { id: true, name: true, loginId: true } } } as const;

export type AuditLogWithActor = Prisma.AuditLogGetPayload<{ include: typeof include }>;

function whereFor(query: ListAuditLogsQuery): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.fromDate || query.toDate) {
    where.at = {
      ...(query.fromDate ? { gte: query.fromDate } : {}),
      ...(query.toDate ? (query.toInclusive ? { lte: query.toDate } : { lt: query.toDate }) : {}),
    };
  }
  if (query.actorId) where.actorId = query.actorId;
  if (query.action) where.action = query.action;
  if (query.targetType) where.targetType = query.targetType;
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const };
    where.OR = [
      { action: contains },
      { targetId: contains },
      { targetType: contains },
      { ip: contains },
      { actor: { name: contains } },
      { actor: { loginId: contains } },
    ];
  }
  return where;
}

export const auditLogRepository = {
  async list(query: ListAuditLogsQuery): Promise<{ rows: AuditLogWithActor[]; total: number }> {
    const where = whereFor(query);
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { rows, total };
  },

  findById(id: string): Promise<AuditLogWithActor | null> {
    return prisma.auditLog.findUnique({ where: { id }, include });
  },
};
