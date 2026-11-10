// Permission Master service (Phase 02 §5, §6):
// 12 actions, 4 scopes, explicit deny wins.
// Can only edit roles below actor's level, and NEVER own role.
// Administration pages can only be granted to Administrator and Super User (level >= 95).
import type { Prisma, Role, RolePermission } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { invalidateAccessCache } from '../../core/rbac/access';
import {
  ACTIONS,
  DEFAULT_RESOURCE,
  SCOPES,
  familyResource,
  noActions,
} from '../../core/rbac/permission-model';
import type { Action, Scope } from '../../core/rbac/permission-model';
import { ADMIN_FAMILY, isFamily, pageInfo, registry } from '../../core/registry';
import { roleRepository } from '../roles/repository';
import { permissionRepository } from './repository';
import type { PermissionRowInput, PutPermissionsInput } from './schemas';

export interface PermissionRowDto {
  resource: string;
  view: boolean | null;
  add: boolean | null;
  edit: boolean | null;
  delete: boolean | null;
  approve: boolean | null;
  export: boolean | null;
  controls: boolean | null;
  submit: boolean | null;
  post: boolean | null;
  cancel: boolean | null;
  print: boolean | null;
  import: boolean | null;
  scope: Scope | null;
  version: number;
}

export interface RolePermissionsDto {
  roleId: string;
  code: string;
  role: string;
  name: string;
  level: number;
  editable: boolean;
  version: number;
  rows: PermissionRowDto[];
}

function resourceOrder(resource: string): number {
  if (resource === DEFAULT_RESOURCE) return -1;
  if (resource.startsWith('family:')) {
    const index = registry.familyNames.indexOf(resource.slice('family:'.length));
    return index < 0 ? 10_000 : index;
  }
  const page = pageInfo(resource.slice('page:'.length));
  return 1_000 + (page?.order ?? 9_000);
}

function toRowDto(r: RolePermission): PermissionRowDto {
  return {
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
    version: r.version,
  };
}

function buildRolePermissionsDto(
  role: Role,
  rows: RolePermission[],
  actor: { level: number; roleId: string },
): RolePermissionsDto {
  const sorted = [...rows].sort((a, b) => resourceOrder(a.resource) - resourceOrder(b.resource));
  return {
    roleId: role.id,
    code: role.code,
    role: role.code,
    name: role.name,
    level: role.level,
    editable: actor.level > role.level && role.id !== actor.roleId,
    version: rows.reduce((max, r) => Math.max(max, r.version), 0),
    rows: sorted.map(toRowDto),
  };
}

function isAdministrationResource(resource: string): boolean {
  if (resource === familyResource(ADMIN_FAMILY)) return true;
  return (
    resource.startsWith('page:') &&
    pageInfo(resource.slice('page:'.length))?.family === ADMIN_FAMILY
  );
}

function validateRows(role: Role, rows: PermissionRowInput[]): void {
  const fields: Record<string, string> = {};
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const key = `rows.${i}.resource`;
    if (seen.has(row.resource)) fields[key] = 'Duplicate resource.';
    seen.add(row.resource);
    if (row.resource === DEFAULT_RESOURCE) return;
    if (row.resource.startsWith('family:')) {
      if (!isFamily(row.resource.slice('family:'.length))) fields[key] = 'Unknown family.';
      return;
    }
    if (row.resource.startsWith('page:')) {
      if (!pageInfo(row.resource.slice('page:'.length))) fields[key] = 'Unknown page.';
      return;
    }
    fields[key] = 'Resource must be "*", "family:<name>" or "page:<id>".';
  });

  if (!seen.has(DEFAULT_RESOURCE)) fields.rows = 'A "*" (role default) row is required.';

  rows.forEach((row, i) => {
    if (row.resource !== DEFAULT_RESOURCE) return;
    for (const cell of [...ACTIONS, 'scope'] as const) {
      if (row[cell] === null) {
        fields[`rows.${i}.${cell}`] = 'The "*" row cannot inherit; set a value.';
      }
    }
  });

  if (Object.keys(fields).length > 0) throw Errors.validation(fields);

  const star = rows.find((r) => r.resource === DEFAULT_RESOURCE);
  if (role.code === 'ADMINISTRATOR' && star && star.controls !== true) {
    throw Errors.protectedResource("An Administrator's controls permission on * cannot be turned off.");
  }

  for (const row of rows) {
    if (!isAdministrationResource(row.resource)) continue;
    if (role.code === 'ADMINISTRATOR') {
      if (row.controls === false) {
        throw Errors.protectedResource(
          "An Administrator's controls permission on Administration pages cannot be turned off.",
        );
      }
    } else if (role.level < 95) {
      if (ACTIONS.some((a) => row[a] === true)) {
        throw Errors.protectedResource('Administration pages are only for Administrator and Super User.');
      }
    }
  }
}

