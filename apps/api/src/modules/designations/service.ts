// apps/api/src/modules/designations/service.ts
// Business logic and audit logging for designations (Phase 03 Order 3)
import { Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { Errors } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import { designationRepository } from './repository';
import type { DesignationWithDept } from './repository';
import type { CreateDesignationInput, ListDesignationsQuery, UpdateDesignationInput } from './schemas';

export interface DesignationDto {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  department: { id: string; code: string; name: string } | null;
  level: number;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toDesignationDto(d: DesignationWithDept): DesignationDto {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    departmentId: d.departmentId,
    department: d.department,
    level: d.level,
    status: d.status as 'ACTIVE' | 'INACTIVE',
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

async function assertUnique(values: { code?: string; name?: string }, excludeId?: string) {
  const clashes = await designationRepository.findCollisions(values, excludeId);
  if (clashes.length === 0) return;
  const fields: FieldErrors = {};
  for (const c of clashes) {
    if (values.code && c.code === values.code) fields.code = 'This designation code is already in use.';
    if (values.name && c.name.toLowerCase() === values.name.toLowerCase()) {
      fields.name = 'This designation name is already in use.';
    }
  }
  throw Errors.duplicate(fields);
}

export const designationService = {
  list: async (query: ListDesignationsQuery = {}): Promise<DesignationDto[]> => {
    const rows = await designationRepository.findMany(query);
    return rows.map(toDesignationDto);
  },

  get: async (id: string): Promise<DesignationDto> => {
    const row = await designationRepository.findById(id);
    if (!row) throw Errors.notFound('Designation not found.');
    return toDesignationDto(row);
  },

  create: async (
    auth: AuthContext,
    input: CreateDesignationInput,
    meta: RequestMeta,
  ): Promise<DesignationDto> => {
    await assertUnique({ code: input.code, name: input.name });

    try {
      const created = await designationRepository.create({
        code: input.code,
        name: input.name,
        departmentId: input.departmentId ?? null,
        level: input.level,
        status: 'ACTIVE',
        createdById: auth.userId,
      });

      await recordAudit({
        action: 'DESIGNATION_CREATED',
        actorId: auth.userId,
        targetType: 'Designation',
        targetId: created.id,
        meta,
        detail: { code: created.code, name: created.name, level: created.level },
      });

      return toDesignationDto(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.duplicate({ code: 'This designation code or name is already in use.' });
      }
      throw err;
    }
  },

  update: async (
    auth: AuthContext,
    id: string,
    version: number,
    input: UpdateDesignationInput,
    meta: RequestMeta,
  ): Promise<DesignationDto> => {
    const current = await designationRepository.findById(id);
    if (!current) throw Errors.notFound('Designation not found.');

    if (input.code || input.name) {
      await assertUnique({ code: input.code, name: input.name }, id);
    }

    const updated = await designationRepository.updateIfVersion(id, version, {
      ...(input.code ? { code: input.code } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.status ? { status: input.status } : {}),
      updatedById: auth.userId,
    });

    if (!updated) {
      const fresh = await designationRepository.findById(id);
      if (!fresh) throw Errors.notFound('Designation not found.');
      throw Errors.conflict('This designation was modified by another request.');
    }

    await recordAudit({
      action: 'DESIGNATION_UPDATED',
      actorId: auth.userId,
      targetType: 'Designation',
      targetId: id,
      meta,
      detail: { changes: input },
    });

    return toDesignationDto(updated);
  },

  remove: async (
    auth: AuthContext,
    id: string,
    version?: number,
    meta?: RequestMeta,
  ): Promise<void> => {
    const current = await designationRepository.findById(id);
    if (!current) throw Errors.notFound('Designation not found.');

    const deleted = await designationRepository.softDelete(id, auth.userId, version);
    if (!deleted) {
      throw Errors.conflict('This designation was modified by another request.');
    }

    if (meta) {
      await recordAudit({
        action: 'DESIGNATION_DELETED',
        actorId: auth.userId,
        targetType: 'Designation',
        targetId: id,
        meta,
        detail: { code: current.code, name: current.name },
      });
    }
  },
};
