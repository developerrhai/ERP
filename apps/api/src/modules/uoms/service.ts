// apps/api/src/modules/uoms/service.ts
// Business logic and audit logging for UOMs (Phase 03 Order 3)
import { Prisma } from '@prisma/client';
import type { Uom } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { Errors } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import { uomRepository } from './repository';
import type { CreateUomInput, ListUomsQuery, UpdateUomInput } from './schemas';

export interface UomDto {
  id: string;
  code: string;
  name: string;
  uomClass: string;
  decimals: number;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toUomDto(u: Uom): UomDto {
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    uomClass: u.uomClass,
    decimals: u.decimals,
    status: u.status,
    version: u.version,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

async function assertUnique(values: { code?: string; name?: string }, excludeId?: string) {
  const clashes = await uomRepository.findCollisions(values, excludeId);
  if (clashes.length === 0) return;
  const fields: FieldErrors = {};
  for (const c of clashes) {
    if (values.code && c.code === values.code) fields.code = 'This UOM code is already in use.';
    if (values.name && c.name.toLowerCase() === values.name.toLowerCase()) {
      fields.name = 'This UOM name is already in use.';
    }
  }
  throw Errors.duplicate(fields);
}

export const uomModuleService = {
  list: async (query: ListUomsQuery = {}): Promise<UomDto[]> => {
    const rows = await uomRepository.findMany(query);
    return rows.map(toUomDto);
  },

  get: async (id: string): Promise<UomDto> => {
    const row = await uomRepository.findById(id);
    if (!row) throw Errors.notFound('UOM not found.');
    return toUomDto(row);
  },

  create: async (
    auth: AuthContext,
    input: CreateUomInput,
    meta: RequestMeta,
  ): Promise<UomDto> => {
    await assertUnique({ code: input.code, name: input.name });

    try {
      const created = await uomRepository.create({
        code: input.code,
        name: input.name,
        uomClass: input.uomClass,
        decimals: input.decimals,
        status: 'Active',
        createdById: auth.userId,
      });

      await recordAudit({
        action: 'UOM_CREATED',
        actorId: auth.userId,
        targetType: 'Uom',
        targetId: created.id,
        meta,
        detail: { code: created.code, name: created.name, uomClass: created.uomClass },
      });

      return toUomDto(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.duplicate({ code: 'This UOM code or name is already in use.' });
      }
      throw err;
    }
  },

  update: async (
    auth: AuthContext,
    id: string,
    version: number,
    input: UpdateUomInput,
    meta: RequestMeta,
  ): Promise<UomDto> => {
    const current = await uomRepository.findById(id);
    if (!current) throw Errors.notFound('UOM not found.');

    if (input.name) {
      await assertUnique({ name: input.name }, id);
    }

    const updated = await uomRepository.updateIfVersion(id, version, {
      ...(input.name ? { name: input.name } : {}),
      ...(input.uomClass ? { uomClass: input.uomClass } : {}),
      ...(input.decimals !== undefined ? { decimals: input.decimals } : {}),
      ...(input.status ? { status: input.status } : {}),
      updatedById: auth.userId,
    });

    if (!updated) {
      const fresh = await uomRepository.findById(id);
      if (!fresh) throw Errors.notFound('UOM not found.');
      throw Errors.conflict('This UOM was modified by another request.');
    }

    await recordAudit({
      action: 'UOM_UPDATED',
      actorId: auth.userId,
      targetType: 'Uom',
      targetId: id,
      meta,
      detail: { changes: input },
    });

    return toUomDto(updated);
  },

  remove: async (
    auth: AuthContext,
    id: string,
    version?: number,
    meta?: RequestMeta,
  ): Promise<void> => {
    const current = await uomRepository.findById(id);
    if (!current) throw Errors.notFound('UOM not found.');

    const deleted = await uomRepository.softDelete(id, auth.userId, version);
    if (!deleted) {
      throw Errors.conflict('This UOM was modified by another request.');
    }

    if (meta) {
      await recordAudit({
        action: 'UOM_DELETED',
        actorId: auth.userId,
        targetType: 'Uom',
        targetId: id,
        meta,
        detail: { code: current.code, name: current.name },
      });
    }
  },
};
