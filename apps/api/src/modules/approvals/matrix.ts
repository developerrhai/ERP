// The approval matrix (docs/phases/PHASE-05.md §3 rules 1-3, §6 Matrix): rule sets and their levels,
// the "most specific set wins as a whole" resolver, the level picker, the validated whole-set
// replace, delete and the preview. The matrix is read when a request is SUBMITTED; the request then
// keeps its own copy (steps), so later edits never touch requests in flight.
import { Prisma } from '@prisma/client';
import type { ApprovalRule, ApprovalRuleSet } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { pageInfo } from '../../core/registry';
import { ApprovalErrors } from './errors';
import { eligibleApprovers } from './pool';

export type RuleSetWithRules = ApprovalRuleSet & { rules: ApprovalRule[] };

/** The set that applies: dept+doctype+unit > dept+doctype > dept+unit > dept. Inactive sets are skipped. */
export async function resolveRuleSet(
  tx: Db,
  departmentId: string,
  docType: string,
  unitId: string,
): Promise<RuleSetWithRules | null> {
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const sets = await tx.approvalRuleSet.findMany({
    where: {
      departmentId,
      active: true,
      AND: [{ OR: [{ docType }, { docType: null }] }, { OR: [{ unitId }, { unitId: null }] }],
    },
    include: { rules: { orderBy: { level: 'asc' } } },
  });
  const score = (s: ApprovalRuleSet) => (s.docType ? 2 : 0) + (s.unitId ? 1 : 0);
  sets.sort((a, b) => score(b) - score(a));
  return sets[0] ?? null;
}

/** Levels that apply: with no amount the first `noAmountLevels`, else every level with threshold <= amount. */
export function applicableRules<T extends { level: number; threshold: Prisma.Decimal }>(
  rules: readonly T[],
  amount: Prisma.Decimal | string | number | null,
  noAmountLevels: number,
): T[] {
  const ordered = [...rules].sort((a, b) => a.level - b.level);
  if (amount === null) return ordered.filter((r) => r.level <= noAmountLevels);
  const value = new Prisma.Decimal(amount);
  const hit = ordered.filter((r) => r.threshold.lte(value));
  return hit.length > 0 ? hit : ordered.slice(0, 1);
}

export interface LevelInput {
  level: number;
  threshold: number | string;
  approverRoleId?: string | null;
  approverUserId?: string | null;
  slaHours: number;
  escalateRoleId?: string | null;
  escalateUserId?: string | null;
}

export interface SetInput {
  id?: string;
  version?: number;
  department: string;
  docType?: string | null;
  unitId?: string | null;
  noAmountLevels: number;
  active?: boolean;
  levels: LevelInput[];
}

/** The four validations of §8, in the order the dialog shows them. Pure, no database. */
export function validateLevels(
  levels: readonly LevelInput[],
  userNames: ReadonlyMap<string, string>,
): void {
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  sorted.forEach((l, i) => {
    if (l.level !== i + 1) throw ApprovalErrors.matrixLevelGap(i + 1);
  });
  const first = sorted[0];
  if (!first || new Prisma.Decimal(first.threshold).gt(0)) {
    throw ApprovalErrors.matrixFirstThreshold();
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && !new Prisma.Decimal(cur.threshold).gt(new Prisma.Decimal(prev.threshold))) {
      throw ApprovalErrors.matrixThresholdOrder(cur.level, prev.threshold);
    }
  }
  for (const l of sorted) {
    if (Boolean(l.approverRoleId) === Boolean(l.approverUserId)) {
      throw ApprovalErrors.matrixApproverRequired(l.level);
    }
  }
  const seen = new Set<string>();
  for (const l of sorted) {
    if (!l.approverUserId) continue;
    if (seen.has(l.approverUserId)) {
      throw ApprovalErrors.matrixSameUser(userNames.get(l.approverUserId) ?? 'This user', l.level);
    }
    seen.add(l.approverUserId);
  }
}

