// The drop-downs of the purchasing forms, the "load from a source document" answer, and the order / stage figures of
// the procurement screens. Everything is read from real records of the caller's plant(s).
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import type { Caller } from '../records/service';
import { spineService } from '../spine/service';
import { D } from '../inventory/money';
import { S, loadDoc, norm, query, scopeSql } from './core';
import type { Row } from './core';
import { refLabels } from './profile';
import { PR_DEF, RFQ_DEF } from './sourcing-service';

export const PURCHASE_PAGES = ['scm-pr', 'scm-rfq', 'scm-vendorquote', 'scm-comparison', 'scm-po'] as const;

/** list name -> query ($1 = the caller's plants, $2 = search pattern or null) returning id, label. */
const LISTS: Record<string, string> = {
  'sales-orders': `SELECT so.id::text AS id, concat_ws(' · ', so.number, NULLIF(so.customer_po_no, ''), c.name) AS label
      FROM sales_orders so JOIN customers c ON c.id = so.customer_id
     WHERE so.deleted_at IS NULL AND so.status <> 'Cancelled' AND so.unit_id = ANY($1::uuid[])
       AND ($2::text IS NULL OR so.number ILIKE $2 OR so.customer_po_no ILIKE $2 OR c.name ILIKE $2)
     ORDER BY so.created_at DESC, so.number DESC LIMIT 100`,
  'mfg-orders': `SELECT m.id::text AS id, concat_ws(' · ', m.number, i.name) AS label
      FROM mfg_orders m LEFT JOIN items i ON i.id = m.item_id
     WHERE m.deleted_at IS NULL AND m.status <> 'Cancelled' AND m.unit_id = ANY($1::uuid[])
       AND ($2::text IS NULL OR m.number ILIKE $2 OR i.name ILIKE $2)
     ORDER BY m.created_at DESC, m.number DESC LIMIT 100`,
  'production-plans': `SELECT p.id::text AS id, concat_ws(' · ', p.number, to_char(p.plan_date, 'DD-MM-YYYY')) AS label
      FROM mfg_production_plans p
     WHERE p.deleted_at IS NULL AND p.unit_id = ANY($1::uuid[]) AND ($2::text IS NULL OR p.number ILIKE $2)
     ORDER BY p.plan_date DESC, p.number DESC LIMIT 100`,
  customers: `SELECT c.id::text AS id, concat_ws(' · ', c.code, c.name) AS label FROM customers c
     WHERE c.deleted_at IS NULL AND $1::uuid[] IS NOT NULL AND ($2::text IS NULL OR c.code ILIKE $2 OR c.name ILIKE $2)
     ORDER BY c.name LIMIT 100`,
  users: `SELECT u.id::text AS id, concat_ws(' · ', u.name, u.department) AS label FROM users u
     WHERE u.status = 'ACTIVE' AND $1::uuid[] IS NOT NULL AND ($2::text IS NULL OR u.name ILIKE $2)
     ORDER BY u.name LIMIT 100`,
  departments: `SELECT d.name AS id, d.name AS label FROM departments d
     WHERE d.status = 'ACTIVE' AND $1::uuid[] IS NOT NULL AND ($2::text IS NULL OR d.name ILIKE $2) ORDER BY d.name LIMIT 100`,
  'payment-terms': `SELECT t.id::text AS id, t.name AS label FROM payment_terms t
     WHERE t.deleted_at IS NULL AND t.status = 'ACTIVE' AND $1::uuid[] IS NOT NULL AND ($2::text IS NULL OR t.name ILIKE $2)
     ORDER BY t.name LIMIT 100`,
};

/** Approved requisitions that still have something to ask for or to order, within the person's own scope. */
async function openRequisitions(caller: Caller, like: string | null): Promise<Row[]> {
  const sc = await scopeSql(caller, PR_DEF.pageId, 'p');
  const n = sc.args.length + 1;
  return query(
    prisma,
    `SELECT p.id::text AS id, concat_ws(' · ', p.number, NULLIF(p.purpose, '')) AS label FROM purchase_requisitions p
      WHERE ${sc.sql} AND p.status = 'Approved' AND ($${n}::text IS NULL OR p.number ILIKE $${n})
        AND EXISTS (SELECT 1 FROM purchase_requisition_lines l WHERE l.pr_id = p.id AND l.qty - l.closed_qty
              - COALESCE((SELECT sum(d.qty) FROM document_links d WHERE d.from_type = 'PR' AND d.from_line_id = l.id AND d.to_type = 'PO'), 0) > 0)
      ORDER BY p.created_at DESC, p.number DESC LIMIT 100`,
    ...sc.args,
    like,
  );
}

export async function optionList(caller: Caller, list: string, q?: string): Promise<Row[]> {
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  if (list === 'requisitions') return openRequisitions(caller, like);
  const sql = LISTS[list];
  if (!sql) throw Errors.notFound('Unknown list.');
  return query(prisma, sql, caller.ctx.unitIds, like);
}

export type SourceKind = 'pr' | 'rfq';
export const SOURCE_PAGE: Record<SourceKind, string> = { pr: 'scm-pr', rfq: 'scm-rfq' };

