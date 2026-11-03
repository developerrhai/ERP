// apps/api/src/kit/panels/schema.ts
// Zod schemas and validation for PanelDto (docs/plans/07-ENGINE-KIT.md §2.3, §6 KR-04)

import { z } from 'zod';

export const formatSchema = z.enum([
  'text',
  'number',
  'qty',
  'money',
  'pct',
  'date',
  'datetime',
  'bool',
  'status',
]);

export const kpiToneSchema = z.enum(['good', 'warn', 'bad']).nullable().optional();

export const kpiSchema = z.object({
  key: z.string().optional(),
  label: z.string(),
  value: z.union([z.string(), z.number(), z.null()]),
  format: formatSchema,
  tone: kpiToneSchema,
  hint: z.string().optional(),
});

export const panelCallSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    name: z.string(),
    target: z.enum(['row', 'rec']),
  }),
  z.object({
    kind: z.literal('command'),
    name: z.string(),
  }),
  z.object({
    kind: z.literal('post'),
    path: z.string(),
  }),
]);

export const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
  format: formatSchema,
  align: z.enum(['left', 'right']).optional(),
  editable: z
    .object({
      type: z.enum(['qty', 'money', 'text']),
      action: panelCallSchema,
    })
    .optional(),
});

export const payloadFieldTypeSchema = z.enum([
  'text',
  'longtext',
  'qty',
  'money',
  'pct',
  'date',
  'bool',
  'enum',
  'lookup',
]);

export const payloadFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: payloadFieldTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  lookup: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().optional(),
});

export const panelActionSchema = z.object({
  key: z.string(),
  label: z.string(),
  variant: z.enum(['primary', 'default', 'danger']).optional(),
  requires: z.enum(['add', 'edit', 'delete', 'approve']).optional(),
  confirm: z.string().nullable().optional(),
  call: panelCallSchema,
  payloadFields: z.array(payloadFieldSchema).optional(),
});

export const rowSchema = z.record(z.string(), z.unknown());

export const tableSectionSchema = z.object({
  type: z.literal('table'),
  title: z.string().optional(),
  columns: z.array(columnSchema),
  rows: z.array(rowSchema).max(500, 'Table section cannot exceed 500 rows.'),
  empty: z.string().optional(),
  meta: z
    .object({
      page: z.number().int(),
      size: z.number().int(),
      total: z.number().int(),
    })
    .optional(),
  totals: z.record(z.string(), z.number()).optional(),
  rowActions: z.array(panelActionSchema).optional(),
  headerActions: z.array(panelActionSchema).optional(),
});

export const stepperSectionSchema = z.object({
  type: z.literal('stepper'),
  title: z.string().optional(),
  steps: z.array(
    z.object({
      label: z.string(),
      state: z.enum(['done', 'current', 'pending', 'rejected']),
      note: z.string().optional(),
    }),
  ),
});

export const factsSectionSchema = z.object({
  type: z.literal('facts'),
  title: z.string().optional(),
  items: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
    }),
  ),
});

export const noticeSectionSchema = z.object({
  type: z.literal('notice'),
  tone: z.enum(['info', 'warn', 'bad']),
  text: z.string(),
});

export const linesSectionSchema = z.object({
  type: z.literal('lines'),
  lineKind: z.string(),
  editable: z.boolean(),
});

export const funnelSectionSchema = z.object({
  type: z.literal('funnel'),
  title: z.string().optional(),
  stages: z.array(
    z.object({
      label: z.string(),
      count: z.number(),
      valueText: z.string().optional(),
    }),
  ),
});

export const barsSectionSchema = z.object({
  type: z.literal('bars'),
  title: z.string().optional(),
  rows: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      max: z.number().optional(),
      format: formatSchema.optional(),
      tone: kpiToneSchema,
    }),
  ),
});

export const chartSectionSchema = z.object({
  type: z.literal('chart'),
  title: z.string().optional(),
  chartType: z.enum(['bar', 'line']),
  labels: z.array(z.string()),
  series: z.array(
    z.object({
      name: z.string(),
      data: z.array(z.number()),
    }),
  ),
});

export const timelineSectionSchema = z.object({
  type: z.literal('timeline'),
  title: z.string().optional(),
  events: z.array(
    z.object({
      at: z.string(),
      title: z.string(),
      detail: z.string().optional(),
      by: z.string().optional(),
      tone: kpiToneSchema,
    }),
  ),
});

export const calendarSectionSchema = z.object({
  type: z.literal('calendar'),
  title: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format.'),
  days: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.'),
      items: z.array(
        z.object({
          label: z.string(),
          tone: kpiToneSchema,
          ref: z.string().optional(),
        }),
      ),
    }),
  ),
});

export const boardSectionSchema = z.object({
  type: z.literal('board'),
  title: z.string().optional(),
  draggable: z.boolean(),
  move: panelCallSchema.optional(),
  lanes: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      cards: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          subtitle: z.string().optional(),
          badge: z.string().optional(),
          amount: z.number().optional(),
        }),
      ),
    }),
  ),
});

export const customSectionSchema = z.object({
  type: z.literal('custom'),
  component: z.string(),
  props: z.record(z.string(), z.unknown()),
});

export const sectionSchema = z.discriminatedUnion('type', [
  tableSectionSchema,
  stepperSectionSchema,
  factsSectionSchema,
  noticeSectionSchema,
  linesSectionSchema,
  funnelSectionSchema,
  barsSectionSchema,
  chartSectionSchema,
  timelineSectionSchema,
  calendarSectionSchema,
  boardSectionSchema,
  customSectionSchema,
]);

export const MAX_PANEL_SECTIONS = 12;
export const MAX_PANEL_JSON_BYTES = 400 * 1024; // 400 KB

export const panelDtoSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Panel key must be lowercase kebab-case.'),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    kpis: z.array(kpiSchema).optional(),
    sections: z.array(sectionSchema).max(MAX_PANEL_SECTIONS, `Panel cannot exceed ${MAX_PANEL_SECTIONS} sections.`),
    actions: z.array(panelActionSchema).optional(),
    notice: z.string().nullable().optional(),
  })
  .refine(
    (dto) => JSON.stringify(dto).length <= MAX_PANEL_JSON_BYTES,
    `Panel response exceeds maximum size of ${MAX_PANEL_JSON_BYTES / 1024} KB.`,
  );
