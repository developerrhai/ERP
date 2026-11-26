// REQ-03: a purchase order / purchase invoice can name the customer's order it is bought for, so the Customer PO shows
// next to the Supplier PO. The link is the sales order that carries the Customer PO number.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { query } from './core';
import type { Row } from './core';

/** Sales orders of the caller's plant(s) that have a Customer PO number, newest first. */
export async function customerPos(caller: Caller, q?: string): Promise<Row[]> {
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return query(
    prisma,
    `SELECT so.id::text AS id, so.number, so.customer_po_no AS "customerPoNo", c.name AS "customerName", so.status
       FROM sales_orders so JOIN customers c ON c.id = so.customer_id
      WHERE so.deleted_at IS NULL AND so.status <> 'Cancelled' AND COALESCE(so.customer_po_no, '') <> ''
        AND so.unit_id = ANY($1::uuid[])
        AND ($2::text IS NULL OR so.customer_po_no ILIKE $2 OR so.number ILIKE $2 OR c.name ILIKE $2)
      ORDER BY so.created_at DESC, so.number DESC LIMIT 100`,
    caller.ctx.unitIds,
    like,
  );
}

/** Refuses an order that no longer exists or belongs to a plant the person does not work in. One plant may buy for
 *  another plant's order. */
export async function assertCustomerOrder(db: Db, unitIds: string[], salesOrderId: string): Promise<void> {
  const so = await query(db, `SELECT 1 FROM sales_orders WHERE id = $1::uuid AND unit_id = ANY($2::uuid[]) AND deleted_at IS NULL`, salesOrderId, unitIds);
  if (!so[0]) throw Errors.validation({ salesOrderId: 'Choose a customer order of a plant you work in.' });
}

/** The customer order of the purchase orders behind these goods receipt lines, when they all name the same one. */
export async function customerOrderOfReceipt(db: Db, grnLineIds: string[]): Promise<string | null> {
  if (grnLineIds.length === 0) return null;
  const rows = await query(
    db,
    `SELECT DISTINCT po.sales_order_id::text AS id FROM goods_receipt_lines gl
       JOIN goods_receipts g ON g.id = gl.grn_id JOIN purchase_orders po ON po.id = g.po_id
      WHERE gl.id = ANY($1::uuid[]) AND po.sales_order_id IS NOT NULL`,
    grnLineIds,
  );
  return rows.length === 1 ? String(rows[0]!.id) : null;
}

/** What a record view shows for the link: the Customer PO number and the sales order. */
export async function customerPoLabels(db: Db, salesOrderId: unknown): Promise<{ customerPoNo?: string; salesOrderNo?: string }> {
  if (typeof salesOrderId !== 'string' || salesOrderId === '') return {};
  const r = (await query(db, `SELECT number, customer_po_no FROM sales_orders WHERE id = $1::uuid`, salesOrderId))[0];
  if (!r) return {};
  return { salesOrderNo: String(r.number), ...(typeof r.customer_po_no === 'string' && r.customer_po_no ? { customerPoNo: r.customer_po_no } : {}) };
}