function withAdministrationDeny(role: Role, rows: PermissionRowInput[]): PermissionRowInput[] {
  if (role.level >= 95) return rows;
  const adminFamily = familyResource(ADMIN_FAMILY);
  const existing = rows.find((r) => r.resource === adminFamily);
  const denyRow: PermissionRowInput = {
    resource: adminFamily,
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
  };
  if (!existing) return [...rows, denyRow];
  return rows.map((r) => (r.resource === adminFamily ? denyRow : r));
}

function snapshot(rows: RolePermission[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = { resource: r.resource, scope: r.scope };
    for (const a of ACTIONS) out[a] = r[a];
    return out;
  });
}

export const permissionService = {
  async list(actor: {
    level: number;
    roleId: string;
  }): Promise<{
    roles: RolePermissionsDto[];
    families: string[];
    actions: readonly Action[];
    scopes: readonly Scope[];
  }> {
    const [allRoles, allRows] = await Promise.all([
      roleRepository.findAll(),
      permissionRepository.all(),
    ]);

    const nonSuperRoles = allRoles.filter((r) => r.code !== 'SUPER_USER');
    const roles = nonSuperRoles.map((role) =>
      buildRolePermissionsDto(
        role,
        allRows.filter((r) => r.roleId === role.id),
        actor,
      ),
    );

    return {
      roles,
      families: [...registry.familyNames],
      actions: ACTIONS,
      scopes: SCOPES,
    };
  },

  async replace(
    actor: AuthContext,
    targetIdentifier: string,
    expectedVersion: number,
    input: PutPermissionsInput,
    meta: RequestMeta,
  ): Promise<RolePermissionsDto> {
    let role = await roleRepository.findById(targetIdentifier);
    if (!role) {
      role = await roleRepository.findByCode(targetIdentifier);
    }
    if (!role) throw Errors.notFound('Role not found.');

    if (role.code === 'SUPER_USER') {
      throw Errors.forbidden('Super User permissions are fixed and cannot be edited.');
    }

    if (role.id === actor.roleId) {
      throw Errors.forbidden("You cannot change your own role's permissions.");
    }

    if (role.level >= actor.level) {
      throw Errors.forbidden('You can only manage users below your own role.');
    }

    validateRows(role, input.rows);

    const rowsToStore = withAdministrationDeny(role, input.rows).filter(
      (r) =>
        r.resource === DEFAULT_RESOURCE ||
        r.scope !== null ||
        ACTIONS.some((a) => r[a] !== null),
    );

    const result = await prisma.$transaction(async (tx) => {
      await permissionRepository.lockRoleId(role.id, tx);
      const before = await permissionRepository.forRoleId(role.id, tx);
      const current = before.reduce((max, r) => Math.max(max, r.version), 0);
      if (current !== expectedVersion) {
        throw Errors.versionConflict();
      }
      const nextVersion = current + 1;
      await permissionRepository.replace(
        role.id,
        rowsToStore.map((r) => ({
          ...r,
          version: nextVersion,
          updatedById: actor.userId,
        })),
        tx,
      );
      const after = await permissionRepository.forRoleId(role.id, tx);

      await recordAudit(
        {
          action: 'PERMISSIONS_UPDATED',
          actorId: actor.userId,
          targetType: 'RolePermissions',
          targetId: role.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          detail: {
            roleId: role.id,
            roleCode: role.code,
            before: snapshot(before) as unknown as Prisma.InputJsonValue,
            after: snapshot(after) as unknown as Prisma.InputJsonValue,
          },
        },
        tx,
      );
      await invalidateAccessCache(tx);
      return after;
    });

    return buildRolePermissionsDto(role, result, { level: actor.level, roleId: actor.roleId });
  },
};
