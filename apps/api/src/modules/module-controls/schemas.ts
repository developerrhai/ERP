// Zod schemas for /module-controls: list filters and the strict PATCH body (at least one field).
import { z } from 'zod';

export const listModuleControlsQuerySchema = z
  .object({
    family: z.string().trim().min(1).max(60).optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListModuleControlsQuery = z.output<typeof listModuleControlsQuerySchema>;

export const updateModuleControlSchema = z
  .object({
    enabled: z.boolean().optional(),
    ownerDepartment: z.string().trim().min(2).max(60).optional(),
    approvalRequired: z.boolean().optional(),
    allowAdd: z.boolean().optional(),
    allowEdit: z.boolean().optional(),
    allowDelete: z.boolean().optional(),
    allowExport: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateModuleControlInput = z.output<typeof updateModuleControlSchema>;

export const pageIdParamsSchema = z.object({ pageId: z.string().trim().min(1).max(80) }).strict();
