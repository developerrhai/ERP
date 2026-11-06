// apps/api/src/modules/currencies/schemas.ts
// Zod schemas for /currencies (Phase 03 Order 3, typed masters)
import { z } from 'zod';

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Code must be exactly 3 uppercase letters (ISO 4217, e.g. USD, EUR, INR).');

export const currencyNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(60, 'Name must be at most 60 characters.');

export const currencySymbolSchema = z
  .string()
  .trim()
  .min(1, 'Symbol must be at least 1 character.')
  .max(10, 'Symbol must be at most 10 characters.');

export const createCurrencySchema = z
  .object({
    code: currencyCodeSchema,
    name: currencyNameSchema,
    symbol: currencySymbolSchema,
    decimalPlaces: z.number().int().min(0, 'Decimal places must be at least 0.').max(4, 'Decimal places must be at most 4.').default(2),
    isBase: z.boolean().default(false),
    exchangeRate: z.number().positive('Exchange rate must be positive.').default(1),
  })
  .strict();
export type CreateCurrencyInput = z.output<typeof createCurrencySchema>;

export const updateCurrencySchema = z
  .object({
    name: currencyNameSchema.optional(),
    symbol: currencySymbolSchema.optional(),
    decimalPlaces: z.number().int().min(0).max(4).optional(),
    isBase: z.boolean().optional(),
    exchangeRate: z.number().positive('Exchange rate must be positive.').optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateCurrencyInput = z.output<typeof updateCurrencySchema>;

export const listCurrenciesQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    q: z.string().trim().optional(),
  })
  .strict();
export type ListCurrenciesQuery = z.output<typeof listCurrenciesQuerySchema>;

export const currencyIdParamsSchema = z
  .object({ id: z.string().uuid('Invalid currency id.') })
  .strict();
