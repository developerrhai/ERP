// Read model of an approval request: the request, its steps with the people behind them, the
// timeline of actions (the "approval journey") and what the CALLER may do right now. The buttons in
// the web are drawn from `can`, and the service re-checks every rule when the action arrives.
import type {
  ApprovalAction,
  ApprovalRequest,
  ApprovalStep,
  ApprovalStepAssignee,
} from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { pageInfo } from '../../core/registry';
import { istDate } from './errors';

type StepWithAssignees = ApprovalStep & { assignees: ApprovalStepAssignee[] };
export type RequestFull = ApprovalRequest & {
  steps: StepWithAssignees[];
  actions: ApprovalAction[];
};

export interface PersonDto {
  id: string;
  name: string;
}

export interface StepDto {
  id: string;
  level: number;
  status: string;
  threshold: string;
  approver: string;
  limitRequired: string | null;
  slaHours: number;
  activatedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  escalatedAt: string | null;
  assignees: { id: string; name: string; via: string; onBehalfOf: string | null }[];
  actedBy: PersonDto | null;
  onBehalfOf: PersonDto | null;
  actedAt: string | null;
  comment: string | null;
}

export interface TimelineDto {
  id: string;
  action: string;
  level: number | null;
  actor: PersonDto | null;
  onBehalfOf: PersonDto | null;
  comment: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  at: string;
}

export interface RequestDto {
  id: string;
  docType: string;
  moduleTitle: string;
  docId: string;
  docCode: string;
  docTitle: string;
  unitId: string;
  department: string;
  amount: string | null;
  cycle: number;
  status: string;
  currentLevel: number;
  totalLevels: number;
  requestedBy: PersonDto;
  requestedAt: string;
  decidedAt: string | null;
  version: number;
  waitingOn: string | null;
  dueAt: string | null;
  overdue: boolean;
  steps: StepDto[];
  timeline: TimelineDto[];
  can: { approve: boolean; reject: boolean; return: boolean; withdraw: boolean };
}

export const REQUEST_INCLUDE = {
  steps: { include: { assignees: true }, orderBy: { level: 'asc' as const } },
  actions: { orderBy: [{ at: 'asc' as const }, { id: 'asc' as const }] },
};

interface Names {
  users: Map<string, string>;
  roles: Map<string, string>;
  departments: Map<string, string>;
}

async function loadNames(db: Db, requests: readonly RequestFull[]): Promise<Names> {
  const userIds = new Set<string>();
  const roleIds = new Set<string>();
  const deptIds = new Set<string>();
  for (const r of requests) {
    userIds.add(r.requestedBy);
    deptIds.add(r.departmentId);
    for (const s of r.steps) {
      for (const id of [s.approverUserId, s.actedBy, s.onBehalfOf]) if (id) userIds.add(id);
      if (s.approverRoleId) roleIds.add(s.approverRoleId);
      for (const a of s.assignees) {
        userIds.add(a.userId);
        if (a.onBehalfOf) userIds.add(a.onBehalfOf);
      }
    }
    for (const a of r.actions) {
      for (const id of [a.actorId, a.onBehalfOf]) if (id) userIds.add(id);
    }
  }
  const [users, roles, departments] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }),
    db.role.findMany({ where: { id: { in: [...roleIds] } }, select: { id: true, name: true } }),
    db.department.findMany({
      where: { id: { in: [...deptIds] } },
      select: { id: true, name: true },
    }),
  ]);
  return {
    users: new Map(users.map((u) => [u.id, u.name])),
    roles: new Map(roles.map((r) => [r.id, r.name])),
    departments: new Map(departments.map((d) => [d.id, d.name])),
  };
}

/** Delegations that let `userId` act today: delegator id -> department id the delegation is limited to (or null). */
async function validDelegations(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ fromUserId: string; departmentId: string | null }[]> {
  const today = new Date(`${istDate(now)}T00:00:00Z`);
  return db.approvalDelegation.findMany({
    where: { toUserId: userId, status: 'ACTIVE', fromDate: { lte: today }, toDate: { gte: today } },
    select: { fromUserId: true, departmentId: true },
  });
}

