// Zod schemas for /units (Phase 3 §A1): code ^[A-Z0-9]{2,10}$ (upper-cased), name 2–100, optional
// address and GSTIN, status. Strict objects; PATCH needs at least one field.
import { z } from 'zod';
import { gstinSchema, nullableText } from '../../core/http/field-schemas';

export const unitCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Code must be 2-10 letters or digits.');

export const unitNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(100, 'Name must be at most 100 characters.');

export const unitStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createUnitSchema = z
  .object({
    code: unitCodeSchema,
    name: unitNameSchema,
    address: nullableText(300).optional(),
    gstin: gstinSchema.optional(),
  })
  .strict();
export type CreateUnitInput = z.output<typeof createUnitSchema>;

export const updateUnitSchema = z
  .object({
    code: unitCodeSchema.optional(),
    name: unitNameSchema.optional(),
    address: nullableText(300).optional(),
    gstin: gstinSchema.optional(),
    status: unitStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateUnitInput = z.output<typeof updateUnitSchema>;

export const listUnitsQuerySchema = z.object({ status: unitStatusSchema.optional() }).strict();
export type ListUnitsQuery = z.output<typeof listUnitsQuerySchema>;

export const unitIdParamsSchema = z.object({ id: z.string().uuid('Invalid unit id.') }).strict();