export interface RuleDto {
  level: number;
  threshold: string;
  approverRoleId: string | null;
  approverRoleName: string | null;
  approverUserId: string | null;
  approverUserName: string | null;
  slaHours: number;
  escalateRoleId: string | null;
  escalateRoleName: string | null;
  escalateUserId: string | null;
  escalateUserName: string | null;
}

export interface RuleSetDto {
  id: string;
  department: string;
  departmentId: string;
  docType: string | null;
  docTitle: string | null;
  unitId: string | null;
  unitCode: string | null;
  noAmountLevels: number;
  active: boolean;
  version: number;
  isDefault: boolean;
  levels: RuleDto[];
}

async function toDtos(sets: readonly RuleSetWithRules[]): Promise<RuleSetDto[]> {
  const roleIds = new Set<string>();
  const userIds = new Set<string>();
  for (const s of sets) {
    for (const r of s.rules) {
      for (const id of [r.approverRoleId, r.escalateRoleId]) if (id) roleIds.add(id);
      for (const id of [r.approverUserId, r.escalateUserId]) if (id) userIds.add(id);
    }
  }
  const [roles, users, departments, units] = await Promise.all([
    prisma.role.findMany({ where: { id: { in: [...roleIds] } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }),
    prisma.department.findMany({
      where: { id: { in: [...new Set(sets.map((s) => s.departmentId))] } },
      select: { id: true, name: true },
    }),
    prisma.unit.findMany({
      where: { id: { in: sets.map((s) => s.unitId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, code: true },
    }),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const unitCode = new Map(units.map((u) => [u.id, u.code]));
  return sets.map((s) => ({
    id: s.id,
    department: deptName.get(s.departmentId) ?? '',
    departmentId: s.departmentId,
    docType: s.docType,
    docTitle: s.docType ? (pageInfo(s.docType)?.title ?? s.docType) : null,
    unitId: s.unitId,
    unitCode: s.unitId ? (unitCode.get(s.unitId) ?? null) : null,
    noAmountLevels: s.noAmountLevels,
    active: s.active,
    version: s.version,
    isDefault: s.docType === null && s.unitId === null,
    levels: s.rules.map((r) => ({
      level: r.level,
      threshold: r.threshold.toString(),
      approverRoleId: r.approverRoleId,
      approverRoleName: r.approverRoleId ? (roleName.get(r.approverRoleId) ?? null) : null,
      approverUserId: r.approverUserId,
      approverUserName: r.approverUserId ? (userName.get(r.approverUserId) ?? null) : null,
      slaHours: r.slaHours,
      escalateRoleId: r.escalateRoleId,
      escalateRoleName: r.escalateRoleId ? (roleName.get(r.escalateRoleId) ?? null) : null,
      escalateUserId: r.escalateUserId,
      escalateUserName: r.escalateUserId ? (userName.get(r.escalateUserId) ?? null) : null,
    })),
  }));
}

async function departmentByName(name: string) {
  const dept = await prisma.department.findUnique({ where: { name } });
  if (!dept) throw Errors.validation({ department: 'Choose a department from the list.' });
  return dept;
}

function auditShape(dto: RuleSetDto | null): Prisma.InputJsonObject {
  if (!dto) return {};
  return {
    department: dto.department,
    docType: dto.docType,
    unitId: dto.unitId,
    noAmountLevels: dto.noAmountLevels,
    active: dto.active,
    levels: dto.levels.map((l) => ({
      level: l.level,
      threshold: l.threshold,
      approver: l.approverRoleName ?? l.approverUserName,
      slaHours: l.slaHours,
      escalateTo: l.escalateRoleName ?? l.escalateUserName,
    })),
  };
}

export const matrixService = {
  async list(filter: {
    department?: string;
    docType?: string;
    unitId?: string;
  }): Promise<RuleSetDto[]> {
    const where: Prisma.ApprovalRuleSetWhereInput = {};
    if (filter.department) {
      const dept = await prisma.department.findUnique({ where: { name: filter.department } });
      where.departmentId = dept?.id ?? '00000000-0000-0000-0000-000000000000';
    }
    // "ALL" = only the sets that cover every document / every unit.
    if (filter.docType) where.docType = filter.docType === 'ALL' ? null : filter.docType;
    if (filter.unitId) where.unitId = filter.unitId === 'ALL' ? null : filter.unitId;
    const sets = await prisma.approvalRuleSet.findMany({
      take: 500, // unpaginated: small lookup, max 500
      where,
      include: { rules: { orderBy: { level: 'asc' } } },
    });
    const dtos = await toDtos(sets);
    return dtos.sort(
      (a, b) =>
        a.department.localeCompare(b.department) ||
        (a.docType ?? '').localeCompare(b.docType ?? '') ||
        (a.unitCode ?? '').localeCompare(b.unitCode ?? ''),
    );
  },

  async save(
    auth: AuthContext,
    meta: RequestMeta,
    input: SetInput,
  ): Promise<{ set: RuleSetDto; created: boolean }> {
    const dept = await departmentByName(input.department);
    const docType = input.docType ?? null;
    if (docType !== null && !pageInfo(docType)) {
      throw Errors.validation({ docType: 'Choose a document type from the list.' });
    }
    const unitId = input.unitId ?? null;
    if (unitId) {
      const unit = await prisma.unit.findUnique({ where: { id: unitId } });
      if (!unit) throw Errors.validation({ unitId: 'Choose a unit from the list.' });
    }
    const userIds = [
      ...new Set(
        input.levels.flatMap((l) =>
          [l.approverUserId, l.escalateUserId].filter((x): x is string => Boolean(x)),
        ),
      ),
    ];
    const roleIds = [
      ...new Set(
        input.levels.flatMap((l) =>
          [l.approverRoleId, l.escalateRoleId].filter((x): x is string => Boolean(x)),
        ),
      ),
    ];
    const [users, roles] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } }),
    ]);
    validateLevels(input.levels, new Map(users.map((u) => [u.id, u.name])));
    if (users.length !== userIds.length || roles.length !== roleIds.length) {
      throw Errors.validation({ levels: 'Choose roles and users from the lists.' });
    }
    if (input.noAmountLevels > input.levels.length) {
      throw Errors.validation({
        noAmountLevels: `Choose 1 to ${input.levels.length}: there are only ${input.levels.length} levels.`,
      });
    }

    try {
      return await prisma.$transaction(
        async (tx) => {
          let before: RuleSetDto | null = null;
          let setId: string;
          let created = false;
          if (input.id) {
            const locked = await tx.$queryRaw<{ id: string; version: number }[]>`
              SELECT id, version FROM approval_rule_sets WHERE id = ${input.id}::uuid FOR UPDATE`;
            const row = locked[0];
            if (!row) throw Errors.notFound('Rule set not found.');
            if (input.version !== undefined && input.version !== row.version) {
              throw Errors.versionConflict();
            }
            const current = await tx.approvalRuleSet.findUniqueOrThrow({
              where: { id: input.id },
              include: { rules: { orderBy: { level: 'asc' } } },
            });
            if (
              current.departmentId !== dept.id ||
              current.docType !== docType ||
              current.unitId !== unitId
            ) {
              throw Errors.validation({
                department:
                  'The department, document and unit of an existing set cannot change. Add a new set instead.',
              });
            }
            before = (await toDtos([current]))[0] ?? null;
            await tx.approvalRule.deleteMany({ where: { ruleSetId: input.id } });
            await tx.approvalRuleSet.update({
              where: { id: input.id },
              data: {
                noAmountLevels: input.noAmountLevels,
                active: input.active ?? current.active,
                version: { increment: 1 },
                updatedAt: new Date(),
                updatedById: auth.userId,
              },
            });
            setId = input.id;
          } else {
            const existing = await tx.approvalRuleSet.findFirst({
              where: { departmentId: dept.id, docType, unitId },
            });
            if (existing) throw ApprovalErrors.matrixDuplicateSet();
            const made = await tx.approvalRuleSet.create({
              data: {
                departmentId: dept.id,
                docType,
                unitId,
                noAmountLevels: input.noAmountLevels,
                active: input.active ?? true,
                createdById: auth.userId,
                updatedById: auth.userId,
              },
            });
            setId = made.id;
            created = true;
          }
          await tx.approvalRule.createMany({
            data: input.levels.map((l) => ({
              ruleSetId: setId,
              level: l.level,
              threshold: new Prisma.Decimal(l.threshold),
              approverRoleId: l.approverRoleId ?? null,
              approverUserId: l.approverUserId ?? null,
              slaHours: l.slaHours,
              escalateRoleId: l.escalateRoleId ?? null,
              escalateUserId: l.escalateUserId ?? null,
            })),
          });
          const saved = await tx.approvalRuleSet.findUniqueOrThrow({
            where: { id: setId },
            include: { rules: { orderBy: { level: 'asc' } } },
          });
          const dto = (await toDtos([saved]))[0] as RuleSetDto;
          await recordAudit(
            {
              action: 'APPROVAL_MATRIX_CHANGED',
              actorId: auth.userId,
              targetType: 'ApprovalRuleSet',
              targetId: setId,
              meta,
              detail: { before: auditShape(before), after: auditShape(dto) },
            },
            tx,
          );
          return { set: dto, created };
        },
        { maxWait: 15_000, timeout: 15_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ApprovalErrors.matrixDuplicateSet();
      }
      if (err instanceof AppError) throw err;
      throw err;
    }
  },

  async remove(auth: AuthContext, meta: RequestMeta, id: string): Promise<void> {
    const set = await prisma.approvalRuleSet.findUnique({
      where: { id },
      include: { rules: { orderBy: { level: 'asc' } } },
    });
    if (!set) throw Errors.notFound('Rule set not found.');
    if (set.docType === null && set.unitId === null) {
      throw Errors.protectedResource(
        'The default rule set of a department cannot be deleted. Edit it instead.',
      );
    }
    const before = (await toDtos([set]))[0] ?? null;
    await prisma.$transaction(async (tx) => {
      await tx.approvalRuleSet.delete({ where: { id } });
      await recordAudit(
        {
          action: 'APPROVAL_MATRIX_CHANGED',
          actorId: auth.userId,
          targetType: 'ApprovalRuleSet',
          targetId: id,
          meta,
          detail: { before: auditShape(before), after: {}, deleted: true },
        },
        tx,
      );
    });
  },

  /** What would happen for a document: the chosen set, the levels and who could approve (by name). */
  async preview(input: {
    department: string;
    docType?: string | undefined;
    unitId?: string | undefined;
    amount?: number | string | null | undefined;
  }) {
    const dept = await departmentByName(input.department);
    const unit = input.unitId
      ? await prisma.unit.findUnique({ where: { id: input.unitId } })
      : await prisma.unit.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!unit) throw Errors.validation({ unitId: 'Choose a unit from the list.' });
    const docType = input.docType ?? '';
    const set = await resolveRuleSet(prisma, dept.id, docType, unit.id);
    if (!set) {
      return { set: null, department: dept.name, amount: input.amount ?? null, levels: [] };
    }
    const amount =
      input.amount === undefined || input.amount === null || input.amount === ''
        ? null
        : new Prisma.Decimal(input.amount);
    const picked = applicableRules(set.rules, amount, set.noAmountLevels);
    const dto = (await toDtos([set]))[0] as RuleSetDto;
    const levels = [];
    for (const rule of picked) {
      const approvers = await eligibleApprovers(prisma, {
        approverRoleId: rule.approverRoleId,
        approverUserId: rule.approverUserId,
        docType,
        unitId: unit.id,
        department: dept.name,
        exclude: new Set(),
      });
      const info = dto.levels.find((l) => l.level === rule.level) as RuleDto;
      levels.push({
        level: rule.level,
        threshold: rule.threshold.toString(),
        approver: info.approverRoleName ?? info.approverUserName,
        slaHours: rule.slaHours,
        approvers: approvers.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.roleName,
          limit: a.approvalLimit?.toString() ?? null,
        })),
      });
    }
    return {
      set: { id: set.id, docType: set.docType, unitId: set.unitId, version: set.version },
      department: dept.name,
      amount: amount?.toString() ?? null,
      levels,
    };
  },
};
