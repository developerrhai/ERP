// User management business rules (Phase 02 §5, §6, §8):
// Role from DB (roleId), level hierarchy, self-escalation bans, approval limits,
// extra departments (user_departments), last active Super User protection, and effective access.
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { checkPasswordPolicy, hashPassword } from '../../core/auth/password';
import { getSecurityPolicy } from '../../core/auth/security-policy';
import { isSessionLive, sessionRepository } from '../../core/auth/session-repository';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import { accessUserOf, explain, invalidateAccessCache, loadAccessData } from '../../core/rbac/access';
import { assertCanManage } from '../../core/rbac/authorize';
import { registry } from '../../core/registry';
import { roleRepository } from '../roles/repository';
import { unitRepository } from '../units/repository';
import { toUserDto } from './dto';
import type { UserDto, UserWithRelations } from './dto';
import { userRepository } from './repository';
import type {
  CreateUserInput,
  ListUsersQuery,
  ResetPasswordInput,
  UpdateUserInput,
} from './schemas';

const DUPLICATE_LOGIN_ID = 'This login ID is already in use.';
const DUPLICATE_EMAIL = 'This email is already in use.';

async function assertNoCollisions(
  values: { loginId?: string; email?: string | null },
  excludeId?: string,
): Promise<void> {
  const collisions = await userRepository.findCollisions(values, excludeId);
  if (collisions.length === 0) return;
  const fields: FieldErrors = {};
  for (const other of collisions) {
    if (values.loginId && (other.loginId === values.loginId || other.email === values.loginId)) {
      fields.loginId = DUPLICATE_LOGIN_ID;
    }
    if (values.email && (other.email === values.email || other.loginId === values.email)) {
      fields.email = DUPLICATE_EMAIL;
    }
  }
  throw Errors.duplicate(fields);
}

export async function toDuplicateError(
  err: unknown,
  values: { loginId?: string; email?: string | null },
  excludeId?: string,
): Promise<unknown> {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
    if (/unit/i.test(JSON.stringify(err.meta ?? ''))) {
      return Errors.validation({ unitIds: 'Choose from the listed units.' });
    }
    return Errors.validation({ department: 'Choose one of the listed departments.' });
  }
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return err;
  const target = JSON.stringify(err.meta?.target ?? '');
  if (/role/i.test(target)) return Errors.forbidden('Only one Super User can exist.');
  const fields: FieldErrors = {};
  if (/login/i.test(target)) fields.loginId = DUPLICATE_LOGIN_ID;
  if (/email/i.test(target)) fields.email = DUPLICATE_EMAIL;
  if (Object.keys(fields).length === 0) {
    try {
      await assertNoCollisions(values, excludeId);
    } catch (duplicate) {
      return duplicate;
    }
    if (values.loginId) fields.loginId = DUPLICATE_LOGIN_ID;
    if (values.email) fields.email = DUPLICATE_EMAIL;
  }
  return Errors.duplicate(fields);
}

function assertPasswordPolicy(
  password: string,
  identity: { loginId: string; email: string | null },
  field: string,
): void {
  const problem = checkPasswordPolicy(password, identity);
  if (problem) throw Errors.validation({ [field]: problem });
}

async function assertActiveDepartment(name: string): Promise<void> {
  const department = await prisma.department.findUnique({ where: { name } });
  if (!department || department.status !== 'ACTIVE') {
    throw Errors.validation({ department: 'Choose one of the listed departments.' });
  }
}

async function assertActiveExtraDepartments(
  departments: readonly string[],
  homeDepartment: string | null,
): Promise<void> {
  if (departments.length > 10) {
    throw Errors.validation({ extraDepartments: 'Up to 10 extra departments.' });
  }
  if (homeDepartment && departments.includes(homeDepartment)) {
    throw Errors.validation({
      extraDepartments: 'Choose departments other than the home department.',
    });
  }
  if (departments.length === 0) return;

  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const found = await prisma.department.findMany({
    where: { name: { in: [...departments] }, status: 'ACTIVE' },
    select: { name: true },
  });
  if (found.length !== departments.length) {
    throw Errors.validation({
      extraDepartments: 'Choose departments other than the home department.',
    });
  }
}

