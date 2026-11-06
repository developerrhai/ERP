// Delegation (docs/phases/PHASE-05.md §3 rule 10, §5): from-user -> to-user for a date range,
// optionally for one department. The delegate acts with the delegator's role and limit under their
// own segregation rules, shown as "Ravi (on behalf of Meena)". One hop only.
import { Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { notificationService } from '../notifications/service';
import { ApprovalErrors, formatDmy, istDate } from './errors';

export interface DelegationDto {
  id: string;
  direction: 'given' | 'received';
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
  department: string | null;
  fromDate: string;
  toDate: string;
  reason: string | null;
  status: string;
  /** Today falls inside the range of an ACTIVE delegation. */
  inEffect: boolean;
}

const MAX_DAYS = 90;
const DAY = 24 * 3600 * 1000;

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

async function toDtos(
  rows: Awaited<ReturnType<typeof prisma.approvalDelegation.findMany>>,
  callerId: string,
): Promise<DelegationDto[]> {
  const userIds = [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId]))];
  const deptIds = rows.map((r) => r.departmentId).filter((x): x is string => Boolean(x));
  const [users, depts] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    }),
  ]);
  const uName = new Map(users.map((u) => [u.id, u.name]));
  const dName = new Map(depts.map((d) => [d.id, d.name]));
  const today = istDate();
  return rows.map((r) => {
    const from = r.fromDate.toISOString().slice(0, 10);
    const to = r.toDate.toISOString().slice(0, 10);
    return {
      id: r.id,
      direction: r.fromUserId === callerId ? 'given' : 'received',
      fromUser: { id: r.fromUserId, name: uName.get(r.fromUserId) ?? 'Unknown user' },
      toUser: { id: r.toUserId, name: uName.get(r.toUserId) ?? 'Unknown user' },
      department: r.departmentId ? (dName.get(r.departmentId) ?? null) : null,
      fromDate: from,
      toDate: to,
      reason: r.reason,
      status: r.status,
      inEffect: r.status === 'ACTIVE' && from <= today && to >= today,
    };
  });
}

