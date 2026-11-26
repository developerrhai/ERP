// The Item / SKU Master fields of the V40 add form (Part Number, Minimum Stock, Tax / GST %, Default BOM and Routing,
// Project Number, status). They are served on top of the frozen typed schema: the schema endpoint, the item validation and
// the Excel export all use itemSchemaFull(), so the form, the API and the workbook always agree.
import type { Item } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import type { FieldMeta } from '../../../engine/field-types';
import { TYPED_SCHEMAS } from '../definitions';
import type { TypedSchema } from '../definitions';

const field = (key: string, label: string, type: FieldMeta['type'], o: Partial<FieldMeta> = {}): FieldMeta => ({
  key,
  label,
  type,
  required: false,
  readOnly: false,
  ...o,
});

export const ITEM_WORKSPACE_FIELDS: readonly FieldMeta[] = [
  field('partNumber', 'Part Number', 'text', { maxLength: 60 }),
  field('minStock', 'Minimum Stock', 'qty', { min: 0, max: 99_999_999_999_999 }),
  field('taxPct', 'Tax / GST % (from HSN)', 'text', { readOnly: true }),
  field('defaultBom', 'Default BOM', 'text', { maxLength: 40 }),
  field('defaultRouting', 'Default Routing', 'text', { maxLength: 40 }),
  field('projectNumber', 'Project Number', 'text', { maxLength: 40 }),
  field('recordStatus', 'Status on Save', 'enum', { options: ['Active', 'Inactive'] }),
];

let full: TypedSchema | null = null;
export function itemSchemaFull(): TypedSchema {
  if (!full) {
    const base = TYPED_SCHEMAS['inv-items'];
    full = { ...base, fields: [...base.fields, ...ITEM_WORKSPACE_FIELDS] };
  }
  return full;
}

export interface ItemExtra {
  taxPct: string | null;
  bom: string | null;
  routing: string | null;
  projectNumber: string | null;
}

/** GST rate of the HSN, the default BOM / routing built in Manufacturing and the project code of a page of items. */
export async function itemExtras(rows: readonly Item[]): Promise<Map<string, ItemExtra>> {
  const out = new Map<string, ItemExtra>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);
  // unpaginated: bounded by the page of items the caller passes in
  const found = await prisma.$queryRaw<
    { id: string; tax_pct: string | null; bom: string | null; routing: string | null; project: string | null }[]
  >`
    SELECT i.id::text,
      (SELECT g.igst_pct::text FROM hsn_sac_rates hr JOIN gst_rates g ON g.id = hr.gst_rate_id
        WHERE hr.hsn_id = i.hsn_id AND hr.effective_from <= CURRENT_DATE AND (hr.effective_to IS NULL OR hr.effective_to >= CURRENT_DATE)
        ORDER BY hr.effective_from DESC LIMIT 1) AS tax_pct,
      (SELECT b.number FROM mfg_boms b WHERE b.item_id = i.id AND b.deleted_at IS NULL ORDER BY b.is_default DESC, b.version_no DESC LIMIT 1) AS bom,
      (SELECT r.number FROM mfg_routings r WHERE r.item_id = i.id AND r.deleted_at IS NULL ORDER BY r.version_no DESC LIMIT 1) AS routing,
      (SELECT p.code FROM projects p WHERE p.id = i.project_id) AS project
    FROM items i WHERE i.id = ANY(${ids}::uuid[])`;
  for (const f of found) {
    out.set(f.id, {
      taxPct: f.tax_pct === null ? null : `${Number(f.tax_pct)}%`,
      bom: f.bom,
      routing: f.routing,
      projectNumber: f.project,
    });
  }
  return out;
}

/** A Default BOM / Routing number must be one that was made for this item. Returns the number as stored. */
async function ownDocument(
  kind: 'bom' | 'routing',
  value: string,
  itemId: string | null,
): Promise<string> {
  const rows =
    kind === 'bom'
      ? await prisma.$queryRaw<{ number: string; item_id: string }[]>`
          SELECT number, item_id::text FROM mfg_boms WHERE upper(number) = upper(${value}) AND deleted_at IS NULL LIMIT 20`
      : await prisma.$queryRaw<{ number: string; item_id: string }[]>`
          SELECT number, item_id::text FROM mfg_routings WHERE upper(number) = upper(${value}) AND deleted_at IS NULL LIMIT 20`;
  const label = kind === 'bom' ? 'BOM' : 'routing';
  const key = kind === 'bom' ? 'defaultBom' : 'defaultRouting';
  if (itemId === null) {
    throw Errors.validation({
      [key]: `A ${label} is made for a saved item: save the item first, create its ${label}, then enter it here.`,
    });
  }
  const mine = rows.find((r) => r.item_id === itemId);
  if (mine) return mine.number;
  throw Errors.validation({
    [key]: rows.length
      ? `${value} is the ${label} of another item.`
      : `No ${label} has the number ${value}. Create it under Manufacturing first, or leave this blank.`,
  });
}

/**
 * Turns the form values that are not plain columns into what the table stores: the BOM / routing number checked against the
 * item, the project id for a project number. `cleared` keys blank the column.
 */
export async function resolveItemRefs(
  values: Record<string, unknown>,
  cleared: readonly string[],
  itemId: string | null,
): Promise<{ defaultBomRef?: string | null; defaultRoutingRef?: string | null; projectId?: string | null }> {
  const out: { defaultBomRef?: string | null; defaultRoutingRef?: string | null; projectId?: string | null } = {};
  if (typeof values.defaultBom === 'string' && values.defaultBom) {
    out.defaultBomRef = await ownDocument('bom', values.defaultBom, itemId);
  } else if (cleared.includes('defaultBom')) out.defaultBomRef = null;
  if (typeof values.defaultRouting === 'string' && values.defaultRouting) {
    out.defaultRoutingRef = await ownDocument('routing', values.defaultRouting, itemId);
  } else if (cleared.includes('defaultRouting')) out.defaultRoutingRef = null;
  if (typeof values.projectNumber === 'string' && values.projectNumber) {
    const p = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM projects WHERE upper(code) = upper(${values.projectNumber}) LIMIT 1`;
    if (!p[0]) {
      throw Errors.validation({
        projectNumber: `No project has the number ${values.projectNumber}. Create it under Projects first, or leave this blank.`,
      });
    }
    out.projectId = p[0].id;
  } else if (cleared.includes('projectNumber')) out.projectId = null;
  return out;
}
