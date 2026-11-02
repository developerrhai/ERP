// Unit Master rules (Phase 3 §A1, page admin-branches): duplicates -> 409 DUPLICATE, delete refused
// with 409 IN_USE while any user (or, later, warehouse / record) references the unit; deactivating is
// the alternative. Every write is audited and clears the access cache (unit access may change).
import { Prisma } from '@prisma/client';
import type { Unit } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import { invalidateAccessCache } from '../../core/rbac/access';
import { unitRepository } from './repository';
import type { UnitWithCount } from './repository';
import type { CreateUnitInput, ListUnitsQuery, UpdateUnitInput } from './schemas';

export interface UnitDto {
  id: string;
  code: string;
  name: string;
  address: string | null;
  gstin: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  /** Users explicitly assigned to the unit (ADMIN+ have every unit implicitly and are not counted). */
  userCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toUnitDto(u: Unit, userCount: number): UnitDto {
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    address: u.address,
    gstin: u.gstin,
    status: u.status,
    userCount,
    version: u.version,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

const withCount = (u: UnitWithCount): UnitDto => toUnitDto(u, u._count.userUnits);

const IN_USE_MESSAGE = 'This unit is still in use. Deactivate it instead.';

async function assertUnique(values: { code?: string; name?: string }, excludeId?: string) {
  const clashes = await unitRepository.findCollisions(values, excludeId);
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
    // A row that references the unit (FK RESTRICT) appeared between the check and the delete.
    if (err.code === 'P2003') return Errors.inUse(IN_USE_MESSAGE);
  }
  // PostgreSQL reports ON DELETE RESTRICT as SQLSTATE 23001, which Prisma does not map to P2003.
  if (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    /violates RESTRICT/.test(err.message)
  ) {
    return Errors.inUse(IN_USE_MESSAGE);
  }
  return err;
}

async function load(id: string): Promise<UnitWithCount> {
  const unit = await unitRepository.findById(id);
  if (!unit) throw Errors.notFound('Unit not found.');
  return unit;
}

type Tracked = 'code' | 'name' | 'address' | 'gstin' | 'status';
const TRACKED: readonly Tracked[] = ['code', 'name', 'address', 'gstin', 'status'];

export const unitService = {
  async list(query: ListUnitsQuery): Promise<UnitDto[]> {
    return (await unitRepository.list(query.status ? { status: query.status } : {})).map(withCount);
  },

  async create(actor: AuthContext, input: CreateUnitInput, meta: RequestMeta): Promise<UnitDto> {
    await assertUnique({ code: input.code, name: input.name });
    try {
      const created = await prisma.$transaction(async (tx) => {
        const unit = await unitRepository.create(
          {
            code: input.code,
            name: input.name,
            address: input.address ?? null,
            gstin: input.gstin ?? null,
          },
          tx,
        );
        await recordAudit(
          {
            action: 'UNIT_CREATED',
            actorId: actor.userId,
            targetType: 'Unit',
            targetId: unit.id,
            meta,
            detail: { code: unit.code, name: unit.name, address: unit.address, gstin: unit.gstin },
          },
          tx,
        );
        return unit;
      });
      invalidateAccessCache();
      return toUnitDto(created, 0);
    } catch (err) {
      throw mapDbError(err);
    }
  },

  async update(
    actor: AuthContext,
    id: string,
    expectedVersion: number,
    input: UpdateUnitInput,
    meta: RequestMeta,
  ): Promise<UnitDto> {
    const target = await load(id);
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
    const data: Prisma.UnitUncheckedUpdateManyInput = {};
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
        if (!(await unitRepository.updateIfVersion(target.id, expectedVersion, data, tx))) {
          throw Errors.versionConflict();
        }
        await recordAudit(
          {
            action: 'UNIT_UPDATED',
            actorId: actor.userId,
            targetType: 'Unit',
            targetId: target.id,
            meta,
            detail: { before, after },
          },
          tx,
        );
        const fresh = await unitRepository.findById(target.id, tx);
        if (!fresh) throw Errors.notFound('Unit not found.');
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
    if (expectedVersion !== undefined && expectedVersion !== target.version) {
      throw Errors.versionConflict();
    }
    const users = await unitRepository.countUsers(target.id);
    if (users > 0) {
      throw Errors.inUse(
        `This unit is assigned to ${users} user${users === 1 ? '' : 's'}. Remove it from them first or deactivate the unit.`,
      );
    }
    const records = await unitRepository.countRecords(target.id);
    if (records > 0) {
      throw Errors.inUse(
        `This unit holds ${records} record${records === 1 ? '' : 's'}. Deactivate the unit instead.`,
      );
    }
    try {
      await prisma.$transaction(async (tx) => {
        await unitRepository.delete(target.id, tx);
        await recordAudit(
          {
            action: 'UNIT_DELETED',
            actorId: actor.userId,
            targetType: 'Unit',
            targetId: target.id,
            meta,
            detail: { code: target.code, name: target.name },
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