export const delegationService = {
  /** Active colleagues whose name or login ID contains `q` (never the caller). */
  async searchTargets(auth: AuthContext, q: string): Promise<{ id: string; name: string }[]> {
    const text = q.trim();
    if (text.length < 2) return [];
    return prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        id: { not: auth.userId },
        OR: [
          { name: { contains: text, mode: 'insensitive' } },
          { loginId: { contains: text, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 10,
    });
  },

  async list(auth: AuthContext): Promise<DelegationDto[]> {
    const rows = await prisma.approvalDelegation.findMany({
      where:
        auth.level >= ADMIN_LEVEL
          ? {}
          : { OR: [{ fromUserId: auth.userId }, { toUserId: auth.userId }] },
      orderBy: [{ fromDate: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return toDtos(rows, auth.userId);
  },

  async create(
    auth: AuthContext,
    meta: RequestMeta,
    input: {
      toUserId: string;
      fromDate: string;
      toDate: string;
      department?: string | undefined;
      reason?: string | undefined;
    },
  ): Promise<DelegationDto> {
    if (input.toUserId === auth.userId) throw ApprovalErrors.delegationSelf();
    const from = dateOnly(input.fromDate);
    const to = dateOnly(input.toDate);
    if (to.getTime() < from.getTime()) {
      throw Errors.validation({ toDate: 'The end date cannot be before the start date.' });
    }
    if ((to.getTime() - from.getTime()) / DAY > MAX_DAYS) {
      throw Errors.validation({ toDate: `A delegation can last at most ${MAX_DAYS} days.` });
    }
    if (input.toDate < istDate()) {
      throw Errors.validation({ toDate: 'The end date cannot be in the past.' });
    }
    const target = await prisma.user.findUnique({ where: { id: input.toUserId } });
    if (!target || target.status !== 'ACTIVE') {
      throw Errors.validation({ toUserId: 'Choose an active user.' });
    }
    let departmentId: string | null = null;
    if (input.department) {
      const dept = await prisma.department.findUnique({ where: { name: input.department } });
      if (!dept) throw Errors.validation({ department: 'Choose a department from the list.' });
      departmentId = dept.id;
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.approvalDelegation.create({
          data: {
            fromUserId: auth.userId,
            toUserId: input.toUserId,
            departmentId,
            fromDate: from,
            toDate: to,
            reason: input.reason?.trim() || null,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
        });
        // The delegate sees the delegator's waiting levels at once (acting is checked day by day).
        const steps = await tx.$queryRaw<
          {
            step_id: string;
            request_id: string;
            requested_by: string;
            created_by_id: string | null;
            department_id: string;
          }[]
        >`
          SELECT s.id AS step_id, r.id AS request_id, r.requested_by, r.created_by_id, r.department_id
            FROM approval_step_assignees a
            JOIN approval_steps s ON s.id = a.step_id AND s.status = 'PENDING'
            JOIN approval_requests r ON r.id = s.request_id AND r.status = 'PENDING'
           WHERE a.user_id = ${auth.userId}::uuid AND a.via <> 'DELEGATION'`;
        for (const s of steps) {
          if (departmentId && s.department_id !== departmentId) continue;
          if (s.requested_by === input.toUserId || s.created_by_id === input.toUserId) continue;
          await tx.approvalStepAssignee.createMany({
            data: [
              {
                stepId: s.step_id,
                userId: input.toUserId,
                via: 'DELEGATION',
                onBehalfOf: auth.userId,
              },
            ],
            skipDuplicates: true,
          });
        }
        await recordAudit(
          {
            action: 'DELEGATION_CREATED',
            actorId: auth.userId,
            targetType: 'ApprovalDelegation',
            targetId: row.id,
            meta,
            detail: {
              toUserId: input.toUserId,
              fromDate: input.fromDate,
              toDate: input.toDate,
              department: input.department ?? null,
            },
          },
          tx,
        );
        await notificationService.notify(tx, [input.toUserId], {
          type: 'DELEGATION_STARTED',
          title: `${auth.user.name} delegated approvals to you`,
          body: `From ${formatDmy(input.fromDate)} to ${formatDmy(input.toDate)}${input.department ? ` · ${input.department}` : ''}.`,
          link: '/approvals?tab=delegations',
          entityType: 'ApprovalDelegation',
          entityId: row.id,
          dedupeKey: `del:${row.id}`,
        });
        return row;
      });
      return (await toDtos([created], auth.userId))[0] as DelegationDto;
    } catch (err) {
      if (
        (err instanceof Prisma.PrismaClientUnknownRequestError ||
          err instanceof Prisma.PrismaClientKnownRequestError) &&
        /approval_delegations_no_overlap|exclusion/i.test(err.message)
      ) {
        const clash = await prisma.approvalDelegation.findFirst({
          where: {
            fromUserId: auth.userId,
            status: 'ACTIVE',
            fromDate: { lte: to },
            toDate: { gte: from },
          },
        });
        throw ApprovalErrors.delegationOverlap(
          formatDmy((clash?.fromDate ?? from).toISOString().slice(0, 10)),
          formatDmy((clash?.toDate ?? to).toISOString().slice(0, 10)),
        );
      }
      throw err;
    }
  },

  async revoke(auth: AuthContext, meta: RequestMeta, id: string): Promise<DelegationDto> {
    const row = await prisma.approvalDelegation.findUnique({ where: { id } });
    if (!row || (row.fromUserId !== auth.userId && auth.level < ADMIN_LEVEL)) {
      throw Errors.notFound('Delegation not found.');
    }
    if (row.status === 'REVOKED') return (await toDtos([row], auth.userId))[0] as DelegationDto;
    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.approvalDelegation.update({
        where: { id },
        data: { status: 'REVOKED', updatedAt: new Date(), updatedById: auth.userId },
      });
      await tx.$executeRaw`
        DELETE FROM approval_step_assignees a
         USING approval_steps s
         WHERE a.step_id = s.id AND s.status = 'PENDING' AND a.via = 'DELEGATION'
           AND a.user_id = ${row.toUserId}::uuid AND a.on_behalf_of = ${row.fromUserId}::uuid`;
      await recordAudit(
        {
          action: 'DELEGATION_REVOKED',
          actorId: auth.userId,
          targetType: 'ApprovalDelegation',
          targetId: id,
          meta,
          detail: { toUserId: row.toUserId },
        },
        tx,
      );
      return r;
    });
    return (await toDtos([updated], auth.userId))[0] as DelegationDto;
  },
};