/** What a new document takes over from the one it is made from: the references and the lines. */
export async function sourceDocument(caller: Caller, kind: SourceKind, id: string): Promise<Row> {
  const head = await loadDoc(prisma, caller, kind === 'pr' ? PR_DEF : RFQ_DEF, id);
  const lines = await query(
    prisma,
    kind === 'pr'
      ? `SELECT l.id::text AS pr_line_id, l.item_id::text, l.service_text, l.uom, l.required_date, l.est_rate,
                i.code AS item_code, i.name AS item_name, i.hsn_sac,
                l.qty - l.closed_qty - COALESCE((SELECT sum(d.qty) FROM document_links d
                  WHERE d.from_type = 'PR' AND d.from_line_id = l.id AND d.to_type = 'PO'), 0) AS qty
           FROM purchase_requisition_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.pr_id = $1::uuid ORDER BY l.line_no`
      : `SELECT l.id::text AS rfq_line_id, l.pr_line_id::text, l.item_id::text, l.service_text, l.uom, l.required_date, l.qty,
                i.code AS item_code, i.name AS item_name, i.hsn_sac
           FROM rfq_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.rfq_id = $1::uuid ORDER BY l.line_no`,
    id,
  );
  const names = await refLabels(prisma, head);
  return {
    number: head.number,
    header: {
      salesOrderId: head.sales_order_id ?? null,
      mfgOrderId: head.mfg_order_id ?? null,
      customerId: head.customer_id ?? null,
      projectNumber: names.projectNumber ?? null,
      supplierType: head.supplier_type ?? null,
      requiredDate: kind === 'pr' ? (norm(head).requiredDate ?? null) : null,
    },
    lines: lines.map((l) => norm(l)).filter((l) => D(S(l.qty)).gt(0)),
  };
}

/** The "Connected Manufacturing" strip: the plant's real sales orders and where the chosen one stands. */
export async function orderFlow(caller: Caller, salesOrderId?: string): Promise<Row> {
  const orders = await query(
    prisma,
    `SELECT so.id::text AS id, so.number, c.name AS customer FROM sales_orders so JOIN customers c ON c.id = so.customer_id
      WHERE so.deleted_at IS NULL AND so.status <> 'Cancelled' AND so.unit_id = ANY($1::uuid[])
      ORDER BY so.created_at DESC, so.number DESC LIMIT 50`,
    caller.ctx.unitIds,
  );
  const chosen = salesOrderId && orders.some((o) => o.id === salesOrderId) ? salesOrderId : S(orders[0]?.id);
  if (!chosen) return { orders, selected: null, stages: [] };
  const o = await spineService.order360(caller, chosen);
  type Stage = { key: string; state: string; docs: { number: unknown }[] };
  const by = new Map((o.stages as Stage[]).map((s) => [s.key, s]));
  /** one strip stage made of one or more order stages */
  const stage = (label: string, detail: string, keys: string[]) => {
    const parts = keys.map((k) => by.get(k)).filter((x): x is Stage => !!x);
    const state = parts.every((p) => p.state === 'DONE')
      ? 'done'
      : parts.every((p) => p.state === 'NOT_STARTED')
        ? 'planned'
        : 'current';
    return { label, detail, state, documents: parts.flatMap((p) => p.docs.map((d) => S(d.number))).filter(Boolean).slice(0, 3) };
  };
  return {
    orders,
    selected: chosen,
    stages: [
      stage('Sales', 'SO / approval', ['so']),
      stage('Plan & MRP', 'Project', ['project']),
      stage('Purchase', 'PR / PO', ['pr', 'po']),
      stage('Receipt & IQC', 'GRN', ['grn']),
      stage('Material Issue', 'Issued to production', ['material']),
      stage('Production', 'Manufacturing order', ['mo']),
      stage('FG & Quality', 'Inspection', ['quality']),
      stage('DC & Receipt', 'Dispatch', ['dc']),
      stage('Invoice', 'Sales invoice', ['invoice']),
      stage('Payment', 'Collection', ['collection']),
    ],
  };
}

const STAGES: { page: string; label: string; table: string; open: string }[] = [
  { page: 'scm-pr', label: 'Purchase Requisition', table: 'purchase_requisitions', open: `t.status IN ('Draft','Pending Approval')` },
  { page: 'scm-rfq', label: 'RFQ', table: 'rfqs', open: `t.status IN ('Draft','Pending Approval')` },
  { page: 'scm-vendorquote', label: 'Vendor Quotation', table: 'vendor_quotes', open: `t.status IN ('Draft','Pending Approval')` },
  { page: 'scm-comparison', label: 'Vendor Comparison', table: 'vendor_comparisons', open: `t.status IN ('Draft','Pending Approval')` },
  { page: 'scm-po', label: 'Purchase Order', table: 'purchase_orders', open: `t.status IN ('Draft','Pending Approval')` },
  { page: 'scm-grn', label: 'Goods Receipt', table: 'goods_receipts', open: `t.status IN ('Draft','Pending Approval')` },
  { page: 'scm-purchaseinvoice', label: 'Purchase Invoice', table: 'purchase_invoices', open: `t.status IN ('Draft','Pending Approval')` },
];

/** The stage cards of the Purchase Work Center: documents in total and still open, for the pages the person may view. */
export async function purchaseStages(caller: Caller): Promise<Row[]> {
  const user = accessUserOf(caller.auth.user);
  const out: Row[] = [];
  for (const s of STAGES) {
    if (!(await can(user, s.page, 'view'))) continue;
    const sc = await scopeSql(caller, s.page);
    const r = (
      await query(
        prisma,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE ${s.open})::int AS open FROM ${s.table} t WHERE ${sc.sql}`,
        ...sc.args,
      )
    )[0]!;
    out.push({ page: s.page, label: s.label, total: Number(r.total), open: Number(r.open) });
  }
  return out;
}