export async function buildRequestDtos(
  db: Db,
  requests: readonly RequestFull[],
  callerId: string,
  now: Date = new Date(),
): Promise<RequestDto[]> {
  if (requests.length === 0) return [];
  const names = await loadNames(db, requests);
  const delegations = await validDelegations(db, callerId, now);
  const who = (id: string | null): PersonDto | null =>
    id ? { id, name: names.users.get(id) ?? 'Unknown user' } : null;

  return requests.map((r) => {
    const levelOf = new Map(r.steps.map((s) => [s.id, s.level]));
    const approverLabel = (s: ApprovalStep): string =>
      s.approverRoleId
        ? (names.roles.get(s.approverRoleId) ?? 'Role')
        : s.approverUserId
          ? (names.users.get(s.approverUserId) ?? 'User')
          : 'Approver';
    const steps: StepDto[] = r.steps.map((s) => ({
      id: s.id,
      level: s.level,
      status: s.status,
      threshold: s.threshold.toString(),
      approver: approverLabel(s),
      limitRequired: s.limitRequired?.toString() ?? null,
      slaHours: s.slaHours,
      activatedAt: s.activatedAt?.toISOString() ?? null,
      dueAt: s.dueAt?.toISOString() ?? null,
      overdue: s.status === 'PENDING' && s.dueAt !== null && s.dueAt.getTime() < now.getTime(),
      escalatedAt: s.escalatedAt?.toISOString() ?? null,
      assignees: s.assignees.map((a) => ({
        id: a.userId,
        name: names.users.get(a.userId) ?? 'Unknown user',
        via: a.via,
        onBehalfOf: a.onBehalfOf ? (names.users.get(a.onBehalfOf) ?? null) : null,
      })),
      actedBy: who(s.actedBy),
      onBehalfOf: who(s.onBehalfOf),
      actedAt: s.actedAt?.toISOString() ?? null,
      comment: s.comment,
    }));
    const current =
      r.status === 'PENDING' ? r.steps.find((s) => s.status === 'PENDING') : undefined;

    const can = { approve: false, reject: false, return: false, withdraw: false };
    if (r.status === 'PENDING') {
      can.withdraw = r.requestedBy === callerId;
      const mine = current?.assignees.find((a) => a.userId === callerId);
      const selfBlocked = r.requestedBy === callerId || r.createdById === callerId;
      if (current && mine && !selfBlocked) {
        const live =
          mine.via !== 'DELEGATION' ||
          delegations.some(
            (d) =>
              d.fromUserId === mine.onBehalfOf &&
              (d.departmentId === null || d.departmentId === r.departmentId),
          );
        if (live) {
          can.reject = true;
          can.return = true;
          const actors = new Set<string>([callerId]);
          if (mine.onBehalfOf) actors.add(mine.onBehalfOf);
          const approvedBefore = r.actions.some(
            (a) =>
              a.action === 'APPROVE' &&
              ((a.actorId && actors.has(a.actorId)) || (a.onBehalfOf && actors.has(a.onBehalfOf))),
          );
          can.approve = !approvedBefore;
        }
      }
    }

    return {
      id: r.id,
      docType: r.docType,
      moduleTitle: pageInfo(r.docType)?.title ?? r.docType,
      docId: r.docId,
      docCode: r.docCode,
      docTitle: r.docTitle,
      unitId: r.unitId,
      department: names.departments.get(r.departmentId) ?? '',
      amount: r.amount?.toString() ?? null,
      cycle: r.cycle,
      status: r.status,
      currentLevel: r.currentLevel,
      totalLevels: r.totalLevels,
      requestedBy: who(r.requestedBy) as PersonDto,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      version: r.version,
      waitingOn: current
        ? current.assignees.length > 0
          ? current.assignees
              .map((a) => names.users.get(a.userId) ?? 'Unknown user')
              .slice(0, 3)
              .join(', ') +
            (current.assignees.length > 3 ? ` +${current.assignees.length - 3}` : '')
          : approverLabel(current)
        : null,
      dueAt: current?.dueAt?.toISOString() ?? null,
      overdue: Boolean(current?.dueAt && current.dueAt.getTime() < now.getTime()),
      steps,
      timeline: r.actions.map((a) => ({
        id: a.id,
        action: a.action,
        level: a.stepId ? (levelOf.get(a.stepId) ?? null) : null,
        actor: who(a.actorId),
        onBehalfOf: who(a.onBehalfOf),
        comment: a.comment,
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        at: a.at.toISOString(),
      })),
      can,
    };
  });
}

export async function loadRequestFull(db: Db, id: string): Promise<RequestFull | null> {
  return db.approvalRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
}

export async function requestView(
  callerId: string,
  id: string,
  db: Db = prisma,
): Promise<RequestDto | null> {
  const full = await loadRequestFull(db, id);
  if (!full) return null;
  return (await buildRequestDtos(db, [full], callerId))[0] ?? null;
}
