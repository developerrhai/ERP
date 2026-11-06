// apps/api/src/modules/designations/schemas.ts
// Zod schemas for /designations (Phase 03 Order 3, typed masters)
import { z } from 'zod';

export const designationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{2,20}$/, 'Code must be 2-20 uppercase letters, numbers, hyphens or underscores.');

export const designationNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(100, 'Name must be at most 100 characters.');

export const createDesignationSchema = z
  .object({
    code: designationCodeSchema,
    name: designationNameSchema,
    departmentId: z.string().uuid('Invalid department id.').nullable().optional(),
    level: z.number().int().min(1, 'Level must be at least 1.').max(99, 'Level must be at most 99.').default(10),
  })
  .strict();
export type CreateDesignationInput = z.output<typeof createDesignationSchema>;

export const updateDesignationSchema = z
  .object({
    code: designationCodeSchema.optional(),
    name: designationNameSchema.optional(),
    departmentId: z.string().uuid('Invalid department id.').nullable().optional(),
    level: z.number().int().min(1, 'Level must be at least 1.').max(99, 'Level must be at most 99.').optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateDesignationInput = z.output<typeof updateDesignationSchema>;

export const listDesignationsQuerySchema = z
  .object({
    q: z.string().trim().optional(),
    departmentId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type ListDesignationsQuery = z.output<typeof listDesignationsQuerySchema>;

export const designationIdParamsSchema = z
  .object({ id: z.string().uuid('Invalid designation id.') })
  .strict();