const LEGACY_ROLE_MAP: Record<string, string> = {
  SUPER_ADMIN: 'SUPER_USER',
  ADMIN: 'ADMINISTRATOR',
  MANAGER: 'DEPT_MANAGER',
  LEAD: 'SUPERVISOR',
  MEMBER: 'EMPLOYEE',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveRole(input: { roleId?: string; role?: string }): Promise<Role> {
  let role: Role | null = null;
  if (input.roleId) {
    role = await roleRepository.findById(input.roleId);
  } else if (input.role) {
    const code = LEGACY_ROLE_MAP[input.role] ?? input.role;
    role = await roleRepository.findByCode(code);
    if (!role && UUID_REGEX.test(code)) {
      role = await roleRepository.findById(code);
    }
  }
  if (!role || role.status !== 'ACTIVE') {
    const field = input.roleId ? 'roleId' : 'role';
    throw Errors.validation({ [field]: 'Choose one of the listed roles.' });
  }
  return role;
}

async function loadTarget(id: string): Promise<UserWithRelations> {
  const user = await userRepository.findWithRelations(id);
  if (!user) throw Errors.notFound('User not found.');
  return user;
}

interface UnitAssignment {
  unitIds: string[];
  defaultUnitId: string | null;
  unitsChanged: boolean;
  defaultChanged: boolean;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

async function resolveUnits(
  allUnits: boolean,
  input: { unitIds?: string[]; defaultUnitId?: string | null },
  current: { unitIds: string[]; defaultUnitId: string | null },
): Promise<UnitAssignment> {
  const finalIds = input.unitIds ?? current.unitIds;
  const toCheck = new Set<string>(input.unitIds ?? []);
  if (input.defaultUnitId) toCheck.add(input.defaultUnitId);
  const found = new Map((await unitRepository.findByIds([...toCheck])).map((u) => [u.id, u]));
  const fields: FieldErrors = {};

  for (const id of input.unitIds ?? []) {
    const unit = found.get(id);
    if (!unit) {
      fields.unitIds = 'Choose from the listed units.';
      break;
    }
    if (unit.status !== 'ACTIVE' && !current.unitIds.includes(id)) {
      fields.unitIds = `Unit ${unit.code} is inactive.`;
      break;
    }
  }

  if (!allUnits && finalIds.length === 0) {
    fields.unitIds ??= 'Choose at least one unit.';
  }

  const explicitDefault = input.defaultUnitId !== undefined;
  let defaultUnitId = explicitDefault ? (input.defaultUnitId ?? null) : current.defaultUnitId;
  if (defaultUnitId) {
    const mustBeAssigned = !allUnits || finalIds.length > 0;
    if (mustBeAssigned && !finalIds.includes(defaultUnitId)) {
      if (explicitDefault) {
        fields.defaultUnitId = "The default unit must be one of the user's units.";
      } else {
        defaultUnitId = null;
      }
    } else if (explicitDefault && defaultUnitId !== current.defaultUnitId) {
      const unit = found.get(defaultUnitId);
      if (!unit) fields.defaultUnitId = 'Choose one of the listed units.';
      else if (unit.status !== 'ACTIVE') fields.defaultUnitId = `Unit ${unit.code} is inactive.`;
    }
  }

  if (Object.keys(fields).length > 0) throw Errors.validation(fields);

  return {
    unitIds: finalIds,
    defaultUnitId,
    unitsChanged: input.unitIds !== undefined && !sameSet(finalIds, current.unitIds),
    defaultChanged: defaultUnitId !== current.defaultUnitId,
  };
}

export const userService = {
  async list(query: ListUsersQuery): Promise<{ users: UserDto[]; total: number }> {
    const { users, total } = await userRepository.list(query);
    return { users: users.map((u) => toUserDto(u)), total };
  },

  async get(id: string): Promise<UserDto> {
    return toUserDto(await loadTarget(id));
  },

  async create(actor: AuthContext, input: CreateUserInput, meta: RequestMeta): Promise<UserDto> {
    const targetRole = await resolveRole(input);

    if (targetRole.level >= actor.level) {
      throw Errors.forbidden('You can only manage users below your own role.');
    }

    const department = input.department ?? null;
    if (targetRole.code !== 'SUPER_USER' && (!department || department.trim() === '')) {
      throw Errors.validation({ department: 'Department is required.' });
    }
    if (department) {
      await assertActiveDepartment(department);
    }

    const extraDepartments = input.extraDepartments ?? [];
    await assertActiveExtraDepartments(extraDepartments, department);

    let approvalLimit: Prisma.Decimal | null = null;
    if (targetRole.code === 'SUPER_USER') {
      approvalLimit = null;
    } else {
      if (input.approvalLimit === null || input.approvalLimit === '') {
        throw Errors.validation({ approvalLimit: 'Only a Super User can have no limit.' });
      }
      approvalLimit = new Prisma.Decimal(input.approvalLimit ?? '0');
    }

    const units = await resolveUnits(
      targetRole.allUnits,
      { unitIds: input.unitIds, defaultUnitId: input.defaultUnitId },
      { unitIds: [], defaultUnitId: null },
    );

    const email = input.email ?? null;
    assertPasswordPolicy(
      input.temporaryPassword,
      { loginId: input.loginId, email },
      'temporaryPassword',
    );
    await assertNoCollisions({ loginId: input.loginId, email });

    const passwordHash = await hashPassword(input.temporaryPassword);

    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            loginId: input.loginId,
            email,
            name: input.name,
            roleId: targetRole.id,
            department,
            approvalLimit,
            passwordHash,
            mustChangePassword: true,
            createdById: actor.userId,
            defaultUnitId: units.defaultUnitId,
            units: { create: units.unitIds.map((unitId) => ({ unitId })) },
          },
        });

        if (extraDepartments.length > 0) {
          await tx.userDepartment.createMany({
            data: extraDepartments.map((departmentName) => ({
              userId: created.id,
              departmentName,
              createdById: actor.userId,
            })),
          });
        }

        await recordAudit(
          {
            action: 'USER_CREATED',
            actorId: actor.userId,
            targetType: 'User',
            targetId: created.id,
            ip: meta.ip,
            userAgent: meta.userAgent,
            detail: {
              loginId: created.loginId,
              email: created.email,
              name: created.name,
              roleId: created.roleId,
              roleCode: targetRole.code,
              department: created.department,
              extraDepartments,
              approvalLimit: approvalLimit ? approvalLimit.toString() : null,
              unitIds: [...units.unitIds].sort(),
              defaultUnitId: units.defaultUnitId,
            },
          },
          tx,
        );

        const fresh = await userRepository.findWithRelations(created.id, tx);
        if (!fresh) throw Errors.notFound('User not found.');
        return fresh;
      });

      invalidateAccessCache();
      return toUserDto(user);
    } catch (err) {
      throw await toDuplicateError(err, { loginId: input.loginId, email });
    }
  },

  async update(
    actor: AuthContext,
    id: string,
    expectedVersion: number,
    input: UpdateUserInput,
    meta: RequestMeta,
  ): Promise<UserDto> {
    const target = await loadTarget(id);

    // Last Super User protection (§5.5, §8): refuse to deactivate the last active Super User (409)
    const isDeactivating = input.status === 'INACTIVE' && target.status !== 'INACTIVE';
    if (target.role.code === 'SUPER_USER' && isDeactivating) {
      const activeSuperUsers = await prisma.user.count({
        where: { role: { code: 'SUPER_USER' }, status: 'ACTIVE' },
      });
      if (activeSuperUsers <= 1) {
        throw Errors.protectedResource('At least one active Super User is required.');
      }
    }

    // Self-escalation guard (§5.5, §8): nobody can change their own role, departments, approval limit or status
    if (actor.userId === target.id) {
      await recordAudit({
        action: 'ACCESS_DENIED_SELF_ESCALATION',
        actorId: actor.userId,
        targetType: 'User',
        targetId: target.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          attemptedRole: input.roleId || input.role,
          attemptedDept: input.department,
          attemptedExtraDepts: input.extraDepartments,
          attemptedLimit: input.approvalLimit,
          attemptedStatus: input.status,
          attemptedName: input.name,
        },
      });
      throw Errors.forbidden(
        'You cannot change your own role, departments, approval limit or status.',
      );
    } else {
      // Cannot manage user at or above your level (except Super User on Super User)
      if (actor.level < 99 && target.role.level >= actor.level) {
        throw Errors.forbidden('You can only manage users below your own role.');
      }
    }

    let targetRole = target.role;
    let roleChanged = false;
    if (input.roleId !== undefined || input.role !== undefined) {
      const nextRole = await resolveRole(input);
      if (nextRole.id !== target.roleId) {
        if (target.role.code === 'SUPER_USER') {
          throw Errors.forbidden("Nobody changes a Super User's role, departments or limit.");
        }
        if (nextRole.code === 'SUPER_USER' || nextRole.level >= actor.level) {
          throw Errors.forbidden('You can only manage users below your own role.');
        }
        targetRole = nextRole;
        roleChanged = true;
      }
    }

    if (target.role.code === 'SUPER_USER') {
      if (
        input.department !== undefined ||
        input.extraDepartments !== undefined ||
        input.approvalLimit !== undefined
      ) {
        throw Errors.forbidden("Nobody changes a Super User's role, departments or limit.");
      }
    }

    if (expectedVersion !== target.version) {
      throw Errors.versionConflict();
    }

    const effectiveDept =
      input.department !== undefined ? input.department : target.department;

    if (targetRole.code !== 'SUPER_USER' && (!effectiveDept || effectiveDept.trim() === '')) {
      throw Errors.validation({ department: 'Department is required.' });
    }
    if (input.department && input.department !== target.department) {
      await assertActiveDepartment(input.department);
    }

    const currentExtraDepts = (target.extraDepartments ?? []).map((d) => d.departmentName);
    const extraDeptsChanged =
      input.extraDepartments !== undefined &&
      !sameSet(input.extraDepartments, currentExtraDepts);
    const finalExtraDepts = input.extraDepartments ?? currentExtraDepts;

    if (extraDeptsChanged) {
      await assertActiveExtraDepartments(finalExtraDepts, effectiveDept);
    }

    let approvalLimitChanged = false;
    let finalLimit = target.approvalLimit;
    if (input.approvalLimit !== undefined) {
      if (targetRole.code === 'SUPER_USER') {
        finalLimit = null;
      } else {
        if (input.approvalLimit === null || input.approvalLimit === '') {
          throw Errors.validation({ approvalLimit: 'Only a Super User can have no limit.' });
        }
        finalLimit = new Prisma.Decimal(input.approvalLimit);
      }
      approvalLimitChanged =
        (target.approvalLimit === null && finalLimit !== null) ||
        (target.approvalLimit !== null && finalLimit === null) ||
        (target.approvalLimit !== null &&
          finalLimit !== null &&
          !target.approvalLimit.equals(finalLimit));
    }

    if (input.email) {
      await assertNoCollisions({ email: input.email }, target.id);
    }

    const units =
      input.unitIds !== undefined || input.defaultUnitId !== undefined || roleChanged
        ? await resolveUnits(
            targetRole.allUnits,
            { unitIds: input.unitIds, defaultUnitId: input.defaultUnitId },
            {
              unitIds: target.units.map((u) => u.unit.id),
              defaultUnitId: target.defaultUnitId,
            },
          )
        : null;

    const deactivating = input.status === 'INACTIVE' && target.status !== 'INACTIVE';

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // Last Super User protection: check if active Super Users count <= 1
        if (
          target.role.code === 'SUPER_USER' &&
          (deactivating || (roleChanged && targetRole.code !== 'SUPER_USER'))
        ) {
          const activeSuperUsers = await tx.$queryRaw<{ id: string }[]>`
            SELECT u.id FROM users u
            WHERE u.role_id = (SELECT id FROM roles WHERE code = 'SUPER_USER' LIMIT 1)
              AND u.status = 'ACTIVE'
            FOR UPDATE
          `;
          if (activeSuperUsers.length <= 1) {
            throw Errors.protectedResource('At least one active Super User is required.');
          }
        }

        const data: Prisma.UserUncheckedUpdateManyInput = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.email !== undefined) data.email = input.email;
        if (input.status !== undefined) data.status = input.status;
        if (roleChanged) data.roleId = targetRole.id;
        if (input.department !== undefined) data.department = input.department;
        if (approvalLimitChanged) data.approvalLimit = finalLimit;
        if (units?.defaultChanged) data.defaultUnitId = units.defaultUnitId;

        const applied = await userRepository.updateIfVersion(
          target.id,
          expectedVersion,
          data,
          tx,
        );
        if (!applied) {
          throw Errors.versionConflict();
        }

        if (units?.unitsChanged) {
          await userRepository.replaceUnits(target.id, units.unitIds, tx);
        }

        if (extraDeptsChanged) {
          await userRepository.replaceExtraDepartments(
            target.id,
            finalExtraDepts,
            actor.userId,
            tx,
          );
        }

        const sessionsRevoked = deactivating
          ? await sessionRepository.revokeAllForUser(target.id, 'deactivated', tx)
          : 0;
        if (deactivating) {
          await tx.$executeRaw`
            UPDATE push_subscriptions SET revoked_at = now(), revoke_reason = 'DEACTIVATED'
            WHERE user_id = ${target.id}::uuid AND revoked_at IS NULL
          `;
        }

        if (roleChanged) {
          await recordAudit(
            {
              action: 'USER_ROLE_CHANGED',
              actorId: actor.userId,
              targetType: 'User',
              targetId: target.id,
              ip: meta.ip,
              userAgent: meta.userAgent,
              detail: {
                before: { roleId: target.roleId, roleCode: target.role.code },
                after: { roleId: targetRole.id, roleCode: targetRole.code },
              },
            },
            tx,
          );
        }

        if (input.department !== undefined || extraDeptsChanged) {
          await recordAudit(
            {
              action: 'USER_DEPARTMENTS_UPDATED',
              actorId: actor.userId,
              targetType: 'User',
              targetId: target.id,
              ip: meta.ip,
              userAgent: meta.userAgent,
              detail: {
                before: {
                  department: target.department,
                  extraDepartments: currentExtraDepts,
                },
                after: {
                  department: effectiveDept,
                  extraDepartments: finalExtraDepts,
                },
              },
            },
            tx,
          );
        }

        if (approvalLimitChanged) {
          await recordAudit(
            {
              action: 'USER_APPROVAL_LIMIT_CHANGED',
              actorId: actor.userId,
              targetType: 'User',
              targetId: target.id,
              ip: meta.ip,
              userAgent: meta.userAgent,
              detail: {
                before: target.approvalLimit ? target.approvalLimit.toString() : null,
                after: finalLimit ? finalLimit.toString() : null,
              },
            },
            tx,
          );
        }

        await recordAudit(
          {
            action: 'USER_UPDATED',
            actorId: actor.userId,
            targetType: 'User',
            targetId: target.id,
            ip: meta.ip,
            userAgent: meta.userAgent,
            detail: {
              sessionsRevoked: deactivating ? sessionsRevoked : undefined,
              status: input.status,
              before: {
                name: target.name,
                department: target.department,
                role: target.role.code,
                status: target.status,
              },
              after: {
                name: input.name ?? target.name,
                department: effectiveDept,
                role: targetRole.code,
                status: input.status ?? target.status,
              },
            },
          },
          tx,
        );

        const fresh = await userRepository.findWithRelations(target.id, tx);
        if (!fresh) throw Errors.notFound('User not found.');
        return fresh;
      });

      invalidateAccessCache();
      return toUserDto(updated);
    } catch (err) {
      throw await toDuplicateError(err, { email: input.email ?? null }, target.id);
    }
  },

  async effectiveAccess(
    _actor: AuthContext,
    userId: string,
    familyFilter?: string,
  ): Promise<{
    user: UserDto;
    pages: {
      pageId: string;
      title: string;
      family: string;
      actions: Record<string, boolean>;
      scope: string;
      reasons: string[];
    }[];
  }> {
    const target = await loadTarget(userId);
    const accessUser = accessUserOf({
      id: target.id,
      roleId: target.roleId,
      roleCode: target.role.code,
      level: target.role.level,
      allUnits: target.role.allUnits,
      departments: [
        target.department,
        ...(target.extraDepartments ?? []).map((d) => d.departmentName),
      ].filter((d): d is string => Boolean(d)),
    });

    const accessData = await loadAccessData(accessUser);

    const pages: {
      pageId: string;
      title: string;
      family: string;
      actions: Record<string, boolean>;
      scope: string;
      reasons: string[];
    }[] = [];

    for (const [pageId, info] of registry.pages.entries()) {
      if (familyFilter && info.family !== familyFilter) continue;
      const explained = explain(accessUser, pageId, accessData);
      pages.push({
        pageId,
        title: info.title,
        family: info.family,
        actions: explained.actions,
        scope: explained.scope,
        reasons: explained.reasons,
      });
    }

    return {
      user: toUserDto(target),
      pages,
    };
  },

  async resetPassword(
    actor: AuthContext,
    id: string,
    input: ResetPasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    if (actor.userId === id) {
      throw Errors.forbidden('You cannot reset your own password through the admin endpoint.');
    }
    const target = await loadTarget(id);
    assertCanManage(actor.level, target.role.level);
    assertPasswordPolicy(input.temporaryPassword, target, 'temporaryPassword');
    const passwordHash = await hashPassword(input.temporaryPassword);
    await prisma.$transaction(async (tx) => {
      await userRepository.update(
        target.id,
        { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
        tx,
      );
      const sessionsRevoked = await sessionRepository.revokeAllForUser(
        target.id,
        'password_reset',
        actor.userId,
        tx,
      );
      await recordAudit(
        {
          action: 'USER_PASSWORD_RESET',
          actorId: actor.userId,
          targetType: 'User',
          targetId: target.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          detail: { sessionsRevoked },
        },
        tx,
      );
    });
    invalidateAccessCache();
  },

  async listSessions(actor: AuthContext, targetId: string) {
    const target = await loadTarget(targetId);
    assertCanManage(actor.level, target.role.level);
    const sessions = await sessionRepository.listForUser(target.id);
    const policy = await getSecurityPolicy();
    const now = new Date();
    return sessions.map((s) => ({
      id: s.id,
      familyId: s.familyId,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
      revokedReason: s.revokedReason,
      isLive: isSessionLive(s, now, policy),
      mfaVerified: s.mfaVerified ?? false,
    }));
  },

  async revokeAllSessions(
    actor: AuthContext,
    targetId: string,
    meta: RequestMeta,
  ): Promise<{ revoked: number }> {
    if (actor.userId === targetId) {
      throw Errors.forbidden('Use My Account → Security for your own account.');
    }
    const target = await loadTarget(targetId);
    assertCanManage(actor.level, target.role.level);
    const count = await sessionRepository.revokeAllForUser(target.id, 'admin_revoked', actor.userId);
    await recordAudit({
      action: 'SESSIONS_REVOKED_BY_ADMIN',
      actorId: actor.userId,
      targetType: 'User',
      targetId: target.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { sessionsRevoked: count },
    });
    return { revoked: count };
  },

  async unlockUser(
    actor: AuthContext,
    targetId: string,
    meta: RequestMeta,
  ): Promise<{ unlocked: true }> {
    if (actor.userId === targetId) {
      throw Errors.forbidden('Use My Account → Security for your own account.');
    }
    const target = await loadTarget(targetId);
    assertCanManage(actor.level, target.role.level);
    const isLocked =
      (target.lockedUntil !== null && target.lockedUntil.getTime() > Date.now()) ||
      target.failedLoginCount > 0;
    if (!isLocked) {
      throw Errors.notLocked();
    }
    await userRepository.update(target.id, { failedLoginCount: 0, lockedUntil: null });
    await recordAudit({
      action: 'ACCOUNT_UNLOCKED',
      actorId: actor.userId,
      targetType: 'User',
      targetId: target.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { loginId: target.loginId },
    });
    return { unlocked: true };
  },

  async resetMfa(
    actor: AuthContext,
    targetId: string,
    meta: RequestMeta,
  ): Promise<{ reset: true }> {
    if (actor.userId === targetId) {
      throw Errors.forbidden('Use My Account → Security for your own account.');
    }
    const target = await loadTarget(targetId);
    assertCanManage(actor.level, target.role.level);
    if (target.role.level >= 95 && actor.level < 99) {
      throw Errors.forbidden('Only SUPER_ADMIN can reset two-step verification for an administrator.');
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          mfaEnabled: false,
          mfaSecretEnc: null,
          mfaPendingSecretEnc: null,
          mfaEnrolledAt: null,
          mfaLastStep: null,
        },
      });
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId: target.id } });
      const revoked = await sessionRepository.revokeAllForUser(
        target.id,
        'mfa_reset',
        actor.userId,
        tx,
      );
      await recordAudit(
        {
          action: 'MFA_RESET_BY_ADMIN',
          actorId: actor.userId,
          targetType: 'User',
          targetId: target.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          detail: { sessionsRevoked: revoked },
        },
        tx,
      );
    });
    return { reset: true };
  },
};
