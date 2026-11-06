import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listQuerySchema = z
  .object({
    unread: bool.optional(),
    type: z.string().trim().min(1).max(40).optional(),
    group: z.enum(['Approvals', 'System']).optional(),
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
            type: z.string().trim().min(1).max(40),
            inApp: z.boolean(),
            email: z.enum(['OFF', 'INSTANT', 'DIGEST']),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
