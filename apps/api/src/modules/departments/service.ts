// Department Master rules (Phase 2 §2.3, §2.6): duplicates -> 409 DUPLICATE, renames cascade to
// users/families/modules through the FK, delete refused with 409 IN_USE while referenced, and the
// Administration department is PROTECTED (no rename, deactivate or delete). Every write is audited
// and clears the access cache.
import { Prisma } from '@prisma/client';
import type { Department } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import { invalidateAccessCache } from '../../core/rbac/access';
import { ADMIN_DEPARTMENT } from '../../core/registry';
import { departmentRepository } from './repository';
import type { DepartmentWithCount } from './repository';
import type { CreateDepartmentInput, UpdateDepartmentInput } from './schemas';

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
  head: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  userCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toDepartmentDto(d: Department, userCount: number): DepartmentDto {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    head: d.head,
    status: d.status,
    userCount,
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

const withCount = (d: DepartmentWithCount): DepartmentDto => toDepartmentDto(d, d._count.users);

async function assertUnique(values: { code?: string; name?: string }, excludeId?: string) {
  const clashes = await departmentRepository.findCollisions(values, excludeId);
  if (clashes.length === 0) return;
  const fields: FieldErrors = {};
  for (const c of clashes) {
    if (values.code && c.code === values.code) fields.code = 'This code is already in use.';
    if (values.name && c.name.toLowerCase() === values.name.toLowerCase()) {
      fields.name = 'This name is already in use.';
    }
  }
  throw Errors.duplicate(fields);
}

function mapDbError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = JSON.stringify(err.meta?.target ?? '');
      const fields: FieldErrors = {};
      if (/code/i.test(target)) fields.code = 'This code is already in use.';
      if (/name/i.test(target)) fields.name = 'This name is already in use.';
      return Errors.duplicate(fields);
    }
    if (err.code === 'P2003') {
      return Errors.inUse('This department is still referenced. Move its users and modules first.');
    }
  }
  return err;
}

async function load(id: string): Promise<DepartmentWithCount> {
  const department = await departmentRepository.findById(id);
  if (!department) throw Errors.notFound('Department not found.');
  return department;
}

type Tracked = 'code' | 'name' | 'head' | 'status';
const TRACKED: readonly Tracked[] = ['code', 'name', 'head', 'status'];

export const departmentService = {
  async list(): Promise<DepartmentDto[]> {
    return (await departmentRepository.list()).map(withCount);
  },

  activeNames(): Promise<string[]> {
    return departmentRepository.activeNames();
  },

  async create(actor: AuthContext, input: CreateDepartmentInput, meta: RequestMeta) {
    await assertUnique({ code: input.code, name: input.name });
    try {
      const created = await prisma.$transaction(async (tx) => {
        const department = await departmentRepository.create(
          {
            code: input.code,
            name: input.name,
            head: input.head ?? null,
            createdById: actor.userId,
          },
          tx,
        );
        await recordAudit(
          {
            action: 'DEPARTMENT_CREATED',
            actorId: actor.userId,
            targetType: 'Department',
            targetId: department.id,
            meta,
            detail: { code: department.code, name: department.name, head: department.head },
          },
          tx,
        );
        return department;
      });
      invalidateAccessCache();
      return toDepartmentDto(created, 0);
    } catch (err) {
      throw mapDbError(err);
    }
  },

  async update(
    actor: AuthContext,
    id: string,
    expectedVersion: number,
    input: UpdateDepartmentInput,
    meta: RequestMeta,
  ): Promise<DepartmentDto> {
    const target = await load(id);
    if (target.name === ADMIN_DEPARTMENT) {
      if (input.name !== undefined && input.name !== target.name) {
        throw Errors.protectedResource('The Administration department cannot be renamed.');
      }
      if (input.status === 'INACTIVE') {
        throw Errors.protectedResource('The Administration department cannot be deactivated.');
      }
    }
    if (expectedVersion !== target.version) throw Errors.versionConflict();
    await assertUnique(
      {
        ...(input.code !== undefined && input.code !== target.code ? { code: input.code } : {}),
        ...(input.name !== undefined && input.name !== target.name ? { name: input.name } : {}),
      },
      target.id,
    );

    const before: Prisma.InputJsonObject = {};
    const after: Prisma.InputJsonObject = {};
    const data: Prisma.DepartmentUncheckedUpdateManyInput = {};
    for (const field of TRACKED) {
      const next = input[field];
      if (next === undefined || next === target[field]) continue;
      Object.assign(before, { [field]: target[field] });
      Object.assign(after, { [field]: next });
      Object.assign(data, { [field]: next });
    }
    // Nothing changes: return the current row without a version bump or an audit row.
    if (Object.keys(data).length === 0) return withCount(target);
    try {
      const updated = await prisma.$transaction(async (tx) => {
        // The name FK cascades to users.department, department_families and module_controls.
        if (!(await departmentRepository.updateIfVersion(target.id, expectedVersion, data, tx))) {
          throw Errors.versionConflict();
        }
        await recordAudit(
          {
            action: 'DEPARTMENT_UPDATED',
            actorId: actor.userId,
            targetType: 'Department',
            targetId: target.id,
            meta,
            detail: { before, after },
          },
          tx,
        );
        const fresh = await departmentRepository.findById(target.id, tx);
        if (!fresh) throw Errors.notFound('Department not found.');
        return fresh;
      });
      invalidateAccessCache();
      return withCount(updated);
    } catch (err) {
      throw mapDbError(err);
    }
  },

  async remove(
    actor: AuthContext,
    id: string,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const target = await load(id);
    if (target.name === ADMIN_DEPARTMENT) {
      throw Errors.protectedResource('The Administration department cannot be deleted.');
    }
    if (expectedVersion !== undefined && expectedVersion !== target.version) {
      throw Errors.versionConflict();
    }
    const users = await departmentRepository.countUsers(target.name);
    if (users > 0) {
      throw Errors.inUse(
        `This department has ${users} user${users === 1 ? '' : 's'}. Move them first or deactivate the department.`,
      );
    }
    const modules = await departmentRepository.countOwnedModules(target.name);
    if (modules > 0) {
      throw Errors.inUse(
        `This department owns ${modules} module${modules === 1 ? '' : 's'}. Reassign them in the System Control Center first.`,
      );
    }
    try {
      await prisma.$transaction(async (tx) => {
        await departmentRepository.deleteWithFamilies(target.id, target.name, tx);
        await recordAudit(
          {
            action: 'DEPARTMENT_DELETED',
            actorId: actor.userId,
            targetType: 'Department',
            targetId: target.id,
            meta,
            detail: { code: target.code, name: target.name, head: target.head },
          },
          tx,
        );
      });
      invalidateAccessCache();
    } catch (err) {
      throw mapDbError(err);
    }
  },
};
