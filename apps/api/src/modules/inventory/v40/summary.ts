// The KPI cards (Records in Scope, Completion, Open / Pending, At Risk) and the Validation Controls panel of Item / SKU
// Master, Product Master, Raw Material Master and Stock Balance. Every figure is counted from the real tables over the
// whole set the caller may see, never from the rows on one screen.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Caller } from '../../records/service';
import { MATERIAL_TYPES, PRODUCT_TYPES } from './datasets';
import { OPEN_RESERVATION, scopeSql } from './stats';

export interface ControlRule {
  name: string;
  state: 'Enabled' | 'Optional';
  detail: string;
}

export interface WorkspaceSummary {
  records: number;
  completeness: number;
  openPending: number;
  atRisk: number;
  /** atRisk as a score out of 100. */
  riskScore: number;
  /** A fifth card where the page has one (Selling Price, Stock Value). */
  primary?: { label: string; value: number; format: 'money' };
  hints: { completeness: string; openPending: string; atRisk: string };
  controls: ControlRule[];
}

const ITEM_CONTROLS: ControlRule[] = [
  { name: 'Unique code', state: 'Enabled', detail: 'An item code (and a barcode) can be used only once.' },
  { name: 'Mandatory name', state: 'Enabled', detail: 'Name, item type, base UOM and HSN / SAC are required.' },
  { name: 'Effective date', state: 'Enabled', detail: 'The GST rate follows the dated rate of the HSN / SAC code.' },
  { name: 'Duplicate check', state: 'Enabled', detail: 'A repeated code or barcode is refused when saving.' },
  { name: 'Approval on change', state: 'Optional', detail: 'Changes save at once. Submit Approval sends an item for review.' },
  { name: 'Audit history', state: 'Enabled', detail: 'Every add, change and delete is written to the Audit Trail.' },
];

const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

interface Counts {
  records: number;
  filled: number;
  open_pending: number;
  at_risk: number;
  primary: string | null;
}

async function stockSummary(caller: Caller): Promise<WorkspaceSummary> {
  const scope = scopeSql(caller);
  // unpaginated: one row of totals over the balances in scope
  const rows = await prisma.$queryRaw<Counts[]>`
    SELECT count(*)::int AS records,
      COALESCE(sum((i.category IS NOT NULL)::int + (i.hsn_sac IS NOT NULL)::int + (i.reorder_level IS NOT NULL)::int
        + (i.standard_cost IS NOT NULL)::int),0)::int AS filled,
      (SELECT count(*)::int FROM stock_reservations r JOIN warehouses w ON w.id = r.warehouse_id
        WHERE r.status IN ${OPEN_RESERVATION} AND ${scope}) AS open_pending,
      count(*) FILTER (WHERE (i.reorder_level IS NOT NULL AND b.on_hand < i.reorder_level)
        OR EXISTS (SELECT 1 FROM stock_reservations r WHERE r.item_id = b.item_id AND r.warehouse_id = b.warehouse_id
          AND r.status IN ${OPEN_RESERVATION} AND r.required_qty - r.fulfilled_qty > r.reserved_qty))::int AS at_risk,
      COALESCE(sum(b.value),0)::text AS primary
    FROM stock_balances b JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id
    WHERE ${scope}`;
  const c = rows[0];
  const records = c?.records ?? 0;
  return {
    records,
    completeness: pct(c?.filled ?? 0, records * 4),
    openPending: c?.open_pending ?? 0,
    atRisk: c?.at_risk ?? 0,
    riskScore: pct(c?.at_risk ?? 0, records),
    primary: { label: 'Stock Value', value: Number(c?.primary ?? 0), format: 'money' },
    hints: {
      completeness: 'Category, HSN / SAC, reorder level and standard cost of the items in stock',
      openPending: 'Reservations still waiting or partly reserved',
      atRisk: 'Rows below their reorder level or short against a reservation',
    },
    controls: [],
  };
}

async function itemSummary(caller: Caller, pageId: string): Promise<WorkspaceSummary> {
  const types = pageId === 'master-products' ? PRODUCT_TYPES : pageId === 'master-materials' ? MATERIAL_TYPES : null;
  const typed = types ? Prisma.sql`AND i.item_type = ANY(${types}::text[])` : Prisma.empty;
  const price = pageId === 'master-materials' ? Prisma.sql`i.standard_cost` : Prisma.sql`i.selling_price`;
  // Item Master asks for the classification fields; the product / material masters also ask for price, part number and planning
  const fields = types
    ? Prisma.sql`(i.category IS NOT NULL)::int + (i.hsn_sac IS NOT NULL)::int + (${price} IS NOT NULL)::int
        + (i.part_number IS NOT NULL)::int + (i.reorder_level IS NOT NULL)::int + (i.min_stock IS NOT NULL
          OR EXISTS (SELECT 1 FROM reorder_policies p WHERE p.item_id = i.id AND p.status = 'Active'))::int`
    : Prisma.sql`(i.category IS NOT NULL)::int + (i.brand IS NOT NULL)::int + (i.hsn_sac IS NOT NULL)::int
        + (i.standard_cost IS NOT NULL)::int + (i.selling_price IS NOT NULL)::int + (i.reorder_level IS NOT NULL)::int`;
  // unpaginated: one row of totals over the items of this master
  const rows = await prisma.$queryRaw<Counts[]>`
    WITH stock AS (
      SELECT b.item_id, sum(b.on_hand) AS on_hand FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id
      WHERE ${scopeSql(caller)} GROUP BY b.item_id
    )
    SELECT count(*)::int AS records,
      COALESCE(sum(${fields}),0)::int AS filled,
      count(*) FILTER (WHERE i.status = 'INACTIVE')::int AS open_pending,
      count(*) FILTER (WHERE i.status = 'ACTIVE' AND (i.hsn_sac IS NULL
        OR COALESCE(s.on_hand,0) < GREATEST(COALESCE(i.reorder_level,0), COALESCE(i.min_stock,0))))::int AS at_risk,
      avg(${price})::text AS primary
    FROM items i LEFT JOIN stock s ON s.item_id = i.id
    WHERE i.deleted_at IS NULL ${typed}`;
  const c = rows[0];
  const records = c?.records ?? 0;
  return {
    records,
    completeness: pct(c?.filled ?? 0, records * 6),
    openPending: c?.open_pending ?? 0,
    atRisk: c?.at_risk ?? 0,
    riskScore: pct(c?.at_risk ?? 0, records),
    ...(types
      ? {
          primary: {
            label: pageId === 'master-materials' ? 'Avg Standard Cost' : 'Avg Selling Price',
            value: Math.round(Number(c?.primary ?? 0) * 100) / 100,
            format: 'money' as const,
          },
        }
      : {}),
    hints: {
      completeness: types
        ? 'Category, HSN / SAC, price, part number, reorder level and minimum stock filled'
        : 'Category, brand, HSN / SAC, standard cost, selling price and reorder level filled',
      openPending: 'Inactive records waiting to be activated',
      atRisk: 'Active records without HSN / SAC or with stock below the reorder / minimum level',
    },
    controls: ITEM_CONTROLS,
  };
}

export const SUMMARY_PAGES: ReadonlySet<string> = new Set(['inv-items', 'inv-stock', 'master-products', 'master-materials']);

export function workspaceSummary(caller: Caller, pageId: string): Promise<WorkspaceSummary> {
  return pageId === 'inv-stock' ? stockSummary(caller) : itemSummary(caller, pageId);
}
