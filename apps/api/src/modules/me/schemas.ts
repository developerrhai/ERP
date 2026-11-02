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
