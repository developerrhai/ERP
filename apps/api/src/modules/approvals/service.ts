// ApprovalService (docs/phases/PHASE-05.md §5): submit, approve / reject / return / withdraw,
// reassign and statusOf. Every verb is ONE transaction that locks the request row (or the document
// row on submit) first, so two people acting at once are serialised and the second one gets a 409.
// The engine never writes a document table: the ApprovalDocHandler of the document type does.
import { Prisma } from '@prisma/client';
import type { ApprovalRequest, ApprovalStep } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { notificationService } from '../notifications/service';
import { ApprovalErrors, formatDateTimeIst, istDate } from './errors';
import { formatInr } from './money';
import { SETTINGS_APPROVAL_DOC_TYPE } from '../../core/settings/constants';
import { handlerFor, registerApprovalHandler } from './handlers';
import { canApproveDoc } from './pool';
import type { ApprovalDocHandler } from './handlers';
import { applicableRules, resolveRuleSet } from './matrix';
import { approverLabel, eligibleApprovers } from './pool';
import type { Approver } from './pool';
import { mailAutomation } from '../docsmail/automation';
import { REQUEST_INCLUDE, buildRequestDtos, requestView } from './view';
import type { RequestDto, RequestFull } from './view';

export interface ApprovalCaller {
  auth: AuthContext;
  meta: RequestMeta;
}

const TX = { maxWait: 15_000, timeout: 20_000 };
const MIN_COMMENT = 10;
const HOUR = 3600 * 1000;

type DecisionKind = 'APPROVE' | 'REJECT' | 'RETURN';
type Audited = Pick<ApprovalRequest, 'id' | 'docType' | 'docId' | 'docCode' | 'amount'>;

function requestLink(requestId: string): string {
  return `/approvals?request=${requestId}`;
}

async function addAction(
  tx: Db,
  p: {
    requestId: string;
    stepId?: string | null;
    action: string;
    actorId?: string | null;
    onBehalfOf?: string | null;
    comment?: string | null;
    from?: string | null;
    to?: string | null;
    key?: string | null;
  },
): Promise<void> {
  await tx.approvalAction.create({
    data: {
      requestId: p.requestId,
      stepId: p.stepId ?? null,
      action: p.action,
      actorId: p.actorId ?? null,
      onBehalfOf: p.onBehalfOf ?? null,
      comment: p.comment ?? null,
      fromStatus: p.from ?? null,
      toStatus: p.to ?? null,
      idempotencyKey: p.key ?? null,
    },
  });
}

/** Audit row; target = the document, detail = request, level, amount, actor, on behalf of, comment. */
async function auditApproval(
  tx: Db,
  action: string,
  req: Audited,
  meta: RequestMeta | undefined,
  actorId: string | null,
  extra: Prisma.InputJsonObject = {},
): Promise<void> {
  await recordAudit(
    {
      action,
      actorId,
      targetType: 'Record',
      targetId: req.docId,
      ...(meta ? { meta } : {}),
      detail: {
        pageId: req.docType,
        code: req.docCode,
        requestId: req.id,
        amount: req.amount?.toString() ?? null,
        ...extra,
      },
    },
    tx,
  );
}

async function lockRequest(tx: Db, id: string): Promise<RequestFull> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows[0]) throw Errors.notFound('Request not found.');
  return tx.approvalRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
}

/** The "already decided" error that names who decided last and when. */
async function decidedError(tx: Db, req: RequestFull) {
  const last = [...req.actions]
    .reverse()
    .find((a) =>
      ['APPROVE', 'REJECT', 'RETURN', 'WITHDRAW', 'AUTO_APPROVED', 'CANCEL'].includes(a.action),
    );
  let name = 'another user';
  if (last?.actorId) {
    const u = await tx.user.findUnique({ where: { id: last.actorId }, select: { name: true } });
    if (u) name = u.name;
  }
  return ApprovalErrors.levelAlreadyDecided(
    name,
    formatDateTimeIst(last?.at ?? req.decidedAt ?? new Date()),
  );
}

