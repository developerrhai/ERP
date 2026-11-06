// Zod schema for PATCH /company (Phase 3 §A1): names, address, GSTIN / PAN / CIN (letterhead
// rules). Strict; at least one field. Code, currency and time zone are read-only (unknown -> 422).
import { z } from 'zod';
import { cinSchema, gstinSchema, nullableText, panSchema } from '../../core/http/field-schemas';

export const updateCompanySchema = z
  .object({
    legalName: z
      .string()
      .trim()
      .min(2, 'Legal name must be at least 2 characters.')
      .max(300, 'Legal name must be at most 300 characters.')
      .optional(),
    tradeName: z
      .string()
      .trim()
      .min(2, 'Trade name must be at least 2 characters.')
      .max(120, 'Trade name must be at most 120 characters.')
      .optional(),
    pan: panSchema.optional(),
    cin: cinSchema.optional(),
    gstin: gstinSchema.optional(),
    address: nullableText(300).optional(),
    city: nullableText(100).optional(),
    stateCode: z.string().trim().regex(/^\d{2}$/, 'State code must be 2 digits.').nullable().optional(),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits.').nullable().optional(),
    email: z.string().trim().email('Invalid email address.').nullable().optional(),
    phone: nullableText(30).optional(),
    website: nullableText(200).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateCompanyInput = z.output<typeof updateCompanySchema>;
