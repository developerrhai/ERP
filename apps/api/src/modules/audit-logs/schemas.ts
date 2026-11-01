// Zod schemas for the Audit Trail viewer: filters (dates accept YYYY-MM-DD or ISO timestamps; a
// date-only `to` includes that whole day), paging with size ≤ 100.
import { z } from 'zod';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateInput = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date.');

export const listAuditLogsQuerySchema = z
  .object({
    from: dateInput.optional(),
    to: dateInput.optional(),
    actorId: z.string().uuid('Invalid user id.').optional(),
    action: z.string().trim().min(1).max(64).optional(),
    targetType: z.string().trim().min(1).max(40).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .transform((v) => ({
    ...v,
    fromDate: v.from ? new Date(v.from) : undefined,
    toDate: v.to
      ? DATE_ONLY.test(v.to)
        ? new Date(new Date(v.to).getTime() + 24 * 60 * 60_000)
        : new Date(v.to)
      : undefined,
    toInclusive: v.to ? !DATE_ONLY.test(v.to) : false,
  }));
export type ListAuditLogsQuery = z.output<typeof listAuditLogsQuerySchema>;

export const auditLogIdParamsSchema = z.object({ id: z.string().uuid('Invalid id.') }).strict();