/** Marks the approver notifications of a request as read once it is no longer waiting on them. */
async function clearApproverNotifications(tx: Db, requestId: string): Promise<void> {
  await tx.notification.updateMany({
    where: {
      entityType: 'ApprovalRequest',
      entityId: requestId,
      readAt: null,
      type: { in: ['APPROVAL_ASSIGNED', 'APPROVAL_REMINDER', 'APPROVAL_ESCALATED'] },
    },
    data: { readAt: new Date() },
  });
}

/** People who may not approve this request at all: its requester and its creator. */
function baseExclusions(req: Pick<ApprovalRequest, 'requestedBy' | 'createdById'>): Set<string> {
  const set = new Set<string>([req.requestedBy]);
  if (req.createdById) set.add(req.createdById);
  return set;
}

interface DocContext {
  docType: string;
  unitId: string;
  department: string;
  departmentId: string;
}

async function docContext(tx: Db, req: ApprovalRequest): Promise<DocContext> {
  const dept = await tx.department.findUnique({
    where: { id: req.departmentId },
    select: { name: true },
  });
  return {
    docType: req.docType,
    unitId: req.unitId,
    department: dept?.name ?? '',
    departmentId: req.departmentId,
  };
}

/**
 * Makes a waiting level the current one: sets its due date, computes the approver pool (without the
 * requester, the creator and anybody who approved an earlier level), adds active delegates and tells
 * everybody. Returns the user ids that now have this step in their inbox.
 */
async function activateStep(
  tx: Db,
  req: RequestFull,
  step: ApprovalStep,
  now: Date,
): Promise<string[]> {
  const ctx = await docContext(tx, req);
  const exclude = baseExclusions(req);
  for (const s of req.steps) {
    if (s.status !== 'APPROVED') continue;
    if (s.actedBy) exclude.add(s.actedBy);
    if (s.onBehalfOf) exclude.add(s.onBehalfOf);
  }
  const pool = await eligibleApprovers(tx, {
    approverRoleId: step.approverRoleId,
    approverUserId: step.approverUserId,
    docType: ctx.docType,
    unitId: ctx.unitId,
    department: ctx.department,
    exclude,
  });
  await tx.approvalStep.update({
    where: { id: step.id },
    data: {
      status: 'PENDING',
      activatedAt: now,
      dueAt: new Date(now.getTime() + step.slaHours * HOUR),
    },
  });
  const via = step.approverUserId ? 'USER' : 'ROLE';
  await tx.approvalStepAssignee.createMany({
    data: pool.map((a) => ({ stepId: step.id, userId: a.id, via })),
    skipDuplicates: true,
  });
  const delegates = await addDelegates(tx, step.id, pool, req, exclude, now);
  const recipients = [...new Set([...pool.map((p) => p.id), ...delegates])];
  await notificationService.notify(tx, recipients, {
    type: 'APPROVAL_ASSIGNED',
    title: `${req.docTitle} ${req.docCode} needs your approval`,
    body: `Level ${step.level} of ${req.totalLevels}${req.amount ? ` · ${formatInr(req.amount)}` : ''}`,
    link: requestLink(req.id),
    entityType: 'ApprovalRequest',
    entityId: req.id,
    dedupeKey: `asg:${step.id}`,
    docCode: req.docCode,
    amount: req.amount?.toString() ?? null,
  });
  return recipients;
}

/** Active (also not yet started) delegates of the pool become assignees "on behalf of" the delegator. */
async function addDelegates(
  tx: Db,
  stepId: string,
  pool: readonly Approver[],
  req: Pick<ApprovalRequest, 'departmentId'>,
  exclude: ReadonlySet<string>,
  now: Date,
): Promise<string[]> {
  if (pool.length === 0) return [];
  const today = new Date(`${istDate(now)}T00:00:00Z`);
  // unpaginated: rows named by an id list
  const delegations = await tx.approvalDelegation.findMany({
    where: {
      fromUserId: { in: pool.map((p) => p.id) },
      status: 'ACTIVE',
      toDate: { gte: today },
      OR: [{ departmentId: null }, { departmentId: req.departmentId }],
    },
  });
  const have = new Set(pool.map((p) => p.id));
  const added: string[] = [];
  for (const d of delegations) {
    if (exclude.has(d.toUserId) || have.has(d.toUserId)) continue;
    const delegate = await tx.user.findUnique({
      where: { id: d.toUserId },
      select: { status: true },
    });
    if (delegate?.status !== 'ACTIVE') continue;
    await tx.approvalStepAssignee.createMany({
      data: [{ stepId, userId: d.toUserId, via: 'DELEGATION', onBehalfOf: d.fromUserId }],
      skipDuplicates: true,
    });
    have.add(d.toUserId);
    added.push(d.toUserId);
  }
  return added;
}

