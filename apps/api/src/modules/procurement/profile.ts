// Procurement comparison report: the references a purchasing document carries (customer order, manufacturing order,
// customer, project) and the other optional fields of its form. Ids are checked here before they are stored, and a
// record view gets their names back, so no screen ever shows a stored id.
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { assertCustomerOrder } from './customer-po';
import { S, norm, query, resolveProject } from './core';
import type { Row } from './core';

/** Form keys every purchasing document accepts for its references. */
export const REF_KEYS = ['salesOrderId', 'mfgOrderId', 'customerId', 'projectNumber'];

/** field -> [check query ($1 = id, $2 = the caller's plants), message]. */
const CHECKS: Record<string, [string, string]> = {
  mfgOrderId: [
    `SELECT 1 FROM mfg_orders WHERE id = $1::uuid AND unit_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    'Choose a manufacturing order of a plant you work in.',
  ],
  productionPlanId: [
    `SELECT 1 FROM mfg_production_plans WHERE id = $1::uuid AND unit_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    'Choose a production plan of a plant you work in.',
  ],
  customerId: [`SELECT 1 FROM customers WHERE id = $1::uuid AND deleted_at IS NULL AND $2::uuid[] IS NOT NULL`, 'Choose a customer.'],
  preferredSupplierId: [`SELECT 1 FROM suppliers WHERE id = $1::uuid AND deleted_at IS NULL AND $2::uuid[] IS NOT NULL`, 'Choose a supplier.'],
  buyerId: [`SELECT 1 FROM users WHERE id = $1::uuid AND status = 'ACTIVE' AND $2::uuid[] IS NOT NULL`, 'Choose an active user.'],
  requestedById: [`SELECT 1 FROM users WHERE id = $1::uuid AND status = 'ACTIVE' AND $2::uuid[] IS NOT NULL`, 'Choose an active user.'],
  prId: [
    `SELECT 1 FROM purchase_requisitions WHERE id = $1::uuid AND unit_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    'Choose a requisition of a plant you work in.',
  ],
};

/**
 * Checks the ids of a header and turns the typed project number into the project. Choosing a customer order also fills
 * the customer and the project it belongs to, where the form left them empty.
 */
export async function prepareRefs(tx: Db, caller: Caller, input: Row, existing: Row | null): Promise<Row> {
  const header = await resolveProject(tx, { ...input });
  for (const [key, [sql, message]] of Object.entries(CHECKS)) {
    const id = header[key];
    // an id the record already holds stays valid, even if its master was retired since
    const kept = existing && S(existing[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]) === S(id);
    if (!id || kept) continue;
    if (!(await query(tx, sql, id, caller.ctx.unitIds))[0]) throw Errors.validation({ [key]: message });
  }
  if (header.salesOrderId) {
    const kept = S(existing?.sales_order_id) === S(header.salesOrderId);
    if (!kept) await assertCustomerOrder(tx, caller.ctx.unitIds, S(header.salesOrderId));
    const so = (await query(tx, `SELECT customer_id::text AS customer_id, project_id::text AS project_id FROM sales_orders WHERE id = $1::uuid`, header.salesOrderId))[0];
    if (so && !header.customerId) header.customerId = so.customer_id;
    if (so?.project_id && !header.projectId) header.projectId = so.project_id;
  }
  return header;
}

/** The references of a stored row, in form keys, to copy into the document made from it. */
export const refsOf = (row: Row): Row => ({
  salesOrderId: row.sales_order_id ?? undefined,
  mfgOrderId: row.mfg_order_id ?? undefined,
  customerId: row.customer_id ?? undefined,
  projectId: row.project_id ?? undefined,
});

/** Names behind the ids of one header row. */
export async function refLabels(db: Db, row: Row): Promise<Row> {
  const r = (
    await query(
      db,
      `SELECT (SELECT number FROM sales_orders WHERE id = $1::uuid) AS sales_order_no,
              (SELECT customer_po_no FROM sales_orders WHERE id = $1::uuid) AS customer_po_no,
              (SELECT number FROM mfg_orders WHERE id = $2::uuid) AS mfg_order_no,
              (SELECT code FROM customers WHERE id = $3::uuid) AS customer_code,
              (SELECT name FROM customers WHERE id = $3::uuid) AS customer_name,
              (SELECT code FROM projects WHERE id = $4::uuid) AS project_number,
              (SELECT code FROM units WHERE id = $5::uuid) AS company_code,
              (SELECT name FROM units WHERE id = $5::uuid) AS company_name,
              (SELECT name FROM users WHERE id = $6::uuid) AS buyer_name,
              (SELECT name FROM users WHERE id = $7::uuid) AS requester_name,
              (SELECT name FROM suppliers WHERE id = $8::uuid) AS preferred_supplier_name,
              (SELECT number FROM mfg_production_plans WHERE id = $9::uuid) AS production_plan_no,
              (SELECT code FROM suppliers WHERE id = $10::uuid) AS vendor_id,
              (SELECT name FROM payment_terms WHERE id = $11::uuid) AS payment_terms`,
      row.sales_order_id ?? null,
      row.mfg_order_id ?? null,
      row.customer_id ?? null,
      row.project_id ?? null,
      row.unit_id ?? null,
      row.buyer_id ?? null,
      row.requested_by_id ?? null,
      row.preferred_supplier_id ?? null,
      row.production_plan_id ?? null,
      row.supplier_id ?? null,
      row.payment_term_id ?? null,
    )
  )[0]!;
  return norm(r);
}

export type Reference = { label: string; value: string };

/** "Label: value" pairs for a record view, empty ones left out. */
export const referenceList = (pairs: [string, unknown][]): Reference[] =>
  pairs.filter(([, v]) => v !== null && v !== undefined && S(v) !== '').map(([label, v]) => ({ label, value: S(v) }));

/** The pairs every purchasing document shares, in the order of the form. */
export const commonPairs = (l: Row): [string, unknown][] => [
  ['Company Code', l.companyCode],
  ['Customer ID', l.customerCode],
  ['Customer', l.customerName],
  ['Sales Order', l.salesOrderNo],
  ['Customer PO Number', l.customerPoNo],
  ['Manufacturing Order', l.mfgOrderNo],
  ['Project Number', l.projectNumber],
];
