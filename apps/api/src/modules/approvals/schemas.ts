import { z } from 'zod';

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'Invalid id.');
const pageId = z.string().trim().min(1).max(80);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30.');

export const idParamsSchema = z.object({ id: uuid }).strict();

export const matrixQuerySchema = z
  .object({
    department: z.string().trim().min(1).max(60).optional(),
    docType: z.string().trim().min(1).max(80).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const level = z
  .object({
    level: z.number().int().min(1).max(10),
    threshold: z
      .union([z.number(), z.string().regex(/^\d+(\.\d{1,2})?$/)])
      .refine(
        (v) => Number(v) >= 0 && Number(v) <= 99_999_999_999_999,
        'Enter an amount of 0 or more.',
      ),
    approverRoleId: uuid.nullish(),
    approverUserId: uuid.nullish(),
    slaHours: z.number().int().min(1).max(720).default(48),
    escalateRoleId: uuid.nullish(),
    escalateUserId: uuid.nullish(),
  })
  .strict();

export const matrixSetBodySchema = z
  .object({
    id: uuid.optional(),
    version: z.number().int().min(1).optional(),
    department: z.string().trim().min(1).max(60),
    docType: pageId.nullish(),
    unitId: uuid.nullish(),
    noAmountLevels: z.number().int().min(1).max(10),
    active: z.boolean().optional(),
    levels: z.array(level).min(1).max(10),
  })
  .strict();

export const matrixPreviewBodySchema = z
  .object({
    department: z.string().trim().min(1).max(60),
    docType: pageId.optional(),
    unitId: uuid.optional(),
    amount: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,2})?$/)]).nullish(),
  })
  .strict();

const page = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
};

export const inboxQuerySchema = z
  .object({
    docType: pageId.optional(),
    q: z.string().trim().max(100).optional(),
    ...page,
  })
  .strict();

export const requestsQuerySchema = z
  .object({
    status: z
      .enum(['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'WITHDRAWN', 'CANCELLED'])
      .optional(),
    docType: pageId.optional(),
    department: z.string().trim().min(1).max(60).optional(),
    mine: z.enum(['submitted']).optional(),
    q: z.string().trim().max(100).optional(),
    ...page,
  })
  .strict();

export const docParamsSchema = z.object({ docType: pageId, docId: uuid }).strict();

export const decisionBodySchema = z.object({ comment: z.string().max(1000).optional() }).strict();

export const reassignBodySchema = z.object({ userId: uuid, reason: z.string().max(1000) }).strict();

export const delegationBodySchema = z
  .object({
    toUserId: uuid,
    fromDate: isoDate,
    toDate: isoDate,
    department: z.string().trim().min(1).max(60).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
