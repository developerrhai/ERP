// Zod schemas for GET /me/permissions and PUT /me/context (strict: unknown keys are rejected with
// 422). Context ids are checked by the context rules, so a bad id is 422 CONTEXT_INVALID like a header.
import { z } from 'zod';

export const mePermissionsQuerySchema = z
  .object({ pageId: z.string().trim().min(1, 'pageId is required.').max(80) })
  .strict();

export const putContextSchema = z
  .object({
    unitId: z.string().trim().min(1, 'Choose a unit.').max(64).nullable(),
    fyId: z.string().trim().min(1, 'Choose a financial year.').max(64),
  })
  .strict();
export type PutContextInput = z.output<typeof putContextSchema>;

export const putPlantsSchema = z
  .object({
    selected: z.array(z.string().trim().min(1).max(64)).min(1, 'Choose at least one plant to continue.').max(50),
    remember: z.boolean().default(false),
  })
  .strict();

export const adminPlantsSchema = z
  .object({
    unitIds: z.array(z.string().uuid()).max(50).default([]),
    allUnits: z.boolean().default(false),
    defaultUnitId: z.string().uuid().nullable().default(null),
  })
  .strict();

export const homePrefsSchema = z
  .object({
    pinnedPages: z.array(z.string().max(80)).max(40).optional(),
    hiddenFamilies: z.array(z.string().max(80)).max(40).optional(),
    familyOrder: z.array(z.string().max(80)).max(60).optional(),
    landing: z.string().max(80).optional(),
    theme: z.enum(['light', 'dark']).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
  })
  .strict();

export const searchQuerySchema = z.object({ q: z.string().trim().max(80).default('') }).strict();
export const roleLandingSchema = z
  .object({ roleId: z.string().uuid(), landing: z.string().trim().min(1).max(80) })
  .strict();

export const putLocaleSchema = z
  .object({
    locale: z.enum(['en', 'hi']),
  })
  .strict();
