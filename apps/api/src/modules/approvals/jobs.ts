// The approval jobs (docs/phases/PHASE-05.md §5 Jobs). Both are idempotent: an escalation is claimed
// with `UPDATE ... WHERE escalated_at IS NULL`, a reminder with a per-user, per-day dedupe key. They
// take `now` so tests can run them against a fake clock.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { notificationService } from '../notifications/service';
import { istDate } from './errors';
import { eligibleApprovers } from './pool';
import { REQUEST_INCLUDE } from './view';

const HOUR = 3600 * 1000;

/** Escalates every overdue level that has not been escalated yet. Returns how many it escalated. */
export async function escalateOverdue(now: Date = new Date()): Promise<number> {
  const due = await prisma.$queryRaw<{ id: string; request_id: string }[]>`
    SELECT s.id, s.request_id FROM approval_steps s
      JOIN approval_requests r ON r.id = s.request_id AND r.status = 'PENDING'
     WHERE s.status = 'PENDING' AND s.escalated_at IS NULL AND s.due_at < ${now}
     ORDER BY s.due_at, s.id`;
  let escalated = 0;
  for (const row of due) {
    const done = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM approval_requests WHERE id = ${row.request_id}::uuid FOR UPDATE`;
        const claimed = await tx.approvalStep.updateMany({
          where: { id: row.id, status: 'PENDING', escalatedAt: null },
          data: { escalatedAt: now },
        });
        if (claimed.count !== 1) return false;
        const req = await tx.approvalRequest.findUniqueOrThrow({
          where: { id: row.request_id },
          include: REQUEST_INCLUDE,
        });
        const step = req.steps.find((s) => s.id === row.id);
        if (!step) return false;
        const dept = await tx.department.findUnique({
          where: { id: req.departmentId },
          select: { name: true },
        });
        const exclude = new Set<string>([req.requestedBy]);
        if (req.createdById) exclude.add(req.createdById);
        for (const s of req.steps) {
          if (s.status !== 'APPROVED') continue;
          if (s.actedBy) exclude.add(s.actedBy);
          if (s.onBehalfOf) exclude.add(s.onBehalfOf);
        }
        let targets: string[] = [];
        if (step.escalateUserId) {
          if (!exclude.has(step.escalateUserId)) targets = [step.escalateUserId];
        } else if (step.escalateRoleId) {
          targets = (
            await eligibleApprovers(tx, {
              approverRoleId: step.escalateRoleId,
              approverUserId: null,
              docType: req.docType,
              unitId: req.unitId,
              department: dept?.name ?? '',
              exclude,
            })
          ).map((a) => a.id);
        }
        if (targets.length > 0) {
          await tx.approvalStepAssignee.createMany({
            data: targets.map((userId) => ({ stepId: step.id, userId, via: 'ESCALATION' })),
            skipDuplicates: true,
          });
        }
        await tx.approvalRequest.update({
          where: { id: req.id },
          data: { version: { increment: 1 } },
        });
        await tx.approvalAction.create({
          data: {
            requestId: req.id,
            stepId: step.id,
            action: 'ESCALATE',
            comment: `Not decided within ${step.slaHours} hours.`,
            at: now,
          },
        });
        await recordAudit(
          {
            action: 'APPROVAL_ESCALATED',
            actorId: null,
            targetType: 'Record',
            targetId: req.docId,
            detail: {
              pageId: req.docType,
              code: req.docCode,
              requestId: req.id,
              level: step.level,
              amount: req.amount?.toString() ?? null,
              escalatedTo: targets,
            },
          },
          tx,
        );
        const recipients = [...new Set([...targets, ...step.assignees.map((a) => a.userId)])];
        await notificationService.notify(tx, recipients, {
          type: 'APPROVAL_ESCALATED',
          title: `Overdue: ${req.docTitle} ${req.docCode} is waiting on level ${step.level}`,
          body: `Not decided within ${step.slaHours} hours.`,
          link: `/approvals?request=${req.id}`,
          entityType: 'ApprovalRequest',
          entityId: req.id,
          dedupeKey: `esc:${step.id}`,
          docCode: req.docCode,
          amount: req.amount?.toString() ?? null,
        });
        return true;
      },
      { maxWait: 15_000, timeout: 20_000 },
    );
    if (done) escalated += 1;
  }
  return escalated;
}

/** One reminder per user per day for levels that have waited more than 24 hours. */
export async function sendApprovalReminders(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * HOUR);
  const rows = await prisma.$queryRaw<
    { user_id: string; step_ids: string[]; request_ids: string[] }[]
  >`
    SELECT a.user_id, array_agg(s.id) AS step_ids, array_agg(DISTINCT r.id) AS request_ids
      FROM approval_step_assignees a
      JOIN approval_steps s ON s.id = a.step_id AND s.status = 'PENDING' AND s.activated_at < ${cutoff}
      JOIN approval_requests r ON r.id = s.request_id AND r.status = 'PENDING'
     GROUP BY a.user_id`;
  const day = istDate(now);
  let sent = 0;
  for (const row of rows) {
    const count = row.step_ids.length;
    const delivered = await prisma.$transaction(async (tx) => {
      const users = await notificationService.notify(tx, [row.user_id], {
        type: 'APPROVAL_REMINDER',
        title: `${count} approval${count === 1 ? '' : 's'} waiting for you`,
        body: 'These requests have been waiting more than 24 hours.',
        link: '/approvals',
        dedupeKey: `rem:${row.user_id}:${day}`,
        severity: 'ACTION',
      });
      if (users.length === 0) return false;
      const steps = await tx.approvalStep.findMany({
        where: { id: { in: row.step_ids } },
        select: { id: true, requestId: true },
      });
      await tx.approvalAction.createMany({
        data: steps.map((s) => ({
          requestId: s.requestId,
          stepId: s.id,
          action: 'REMIND',
          at: now,
        })),
      });
      return true;
    });
    if (delivered) sent += 1;
  }
  return sent;
}
