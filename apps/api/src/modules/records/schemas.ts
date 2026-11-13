// Zod schemas for /pages/:pageId/records (docs/phase3-4 B3): route params, list / export filters,
// and the strict bodies. The record `data` itself is validated against the page's field metadata
// by the engine (record-input.ts), so here it is only "an object".
import { z } from 'zod';
import { offsetWithinCap } from '../../core/http/query-safety';

export const pageParamsSchema = z.object({ pageId: z.string().trim().min(1).max(80) }).strict();

export const recordParamsSchema = z
  .object({
    pageId: z.string().trim().min(1).max(80),
    /** A uuid; the Stock Balance page uses "<itemId>_<warehouseId>". */
    id: z.string().regex(/^[0-9a-fA-F-]{36}(_[0-9a-fA-F-]{36})?$/, 'Invalid record id.'),
  })
  .strict();

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const filters = {
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().min(1).max(30).optional(),
  sort: z.string().trim().min(1).max(81).default('-createdAt'),
  deleted: bool.optional(),
};

export const listRecordsQuerySchema = z
  .object({
    ...filters,
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine(offsetWithinCap);
export type ListRecordsQuery = z.output<typeof listRecordsQuerySchema>;

export const MAX_EXPORT_ROWS = 10_000;
/** Largest export answered inside the request; bigger ones run as a background job. */
export const SYNC_EXPORT_ROWS = 5_000;
/** Largest background export. */
export const ASYNC_EXPORT_ROWS = 50_000;

/** Extra filters of the typed Inventory pages (ledger / voucher view, warehouse, below reorder). */
const typedFilters = {
  view: z.enum(['ledger', 'vouchers']).optional(),
  warehouseId: z.string().uuid('Invalid warehouse id.').optional(),
  belowReorder: bool.optional(),
};

export const typedListQuerySchema = z
  .object({
    ...filters,
    ...typedFilters,
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine(offsetWithinCap);

export const typedExportQuerySchema = z
  .object({
    ...filters,
    ...typedFilters,
    ids: z
      .string()
      .trim()
      .max(80_000)
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      ),
  })
  .strict();

export { buildTypedListQuery, buildTypedExportQuery } from '../../kit/filters';

export const actionParamsSchema = z
  .object({
    pageId: z.string().trim().min(1).max(80),
    id: z.string().min(1).max(100),
    action: z.string().trim().min(1).max(30),
  })
  .strict();

export const actionBodySchema = z
  .object({
    dispatchedQty: z.number().positive('Enter a quantity greater than 0.').optional(),
    receivedQty: z.number().positive('Enter a quantity greater than 0.').optional(),
    payload: z
      .record(z.string(), z.unknown())
      .refine((val) => JSON.stringify(val).length <= 100 * 1024, 'Payload exceeds 100 KB limit.')
      .optional(),
  })
  .strict();

export const previewQuerySchema = z
  .object({
    itemId: z.string().max(64).optional(),
    warehouseId: z.string().max(64).optional(),
  })
  .strict();

export const exportRecordsQuerySchema = z
  .object({
    ...filters,
    /** Comma-separated record ids ("Export Selected"). */
    ids: z
      .string()
      .trim()
      .max(40_000)
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      )
      .pipe(z.array(z.string().uuid('Invalid record id.')).max(MAX_EXPORT_ROWS).optional()),
  })
  .strict();
export type ExportRecordsQuery = z.output<typeof exportRecordsQuerySchema>;

/** `unitId` (Phase 23): the plant a new document belongs to when 2+ plants are chosen. */
export const recordBodySchema = z
  .object({ data: z.record(z.unknown()), unitId: z.string().uuid().optional() })
  .strict();
export type RecordBody = z.output<typeof recordBodySchema>;

export const statusBodySchema = z
  .object({ to: z.string().trim().min(1, 'Choose a status.').max(30) })
  .strict();

export const restoreBodySchema = z
  .object({ undoToken: z.string().trim().min(1).max(200).optional() })
  .strict();

export const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine(offsetWithinCap);
export type AuditQuery = z.output<typeof auditQuerySchema>;

export const MAX_BULK = 200;

export const bulkBodySchema = z
  .object({
    action: z.literal('delete', { errorMap: () => ({ message: 'Only "delete" is supported.' }) }),
    ids: z
      .array(z.string().uuid('Invalid record id.'))
      .min(1, 'Choose at least one record.')
      .max(MAX_BULK, `At most ${MAX_BULK} records at a time.`),
  })
  .strict();
export type BulkBody = z.output<typeof bulkBodySchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/, 'Idempotency-Key must be printable ASCII without spaces.');

export const submitBulkBodySchema = z
  .object({
    ids: z
      .array(z.string().uuid('Invalid record id.'))
      .min(1, 'Select at least one record.')
      .max(100, 'Submit at most 100 records at a time.')
      .refine((ids) => new Set(ids).size === ids.length, 'Each record may appear only once.'),
  })
  .strict();
