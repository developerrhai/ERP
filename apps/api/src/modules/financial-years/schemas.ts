// Zod schemas for /financial-years (Phase 3 §A1). POST takes any of code / startDate / endDate /
// label (all optional: an empty body adds the year after the latest); the Indian FY rules are
// checked in the service. PATCH changes only the label. Strict objects.
import { z } from 'zod';

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.');

export const fyLabelSchema = z
  .string()
  .trim()
  .min(2, 'Label must be at least 2 characters.')
  .max(40, 'Label must be at most 40 characters.');

export const createFinancialYearSchema = z
  .object({
    code: z.string().trim().max(7, 'Use the form 2027-28.').optional(),
    label: fyLabelSchema.optional(),
    startDate: isoDateString.optional(),
    endDate: isoDateString.optional(),
  })
  .strict();
export type CreateFinancialYearInput = z.output<typeof createFinancialYearSchema>;

export const updateFinancialYearSchema = z.object({ label: fyLabelSchema }).strict();
export type UpdateFinancialYearInput = z.output<typeof updateFinancialYearSchema>;

export const fyIdParamsSchema = z
  .object({ id: z.string().uuid('Invalid financial year id.') })
  .strict();
