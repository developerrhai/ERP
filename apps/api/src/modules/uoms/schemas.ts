// apps/api/src/modules/uoms/schemas.ts
// Zod schemas for /uoms (Phase 03 Order 3, typed masters)
import { z } from 'zod';

export const uomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Code must be at least 1 character.')
  .max(20, 'Code must be at most 20 characters.');

export const uomNameSchema = z
  .string()
  .trim()
  .min(1, 'Name must be at least 1 character.')
  .max(60, 'Name must be at most 60 characters.');

export const uomClassSchema = z.enum([
  'Count',
  'Weight',
  'Length',
  'Area',
  'Volume',
  'Time',
  'Temperature',
]);

export const createUomSchema = z
  .object({
    code: uomCodeSchema,
    name: uomNameSchema,
    uomClass: uomClassSchema.default('Count'),
    decimals: z.number().int().min(0, 'Decimals must be at least 0.').max(6, 'Decimals must be at most 6.').default(3),
  })
  .strict();
export type CreateUomInput = z.output<typeof createUomSchema>;

export const updateUomSchema = z
  .object({
    name: uomNameSchema.optional(),
    uomClass: uomClassSchema.optional(),
    decimals: z.number().int().min(0).max(6).optional(),
    status: z.enum(['Active', 'Inactive', 'ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateUomInput = z.output<typeof updateUomSchema>;

export const listUomsQuerySchema = z
  .object({
    status: z.string().trim().optional(),
    uomClass: z.string().trim().optional(),
    q: z.string().trim().optional(),
  })
  .strict();
export type ListUomsQuery = z.output<typeof listUomsQuerySchema>;

export const uomIdParamsSchema = z
  .object({ id: z.string().uuid('Invalid UOM id.') })
  .strict();
