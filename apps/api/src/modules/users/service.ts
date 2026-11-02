// User management business rules: the §1.2 hierarchy (via role-rules.ts), self-edit bans, optimistic
// locking, duplicate detection, session revocation on deactivate/reset, unit assignment (Phase 3:
// at least one active unit for MANAGER/LEAD/MEMBER, default unit among them), and audit rows.
import { Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { checkPasswordPolicy, hashPassword } from '../../core/auth/password';
import { sessionRepository } from '../../core/auth/session-repository';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import { invalidateAccessCache } from '../../core/rbac/access';
import { assertCanManage } from '../../core/rbac/authorize';
import { canManage } from '../../core/rbac/role-rules';
import type { RoleCode } from '../../core/rbac/role-rules';
import { hasAllUnits } from '../../core/context/context-repository';
import { unitRepository } from '../units/repository';
import { toUserDto } from './dto';
import type { UserDto, UserWithUnits } from './dto';
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

/**
 * Race fallback: a DB unique index or the namespace trigger fired after the pre-check passed. The
 * trigger's violation arrives as P2002 without a target, so the colliding field is looked up again.
 */
export async function toDuplicateError(
  err: unknown,
  values: { loginId?: string; email?: string | null },
  excludeId?: string,
): Promise<unknown> {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
    // A unit or the department vanished between the check and the write (FK violation).
    if (/unit/i.test(JSON.stringify(err.meta ?? ''))) {
      return Errors.validation({ unitIds: 'Choose from the listed units.' });
    }
    return Errors.validation({ department: 'Choose one of the listed departments.' });
  }
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return err;
  const target = JSON.stringify(err.meta?.target ?? '');
  if (/role/i.test(target)) return Errors.forbidden('Only one Super Admin can exist.');
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

/** Phase 2: the department must be an ACTIVE row in the departments table. */
async function assertActiveDepartment(name: string): Promise<void> {
  const department = await prisma.department.findUnique({ where: { name } });
  if (!department || department.status !== 'ACTIVE') {
    throw Errors.validation({ department: 'Choose one of the listed departments.' });
  }
}

async function loadTarget(id: string): Promise<UserWithUnits> {
  const user = await userRepository.findWithUnits(id);
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

/**
 * Phase 3 unit rules. MANAGER/LEAD/MEMBER need at least one unit; newly assigned units must exist
 * and be ACTIVE (an already assigned unit that was deactivated may stay). The default unit must be
 * one of the user's units; ADMIN+ without unit rows may default to any active unit. A default that
 * is no longer among the units (and was not given explicitly) is cleared.
 */
async function resolveUnits(
  role: RoleCode,
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
  if (!hasAllUnits(role) && finalIds.length === 0) {
    fields.unitIds ??= 'Choose at least one unit.';
  }
  const explicitDefault = input.defaultUnitId !== undefined;
  let defaultUnitId = explicitDefault ? (input.defaultUnitId ?? null) : current.defaultUnitId;
  if (defaultUnitId) {
    const mustBeAssigned = !hasAllUnits(role) || finalIds.length > 0;
    if (mustBeAssigned && !finalIds.includes(defaultUnitId)) {
      if (explicitDefault) {
        fields.defaultUnitId = "The default unit must be one of the user's units.";
      } else defaultUnitId = null;
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

type TrackedField = 'email' | 'name' | 'role' | 'department' | 'status';
const TRACKED_FIELDS: readonly TrackedField[] = ['email', 'name', 'role', 'department', 'status'];

export const userService = {
  async list(query: ListUsersQuery): Promise<{ users: UserDto[]; total: number }> {
    const { users, total } = await userRepository.list(query);
    return { users: users.map(toUserDto), total };
  },

  async get(id: string): Promise<UserDto> {
    return toUserDto(await loadTarget(id));
  },

  async create(actor: AuthContext, input: CreateUserInput, meta: RequestMeta): Promise<UserDto> {
    if (input.role === 'SUPER_ADMIN') throw Errors.forbidden('A Super Admin cannot be created.');
    assertCanManage(actor.role, input.role);
    const department = input.department ?? null;
    if (!department) throw Errors.validation({ department: 'Department is required.' });
    await assertActiveDepartment(department);
    const units = await resolveUnits(
      input.role,
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
        const created = await userRepository.create(
          {
            loginId: input.loginId,
            email,
            name: input.name,
            role: input.role,
            department,
            passwordHash,
            mustChangePassword: true,
            createdById: actor.userId,
            defaultUnitId: units.defaultUnitId,
            units: { create: units.unitIds.map((unitId) => ({ unitId })) },
          },
          tx,
        );
        await recordAudit(
          {
            action: 'USER_CREATED',
            actorId: actor.userId,
            targetType: 'User',
            targetId: created.id,
            meta,
            detail: {
              loginId: created.loginId,
              email: created.email,
              name: created.name,
              role: created.role,
              department: created.department,
              unitIds: [...units.unitIds].sort(),
              defaultUnitId: units.defaultUnitId,
            },
          },
          tx,
        );
        const fresh = await userRepository.findWithUnits(created.id, tx);
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
    if (actor.userId === target.id) {
      throw Errors.forbidden(
        input.role !== undefined || input.status !== undefined
          ? 'You cannot change your own role or status.'
          : 'You cannot edit your own account here.',
      );
    }
    assertCanManage(actor.role, target.role);
    if (
      input.role !== undefined &&
      input.role !== target.role &&
      !canManage(actor.role, input.role)
    ) {
      throw Errors.forbidden('You are not allowed to assign this role.');
    }
    // Fail fast on a stale version; the conditional update below still guards the race.
    if (expectedVersion !== target.version) throw Errors.versionConflict();
    if (input.department === null) {
      throw Errors.validation({ department: 'Department is required.' });
    }
    if (input.department !== undefined && input.department !== target.department) {
      await assertActiveDepartment(input.department);
    }
    if (input.email) await assertNoCollisions({ email: input.email }, target.id);
    const roleChanges = input.role !== undefined && input.role !== target.role;
    const units =
      input.unitIds !== undefined || input.defaultUnitId !== undefined || roleChanges
        ? await resolveUnits(
            input.role ?? target.role,
            { unitIds: input.unitIds, defaultUnitId: input.defaultUnitId },
            { unitIds: target.units.map((u) => u.unit.id), defaultUnitId: target.defaultUnitId },
          )
        : null;

    const before: Prisma.InputJsonObject = {};
    const after: Prisma.InputJsonObject = {};
    const data: Prisma.UserUncheckedUpdateManyInput = {};
    for (const field of TRACKED_FIELDS) {
      const next = input[field];
      if (next === undefined || next === target[field]) continue;
      Object.assign(before, { [field]: target[field] });
      Object.assign(after, { [field]: next });
      Object.assign(data, { [field]: next });
    }
    if (units?.unitsChanged) {
      // Sorted so the audit entry is deterministic (the DB returns unit rows in no fixed order).
      Object.assign(before, { unitIds: target.units.map((u) => u.unit.id).sort() });
      Object.assign(after, { unitIds: [...units.unitIds].sort() });
    }
    if (units?.defaultChanged) {
      Object.assign(before, { defaultUnitId: target.defaultUnitId });
      Object.assign(after, { defaultUnitId: units.defaultUnitId });
      data.defaultUnitId = units.defaultUnitId;
    }
    const deactivating = input.status === 'INACTIVE' && target.status !== 'INACTIVE';

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const applied = await userRepository.updateIfVersion(
          target.id,
          expectedVersion,
          target.role,
          data,
          tx,
        );
        if (!applied) throw Errors.versionConflict();
        if (units?.unitsChanged) await userRepository.replaceUnits(target.id, units.unitIds, tx);
        const sessionsRevoked = deactivating
          ? await sessionRepository.revokeAllForUser(target.id, 'deactivated', tx)
          : 0;
        await recordAudit(
          {
            action: 'USER_UPDATED',
            actorId: actor.userId,
            targetType: 'User',
            targetId: target.id,
            meta,
            detail: { before, after, ...(deactivating ? { sessionsRevoked } : {}) },
          },
          tx,
        );
        const fresh = await userRepository.findWithUnits(target.id, tx);
        if (!fresh) throw Errors.notFound('User not found.');
        return fresh;
      });
      invalidateAccessCache();
      return toUserDto(updated);
    } catch (err) {
      throw await toDuplicateError(err, { email: input.email ?? null }, target.id);
    }
  },

  async resetPassword(
    actor: AuthContext,
    id: string,
    input: ResetPasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    if (actor.userId === id) {
      throw Errors.forbidden('Use change password to change your own password.');
    }
    const target = await loadTarget(id);
    assertCanManage(actor.role, target.role);
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
        tx,
      );
      await recordAudit(
        {
          action: 'USER_PASSWORD_RESET',
          actorId: actor.userId,
          targetType: 'User',
          targetId: target.id,
          meta,
          detail: { sessionsRevoked },
        },
        tx,
      );
    });
    invalidateAccessCache();
  },
};
