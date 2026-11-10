import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listQuerySchema = z
  .object({
    unread: bool.optional(),
    type: z.string().trim().min(1).max(64).optional(),
    group: z.enum(['Approvals', 'System']).optional(),
    category: z
      .enum(['APPROVAL', 'ALERT', 'DOCUMENT', 'ANNOUNCEMENT', 'SECURITY', 'REMINDER', 'DIGEST', 'MARKETING'])
      .optional(),
    cursor: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    includeArchived: bool.optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const idParamsSchema = z
  .object({ id: z.string().regex(/^[0-9a-fA-F-]{36}$/, 'Invalid id.') })
  .strict();

export const preferencesBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            type: z.string().trim().min(1).max(64),
            inApp: z.boolean(),
            email: z.enum(['OFF', 'INSTANT', 'DIGEST']),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
