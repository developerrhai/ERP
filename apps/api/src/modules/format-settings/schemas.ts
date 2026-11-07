// Zod schemas for the Format & Settings API (docs/phases/PHASE-06B.md §6).
import { z } from 'zod';

const uuid = z.string().uuid('Invalid id.');
const reason = z.string().trim().min(3, 'Give a short reason (at least 3 characters).').max(500);
const nullableUuid = z.union([uuid, z.null()]).optional();

export const pageParamsSchema = z.object({ pageId: z.string().min(1).max(80) }).strict();
export const idParamsSchema = z.object({ pageId: z.string().min(1).max(80), id: uuid }).strict();
export const codeParamsSchema = z
  .object({ pageId: z.string().min(1).max(80), code: z.string().min(1).max(40) })
  .strict();
export const globalIdParamsSchema = z.object({ id: uuid }).strict();

export const kindSchema = z.enum(['PRINT', 'FORM', 'REPORT']);

export const formatKeyQuerySchema = z
  .object({
    kind: kindSchema.optional(),
    customerId: uuid.optional(),
    unitId: uuid.optional(),
  })
  .strict();

export const formatVersionsQuerySchema = z
  .object({ kind: kindSchema, customerId: uuid.optional(), unitId: uuid.optional() })
  .strict();

export const resolveQuerySchema = z
  .object({ kind: kindSchema, customerId: uuid.optional(), unitId: uuid.optional() })
  .strict();

export const saveFormatBodySchema = z
  .object({
    kind: kindSchema,
    customerId: nullableUuid,
    unitId: nullableUuid,
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    schema: z.unknown(),
    reason: reason.optional(),
  })
  .strict();

export const saveRuleBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z][A-Za-z0-9_]{0,39}$/,
        'Use letters, digits and underscore, starting with a letter.',
      ),
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    moneyAffecting: z.boolean().default(true),
    definition: z.unknown(),
    reason: reason.optional(),
  })
  .strict();

export const reasonBodySchema = z.object({ reason }).strict();
export const optionalReasonBodySchema = z.object({ reason: reason.optional() }).strict();

export const evaluateBodySchema = z
  .object({
    id: uuid.optional(),
    code: z.string().trim().max(40).optional(),
    inputs: z.record(z.union([z.string(), z.number()])).default({}),
  })
  .strict()
  .refine((b) => b.id || b.code, { message: 'Send the rule set id or code.' });

export const importQuerySchema = z
  .object({
    target: z.enum(['format', 'rate-table']),
    kind: kindSchema.optional(),
    customerId: uuid.optional(),
    unitId: uuid.optional(),
    code: z.string().trim().max(40).optional(),
    tableName: z.string().trim().max(40).optional(),
    name: z.string().trim().max(120).optional(),
  })
  .strict();

export const templateQuerySchema = z.object({ target: z.enum(['format', 'rate-table']) }).strict();

export const listAllQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    pageId: z.string().trim().max(80).optional(),
    type: z.enum(['format', 'rule']).optional(),
    status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const changesQuerySchema = z
  .object({
    pageId: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
