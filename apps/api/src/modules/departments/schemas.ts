// Zod schemas for /departments (Phase 2 §2.3): code ^[A-Z0-9]{2,10}$ (upper-cased), name 2–60,
// head ≤ 100 (nullable), status. Strict objects; PATCH needs at least one field.
import { z } from 'zod';

export const departmentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Code must be 2-10 letters or digits.');

export const departmentNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(60, 'Name must be at most 60 characters.');

const headSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(100, 'Head must be at most 100 characters.').nullable(),
);

export const createDepartmentSchema = z
  .object({
    code: departmentCodeSchema,
    name: departmentNameSchema,
    head: headSchema.optional(),
  })
  .strict();
export type CreateDepartmentInput = z.output<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    code: departmentCodeSchema.optional(),
    name: departmentNameSchema.optional(),
    head: headSchema.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateDepartmentInput = z.output<typeof updateDepartmentSchema>;

export const departmentIdParamsSchema = z
  .object({ id: z.string().uuid('Invalid department id.') })
  .strict();
