// V40 register views of the Procurement / SCM family. V40 shows one flat register per page (one row per PO line, GRN
// line, PR line ...) with the columns the client approved: material, ordered / received / pending quantity, invoice
// matched amount, vendor ratings and so on. This file builds exactly those rows from the real tables, with the
// computed columns (pending = ordered - received - closed, matched amount = sum of invoice line matches ...) done in SQL.
// A column that has no source in the database is returned as null (the screen shows a plain dash), never a made-up value.
import { prisma } from '../../core/db/prisma';
import type { Caller } from '../records/service';
import { norm, query, scopeSql } from './core';
import type { Row } from './core';

export type V40Kind =
  | 'po'
  | 'grn'
  | 'pr'
  | 'invoice'
  | 'invoice-exceptions'
  | 'supplier'
  | 'rfq'
  | 'quote'
  | 'comparison'
  | 'evaluation'
  | 'contract'
  | 'approval';

export interface V40Query {
  q?: string | undefined;
  status?: string | undefined;
  page: number;
  size: number;
}

interface Spec {
  /** page id: permission + OWN scope */
  page: string;
  from: string;
  select: string;
  order: string;
  /** SQL expressions the search box looks into */
  search: string[];
  /** SQL expression compared with ?status= */
  status?: string;
  /** how the rows are fenced to the caller's plant */
  scope: 'doc' | 'unit' | 'none';
  /** unit column when scope is 'unit' */
  unitCol?: string;
  softDelete?: boolean;
}

/** Sales order numbers that share the project of a document (a PR / PO / GRN has no direct sales order column). */
const soOf = (alias: string): string =>
  `(SELECT string_agg(so.number, ', ' ORDER BY so.number) FROM sales_orders so WHERE so.project_id = ${alias}.project_id AND so.deleted_at IS NULL)`;

/** The Supplier PO(s) behind an invoice: its own, else those of the goods receipts it bills. */
const poOfInvoice = `COALESCE(po.number, (SELECT string_agg(DISTINCT p2.number, ', ') FROM purchase_invoice_lines il2
  JOIN goods_receipt_lines gl2 ON gl2.id = il2.grn_line_id JOIN goods_receipts g2 ON g2.id = gl2.grn_id
  JOIN purchase_orders p2 ON p2.id = g2.po_id WHERE il2.invoice_id = t.id))`;

