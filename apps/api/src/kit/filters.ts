// apps/api/src/kit/filters.ts
// Typed filter validation, parsing, and query building for Kit pages (docs/plans/07-ENGINE-KIT.md §2.8, §6 KR-08, §12 T-KIT-06)

import { z } from 'zod';
import { offsetWithinCap } from '../core/http/query-safety';
import type { TypedSchema } from '../modules/inventory/definitions';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-\d{2}$/;

export function buildTypedListQuery(schema?: TypedSchema | null) {
  const shape: Record<string, z.ZodTypeAny> = {
    q: z.string().trim().max(100, 'Search query must be at most 100 characters.').optional(),
    status: z.string().trim().min(1).max(30).optional(),
    sort: z.string().trim().min(1).max(81).default('-createdAt'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
    deleted: bool.optional(),
    view: z.enum(['ledger', 'vouchers']).optional(),
    warehouseId: z.string().regex(UUID_REGEX, 'Invalid warehouse id.').optional(),
    belowReorder: bool.optional(),
  };

  const declaredFilters = schema?.filters ?? [];
  for (const flt of declaredFilters) {
    if (flt.param in shape && (flt.param === 'warehouseId' || flt.param === 'belowReorder')) {
      // Keep legacy shape definition, will be copied to filters
      continue;
    }

    if (flt.type === 'bool') {
      shape[flt.param] = z
        .enum(['true', 'false'], {
          errorMap: () => ({ message: 'Invalid boolean filter (expected "true" or "false").' }),
        })
        .transform((v) => v === 'true')
        .optional();
    } else if (flt.type === 'select') {
      if (flt.options && flt.options.length > 0) {
        shape[flt.param] = z
          .enum(flt.options as [string, ...string[]], {
            errorMap: () => ({ message: `Value must be one of: ${flt.options?.join(', ')}` }),
          })
          .optional();
      } else {
        shape[flt.param] = z.string().trim().min(1).max(100).optional();
      }
    } else if (flt.type === 'text') {
      shape[flt.param] = z.string().trim().max(100, 'Text exceeds 100 characters.').optional();
    } else if (flt.type === 'date') {
      shape[flt.param] = z
        .string()
        .regex(DATE_REGEX, 'Date must match YYYY-MM-DD.')
        .refine(
          (val) => {
            const parts = val.split('-').map(Number);
            const y = parts[0];
            const m = parts[1];
            const d = parts[2];
            if (y === undefined || m === undefined || d === undefined) return false;
            const dt = new Date(Date.UTC(y, m - 1, d));
            return (
              dt.getUTCFullYear() === y &&
              dt.getUTCMonth() === m - 1 &&
              dt.getUTCDate() === d
            );
          },
          'Invalid calendar date.',
        )
        .optional();
    } else if (flt.type === 'month') {
      shape[flt.param] = z
        .string()
        .regex(MONTH_REGEX, 'Month must match YYYY-MM.')
        .refine(
          (val) => {
            const parts = val.split('-').map(Number);
            const m = parts[1];
            if (m === undefined) return false;
            return m >= 1 && m <= 12;
          },
          'Invalid month.',
        )
        .optional();
    } else if (flt.type === 'lookup') {
      shape[flt.param] = z
        .string()
        .regex(UUID_REGEX, 'Invalid lookup id (expected UUID).')
        .optional();
    }
  }

  return z
    .object(shape)
    .strict()
    .superRefine((query: any, ctx: z.RefinementCtx) => offsetWithinCap(query, ctx))
    .transform((data: Record<string, any>) => {
      const filtersObj: Record<string, string | boolean> = {};
      for (const flt of declaredFilters) {
        if (data[flt.param] !== undefined) {
          filtersObj[flt.param] = data[flt.param];
        }
      }
      return {
        ...data,
        filters: filtersObj,
      };
    });
}

export function buildTypedExportQuery(schema?: TypedSchema | null) {
  const shape: Record<string, z.ZodTypeAny> = {
    q: z.string().trim().max(100, 'Search query must be at most 100 characters.').optional(),
    status: z.string().trim().min(1).max(30).optional(),
    sort: z.string().trim().min(1).max(81).default('-createdAt'),
    deleted: bool.optional(),
    view: z.enum(['ledger', 'vouchers']).optional(),
    warehouseId: z.string().regex(UUID_REGEX, 'Invalid warehouse id.').optional(),
    belowReorder: bool.optional(),
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
  };

  const declaredFilters = schema?.filters ?? [];
  for (const flt of declaredFilters) {
    if (flt.param in shape && (flt.param === 'warehouseId' || flt.param === 'belowReorder')) {
      continue;
    }

    if (flt.type === 'bool') {
      shape[flt.param] = z
        .enum(['true', 'false'], {
          errorMap: () => ({ message: 'Invalid boolean filter (expected "true" or "false").' }),
        })
        .transform((v) => v === 'true')
        .optional();
    } else if (flt.type === 'select') {
      if (flt.options && flt.options.length > 0) {
        shape[flt.param] = z
          .enum(flt.options as [string, ...string[]], {
            errorMap: () => ({ message: `Value must be one of: ${flt.options?.join(', ')}` }),
          })
          .optional();
      } else {
        shape[flt.param] = z.string().trim().min(1).max(100).optional();
      }
    } else if (flt.type === 'text') {
      shape[flt.param] = z.string().trim().max(100, 'Text exceeds 100 characters.').optional();
    } else if (flt.type === 'date') {
      shape[flt.param] = z
        .string()
        .regex(DATE_REGEX, 'Date must match YYYY-MM-DD.')
        .refine(
          (val) => {
            const parts = val.split('-').map(Number);
            const y = parts[0];
            const m = parts[1];
            const d = parts[2];
            if (y === undefined || m === undefined || d === undefined) return false;
            const dt = new Date(Date.UTC(y, m - 1, d));
            return (
              dt.getUTCFullYear() === y &&
              dt.getUTCMonth() === m - 1 &&
              dt.getUTCDate() === d
            );
          },
          'Invalid calendar date.',
        )
        .optional();
    } else if (flt.type === 'month') {
      shape[flt.param] = z
        .string()
        .regex(MONTH_REGEX, 'Month must match YYYY-MM.')
        .refine(
          (val) => {
            const parts = val.split('-').map(Number);
            const m = parts[1];
            if (m === undefined) return false;
            return m >= 1 && m <= 12;
          },
          'Invalid month.',
        )
        .optional();
    } else if (flt.type === 'lookup') {
      shape[flt.param] = z
        .string()
        .regex(UUID_REGEX, 'Invalid lookup id (expected UUID).')
        .optional();
    }
  }

  return z
    .object(shape)
    .strict()
    .transform((data: Record<string, any>) => {
      const filtersObj: Record<string, string | boolean> = {};
      for (const flt of declaredFilters) {
        if (data[flt.param] !== undefined) {
          filtersObj[flt.param] = data[flt.param];
        }
      }
      return {
        ...data,
        filters: filtersObj,
      };
    });
}

export function parseFilters(
  schema: TypedSchema | null | undefined,
  rawQuery: Record<string, unknown>,
) {
  const querySchema = buildTypedListQuery(schema);
  const parsed = querySchema.parse(rawQuery) as any;
  return {
    base: {
      q: parsed.q,
      status: parsed.status,
      sort: parsed.sort,
      page: parsed.page,
      size: parsed.size,
      deleted: parsed.deleted,
      view: parsed.view,
    },
    filters: parsed.filters,
  };
}
