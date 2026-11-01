// Zod schema for GET /me/permissions (strict: unknown query keys are rejected with 422).
import { z } from 'zod';

export const mePermissionsQuerySchema = z
  .object({ pageId: z.string().trim().min(1, 'pageId is required.').max(80) })
  .strict();