const SPECS: Record<V40Kind, Spec> = {
  po: {
    page: 'scm-po',
    scope: 'doc',
    from: `purchase_order_lines l
      JOIN purchase_orders t ON t.id = l.po_id
      JOIN suppliers s ON s.id = t.supplier_id
      LEFT JOIN items i ON i.id = l.item_id
      LEFT JOIN purchase_requisition_lines prl ON prl.id = l.pr_line_id
      LEFT JOIN purchase_requisitions pr ON pr.id = prl.pr_id
      LEFT JOIN payment_terms pt ON pt.id = t.payment_term_id
      LEFT JOIN warehouses w ON w.id = t.ship_to_warehouse_id
      LEFT JOIN users cu ON cu.id = t.created_by_id
      LEFT JOIN projects pj ON pj.id = t.project_id`,
    select: `t.id::text AS id, l.id::text AS line_id, l.line_no, t.number, t.status, t.version, t.po_date, t.department,
      t.revision_no, t.po_type, t.grand_total, pr.number AS pr_number, s.code AS vendor_id, s.name AS vendor,
      i.code AS material_code, COALESCE(i.name, l.service_text) AS material, l.qty AS ordered_quantity, l.uom, l.rate,
      l.gst_pct, (l.taxable + l.cgst + l.sgst + l.igst) AS total_amount, l.delivery_date AS expected_delivery_date,
      pt.name AS payment_terms, l.received_qty AS received_quantity, l.accepted_qty AS accepted_quantity,
      l.billed_qty AS billed_quantity, l.closed_qty AS cancelled_quantity,
      GREATEST(l.qty - l.received_qty - l.closed_qty, 0) AS pending_quantity,
      w.code AS ship_to, cu.name AS buyer, pj.code AS project_number,
      COALESCE((SELECT cso.number FROM sales_orders cso WHERE cso.id = t.sales_order_id), ${soOf('t')}) AS sales_order,
      (SELECT cso.customer_po_no FROM sales_orders cso WHERE cso.id = t.sales_order_id) AS customer_po,
      (l.taxable + l.cgst + l.sgst + l.igst) * LEAST(l.received_qty / NULLIF(l.qty, 0), 1) AS received_value,
      t.created_at`,
    order: 't.created_at DESC, t.number DESC, l.line_no',
    search: ['t.number', 's.name', 's.code', 'i.code', 'i.name', 'pr.number', '(SELECT cso.customer_po_no FROM sales_orders cso WHERE cso.id = t.sales_order_id)'],
    status: 't.status',
  },
  grn: {
    page: 'scm-grn',
    scope: 'doc',
    from: `goods_receipt_lines l
      JOIN goods_receipts t ON t.id = l.grn_id
      JOIN suppliers s ON s.id = t.supplier_id
      LEFT JOIN purchase_orders po ON po.id = t.po_id
      LEFT JOIN purchase_order_lines pol ON pol.id = l.po_line_id
      LEFT JOIN purchase_requisition_lines prl ON prl.id = pol.pr_line_id
      LEFT JOIN purchase_requisitions pr ON pr.id = prl.pr_id
      LEFT JOIN items i ON i.id = l.item_id
      LEFT JOIN warehouses w ON w.id = t.warehouse_id`,
    select: `t.id::text AS id, l.id::text AS line_id, l.line_no, t.number, t.status, t.version, t.receipt_date, t.qc_status,
      t.putaway_status, l.qc_state, t.vendor_invoice_ref, t.vehicle_no, po.number AS po_number, pr.number AS pr_number,
      ${soOf('t')} AS sales_order, s.code AS vendor_id, s.name AS vendor, i.code AS material_code, i.name AS material,
      pol.qty AS ordered_quantity, l.uom, l.received_qty AS received_quantity, l.accepted_qty AS accepted_quantity,
      l.rejected_qty AS rejected_quantity, l.putaway_qty AS putaway_quantity, l.rate, l.stock_value, w.code AS warehouse, w.name AS warehouse_name,
      GREATEST(pol.qty - pol.received_qty - pol.closed_qty, 0) AS po_balance_quantity,
      (SELECT string_agg(b.batch_no, ', ' ORDER BY b.batch_no) FROM goods_receipt_batches b WHERE b.grn_line_id = l.id) AS batch_number,
      t.created_at`,
    order: 't.created_at DESC, t.number DESC, l.line_no',
    search: ['t.number', 'po.number', 's.name', 's.code', 'i.code', 'i.name'],
    status: 't.status',
  },
  pr: {
    page: 'scm-pr',
    scope: 'doc',
    from: `purchase_requisition_lines l
      JOIN purchase_requisitions t ON t.id = l.pr_id
      LEFT JOIN items i ON i.id = l.item_id
      LEFT JOIN users ru ON ru.id = t.requested_by_id
      LEFT JOIN projects pj ON pj.id = t.project_id
      LEFT JOIN suppliers ps ON ps.id = t.preferred_supplier_id
      LEFT JOIN mfg_production_plans pp ON pp.id = t.production_plan_id`,
    select: `t.id::text AS id, l.id::text AS line_id, l.line_no, t.number, t.status, t.version, COALESCE(t.pr_date, t.created_at::date) AS pr_date,
      i.code AS material_code, COALESCE(i.name, l.service_text) AS required_material, l.qty AS quantity, l.uom,
      COALESCE(l.required_date, t.required_date) AS required_date, COALESCE(t.request_department, t.department) AS department, ru.name AS requester,
      COALESCE((SELECT rso.number FROM sales_orders rso WHERE rso.id = t.sales_order_id), ${soOf('t')}) AS sales_order,
      pj.code AS project_number, t.purpose, t.estimated_total, l.est_rate,
      t.priority, ps.name AS preferred_vendor, pp.number AS production_plan,
      l.closed_qty, GREATEST(l.qty - l.closed_qty, 0) AS open_quantity,
      (SELECT COALESCE(sum(b.on_hand), 0) FROM stock_balances b JOIN warehouses bw ON bw.id = b.warehouse_id
        WHERE b.item_id = l.item_id AND bw.unit_id = t.unit_id) AS stock_on_hand,
      (SELECT COALESCE(sum(d.qty), 0) FROM document_links d WHERE d.from_type = 'PR' AND d.from_line_id = l.id AND d.to_type = 'PO') AS ordered_quantity,
      (SELECT string_agg(DISTINCT po.number, ', ') FROM document_links d JOIN purchase_orders po ON po.id = d.to_id
        WHERE d.from_type = 'PR' AND d.from_line_id = l.id AND d.to_type = 'PO') AS po_numbers,
      COALESCE(t.mrp_line_no, (SELECT string_agg(DISTINCT f.flow_no, ', ') FROM bom_material_flows f WHERE f.pr_id = t.id)) AS mrp_line_no,
      t.created_at`,
    order: 't.created_at DESC, t.number DESC, l.line_no',
    search: ['t.number', 'i.code', 'i.name', 'ru.name', 'ps.name', 't.mrp_line_no'],
    status: 't.status',
  },
  invoice: {
    page: 'scm-purchaseinvoice',
    scope: 'doc',
    from: `purchase_invoices t
      JOIN suppliers s ON s.id = t.supplier_id
      LEFT JOIN purchase_orders po ON po.id = t.po_id
      LEFT JOIN units un ON un.id = t.unit_id`,
    select: `t.id::text AS id, t.number, t.status, t.version, s.code AS vendor_id, s.name AS vendor,
      t.vendor_invoice_no AS vendor_invoice_ref, t.invoice_date, t.due_date, ${poOfInvoice} AS po_number,
      (SELECT string_agg(DISTINCT g.number, ', ') FROM purchase_invoice_lines il
        JOIN goods_receipt_lines gl ON gl.id = il.grn_line_id JOIN goods_receipts g ON g.id = gl.grn_id
        WHERE il.invoice_id = t.id) AS grn_number,
      t.taxable AS taxable_value, (t.cgst + t.sgst + t.igst) AS gst, t.tds_amount AS tds, t.tds_section_code,
      t.grand_total AS invoice_total, t.net_payable, t.paid_amount,
      (SELECT COALESCE(sum(il.matched_value), 0) FROM purchase_invoice_lines il WHERE il.invoice_id = t.id) AS matched_amount,
      t.payment_status, t.match_state, t.payment_block, t.payment_block_reason, t.supplier_gstin, t.gstr2b_status,
      un.code AS company_code, t.department, t.is_rcm,
      (SELECT cso.customer_po_no FROM sales_orders cso WHERE cso.id = t.sales_order_id) AS customer_po,
      (SELECT cso.number FROM sales_orders cso WHERE cso.id = t.sales_order_id) AS sales_order,
      (SELECT count(*)::int FROM invoice_match_exceptions e WHERE e.invoice_id = t.id AND e.state = 'OPEN') AS open_exceptions,
      t.created_at`,
    order: 't.created_at DESC, t.number DESC',
    search: ['t.number', 's.name', 's.code', 't.vendor_invoice_no', poOfInvoice, '(SELECT cso.customer_po_no FROM sales_orders cso WHERE cso.id = t.sales_order_id)'],
    status: 't.status',
  },
  'invoice-exceptions': {
    page: 'scm-purchaseinvoice',
    scope: 'doc',
    from: `invoice_match_exceptions e
      JOIN purchase_invoices t ON t.id = e.invoice_id
      JOIN suppliers s ON s.id = t.supplier_id`,
    select: `e.id::text AS id, t.id::text AS invoice_id, t.number, e.code, e.severity, e.message, e.state, e.reason,
      e.created_at, GREATEST(CURRENT_DATE - e.created_at::date, 0)::int AS age_days, t.department, s.name AS vendor`,
    order: 'e.created_at DESC, e.id',
    search: ['t.number', 'e.code', 's.name'],
    status: 'e.state',
  },
  supplier: {
    page: 'scm-suppliers',
    scope: 'none',
    from: `suppliers t
      LEFT JOIN payment_terms pt ON pt.id = t.payment_term_id
      LEFT JOIN LATERAL (SELECT c.name, c.mobile, c.email FROM supplier_contacts c WHERE c.supplier_id = t.id
        ORDER BY c.is_primary DESC, c.name LIMIT 1) ct ON true
      LEFT JOIN LATERAL (SELECT a.line1, a.city, a.pincode, a.state_code FROM supplier_addresses a WHERE a.supplier_id = t.id
        ORDER BY a.is_default DESC, a.type LIMIT 1) ad ON true
      LEFT JOIN LATERAL (SELECT e.quality, e.delivery, e.cost, e.response, e.overall, e.grade, e.period FROM supplier_evaluations e
        WHERE e.supplier_id = t.id ORDER BY e.period DESC, e.created_at DESC LIMIT 1) ev ON true`,
    select: `t.id::text AS id, t.code AS vendor_id, t.name AS vendor_name, t.legal_name, t.supplier_type,
      CASE t.material_class WHEN 'DIRECT' THEN 'Direct Material' WHEN 'INDIRECT' THEN 'Indirect' END AS material_class, t.status,
      t.version, t.approval_status, t.gstin AS gst_number, t.pan, t.state_code, t.gst_registration_type,
      ct.name AS contact_person, ct.mobile, ct.email,
      NULLIF(concat_ws(', ', ad.line1, ad.city, ad.pincode), '') AS address, pt.name AS payment_terms,
      (SELECT string_agg(DISTINCT i.category, ', ' ORDER BY i.category) FROM supplier_items si JOIN items i ON i.id = si.item_id
        WHERE si.supplier_id = t.id AND i.category IS NOT NULL) AS material_categories,
      (SELECT round(avg(si.lead_days))::int FROM supplier_items si WHERE si.supplier_id = t.id AND si.lead_days IS NOT NULL) AS lead_time_days,
      ev.quality AS quality_rating, ev.delivery AS delivery_rating, ev.cost AS cost_rating, ev.response AS response_rating,
      ev.overall AS overall_rating, ev.grade, ev.period AS rating_period,
      t.purchase_hold, t.hold_reason, t.tds_section_code, t.msme_category, t.msme_udyam_no, t.currency_code,
      (SELECT count(*)::int FROM supplier_documents d WHERE d.supplier_id = t.id) AS document_count,
      (SELECT count(*)::int FROM supplier_documents d WHERE d.supplier_id = t.id AND d.valid_to < CURRENT_DATE) AS expired_documents,
      (SELECT count(*)::int FROM purchase_orders p WHERE p.supplier_id = t.id AND p.deleted_at IS NULL) AS po_count,
      t.created_at`,
    order: 't.name, t.id',
    search: ['t.code', 't.name', 't.gstin', 'ct.name', 'ct.email', `CASE t.material_class WHEN 'DIRECT' THEN 'Direct Material' WHEN 'INDIRECT' THEN 'Indirect' END`],
    status: 't.status',
  },
  rfq: {
    page: 'scm-rfq',
    scope: 'doc',
    from: `rfqs t LEFT JOIN users cu ON cu.id = COALESCE(t.buyer_id, t.created_by_id)
      LEFT JOIN projects pj ON pj.id = t.project_id`,
    select: `t.id::text AS id, t.number, t.status, t.version, t.issue_date AS rfq_date, t.due_date AS closing_date,
      t.department, cu.name AS buyer,
      COALESCE(NULLIF(t.category, ''), CASE t.supplier_type WHEN 'MATERIAL' THEN 'Material supplier' WHEN 'CONTRACTOR' THEN 'Contractor' ELSE t.supplier_type END) AS category,
      t.technical_spec, t.commercial_terms, t.delivery_location, t.validity, pj.code AS project_code, t.notes, t.issued_at,
      (SELECT string_agg(DISTINCT pr.number, ', ') FROM purchase_requisitions pr
        WHERE pr.id = t.pr_id OR pr.id IN (SELECT prl.pr_id FROM rfq_lines rl JOIN purchase_requisition_lines prl ON prl.id = rl.pr_line_id
          WHERE rl.rfq_id = t.id)) AS pr_number,
      (SELECT count(*)::int FROM rfq_suppliers rs WHERE rs.rfq_id = t.id) AS vendor_count,
      (SELECT count(*)::int FROM rfq_suppliers rs WHERE rs.rfq_id = t.id AND rs.responded_at IS NOT NULL) AS responded_count,
      (SELECT count(*)::int FROM rfq_lines rl WHERE rl.rfq_id = t.id) AS line_count,
      (SELECT count(*)::int FROM vendor_quotes vq WHERE vq.rfq_id = t.id AND vq.deleted_at IS NULL AND vq.is_current) AS quote_count,
      t.created_at`,
    order: 't.created_at DESC, t.number DESC',
    search: ['t.number', 'cu.name', 't.category', 'pj.code'],
    status: 't.status',
  },
  quote: {
    page: 'scm-vendorquote',
    scope: 'doc',
    from: `vendor_quotes t
      JOIN suppliers s ON s.id = t.supplier_id
      LEFT JOIN rfqs r ON r.id = t.rfq_id
      LEFT JOIN payment_terms pt ON pt.id = t.payment_term_id
      LEFT JOIN units un ON un.id = t.unit_id
      LEFT JOIN LATERAL (SELECT sum(l.qty * l.rate) AS base,
          sum(l.qty * l.rate * COALESCE(l.discount_pct, 0) / 100) AS disc,
          sum(l.qty * l.rate * (1 - COALESCE(l.discount_pct, 0) / 100) * COALESCE(l.gst_pct, 0) / 100) AS gst,
          sum(l.landed_cost) AS landed, max(l.lead_days) AS lead
        FROM vendor_quote_lines l WHERE l.quote_id = t.id) ag ON true
      LEFT JOIN customers qc ON qc.id = t.customer_id
      LEFT JOIN sales_orders qso ON qso.id = t.sales_order_id`,
    select: `t.id::text AS id, t.number, t.status, t.version, r.number AS rfq_no, s.code AS vendor_id, s.name AS vendor,
      t.quote_date, t.valid_until, t.round_no, t.is_current, ag.base AS base_amount, ag.disc AS discount, ag.gst,
      t.freight, t.other_charges, t.total AS total_before_tax,
      t.total + COALESCE(ag.gst, 0) + COALESCE(ag.landed, 0) AS landed_cost,
      t.warranty, qc.code AS customer_id, qso.customer_po_no AS customer_po_number, qso.number AS sales_order,
      ag.lead AS lead_time_days, pt.name AS payment_terms, t.technical_compliance, un.code AS company_code, t.department, t.created_at`,
    order: 't.created_at DESC, t.number DESC',
    search: ['t.number', 's.name', 's.code', 'r.number'],
    status: 't.status',
  },
  comparison: {
    page: 'scm-comparison',
    scope: 'doc',
    from: `vendor_comparisons t
      LEFT JOIN rfqs r ON r.id = t.rfq_id
      LEFT JOIN users cu ON cu.id = COALESCE(t.buyer_id, t.created_by_id)
      LEFT JOIN units un ON un.id = t.unit_id
      LEFT JOIN vendor_quotes aq ON aq.id = t.awarded_quote_id
      LEFT JOIN suppliers asup ON asup.id = aq.supplier_id
      LEFT JOIN LATERAL (SELECT count(*)::int AS n, min(e.total_landed) AS best,
          (SELECT s2.name FROM comparison_entries e2 JOIN suppliers s2 ON s2.id = e2.supplier_id
            WHERE e2.comparison_id = t.id ORDER BY e2.rank NULLS LAST, e2.total_landed LIMIT 1) AS top_vendor,
          (SELECT max(e3.total_score) FROM comparison_entries e3 WHERE e3.comparison_id = t.id) AS top_score
        FROM comparison_entries e WHERE e.comparison_id = t.id) en ON true`,
    select: `t.id::text AS id, t.number AS document_no, t.number, t.status, t.version,
      COALESCE(t.request_department, t.department) AS department, cu.name AS buyer,
      COALESCE(t.doc_date, t.created_at::date) AS document_date, COALESCE(t.required_date, r.due_date) AS required_date, r.number AS rfq_no,
      COALESCE(asup.name, en.top_vendor) AS vendor, asup.name AS awarded_vendor, en.n AS quote_count,
      COALESCE(aq.total, en.best) AS amount, en.best AS best_landed, en.top_score,
      t.w_price, t.w_lead, t.w_quality, un.code AS company_code, t.locked_at, t.award_reason, t.created_at`,
    order: 't.created_at DESC, t.number DESC',
    search: ['t.number', 'r.number', 'asup.name'],
    status: 't.status',
  },
  evaluation: {
    page: 'scm-evaluation',
    scope: 'unit',
    unitCol: 't.unit_id',
    from: `supplier_evaluations t JOIN suppliers s ON s.id = t.supplier_id`,
    select: `t.id::text AS id, ('EV-' || t.period || '-' || s.code) AS evaluation_no, s.code AS vendor_id, s.name AS vendor,
      t.period, t.quality AS quality_score, t.otif_pct AS delivery_otif, t.delivery AS delivery_score, t.cost AS cost_score,
      t.response AS responsiveness, t.overall, t.grade, t.rank, t.ppm, t.compliance_ok, t.risk_flag,
      CASE WHEN t.risk_flag THEN 'At risk' ELSE 'Graded' END AS status, t.created_at`,
    order: 't.period DESC, t.rank NULLS LAST, s.name',
    search: ['s.name', 's.code', 't.period'],
    status: `CASE WHEN t.risk_flag THEN 'At risk' ELSE 'Graded' END`,
  },
  contract: {
    page: 'scm-contracts',
    scope: 'doc',
    from: `purchase_contracts t
      JOIN suppliers s ON s.id = t.supplier_id`,
    select: `t.id::text AS id, t.number, t.status, t.version, t.title, s.code AS vendor_id, s.name AS vendor,
      t.contract_type, t.valid_from AS start_date, t.valid_to AS end_date, s.currency_code AS currency,
      t.max_value AS committed_value, t.released_value AS consumed_value,
      CASE WHEN t.max_value IS NULL THEN NULL ELSE t.max_value - t.released_value END AS balance_value,
      (SELECT string_agg(DISTINCT i.category, ', ' ORDER BY i.category) FROM purchase_contract_lines cl
        JOIN items i ON i.id = cl.item_id WHERE cl.contract_id = t.id AND i.category IS NOT NULL) AS category,
      (SELECT count(*)::int FROM purchase_orders p WHERE p.contract_id = t.id AND p.deleted_at IS NULL AND p.status <> 'Cancelled') AS release_orders,
      (SELECT count(*)::int FROM purchase_contract_lines cl WHERE cl.contract_id = t.id) AS line_count,
      (SELECT COALESCE(sum(cl.max_qty), 0) FROM purchase_contract_lines cl WHERE cl.contract_id = t.id) AS committed_qty,
      (SELECT COALESCE(sum(cl.released_qty), 0) FROM purchase_contract_lines cl WHERE cl.contract_id = t.id) AS consumed_qty,
      (t.valid_to - CURRENT_DATE)::int AS days_left, t.department, t.created_at`,
    order: 't.created_at DESC, t.number DESC',
    search: ['t.number', 's.name', 's.code', 't.title'],
    status: 't.status',
  },
  approval: {
    page: 'scm-approval',
    scope: 'none',
    softDelete: false,
    from: `approval_requests t
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN users u ON u.id = t.requested_by`,
    select: `t.id::text AS id, t.doc_code AS number, t.doc_code AS document_no,
      t.doc_type AS transaction_type, t.status, t.current_level, t.total_levels, t.amount,
      t.requested_at AS submitted_at, t.requested_at AS created_at,
      d.name AS department, u.name AS requester,
      t.doc_id::text AS document_id, t.version`,
    order: 't.requested_at DESC, t.doc_code DESC',
    search: ['t.doc_code', 't.doc_type', 'd.name', 'u.name'],
    status: 't.status',
  },
};

