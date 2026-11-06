// Role Master service (Phase 02 §5.5, §6): add, edit, delete, and list roles.
// Hierarchy: actor manages role only if actor.level > role.level.
// Levels 95 and 99 are reserved. System roles cannot be deleted; their code and level are fixed.
import type { Prisma, Role } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import type { RequestMeta } from '../../core/auth/auth-context';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { invalidateAccessCache } from '../../core/rbac/access';
import { DEFAULT_RESOURCE } from '../../core/rbac/permission-model';
import { isReservedLevel } from '../../core/rbac/role-rules';
import { roleRepository } from './repository';
import type { CreateRoleInput, UpdateRoleInput } from './schemas';

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  level: number;
  isSystem: boolean;
  allUnits: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  userCount: number;
  canManage: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function toDto(role: Role, userCount: number, actorLevel: number): RoleDto {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    level: role.level,
    isSystem: role.isSystem,
    allUnits: role.allUnits,
    status: role.status,
    userCount,
    canManage: actorLevel > role.level,
    version: role.version,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

export const roleService = {
  async list(actor: { level: number }): Promise<RoleDto[]> {
    const [roles, counts] = await Promise.all([
      roleRepository.findAll(),
      roleRepository.userCountsByRoleId(),
    ]);
    return roles.map((r) => toDto(r, counts.get(r.id) ?? 0, actor.level));
  },

  async getById(id: string, actor: { level: number }): Promise<RoleDto> {
    const role = await roleRepository.findById(id);
    if (!role) throw Errors.notFound('Role not found.');
    const count = await roleRepository.userCount(id);
    return toDto(role, count, actor.level);
  },

  async create(
    actor: { id: string; level: number },
    input: CreateRoleInput,
    meta: RequestMeta,
  ): Promise<RoleDto> {
    if (input.level >= actor.level) {
      throw Errors.forbidden(`You can only create roles below your own level (${actor.level}).`);
    }
    if (isReservedLevel(input.level)) {
      throw Errors.forbidden('Levels 95 and 99 are reserved.');
    }

    const existingCode = await roleRepository.findByCode(input.code);
    if (existingCode) {
      throw Errors.duplicate({ code: 'This code is already used.' });
    }
    const existingName = await roleRepository.findByName(input.name);
    if (existingName) {
      throw Errors.duplicate({ name: 'A role with this name already exists.' });
    }

    const created = await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          code: input.code,
          name: input.name,
          level: input.level,
          description: input.description ?? null,
          allUnits: input.allUnits ?? false,
          createdById: actor.id,
        },
      });

      if (input.copyFromRoleId) {
        const sourceRows = await tx.rolePermission.findMany({
          where: { roleId: input.copyFromRoleId },
        });
        if (sourceRows.length > 0) {
          await tx.rolePermission.createMany({
            data: sourceRows.map((r) => ({
              roleId: role.id,
              resource: r.resource,
              view: r.view,
              add: r.add,
              edit: r.edit,
              delete: r.delete,
              approve: r.approve,
              export: r.export,
              controls: r.controls,
              submit: r.submit,
              post: r.post,
              cancel: r.cancel,
              print: r.print,
              import: r.import,
              scope: r.scope,
              version: 1,
            })),
          });
        }
      } else {
        // Create default * row with employee-like view permissions
        await tx.rolePermission.create({
          data: {
            roleId: role.id,
            resource: DEFAULT_RESOURCE,
            view: true,
            add: true,
            edit: true,
            delete: false,
            approve: false,
            export: false,
            controls: false,
            submit: true,
            post: false,
            cancel: false,
            print: true,
            import: false,
            scope: 'OWN',
            version: 1,
          },
        });
      }

      // Add family:Administration deny row if level < 95
      if (role.level < 95) {
        await tx.rolePermission.upsert({
          where: { roleId_resource: { roleId: role.id, resource: 'family:Administration' } },
          create: {
            roleId: role.id,
            resource: 'family:Administration',
            view: false,
            add: false,
            edit: false,
            delete: false,
            approve: false,
            export: false,
            controls: false,
            submit: false,
            post: false,
            cancel: false,
            print: false,
            import: false,
            scope: 'OWN',
            version: 1,
          },
          update: {},
        });
      }

      return role;
    });

    invalidateAccessCache();

    await recordAudit({
      actorId: actor.id,
      action: 'ROLE_CREATED',
      targetType: 'Role',
      targetId: created.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: {
        after: {
          code: created.code,
          name: created.name,
          level: created.level,
          allUnits: created.allUnits,
          description: created.description,
        },
      },
    });

    return toDto(created, 0, actor.level);
  },

  async update(
    id: string,
    actor: { id: string; level: number },
    input: UpdateRoleInput,
    expectedVersion: number,
    meta: RequestMeta,
  ): Promise<RoleDto> {
    const role = await roleRepository.findById(id);
    if (!role) throw Errors.notFound('Role not found.');

    if (role.version !== expectedVersion) {
      throw Errors.versionConflict();
    }

    if (role.level >= actor.level) {
      throw Errors.forbidden('You can only manage users below your own role.');
    }

    if (input.level !== undefined && input.level !== role.level) {
      if (role.isSystem) {
        throw Errors.protectedResource(
          'System roles cannot be deleted. Their code and level are fixed.',
        );
      }
      if (input.level >= actor.level) {
        throw Errors.forbidden(`You can only create roles below your own level (${actor.level}).`);
      }
      if (isReservedLevel(input.level)) {
        throw Errors.forbidden('Levels 95 and 99 are reserved.');
      }
    }

    if (input.name && input.name !== role.name) {
      const existing = await roleRepository.findByName(input.name);
      if (existing && existing.id !== id) {
        throw Errors.conflict('A role with this name already exists.');
      }
    }

    const userCount = await roleRepository.userCount(id);

    if (input.status === 'INACTIVE' && role.status !== 'INACTIVE') {
      if (userCount > 0) {
        throw Errors.inUse(
          `This role is assigned to ${userCount} users. Move them to another role first.`,
        );
      }
    }

    const data: Prisma.RoleUncheckedUpdateInput = {
      updatedById: actor.id,
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.level !== undefined) data.level = input.level;
    if (input.description !== undefined) data.description = input.description;
    if (input.allUnits !== undefined) data.allUnits = input.allUnits;
    if (input.status !== undefined) data.status = input.status;

    const updated = await roleRepository.updateWithVersion(id, data, expectedVersion);
    if (!updated) {
      throw Errors.versionConflict();
    }

    invalidateAccessCache();

    await recordAudit({
      actorId: actor.id,
      action: 'ROLE_UPDATED',
      targetType: 'Role',
      targetId: updated.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: {
        before: {
          name: role.name,
          level: role.level,
          allUnits: role.allUnits,
          description: role.description,
          status: role.status,
        },
        after: {
          name: updated.name,
          level: updated.level,
          allUnits: updated.allUnits,
          description: updated.description,
          status: updated.status,
        },
      },
    });

    return toDto(updated, userCount, actor.level);
  },

  async delete(
    id: string,
    actor: { id: string; level: number },
    expectedVersion: number | null,
    meta: RequestMeta,
  ): Promise<void> {
    const role = await roleRepository.findById(id);
    if (!role) throw Errors.notFound('Role not found.');

    if (expectedVersion !== null && role.version !== expectedVersion) {
      throw Errors.versionConflict();
    }

    if (role.isSystem) {
      throw Errors.protectedResource(
        'System roles cannot be deleted. Their code and level are fixed.',
      );
    }

    if (role.level >= actor.level) {
      throw Errors.forbidden('You can only manage users below your own role.');
    }

    const userCount = await roleRepository.userCount(id);
    if (userCount > 0) {
      throw Errors.inUse(
        `This role is assigned to ${userCount} users. Move them to another role first.`,
      );
    }

    await roleRepository.delete(id);

    invalidateAccessCache();

    await recordAudit({
      actorId: actor.id,
      action: 'ROLE_DELETED',
      targetType: 'Role',
      targetId: role.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: {
        before: {
          code: role.code,
          name: role.name,
          level: role.level,
          description: role.description,
        },
      },
    });
  },
};
