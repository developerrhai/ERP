// Zod schemas for PUT /permissions/:roleId (Phase 02 §6).
// 12 actions, 4 scopes, nullable override cells.
import { z } from 'zod';
import { SCOPES } from '../../core/rbac/permission-model';

/** On family/page rows a null cell means "inherit"; the "*" row must be complete (service check). */
export const permissionRowSchema = z
  .object({
    resource: z.string().trim().min(1).max(120),
    view: z.boolean().nullable(),
    add: z.boolean().nullable(),
    edit: z.boolean().nullable(),
    delete: z.boolean().nullable(),
    approve: z.boolean().nullable(),
    export: z.boolean().nullable(),
    controls: z.boolean().nullable(),
    submit: z.boolean().nullable().optional().default(null),
    post: z.boolean().nullable().optional().default(null),
    cancel: z.boolean().nullable().optional().default(null),
    print: z.boolean().nullable().optional().default(null),
    import: z.boolean().nullable().optional().default(null),
    scope: z.enum(SCOPES).nullable(),
  })
  .strict();

export type PermissionRowInput = z.output<typeof permissionRowSchema>;

export const putPermissionsSchema = z
  .object({ rows: z.array(permissionRowSchema).min(1).max(400) })
  .strict();

export type PutPermissionsInput = z.output<typeof putPermissionsSchema>;

export const roleIdParamsSchema = z
  .object({
    roleId: z.string().trim().min(1),
  })
  .strict();