export const V40_KINDS = Object.keys(SPECS) as V40Kind[];
export const v40PageOf = (kind: V40Kind): string => SPECS[kind].page;

export async function v40Register(
  caller: Caller,
  kind: V40Kind,
  q: V40Query,
): Promise<{ rows: Row[]; total: number }> {
  const spec = SPECS[kind];
  const args: unknown[] = [];
  const where: string[] = [];
  if (spec.scope === 'doc') {
    const sc = await scopeSql(caller, spec.page, 't');
    args.push(...sc.args);
    where.push(sc.sql);
  } else if (spec.scope === 'unit') {
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      where.push(`${spec.unitCol ?? 't.unit_id'} = $${args.length}::uuid`);
    } else if (!caller.ctx.allUnits) where.push('false');
  } else if (spec.softDelete === false) {
    where.push('1=1');
  } else {
    where.push('t.deleted_at IS NULL');
  }
  if (q.q) {
    args.push(`%${q.q}%`);
    where.push(`(${spec.search.map((c) => `${c}::text ILIKE $${args.length}`).join(' OR ')})`);
  }
  if (q.status && spec.status) {
    args.push(q.status);
    where.push(`${spec.status} = $${args.length}`);
  }
  const w = where.join(' AND ');
  const total = Number(
    (await query(prisma, `SELECT count(*)::int AS n FROM ${spec.from} WHERE ${w}`, ...args))[0]?.n ?? 0,
  );
  const rows = await query(
    prisma,
    `SELECT ${spec.select} FROM ${spec.from} WHERE ${w} ORDER BY ${spec.order} LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
    ...args,
  );
  return { rows: rows.map((r) => norm(r)), total };
}