interface Authority {
  /** Whose role and limit are used. */
  userId: string;
  onBehalfOf: string | null;
}

/** The caller's authority on the current step: their own, or a live delegation's delegator. */
async function resolveAuthority(
  tx: Db,
  req: RequestFull,
  step: RequestFull['steps'][number],
  callerId: string,
  now: Date,
): Promise<Authority | null> {
  const row = step.assignees.find((a) => a.userId === callerId);
  if (!row) return null;
  if (row.via !== 'DELEGATION' || !row.onBehalfOf) return { userId: callerId, onBehalfOf: null };
  const today = new Date(`${istDate(now)}T00:00:00Z`);
  const live = await tx.approvalDelegation.findFirst({
    where: {
      fromUserId: row.onBehalfOf,
      toUserId: callerId,
      status: 'ACTIVE',
      fromDate: { lte: today },
      toDate: { gte: today },
      OR: [{ departmentId: null }, { departmentId: req.departmentId }],
    },
  });
  return live ? { userId: row.onBehalfOf, onBehalfOf: row.onBehalfOf } : null;
}

function uniqueViolation(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.target;
    return Array.isArray(target) ? target.join(',') : typeof target === 'string' ? target : '';
  }
  return null;
}

export const approvalService = {
  /** A module registers the handler of its own document type (generic pages need nothing). */
  register(docType: string, handler: ApprovalDocHandler): void {
    registerApprovalHandler(docType, handler);
  },

  /**
   * Submit a Draft or Rejected document. Amount, department and unit are re-read from the document
   * inside the transaction (handler.snapshot) — the API never accepts them from the client.
   */
  async submit(
    caller: ApprovalCaller,
    docType: string,
    docId: string,
    opts: { docVersion?: number | undefined; idemKey?: string | undefined } = {},
  ): Promise<RequestDto> {
    const handler = handlerFor(docType);
    const user = caller.auth.user;
    if (
      docType !== SETTINGS_APPROVAL_DOC_TYPE &&
      !(await can(accessUserOf(user), docType, 'submit'))
    ) {
      throw Errors.forbidden();
    }
    const now = new Date();
    try {
      const requestId = await prisma.$transaction(async (tx) => {
        const snap = await handler.snapshot(tx, docId);
        if (!snap) throw Errors.notFound('Record not found.');
        if (snap.status === 'Pending Approval') throw ApprovalErrors.alreadyPending();
        if (snap.status !== 'Draft' && snap.status !== 'Rejected') {
          throw ApprovalErrors.notSubmittable(snap.status);
        }
        if (!snap.fyOpen)
          throw Errors.periodClosed('The financial year of this document is closed.');
        if (opts.docVersion !== undefined && opts.docVersion !== snap.version) {
          throw Errors.versionConflict();
        }
        const dept = await tx.department.findUnique({ where: { name: snap.department } });
        if (!dept) throw ApprovalErrors.noApprovalRule(snap.department || 'this department');
        const control = await tx.moduleControl.findUnique({ where: { pageId: docType } });
        const prior = await tx.approvalRequest.aggregate({
          where: { docType, docId },
          _max: { cycle: true },
        });
        const cycle = (prior._max.cycle ?? 0) + 1;
        const amount = snap.amount === null ? null : new Prisma.Decimal(snap.amount);
        const base = {
          docType,
          docId,
          docCode: snap.code,
          docTitle: snap.title.slice(0, 200),
          unitId: snap.unitId,
          departmentId: dept.id,
          amount,
          cycle,
          requestedBy: user.id,
          createdById: snap.createdBy,
          docVersion: snap.version,
        };
        const info = { docType, actorId: user.id };

        // approval_required = false: straight to Approved, recorded as evidence.
        if (control && !control.approvalRequired) {
          const auto = await tx.approvalRequest.create({
            data: {
              ...base,
              status: 'APPROVED',
              currentLevel: 0,
              totalLevels: 0,
              decidedAt: now,
            },
          });
          await addAction(tx, {
            requestId: auto.id,
            action: 'AUTO_APPROVED',
            actorId: user.id,
            from: snap.status,
            to: 'Approved',
            key: opts.idemKey ?? null,
          });
          await handler.onApproved(tx, docId, { id: auto.id, ...info });
          await auditApproval(tx, 'APPROVAL_APPROVED', auto, caller.meta, user.id, {
            auto: true,
            cycle,
          });
          return auto.id;
        }

        const set = await resolveRuleSet(tx, dept.id, docType, snap.unitId);
        if (!set || set.rules.length === 0) throw ApprovalErrors.noApprovalRule(dept.name);
        const picked = applicableRules(set.rules, amount, set.noAmountLevels);
        const exclude = new Set<string>([user.id, snap.createdBy]);
        for (const rule of picked) {
          const pool = await eligibleApprovers(tx, {
            approverRoleId: rule.approverRoleId,
            approverUserId: rule.approverUserId,
            docType,
            unitId: snap.unitId,
            department: dept.name,
            exclude,
          });
          const isFinal = rule.level === picked[picked.length - 1]?.level;
          const usable =
            isFinal && amount !== null
              ? pool.filter((p) => (p.approvalLimit ?? new Prisma.Decimal(0)).gte(amount))
              : pool;
          if (usable.length === 0) {
            throw ApprovalErrors.noEligibleApprover(rule.level, await approverLabel(tx, rule));
          }
        }
        const request = await tx.approvalRequest.create({
          data: {
            ...base,
            ruleSetId: set.id,
            ruleSetVersion: set.version,
            status: 'PENDING',
            currentLevel: picked[0]?.level ?? 1,
            totalLevels: picked.length,
          },
        });
        await tx.approvalStep.createMany({
          data: picked.map((rule, i) => ({
            requestId: request.id,
            level: rule.level,
            ruleId: rule.id,
            threshold: rule.threshold,
            approverRoleId: rule.approverRoleId,
            approverUserId: rule.approverUserId,
            limitRequired: i === picked.length - 1 && amount !== null ? amount : null,
            slaHours: rule.slaHours,
            status: 'WAITING',
            escalateRoleId: rule.escalateRoleId,
            escalateUserId: rule.escalateUserId,
          })),
        });
        await addAction(tx, {
          requestId: request.id,
          action: 'SUBMIT',
          actorId: user.id,
          from: snap.status,
          to: 'Pending Approval',
          key: opts.idemKey ?? null,
        });
        await handler.onSubmitted(tx, docId, { id: request.id, ...info });
        await auditApproval(tx, 'APPROVAL_SUBMITTED', request, caller.meta, user.id, {
          cycle,
          levels: picked.length,
        });
        const full = await tx.approvalRequest.findUniqueOrThrow({
          where: { id: request.id },
          include: REQUEST_INCLUDE,
        });
        const first = full.steps[0];
        if (first) await activateStep(tx, full, first, now);
        return request.id;
      }, TX);
      return (await requestView(user.id, requestId)) as RequestDto;
    } catch (err) {
      if (uniqueViolation(err) !== null) throw ApprovalErrors.alreadyPending();
      throw err;
    }
  },

  /** approve / reject / return: the request row is locked, then the §5 checks run in order. */
  async decide(
    caller: ApprovalCaller,
    requestId: string,
    kind: DecisionKind,
    p: { comment?: string | undefined; version: number; idemKey?: string | undefined },
    now: Date = new Date(),
  ): Promise<RequestDto> {
    const comment = (p.comment ?? '').trim();
    if (kind !== 'APPROVE' && comment.length < MIN_COMMENT) throw ApprovalErrors.commentRequired();
    if (comment.length > 1000) {
      throw Errors.validation({ comment: 'Keep the comment under 1000 characters.' });
    }
    const callerId = caller.auth.userId;
    try {
      let mailNote: Parameters<typeof mailAutomation.onApprovalResult>[0] | null = null;
      await prisma.$transaction(async (tx) => {
        const req = await lockRequest(tx, requestId);
        if (req.status !== 'PENDING') throw await decidedError(tx, req);
        if (p.version !== req.version) throw Errors.versionConflict();
        const step = req.steps.find((s) => s.status === 'PENDING');
        if (!step) throw await decidedError(tx, req);

        if (callerId === req.requestedBy || callerId === req.createdById) {
          throw ApprovalErrors.selfApproval();
        }
        const authority = await resolveAuthority(tx, req, step, callerId, now);
        if (!authority) throw ApprovalErrors.notYourLevel(await approverLabel(tx, step));
        const actingUser = await tx.user.findUniqueOrThrow({
          where: { id: authority.userId },
          include: { role: true, extraDepartments: true },
        });
        if (actingUser.status !== 'ACTIVE') {
          throw ApprovalErrors.notYourLevel(await approverLabel(tx, step));
        }
        if (!(await canApproveDoc(actingUser, req.docType))) {
          throw Errors.forbidden();
        }

        if (kind === 'APPROVE') {
          const mine = new Set([callerId, authority.userId]);
          for (const a of req.actions) {
            if (a.action !== 'APPROVE') continue;
            const hit =
              (a.actorId && mine.has(a.actorId)) || (a.onBehalfOf && mine.has(a.onBehalfOf));
            if (!hit) continue;
            const earlier = req.steps.find((s) => s.id === a.stepId);
            throw ApprovalErrors.oneLevelOnly(earlier?.level ?? step.level - 1);
          }
          const last = req.steps[req.steps.length - 1];
          if (step.id === last?.id && req.amount !== null) {
            const limit = actingUser.approvalLimit ?? new Prisma.Decimal(0);
            if (limit.lt(req.amount))
              throw ApprovalErrors.overLimit(req.amount.toString(), limit.toString());
          }
        }

        const decided = await tx.approvalStep.updateMany({
          where: { id: step.id, status: 'PENDING' },
          data: {
            status: kind === 'APPROVE' ? 'APPROVED' : kind === 'REJECT' ? 'REJECTED' : 'RETURNED',
            actedBy: callerId,
            onBehalfOf: authority.onBehalfOf,
            actedAt: now,
            comment: comment || null,
          },
        });
        if (decided.count !== 1) throw await decidedError(tx, req);
        await addAction(tx, {
          requestId: req.id,
          stepId: step.id,
          action: kind,
          actorId: callerId,
          onBehalfOf: authority.onBehalfOf,
          comment: comment || null,
          from: 'Pending Approval',
          key: p.idemKey ?? null,
        });
        await clearApproverNotifications(tx, req.id);
        const handler = handlerFor(req.docType);
        const info = { id: req.id, docType: req.docType, actorId: callerId };
        const onBehalf = authority.onBehalfOf ? { onBehalfOf: authority.onBehalfOf } : {};

        if (kind === 'APPROVE') {
          const next = req.steps.find((s) => s.level > step.level && s.status === 'WAITING');
          if (next) {
            await tx.approvalRequest.update({
              where: { id: req.id },
              data: { currentLevel: next.level, version: { increment: 1 } },
            });
            await auditApproval(tx, 'APPROVAL_APPROVED_LEVEL', req, caller.meta, callerId, {
              level: step.level,
              comment,
              ...onBehalf,
            });
            const refreshed = await tx.approvalRequest.findUniqueOrThrow({
              where: { id: req.id },
              include: REQUEST_INCLUDE,
            });
            const nextStep = refreshed.steps.find((s) => s.id === next.id) as ApprovalStep;
            await activateStep(tx, refreshed, nextStep, now);
            await notificationService.notify(tx, [req.requestedBy], {
              type: 'APPROVAL_LEVEL_PASSED',
              title: `${req.docTitle} ${req.docCode}: level ${step.level} approved`,
              body: `Now waiting for level ${next.level} of ${req.totalLevels}.`,
              link: requestLink(req.id),
              entityType: 'ApprovalRequest',
              entityId: req.id,
              dedupeKey: `lvl:${step.id}`,
              docCode: req.docCode,
              amount: req.amount?.toString() ?? null,
            });
            return;
          }
          await tx.approvalRequest.update({
            where: { id: req.id },
            data: { status: 'APPROVED', decidedAt: now, version: { increment: 1 } },
          });
          await handler.onApproved(tx, req.docId, info);
          await auditApproval(tx, 'APPROVAL_APPROVED', req, caller.meta, callerId, {
            level: step.level,
            comment,
            ...onBehalf,
          });
        } else {
          const status = kind === 'REJECT' ? 'REJECTED' : 'RETURNED';
          await tx.approvalStep.updateMany({
            where: { requestId: req.id, status: { in: ['WAITING', 'PENDING'] } },
            data: { status: 'CANCELLED' },
          });
          await tx.approvalRequest.update({
            where: { id: req.id },
            data: { status, decidedAt: now, version: { increment: 1 } },
          });
          if (kind === 'REJECT') await handler.onRejected(tx, req.docId, info);
          else await handler.onReturned(tx, req.docId, info);
          await auditApproval(
            tx,
            kind === 'REJECT' ? 'APPROVAL_REJECTED' : 'APPROVAL_RETURNED',
            req,
            caller.meta,
            callerId,
            { level: step.level, comment, ...onBehalf },
          );
        }
        const verb =
          kind === 'APPROVE' ? 'approved' : kind === 'REJECT' ? 'rejected' : 'returned for changes';
        await notificationService.notify(tx, [req.requestedBy], {
          type: 'APPROVAL_DECIDED',
          title: `${req.docTitle} ${req.docCode} was ${verb === 'approved' ? 'Approved' : verb === 'rejected' ? 'Rejected' : 'Returned'}`,
          body: comment || `Your request was ${verb}.`,
          link: requestLink(req.id),
          entityType: 'ApprovalRequest',
          entityId: req.id,
          dedupeKey: `dec:${req.id}`,
          docCode: req.docCode,
          amount: req.amount?.toString() ?? null,
        });
        if (kind !== 'RETURN') {
          mailNote = { docType: req.docType, docId: req.docId, docNo: req.docCode, unitId: req.unitId, requesterId: req.requestedBy, approved: kind === 'APPROVE', ...(comment ? { detail: comment } : {}) };
        }
      }, TX);
      if (mailNote) void mailAutomation.onApprovalResult(mailNote);
    } catch (err) {
      const target = uniqueViolation(err);
      if (target !== null) {
        throw target.includes('one_approve_per_user')
          ? ApprovalErrors.oneLevelOnly(1)
          : Errors.conflict('This level was already decided. Refresh to see the latest.');
      }
      throw err;
    }
    return (await requestView(callerId, requestId)) as RequestDto;
  },

  approve: (
    caller: ApprovalCaller,
    requestId: string,
    p: { comment?: string | undefined; version: number; idemKey?: string | undefined },
  ) => approvalService.decide(caller, requestId, 'APPROVE', p),
  reject: (
    caller: ApprovalCaller,
    requestId: string,
    p: { comment?: string | undefined; version: number; idemKey?: string | undefined },
  ) => approvalService.decide(caller, requestId, 'REJECT', p),
  return: (
    caller: ApprovalCaller,
    requestId: string,
    p: { comment?: string | undefined; version: number; idemKey?: string | undefined },
  ) => approvalService.decide(caller, requestId, 'RETURN', p),

  /** The requester takes the request back while it is pending: the document returns to Draft. */
  async withdraw(
    caller: ApprovalCaller,
    requestId: string,
    p: { version: number; idemKey?: string | undefined },
  ): Promise<RequestDto> {
    const callerId = caller.auth.userId;
    await prisma.$transaction(async (tx) => {
      const req = await lockRequest(tx, requestId);
      if (req.requestedBy !== callerId) {
        throw Errors.forbidden('Only the person who raised this request can withdraw it.');
      }
      if (req.status !== 'PENDING') throw await decidedError(tx, req);
      if (p.version !== req.version) throw Errors.versionConflict();
      const now = new Date();
      await tx.approvalStep.updateMany({
        where: { requestId: req.id, status: { in: ['WAITING', 'PENDING'] } },
        data: { status: 'CANCELLED' },
      });
      await tx.approvalRequest.update({
        where: { id: req.id },
        data: { status: 'WITHDRAWN', decidedAt: now, version: { increment: 1 } },
      });
      await addAction(tx, {
        requestId: req.id,
        action: 'WITHDRAW',
        actorId: callerId,
        from: 'Pending Approval',
        to: 'Draft',
        key: p.idemKey ?? null,
      });
      await clearApproverNotifications(tx, req.id);
      await handlerFor(req.docType).onReturned(tx, req.docId, {
        id: req.id,
        docType: req.docType,
        actorId: callerId,
      });
      await auditApproval(tx, 'APPROVAL_WITHDRAWN', req, caller.meta, callerId, {
        level: req.currentLevel,
      });
    }, TX);
    return (await requestView(callerId, requestId)) as RequestDto;
  },

  /** An Administrator hands a stuck level to another person (with a written reason). */
  async reassign(
    caller: ApprovalCaller,
    stepId: string,
    input: { userId: string; reason: string; version?: number | undefined },
  ): Promise<RequestDto> {
    if (caller.auth.level < ADMIN_LEVEL) throw Errors.forbidden();
    const reason = input.reason.trim();
    if (reason.length < MIN_COMMENT) throw ApprovalErrors.commentRequired();
    const found = await prisma.approvalStep.findUnique({
      where: { id: stepId },
      select: { requestId: true },
    });
    if (!found) throw Errors.notFound('Step not found.');
    await prisma.$transaction(async (tx) => {
      const req = await lockRequest(tx, found.requestId);
      const step = req.steps.find((s) => s.id === stepId);
      if (!step || req.status !== 'PENDING' || step.status !== 'PENDING') {
        throw Errors.conflict('Only the level that is waiting right now can be reassigned.');
      }
      if (input.version !== undefined && input.version !== req.version)
        throw Errors.versionConflict();
      const target = await tx.user.findUnique({ where: { id: input.userId } });
      if (!target || target.status !== 'ACTIVE') {
        throw Errors.validation({ userId: 'Choose an active user.' });
      }
      if (baseExclusions(req).has(target.id)) {
        throw Errors.validation({
          userId: 'The person who raised or created this request cannot approve it.',
        });
      }
      await tx.approvalStepAssignee.upsert({
        where: { stepId_userId: { stepId, userId: target.id } },
        create: { stepId, userId: target.id, via: 'REASSIGN' },
        update: { via: 'REASSIGN', onBehalfOf: null },
      });
      await tx.approvalRequest.update({
        where: { id: req.id },
        data: { version: { increment: 1 } },
      });
      await addAction(tx, {
        requestId: req.id,
        stepId,
        action: 'REASSIGN',
        actorId: caller.auth.userId,
        comment: `${reason} (to ${target.name})`.slice(0, 1000),
      });
      await auditApproval(tx, 'APPROVAL_REASSIGNED', req, caller.meta, caller.auth.userId, {
        level: step.level,
        toUserId: target.id,
        comment: reason,
      });
      await notificationService.notify(tx, [target.id], {
        type: 'APPROVAL_ASSIGNED',
        title: `${req.docTitle} ${req.docCode} needs your approval`,
        body: `Level ${step.level} of ${req.totalLevels} was assigned to you.`,
        link: requestLink(req.id),
        entityType: 'ApprovalRequest',
        entityId: req.id,
        dedupeKey: `asg:${stepId}:${target.id}`,
        docCode: req.docCode,
        amount: req.amount?.toString() ?? null,
      });
    }, TX);
    return (await requestView(caller.auth.userId, found.requestId)) as RequestDto;
  },

  /** The latest request of a document (for the lock chip, the Approvals tab and the journey). */
  async statusOf(docType: string, docId: string, callerId: string): Promise<RequestDto | null> {
    const latest = await prisma.approvalRequest.findFirst({
      where: { docType, docId },
      orderBy: [{ cycle: 'desc' }, { requestedAt: 'desc' }],
      select: { id: true },
    });
    return latest ? requestView(callerId, latest.id) : null;
  },

  /** All requests of a document, newest cycle first. */
  async historyOf(docType: string, docId: string, callerId: string): Promise<RequestDto[]> {
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const rows = await prisma.approvalRequest.findMany({
      where: { docType, docId },
      orderBy: [{ cycle: 'desc' }],
      include: REQUEST_INCLUDE,
    });
    return buildRequestDtos(prisma, rows, callerId);
  },
};
