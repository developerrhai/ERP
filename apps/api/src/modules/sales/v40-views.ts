// V40 tab views of the CRM and Sales pages (page-by-page build). One endpoint, GET /sales/v40/:pageId?tab=<V40 tab name>,
// answers every tab of a page with the columns V40 shows on that tab and values from the real tables:
//   * each page has one FROM (the document + joins) and a map "V40 column label -> SQL expression";
//   * each tab is a list of labels (a real view of the same data: other columns, other filters, other grain);
//   * a column with no real source (e.g. Campaign, Consent Status) has no expression and returns NULL (the screen shows a dash)
//     and is listed in V40_NO_SOURCE so the owner can see what is still open. Nothing is invented.
// Plant scope, soft delete and "own records only" are applied exactly like the document lists (scopeSql).
import { prisma } from '../../core/db/prisma';
import { scopeFor, accessUserOf } from '../../core/rbac/access';
import type { Caller } from '../records/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';

export type ColType = 'text' | 'date' | 'inr' | 'num' | 'pill' | 'docs' | 'actions' | 'time';
export interface Col {
  /** SQL expression (text-castable); absent = no real source yet */
  e?: string;
  type: ColType;
}
export interface PanelDef {
  title: string;
  /** FROM ... with alias p (scoped like the page) */
  from: string;
  unit: string | null;
  soft: string | null;
  where?: string[];
  /** SQL of the row id the panel buttons act on */
  id?: string;
  order: string;
  cols: [label: string, expr: string | undefined, type: ColType][];
}
export interface ViewDef {
  match: RegExp;
  labels: string[];
  /** replaces the page FROM (the grain changes, e.g. order lines) */
  from?: string;
  /** the record behind a row of this tab, when it differs from the page's (SQL; may be NULL for a row with none) */
  recordId?: string;
  cols?: Record<string, Col>;
  where?: string[];
  order?: string;
  /** search columns of this tab, when its FROM does not have the page's tables */
  search?: string[];
  /** the rows of this tab are records of another page (its documents, print and email apply to them) */
  recordPage?: string;
  panel?: PanelDef;
  /** the tab also shows the page's audit entries below the table */
  audit?: boolean;
}
export interface PageDef {
  from: string;
  unit?: string | null;
  soft?: string | null;
  owner?: string | null;
  /** SQL of the row version column (default t.version); null when the table has none */
  version?: string | null;
  /** SQL of the record a row belongs to, when the row is a line of it (a pick task of a pick wave): print, e-mail,
   *  documents and Move Forward act on that record */
  recordId?: string;
  number: string;
  status: string;
  search: string[];
  /** always applied (e.g. only posted orders) */
  base?: string[];
  order: string;
  cols: Record<string, Col>;
  register: string[];
  compact: string[];
  views: ViewDef[];
}

export const t = (e?: string): Col => (e ? { e, type: 'text' } : { type: 'text' });
export const d = (e: string): Col => ({ e, type: 'date' });
export const m = (e: string): Col => ({ e, type: 'inr' });
export const n = (e: string): Col => ({ e, type: 'num' });
export const none = (type: ColType = 'text'): Col => ({ type });

export const DOCS = (page: string): Col => ({
  e: `(SELECT count(*)::int FROM record_documents rd WHERE rd.page_id='${page}' AND rd.record_id=t.id AND rd.deleted_at IS NULL)`,
  type: 'docs',
});
export const ACTIONS: Col = { type: 'actions' };

/** Latest approval request of the row (approval_requests.doc_type = page id) and the role it waits on. */
export const apJoin = (page: string, idCol = 't.id'): string =>
  `LEFT JOIN LATERAL (SELECT ar.id, ar.status, ar.amount, ar.department_id FROM approval_requests ar WHERE ar.doc_type='${page}' AND ar.doc_id=${idCol} ORDER BY ar.cycle DESC LIMIT 1) ap ON true`;
export const approvalCols = (record: string): Record<string, Col> => ({
  Request: t(`upper(left(ap.id::text,8))`),
  Record: t(record),
  Department: t(`(SELECT dp.name FROM departments dp WHERE dp.id=ap.department_id)`),
  Amount: m('ap.amount'),
  'Current Role': t(
    `(SELECT COALESCE(ro.name,us.name) FROM approval_steps st LEFT JOIN roles ro ON ro.id=st.approver_role_id LEFT JOIN users us ON us.id=st.approver_user_id WHERE st.request_id=ap.id AND st.status='PENDING' ORDER BY st.level LIMIT 1)`,
  ),
  'Approval Status': t('ap.status'),
});
export const APPROVAL_LABELS = [
  'Request',
  'Record',
  'Department',
  'Amount',
  'Current Role',
  'Status',
  'Actions',
];

export const NOT_OPEN = `('Draft','Cancelled','Rejected')`;

/** Settlement panel V40 shows next to the money tabs: invoices with what is allocated and what is left. */
const settlementPanel = (title: string, extra: string[] = []): PanelDef => ({
  title,
  from: `sales_invoices p`,
  unit: 'p.unit_id',
  soft: 'p.deleted_at',
  id: 'p.id',
  where: [`p.status NOT IN ${NOT_OPEN}`, ...extra],
  order: 'p.due_date NULLS LAST, p.number',
  cols: [
    ['Reference', 'p.number', 'text'],
    ['Due', 'p.due_date', 'date'],
    ['Amount', 'p.grand_total', 'inr'],
    ['Allocated', 'p.received_amount', 'inr'],
    ['Balance', 'p.grand_total - p.received_amount', 'inr'],
    ['Action', `CASE WHEN p.grand_total - p.received_amount > 0 THEN 'Allocate' END`, 'actions'],
  ],
});

// ------------------------------------------------------------------------------------------------ line laterals
const soLines = `LEFT JOIN LATERAL (SELECT (array_agg(i.code ORDER BY l.line_no))[1] AS code,
    (array_agg(i.name ORDER BY l.line_no))[1] AS pname,
    (array_agg(l.uom ORDER BY l.line_no))[1] AS uom,
    (array_agg(l.rate ORDER BY l.line_no))[1] AS rate,
    sum(l.qty) AS qty, sum(l.dispatched_qty) AS disp, sum(l.invoiced_qty) AS inv, sum(l.closed_qty) AS closed, count(*) AS n
  FROM sales_order_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.order_id=t.id) ln ON true`;
const sqLines = `LEFT JOIN LATERAL (SELECT (array_agg(i.code ORDER BY l.line_no))[1] AS code,
    (array_agg(i.name ORDER BY l.line_no))[1] AS pname,
    (array_agg(l.rate ORDER BY l.line_no))[1] AS rate,
    (array_agg(l.discount_pct ORDER BY l.line_no))[1] AS disc,
    (array_agg(l.gst_pct ORDER BY l.line_no))[1] AS gst,
    max(l.lead_days) AS lead, sum(l.qty) AS qty, count(*) AS n
  FROM sales_quotation_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.quotation_id=t.id) ln ON true`;
const more = (e: string): string =>
  `${e} || CASE WHEN ln.n > 1 THEN ' +' || (ln.n - 1) || ' more' ELSE '' END`;

// ------------------------------------------------------------------------------------------------ pages
const SO_COMPACT = [
  'Sales Order ID',
  'SO No',
  'Quotation Number',
  'Customer ID',
  'Customer',
  'Order Date',
  'Product ID',
  'Status',
  'Actions',
];
const ORDERS: PageDef = {
  from: `sales_orders t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN sales_quotations sq ON sq.id=t.quotation_id ${soLines} ${apJoin('sales-orders')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 'cu.code', 't.customer_po_no', 'sq.number'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Sales Order ID': t(`upper(left(t.id::text,8))`),
    'SO No': t('t.number'),
    'Quotation Number': t('sq.number'),
    'Customer ID': t('cu.code'),
    Customer: t('cu.name'),
    'Order Date': d('t.order_date'),
    'Product ID': t('ln.code'),
    Product: t(more('ln.pname')),
    'Ordered Quantity': n('ln.qty'),
    Unit: t('ln.uom'),
    'Delivery Date': d('t.delivery_date'),
    Rate: m('ln.rate'),
    'Total Amount': m('t.grand_total'),
    Status: { e: 't.status', type: 'pill' },
    'Customer PO': t('t.customer_po_no'),
    'Customer PO No': t('t.customer_po_no'),
    'PO Date': d('t.customer_po_date'),
    'Dispatched Qty': n('ln.disp'),
    'Balance Qty': n('GREATEST(ln.qty - ln.disp - ln.closed, 0)'),
    'Invoiced Qty': n('ln.inv'),
    'Billed Value': m(
      `(SELECT COALESCE(sum(i.grand_total),0) FROM sales_invoices i WHERE i.order_id=t.id AND i.deleted_at IS NULL AND i.status NOT IN ${NOT_OPEN})`,
    ),
    'Billing Balance': m(
      `GREATEST(t.grand_total - (SELECT COALESCE(sum(i.grand_total),0) FROM sales_invoices i WHERE i.order_id=t.id AND i.deleted_at IS NULL AND i.status NOT IN ${NOT_OPEN}), 0)`,
    ),
    'Manufacturing Orders': n(
      `(SELECT count(*) FROM mfg_orders mo WHERE mo.source_type='SALES_ORDER' AND mo.source_id::text=t.id::text AND mo.deleted_at IS NULL)`,
    ),
    Docs: DOCS('sales-orders'),
    Actions: ACTIONS,
  },
  register: [
    'Sales Order ID',
    'SO No',
    'Customer PO No',
    'PO Date',
    'Quotation Number',
    'Customer ID',
    'Customer',
    'Order Date',
    'Product ID',
    'Product',
    'Ordered Quantity',
    'Unit',
    'Delivery Date',
    'Rate',
    'Docs',
    'Actions',
    'Total Amount',
    'Status',
  ],
  compact: SO_COMPACT,
  views: [
    {
      match: /^order items$/i,
      from: `sales_order_lines l JOIN sales_orders t ON t.id=l.order_id LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN sales_quotations sq ON sq.id=t.quotation_id LEFT JOIN items it ON it.id=l.item_id LEFT JOIN LATERAL (SELECT sum(x.qty) AS qty FROM sales_order_lines x WHERE x.order_id=t.id) ln ON true`,
      order: 't.created_at DESC, t.id, l.line_no',
      cols: {
        '#': n('l.line_no'),
        'Item / Service': t(`it.code || ' · ' || it.name`),
        Description: t('l.description'),
        Qty: n('l.qty'),
        Rate: m('l.rate'),
        'Disc %': n('l.discount_pct'),
        'Tax %': n('l.gst_pct'),
        Net: m('l.taxable'),
        Action: ACTIONS,
        'Sales Order ID': t(`upper(left(t.id::text,8))`),
        'Customer ID': t('cu.code'),
        Customer: t('cu.name'),
        'Order Date': d('t.order_date'),
        'Ordered Quantity': n('ln.qty'),
        'Delivery Date': d('COALESCE(l.delivery_date, t.delivery_date)'),
        'Total Amount': m('t.grand_total'),
        Status: { e: 't.status', type: 'pill' },
        Actions: ACTIONS,
      },
      labels: [
        '#',
        'Item / Service',
        'Description',
        'Qty',
        'Rate',
        'Disc %',
        'Tax %',
        'Net',
        'Action',
        'Sales Order ID',
        'Customer ID',
        'Customer',
        'Order Date',
        'Ordered Quantity',
        'Delivery Date',
        'Total Amount',
        'Status',
        'Actions',
      ],
    },
    {
      match: /^production link$/i,
      labels: [
        'Approval Status',
        'Status',
        'Sales Order ID',
        'SO No',
        'Quotation Number',
        'Customer ID',
        'Customer',
        'Manufacturing Orders',
        'Actions',
      ],
    },
    {
      match: /^delivery balance$/i,
      where: [`t.status NOT IN ('Draft','Cancelled','Rejected')`],
      labels: [
        'Sales Order ID',
        'SO No',
        'Quotation Number',
        'Customer ID',
        'Customer',
        'Order Date',
        'Product ID',
        'Ordered Quantity',
        'Dispatched Qty',
        'Balance Qty',
        'Status',
        'Actions',
      ],
    },
    {
      match: /^billing balance$/i,
      where: [`t.status NOT IN ('Draft','Cancelled','Rejected')`],
      labels: [
        'Sales Order ID',
        'SO No',
        'Quotation Number',
        'Customer ID',
        'Customer',
        'Order Date',
        'Product ID',
        'Total Amount',
        'Billed Value',
        'Billing Balance',
        'Status',
        'Actions',
      ],
      panel: settlementPanel('Invoices against sales orders', ['p.order_id IS NOT NULL']),
    },
    { match: /^approval & audit$/i, labels: [...SO_COMPACT, 'Approval Status'], audit: true },
  ],
};

const SQ_COMPACT = [
  'Quotation Number',
  'Enquiry Number',
  'Customer ID',
  'Customer',
  'Product ID',
  'Product',
  'Quantity',
  'Status',
  'Actions',
];
const QUOTES: PageDef = {
  from: `sales_quotations t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN units un ON un.id=t.unit_id ${sqLines} ${apJoin('sales-quotations')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 'cu.code', 't.customer_ref'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Quotation Number': t('t.number'),
    'Enquiry Number': t(
      `(SELECT en.number FROM sales_enquiries en WHERE en.quotation_id=t.id AND en.deleted_at IS NULL LIMIT 1)`,
    ),
    'Customer ID': t('cu.code'),
    Customer: t('cu.name'),
    'Product ID': t('ln.code'),
    Product: t(more('ln.pname')),
    Quantity: n('ln.qty'),
    Rate: m('ln.rate'),
    'Discount %': n('ln.disc'),
    'GST %': n('ln.gst'),
    'Grand Total': m('t.grand_total'),
    'Delivery Date': d(`CASE WHEN ln.lead IS NOT NULL THEN t.quote_date + ln.lead END`),
    Status: { e: 't.status', type: 'pill' },
    'Sales Order': t(
      `(SELECT so.number FROM sales_orders so WHERE so.quotation_id=t.id AND so.deleted_at IS NULL ORDER BY so.created_at LIMIT 1)`,
    ),
    'Manufacturing / Machine Order': t(
      `(SELECT mo.number FROM mfg_orders mo JOIN sales_orders so ON so.id::text=mo.source_id::text AND mo.source_type='SALES_ORDER' WHERE so.quotation_id=t.id AND mo.deleted_at IS NULL ORDER BY mo.created_at LIMIT 1)`,
    ),
    'Manufacturing Order': t(
      `(SELECT mo.number FROM mfg_orders mo JOIN sales_orders so ON so.id::text=mo.source_id::text AND mo.source_type='SALES_ORDER' WHERE so.quotation_id=t.id AND mo.deleted_at IS NULL ORDER BY mo.created_at LIMIT 1)`,
    ),
    'Company Code': t('un.code'),
    Revision: n('t.revision_no'),
    'Customer Decision': t('t.customer_status'),
    Docs: DOCS('sales-quotations'),
    Actions: ACTIONS,
  },
  register: [
    'Quotation Number',
    'Enquiry Number',
    'Customer ID',
    'Customer',
    'Product ID',
    'Product',
    'Quantity',
    'Rate',
    'Discount %',
    'GST %',
    'Grand Total',
    'Delivery Date',
    'Docs',
    'Actions',
    'Status',
    'Sales Order',
    'Manufacturing / Machine Order',
    'Manufacturing Order',
  ],
  compact: SQ_COMPACT,
  views: [
    {
      match: /^items & tax$/i,
      labels: [
        'GST %',
        'Company Code',
        'Quotation Number',
        'Enquiry Number',
        'Customer ID',
        'Customer',
        'Product ID',
        'Grand Total',
        'Status',
        'Actions',
      ],
    },
    {
      match: /^terms$/i,
      labels: SQ_COMPACT,
      panel: {
        title: 'Validation of the quotations in view',
        from: `(SELECT 'Every line has a rate' AS rule, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales_quotation_lines l WHERE l.quotation_id=p.id AND l.rate <= 0)) AS fail, 0 AS warn, count(*) AS total FROM sales_quotations p WHERE {SCOPE}
          UNION ALL SELECT 'Validity date is set', 0, count(*) FILTER (WHERE p.valid_until IS NULL), count(*) FROM sales_quotations p WHERE {SCOPE}
          UNION ALL SELECT 'Margin is not negative', count(*) FILTER (WHERE p.margin_pct < 0), count(*) FILTER (WHERE p.margin_pct IS NULL), count(*) FROM sales_quotations p WHERE {SCOPE}
          UNION ALL SELECT 'Customer is approved', count(*) FILTER (WHERE c.approval_status <> 'APPROVED'), 0, count(*) FROM sales_quotations p JOIN customers c ON c.id=p.customer_id WHERE {SCOPE}
          UNION ALL SELECT 'GST is on every line', 0, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales_quotation_lines l WHERE l.quotation_id=p.id AND COALESCE(l.gst_pct,0) = 0)), count(*) FROM sales_quotations p WHERE {SCOPE}) p`,
        unit: null,
        soft: null,
        order: 'p.rule',
        cols: [
          ['Validation Rule', 'p.rule', 'text'],
          ['Pass', 'p.total - p.fail - p.warn', 'num'],
          ['Warning', 'p.warn', 'num'],
          ['Fail', 'p.fail', 'num'],
          ['Action', `CASE WHEN p.fail + p.warn > 0 THEN 'Review' END`, 'actions'],
        ],
      },
    },
    {
      match: /^conversion$/i,
      labels: [...SQ_COMPACT.slice(0, 8), 'Sales Order', 'Status', 'Actions'],
    },
    { match: /^audit$/i, labels: SQ_COMPACT, audit: true },
  ],
};

const INV_COMPACT = [
  'Invoice No',
  'Customer',
  'Invoice Date',
  'Due Date',
  'GSTIN',
  'Place of Supply',
  'Taxable Value',
  'Status',
  'Actions',
];
const INVOICES: PageDef = {
  from: `sales_invoices t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN sales_orders so ON so.id=t.order_id LEFT JOIN units un ON un.id=t.unit_id ${apJoin('sales-invoices')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 'cu.code', 'so.number', 't.irn'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Invoice No': t('t.number'),
    Customer: t('cu.name'),
    'Invoice Date': d('t.invoice_date'),
    'Due Date': d('t.due_date'),
    GSTIN: t('cu.gstin'),
    'Place of Supply': t('t.customer_state'),
    'Taxable Value': m('t.taxable'),
    CGST: m('t.cgst'),
    SGST: m('t.sgst'),
    IGST: m('t.igst'),
    'Grand Total': m('t.grand_total'),
    Paid: m('t.received_amount'),
    Balance: m('t.grand_total - t.received_amount'),
    'IRN Status': t(
      `CASE WHEN t.irn IS NOT NULL THEN 'Generated' WHEN t.status='Posted' THEN 'Pending' ELSE 'Not due' END`,
    ),
    Status: { e: 't.status', type: 'pill' },
    'Sales Order': t('so.number'),
    'Company Code': t('un.code'),
    'Receipt Status': t('t.receipt_status'),
    'Age (days)': n(
      `CASE WHEN t.status='Posted' AND t.grand_total - t.received_amount > 0 AND t.due_date IS NOT NULL THEN GREATEST(CURRENT_DATE - t.due_date, 0) END`,
    ),
    Docs: DOCS('sales-invoices'),
    Actions: ACTIONS,
  },
  register: [
    'Invoice No',
    'Customer',
    'Invoice Date',
    'Due Date',
    'GSTIN',
    'Place of Supply',
    'Taxable Value',
    'CGST',
    'SGST',
    'IGST',
    'Grand Total',
    'Paid',
    'Docs',
    'Actions',
    'IRN Status',
    'Status',
    'Sales Order',
  ],
  compact: INV_COMPACT,
  views: [
    {
      match: /^tax breakdown$/i,
      labels: [
        'GSTIN',
        'Taxable Value',
        'CGST',
        'SGST',
        'IGST',
        'Company Code',
        'Invoice No',
        'Status',
        'Actions',
      ],
    },
    {
      match: /^e-?invoice status$/i,
      labels: [
        'Invoice No',
        'Customer',
        'Invoice Date',
        'Due Date',
        'IRN Status',
        'Status',
        'Sales Order',
        'Actions',
      ],
      panel: settlementPanel('Invoices and what is allocated'),
    },
    {
      match: /^receipts & balance$/i,
      labels: [
        'Invoice No',
        'Invoice Date',
        'Due Date',
        'Grand Total',
        'Paid',
        'Balance',
        'IRN Status',
        'Status',
        'Actions',
      ],
      panel: settlementPanel('Open balance per invoice'),
    },
    {
      match: /^credit notes$/i,
      labels: [
        'Invoice No',
        'Customer',
        'Invoice Date',
        'Due Date',
        'GSTIN',
        'Place of Supply',
        'Taxable Value',
        'Status',
        'Actions',
      ],
      panel: {
        title: 'Credit notes of sales returns',
        from: `sales_returns p LEFT JOIN customers pc ON pc.id=p.customer_id`,
        unit: 'p.unit_id',
        soft: 'p.deleted_at',
        where: [`p.status = 'Posted'`],
        order: 'p.return_date DESC, p.number',
        cols: [
          ['Reference', 'COALESCE(p.credit_note_no, p.number)', 'text'],
          ['Due', 'p.return_date', 'date'],
          ['Amount', 'p.grand_total', 'inr'],
          ['Allocated', 'p.grand_total', 'inr'],
          ['Balance', '0', 'inr'],
          ['Action', undefined, 'actions'],
        ],
      },
    },
    {
      match: /^invoice ageing$/i,
      where: [`t.status = 'Posted'`, `t.grand_total - t.received_amount > 0`],
      labels: [
        'Invoice No',
        'Customer',
        'Invoice Date',
        'Due Date',
        'Balance',
        'Age (days)',
        'IRN Status',
        'Status',
        'Sales Order',
        'Actions',
      ],
    },
  ],
};

const DISP_COMPACT = [
  'Dispatch No',
  'Sales Order',
  'Customer',
  'Warehouse',
  'Pick List',
  'Packing Ref',
  'Vehicle',
  'Status',
  'Actions',
];
const DISPATCH: PageDef = {
  from: `sales_dispatches t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN sales_orders so ON so.id=t.order_id LEFT JOIN warehouses wh ON wh.id=t.warehouse_id ${apJoin('sales-dispatch')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 'so.number', 't.vehicle_no', 't.lr_no'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Dispatch No': t('t.number'),
    'Sales Order': t('so.number'),
    Customer: t('cu.name'),
    Warehouse: t(`wh.code || ' · ' || wh.name`),
    // TC-29: the warehouse pick wave / pack unit raised for this dispatch (their reference is the dispatch or sales order number)
    'Pick List': t(
      `(SELECT pw.number FROM pick_waves pw WHERE pw.deleted_at IS NULL AND lower(btrim(pw.reference)) IN (lower(t.number), lower(so.number)) ORDER BY pw.created_at DESC LIMIT 1)`,
    ),
    'Packing Ref': t(
      `(SELECT pu.number FROM pack_units pu JOIN pick_waves pw ON pw.id=pu.wave_id WHERE pu.deleted_at IS NULL AND pw.deleted_at IS NULL AND lower(btrim(pw.reference)) IN (lower(t.number), lower(so.number)) ORDER BY pu.created_at DESC LIMIT 1)`,
    ),
    Vehicle: t('t.vehicle_no'),
    Driver: t('t.driver'),
    Transporter: t('t.transporter'),
    'LR No': t('t.lr_no'),
    'Dispatch Date': d('t.dispatch_date'),
    'Ship To': t('t.ship_to'),
    'Weight (kg)': n('t.weight_kg'),
    Lines: n('(SELECT count(*) FROM sales_dispatch_lines l WHERE l.dispatch_id=t.id)'),
    'Dispatched Qty': n('(SELECT sum(l.qty) FROM sales_dispatch_lines l WHERE l.dispatch_id=t.id)'),
    'Invoiced Qty': n(
      '(SELECT sum(l.invoiced_qty) FROM sales_dispatch_lines l WHERE l.dispatch_id=t.id)',
    ),
    'E-Way Bill': t(
      `(SELECT i.ewb_no FROM sales_invoices i WHERE i.order_id=t.order_id AND i.ewb_no IS NOT NULL AND i.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 1)`,
    ),
    Status: { e: 't.status', type: 'pill' },
    Docs: DOCS('sales-dispatch'),
    Actions: ACTIONS,
  },
  register: DISP_COMPACT,
  compact: DISP_COMPACT,
  views: [
    {
      match: /^pick pack readiness$/i,
      labels: [...DISP_COMPACT.slice(0, 7), 'Lines', 'Dispatched Qty', 'Status', 'Actions'],
      panel: {
        title: 'Stock against the open sales-order lines',
        from: `sales_order_lines p JOIN sales_orders po ON po.id=p.order_id LEFT JOIN warehouses pw ON pw.id=p.warehouse_id LEFT JOIN items pi ON pi.id=p.item_id LEFT JOIN LATERAL (SELECT COALESCE(sum(sb.on_hand - sb.reserved_qty),0) AS free FROM stock_balances sb WHERE sb.item_id=p.item_id AND (p.warehouse_id IS NULL OR sb.warehouse_id=p.warehouse_id)) av ON true`,
        unit: 'po.unit_id',
        soft: 'po.deleted_at',
        where: [`po.status NOT IN ${NOT_OPEN}`, `p.qty - p.dispatched_qty - p.closed_qty > 0`],
        order: 'po.number, p.line_no',
        cols: [
          ['Record', `po.number || ' / ' || pi.code`, 'text'],
          ['Demand', 'p.qty - p.dispatched_qty - p.closed_qty', 'num'],
          ['Available', 'av.free', 'num'],
          ['Allocated', 'p.reserved_qty', 'num'],
          ['Short', 'GREATEST((p.qty - p.dispatched_qty - p.closed_qty) - av.free, 0)', 'num'],
          ['Location', `COALESCE(pw.code, 'Any warehouse')`, 'text'],
          [
            'Action',
            `CASE WHEN p.qty - p.dispatched_qty - p.closed_qty > av.free THEN 'Replenish' ELSE 'Ready' END`,
            'actions',
          ],
        ],
      },
    },
    {
      match: /^vehicle & driver$/i,
      labels: [...DISP_COMPACT.slice(0, 7), 'Driver', 'Transporter', 'LR No', 'Status', 'Actions'],
    },
    {
      match: /^dispatch documents$/i,
      labels: [...DISP_COMPACT.slice(0, 7), 'LR No', 'E-Way Bill', 'Docs', 'Status', 'Actions'],
    },
    {
      match: /^pod status$/i,
      labels: [...DISP_COMPACT.slice(0, 7), 'Ship To', 'Dispatch Date', 'Status', 'Actions'],
    },
    {
      match: /^dispatch analytics$/i,
      labels: [
        ...DISP_COMPACT.slice(0, 7),
        'Dispatched Qty',
        'Invoiced Qty',
        'Weight (kg)',
        'Status',
        'Actions',
      ],
    },
  ],
};

const COLL_COMPACT = [
  'Payment Number',
  'Payment Date',
  'Customer ID',
  'Customer',
  'Sales Order',
  'Invoice Number',
  'Invoice Amount',
  'Status',
  'Actions',
];
const COLLECTIONS: PageDef = {
  from: `sales_receipts t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN LATERAL (SELECT string_agg(DISTINCT i.number, ', ') AS inv, string_agg(DISTINCT so.number, ', ') AS so, sum(a.amount) AS alloc, sum(i.grand_total) AS invamt FROM sales_receipt_allocations a JOIN sales_invoices i ON i.id=a.invoice_id LEFT JOIN sales_orders so ON so.id=i.order_id WHERE a.receipt_id=t.id) al ON true ${apJoin('sales-collections')}`,
  soft: null,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 'cu.code', 't.reference', 'al.inv', 'al.so'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Payment Number': t('t.number'),
    'Payment Date': d('t.receipt_date'),
    'Receipt Amount': m('t.amount'),
    'Payment Mode': t('t.mode'),
    'Bank / Cash Reference': t('t.reference'),
    Status: { e: 't.status', type: 'pill' },
    'Customer ID': t('cu.code'),
    Customer: t('cu.name'),
    'Sales Order': t('al.so'),
    'Invoice Number': t('al.inv'),
    'Invoice Amount': m('al.invamt'),
    Allocated: m('COALESCE(al.alloc,0)'),
    Unallocated: m('t.amount - COALESCE(al.alloc,0)'),
    Particulars: t(`'Receipt ' || t.number`),
    Credit: m('t.amount'),
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: [
    'Payment Number',
    'Payment Date',
    'Receipt Amount',
    'Payment Mode',
    'Bank / Cash Reference',
    'Allocated',
    'Unallocated',
    'Status',
    'Customer ID',
    'Actions',
  ],
  compact: COLL_COMPACT,
  views: [
    {
      match: /^payment register$/i,
      labels: [
        'Payment Number',
        'Payment Date',
        'Receipt Amount',
        'Payment Mode',
        'Bank / Cash Reference',
        'Status',
        'Customer ID',
        'Actions',
      ],
      panel: settlementPanel('Invoices waiting for a receipt', [
        `p.grand_total - p.received_amount > 0`,
      ]),
    },
    {
      match: /^invoice allocation$/i,
      labels: [
        'Status',
        'Payment Number',
        'Payment Date',
        'Customer ID',
        'Customer',
        'Sales Order',
        'Invoice Number',
        'Allocated',
        'Actions',
      ],
    },
    {
      match: /^partial payments$/i,
      where: ['t.amount - COALESCE(al.alloc,0) > 0'],
      labels: [
        'Payment Number',
        'Payment Date',
        'Receipt Amount',
        'Payment Mode',
        'Bank / Cash Reference',
        'Allocated',
        'Unallocated',
        'Status',
        'Customer ID',
        'Actions',
      ],
      panel: settlementPanel('Invoices part paid', [
        `p.received_amount > 0`,
        `p.grand_total - p.received_amount > 0`,
      ]),
    },
    {
      match: /^overdue$/i,
      from: `sales_invoices t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN sales_orders so ON so.id=t.order_id`,
      search: ['t.number', 'cu.name', 'cu.code', 'so.number'],
      recordPage: 'sales-invoices',
      where: [
        `t.deleted_at IS NULL`,
        `t.status = 'Posted'`,
        `t.grand_total - t.received_amount > 0`,
        `t.due_date < CURRENT_DATE`,
      ],
      order: 't.due_date, t.number',
      cols: {
        'Payment Number': none(),
        'Payment Date': none('date'),
        'Customer ID': t('cu.code'),
        Customer: t('cu.name'),
        'Sales Order': t('so.number'),
        'Invoice Number': t('t.number'),
        'Invoice Amount': m('t.grand_total - t.received_amount'),
        Status: { e: `'Overdue ' || (CURRENT_DATE - t.due_date) || ' d'`, type: 'pill' },
        Actions: ACTIONS,
      },
      labels: COLL_COMPACT,
    },
    {
      match: /^reconciliation$/i,
      labels: [
        ...COLL_COMPACT.slice(0, 7),
        'Particulars',
        'Receipt Amount',
        'Allocated',
        'Unallocated',
        'Status',
        'Actions',
      ],
      cols: {},
      panel: {
        title: 'Receivable ledger: invoices raised and receipts received',
        from: `(SELECT x.d, x.ref, x.part, x.debit, x.credit, sum(x.debit - x.credit) OVER (ORDER BY x.d, x.ref) AS bal FROM (
            SELECT i.invoice_date AS d, i.number AS ref, 'Invoice to ' || c.name AS part, i.grand_total AS debit, 0::numeric AS credit FROM sales_invoices i JOIN customers c ON c.id=i.customer_id WHERE {SCOPE:i} AND i.status = 'Posted'
            UNION ALL SELECT r.receipt_date, r.number, 'Receipt from ' || c.name, 0::numeric, r.amount FROM sales_receipts r JOIN customers c ON c.id=r.customer_id WHERE {SCOPE:r:nosoft}) x) p`,
        unit: null,
        soft: null,
        order: 'p.d DESC, p.ref DESC',
        cols: [
          ['Date', 'p.d', 'date'],
          ['Reference', 'p.ref', 'text'],
          ['Particulars', 'p.part', 'text'],
          ['Debit', 'p.debit', 'inr'],
          ['Credit', 'p.credit', 'inr'],
          ['Balance', 'p.bal', 'inr'],
          ['Action', undefined, 'actions'],
        ],
      },
    },
    { match: /^audit$/i, labels: COLL_COMPACT, audit: true },
  ],
};

const LEAD_COMPACT = [
  'Lead No',
  'Lead Name',
  'Company',
  'Mobile',
  'Email',
  'Source',
  'Campaign',
  'Status',
  'Actions',
];
/** The date typed on the lead; when none is typed, the earliest open follow-up planned for it. */
const LEAD_NEXT = `COALESCE(t.next_follow_up, (SELECT min(f.due_at)::date FROM crm_followups f WHERE f.related_type='LEAD' AND f.related_id=t.id AND f.status='Open' AND f.deleted_at IS NULL))`;
const LEADS: PageDef = {
  from: `leads t LEFT JOIN lead_sources ls ON ls.id=t.source_id LEFT JOIN users ow ON ow.id=t.assigned_to_id LEFT JOIN projects lpj ON lpj.id=t.project_id ${apJoin('crm-leads')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 't.name', 't.company', 't.mobile', 't.email'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Lead No': t('t.number'),
    'Lead Name': t('t.name'),
    Company: t('t.company'),
    Mobile: t('t.mobile'),
    Email: t('t.email'),
    Source: t('ls.name'),
    Campaign: t('t.campaign'),
    Owner: t('ow.name'),
    Stage: t('t.status'),
    'Qualification Score': n('t.score'),
    'Expected Value': m('t.est_value'),
    'Next Follow-up': d(LEAD_NEXT),
    'Consent Status': t('t.consent_status'),
    'Interested In': t('t.interest'),
    'Project Number': t('lpj.code'),
    Status: { e: 't.status', type: 'pill' },
    Interested: t('t.interest'),
    'Converted On': d('t.converted_at'),
    'Lost Reason': t('t.lost_reason'),
    Docs: DOCS('crm-leads'),
    Actions: ACTIONS,
  },
  register: [
    'Lead No',
    'Lead Name',
    'Company',
    'Mobile',
    'Email',
    'Source',
    'Campaign',
    'Owner',
    'Stage',
    'Qualification Score',
    'Expected Value',
    'Next Follow-up',
    'Consent Status',
    'Status',
    'Interested In',
    'Project Number',
    'Docs',
    'Actions',
  ],
  compact: LEAD_COMPACT,
  views: [
    {
      match: /^lead scoring$/i,
      labels: [
        'Lead No',
        'Lead Name',
        'Qualification Score',
        'Consent Status',
        'Status',
        'Company',
        'Mobile',
        'Email',
        'Actions',
      ],
    },
    {
      match: /^conversion analytics$/i,
      labels: [...LEAD_COMPACT.slice(0, 8), 'Converted On', 'Lost Reason', 'Actions'],
    },
    {
      match: /^qualification desk$/i,
      where: [`t.status IN ('New','Contacted','Qualified')`],
      labels: LEAD_COMPACT,
    },
  ],
};

const OPP_COMPACT = [
  'Opportunity No',
  'Customer',
  'Opportunity Name',
  'Stage',
  'Probability %',
  'Expected Value',
  'Expected Close',
  'Status',
  'Actions',
];
const OPPS: PageDef = {
  from: `opportunities t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN users ow ON ow.id=t.owner_id ${apJoin('crm-opportunities')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 't.title', 'cu.name'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Opportunity No': t('t.number'),
    Customer: t('cu.name'),
    'Opportunity Name': t('t.title'),
    Stage: t('t.status'),
    'Probability %': n('t.probability'),
    'Expected Value': m('t.amount'),
    'Weighted Value': m('t.amount * t.probability / 100'),
    'Expected Close': d('t.expected_close'),
    'Primary Contact': t(
      `COALESCE(NULLIF(t.primary_contact,''), (SELECT cc.name FROM customer_contacts cc WHERE cc.customer_id=t.customer_id ORDER BY cc.is_primary DESC, cc.name LIMIT 1))`,
    ),
    Salesperson: t('ow.name'),
    Competitor: t('t.competitor'),
    'Next Action': t(
      `COALESCE(NULLIF(t.next_action,''), (SELECT f.title FROM crm_followups f WHERE f.related_type='OPPORTUNITY' AND f.related_id=t.id AND f.status='Open' AND f.deleted_at IS NULL ORDER BY f.due_at LIMIT 1))`,
    ),
    'Project Number': t(`(SELECT pj.code FROM projects pj WHERE pj.id=t.project_id)`),
    Status: { e: 't.status', type: 'pill' },
    'Lost Reason': t('t.lost_reason'),
    'Closed On': d('t.closed_at'),
    Quotations: n(
      `(SELECT count(*) FROM sales_quotations q WHERE q.opportunity_id=t.id AND q.deleted_at IS NULL)`,
    ),
    Docs: DOCS('crm-opportunities'),
    Actions: ACTIONS,
  },
  register: [
    'Opportunity No',
    'Customer',
    'Opportunity Name',
    'Stage',
    'Probability %',
    'Expected Value',
    'Expected Close',
    'Primary Contact',
    'Salesperson',
    'Competitor',
    'Next Action',
    'Status',
    'Docs',
    'Actions',
  ],
  compact: OPP_COMPACT,
  views: [
    {
      match: /^probability & forecast$/i,
      labels: [
        'Opportunity No',
        'Customer',
        'Opportunity Name',
        'Stage',
        'Probability %',
        'Expected Value',
        'Weighted Value',
        'Expected Close',
        'Status',
        'Actions',
      ],
    },
    {
      match: /^proposal activity$/i,
      labels: [...OPP_COMPACT.slice(0, 7), 'Quotations', 'Status', 'Actions'],
    },
    {
      match: /^win loss analysis$/i,
      labels: [...OPP_COMPACT.slice(0, 7), 'Lost Reason', 'Closed On', 'Status', 'Actions'],
    },
  ],
};

const FU_COMPACT = [
  'Follow-up No',
  'Lead Customer',
  'Related Record',
  'Owner',
  'Due Date',
  'Due Time',
  'Channel',
  'Status',
  'Actions',
];
const FOLLOWUPS: PageDef = {
  from: `crm_followups t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN users ow ON ow.id=t.assigned_to_id ${apJoin('crm-followups')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 't.title', 'cu.name'],
  order: 't.due_at, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Follow-up No': t('t.number'),
    'Lead Customer': t(
      `COALESCE(cu.name, (SELECT l.name FROM leads l WHERE t.related_type='LEAD' AND l.id=t.related_id))`,
    ),
    'Related Record': t(
      `CASE t.related_type WHEN 'LEAD' THEN (SELECT l.number FROM leads l WHERE l.id=t.related_id) WHEN 'OPPORTUNITY' THEN (SELECT o.number FROM opportunities o WHERE o.id=t.related_id) ELSE t.title END`,
    ),
    Owner: t('ow.name'),
    'Due Date': d(`(t.due_at AT TIME ZONE 'Asia/Kolkata')::date`),
    'Due Time': { e: `to_char(t.due_at AT TIME ZONE 'Asia/Kolkata','HH24:MI')`, type: 'time' },
    Channel: t('t.kind'),
    Status: { e: 't.status', type: 'pill' },
    Task: t('t.title'),
    Outcome: t('t.outcome'),
    'Done On': d('t.done_at'),
    'Days Overdue': n(
      `CASE WHEN t.status='Open' AND t.due_at < now() THEN CURRENT_DATE - (t.due_at AT TIME ZONE 'Asia/Kolkata')::date END`,
    ),
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: FU_COMPACT,
  compact: FU_COMPACT,
  views: [
    {
      match: /^due today$/i,
      where: [
        `(t.due_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
        `t.status='Open'`,
      ],
      labels: FU_COMPACT,
      panel: {
        title: 'Customer payments promised or due',
        from: `open_items p`,
        unit: 'p.unit_id',
        soft: null,
        where: [
          `p.party_type = 'CUSTOMER'`,
          `p.outstanding > 0`,
          `p.status NOT IN ('Settled','Cancelled')`,
          `(p.promise_date <= CURRENT_DATE OR p.due_date <= CURRENT_DATE)`,
        ],
        order: 'COALESCE(p.promise_date, p.due_date), p.doc_no',
        cols: [
          ['Reference', 'p.doc_no', 'text'],
          ['Due', 'COALESCE(p.promise_date, p.due_date)', 'date'],
          ['Amount', 'p.amount', 'inr'],
          ['Allocated', 'p.settled_amount', 'inr'],
          ['Balance', 'p.outstanding', 'inr'],
          [
            'Action',
            `CASE WHEN p.promise_date IS NOT NULL THEN 'Promised' ELSE 'Call' END`,
            'actions',
          ],
        ],
      },
    },
    {
      match: /^overdue actions$/i,
      where: [`t.status='Open'`, `t.due_at < now()`],
      labels: [...FU_COMPACT.slice(0, 8), 'Days Overdue', 'Actions'],
    },
    {
      match: /^outcome log$/i,
      where: [`t.status='Done'`],
      labels: [...FU_COMPACT.slice(0, 8), 'Outcome', 'Done On', 'Actions'],
    },
    { match: /^completion analytics$/i, labels: [...FU_COMPACT.slice(0, 8), 'Done On', 'Actions'] },
  ],
};

const MTG_COMPACT = [
  'Meeting No',
  'Subject',
  'Customer Lead',
  'Start Date',
  'Start Time',
  'Duration',
  'Location Mode',
  'Status',
  'Actions',
];
const MEETINGS: PageDef = {
  from: `crm_meetings t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN users ow ON ow.id=t.owner_id ${apJoin('crm-meetings')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 't.subject', 'cu.name'],
  order: 't.starts_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Meeting No': t('t.number'),
    Subject: t('t.subject'),
    'Customer Lead': t(
      `COALESCE(cu.name, (SELECT l.name FROM leads l WHERE t.related_type='LEAD' AND l.id=t.related_id))`,
    ),
    'Start Date': d(`(t.starts_at AT TIME ZONE 'Asia/Kolkata')::date`),
    'Start Time': { e: `to_char(t.starts_at AT TIME ZONE 'Asia/Kolkata','HH24:MI')`, type: 'time' },
    Duration: t(`CASE WHEN t.duration_min IS NOT NULL THEN t.duration_min || ' min' END`),
    'Location Mode': t(`COALESCE(NULLIF(t.location_mode,''), t.kind)`),
    Agenda: t('t.agenda'),
    'Project Number': t(`(SELECT pj.code FROM projects pj WHERE pj.id=t.project_id)`),
    Status: { e: 't.status', type: 'pill' },
    Participants: t(`CASE WHEN t.attendees IS NOT NULL THEN t.attendees::text END`),
    Owner: t('ow.name'),
    Outcome: t('t.outcome'),
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: MTG_COMPACT,
  compact: MTG_COMPACT,
  views: [
    { match: /^call log$/i, where: [`t.kind = 'Call'`], labels: MTG_COMPACT },
    {
      match: /^agenda & notes$/i,
      labels: [...MTG_COMPACT.slice(0, 7), 'Outcome', 'Status', 'Actions'],
    },
    {
      match: /^participants$/i,
      labels: [...MTG_COMPACT.slice(0, 7), 'Participants', 'Owner', 'Status', 'Actions'],
    },
    {
      match: /^action items$/i,
      where: [`t.outcome IS NOT NULL`],
      labels: [...MTG_COMPACT.slice(0, 7), 'Outcome', 'Status', 'Actions'],
    },
  ],
};

const FB_COMPACT = [
  'Feedback No',
  'Customer',
  'Date',
  'Channel',
  'Rating',
  'NPS Score',
  'Category',
  'Status',
  'Actions',
];
const FEEDBACK: PageDef = {
  from: `crm_feedback t LEFT JOIN customers cu ON cu.id=t.customer_id ${apJoin('crm-feedback')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 't.category', 't.comment'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Feedback No': t('t.number'),
    Customer: t('cu.name'),
    Date: d('t.given_on'),
    Channel: none(),
    Rating: n('t.rating'),
    'NPS Score': t(
      `CASE WHEN t.rating >= 9 THEN 'Promoter' WHEN t.rating >= 7 THEN 'Passive' ELSE 'Detractor' END`,
    ),
    Category: t('t.category'),
    Status: { e: 't.status', type: 'pill' },
    Comment: t('t.comment'),
    'Action Taken': t('t.action_note'),
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: FB_COMPACT,
  compact: FB_COMPACT,
  views: [
    {
      match: /^issue categories$/i,
      labels: FB_COMPACT,
      panel: {
        title: 'Low scores by category',
        from: `crm_feedback p`,
        unit: 'p.unit_id',
        soft: 'p.deleted_at',
        where: ['p.rating <= 6'],
        order: 'p.given_on DESC, p.number',
        cols: [
          ['Exception', `'Low score ' || p.rating`, 'text'],
          ['Record', 'p.number', 'text'],
          ['Severity', `CASE WHEN p.rating <= 3 THEN 'High' ELSE 'Medium' END`, 'text'],
          ['Age', `CURRENT_DATE - p.given_on`, 'num'],
          ['Root Cause', 'p.category', 'text'],
          ['Owner', `(SELECT u.name FROM users u WHERE u.id=p.created_by_id)`, 'text'],
          [
            'Action',
            `COALESCE(p.action_note, CASE WHEN p.status <> 'Closed' THEN 'Open' END)`,
            'text',
          ],
        ],
      },
    },
    { match: /^response workflow$/i, labels: FB_COMPACT },
    {
      match: /^improvement actions$/i,
      labels: [...FB_COMPACT.slice(0, 7), 'Action Taken', 'Status', 'Actions'],
    },
  ],
};

const SRC_COMPACT = [
  'Source Code',
  'Source Name',
  'Channel',
  'Campaign',
  'UTM Source',
  'UTM Medium',
  'Monthly Cost',
  'Status',
  'Actions',
];
const SOURCES: PageDef = {
  from: `lead_sources t ${apJoin('crm-sources')}`,
  unit: null,
  soft: null,
  // a shared master: an employee sees every source, like the list above the table (not only the ones they typed)
  owner: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 't.channel', 't.campaign'],
  order: 't.code',
  cols: {
    ...approvalCols('t.code'),
    'Source Code': t('t.code'),
    'Source Name': t('t.name'),
    'UTM Source': t('t.utm_source'),
    Status: { e: 't.status', type: 'pill' },
    Channel: t('t.channel'),
    Campaign: t('t.campaign'),
    'UTM Medium': t('t.utm_medium'),
    'Monthly Cost': m('t.monthly_cost'),
    Qualified: n(
      `(SELECT count(*) FROM leads l WHERE l.source_id=t.id AND l.status IN ('Qualified','Converted') AND l.deleted_at IS NULL)`,
    ),
    Won: n(
      `(SELECT count(*) FROM opportunities o JOIN leads l ON l.id=o.lead_id WHERE l.source_id=t.id AND l.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status='Won')`,
    ),
    Revenue: m(
      `(SELECT COALESCE(sum(o.amount),0) FROM opportunities o JOIN leads l ON l.id=o.lead_id WHERE l.source_id=t.id AND l.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status='Won')`,
    ),
    Leads: n(`(SELECT count(*) FROM leads l WHERE l.source_id=t.id AND l.deleted_at IS NULL)`),
    'Converted Leads': n(
      `(SELECT count(*) FROM leads l WHERE l.source_id=t.id AND l.status='Converted' AND l.deleted_at IS NULL)`,
    ),
    'Lead Value': m(
      `(SELECT COALESCE(sum(l.est_value),0) FROM leads l WHERE l.source_id=t.id AND l.deleted_at IS NULL)`,
    ),
    Actions: ACTIONS,
  },
  register: SRC_COMPACT,
  compact: SRC_COMPACT,
  views: [
    {
      match: /^source quality$/i,
      labels: [
        ...SRC_COMPACT.slice(0, 7),
        'Leads',
        'Qualified',
        'Converted Leads',
        'Lead Value',
        'Status',
        'Actions',
      ],
    },
    {
      match: /^roi analysis$/i,
      labels: [
        ...SRC_COMPACT.slice(0, 7),
        'Leads',
        'Won',
        'Revenue',
        'Lead Value',
        'Status',
        'Actions',
      ],
    },
  ],
};

const CUST_COMPACT = [
  'Customer ID',
  'Company Name',
  'Contact Person',
  'Mobile Number',
  'Email',
  'GST Number',
  'Billing Address',
  'Status',
  'Actions',
];
const addr = (kind: string): string =>
  `(SELECT concat_ws(', ', a.line1, a.line2, a.city, a.pincode) FROM customer_addresses a WHERE a.customer_id=t.id ORDER BY (a.type='${kind}') DESC, a.is_default DESC LIMIT 1)`;
const contact = (col: string): string =>
  `(SELECT cc.${col} FROM customer_contacts cc WHERE cc.customer_id=t.id ORDER BY cc.is_primary DESC, cc.name LIMIT 1)`;
const CUSTOMER_COLS: Record<string, Col> = {
  'Customer ID': t('t.code'),
  'Company Name': t('t.name'),
  'Contact Person': t(contact('name')),
  'Mobile Number': t(contact('mobile')),
  Email: t(contact('email')),
  'GST Number': t('t.gstin'),
  'Billing Address': t(addr('BILLING')),
  'Shipping Address': t(addr('SHIPPING')),
  'Credit Limit': m('t.credit_limit'),
  'Payment Terms': t(
    `COALESCE((SELECT pt.name FROM payment_terms pt WHERE pt.id=t.payment_term_id), CASE WHEN t.credit_days IS NOT NULL THEN t.credit_days || ' days' END)`,
  ),
  Status: { e: 't.status', type: 'pill' },
  'Project Number': t(
    `(SELECT string_agg(pj.code, ', ') FROM projects pj WHERE pj.customer_id=t.id)`,
  ),
  'Used Limit': m(
    `COALESCE((SELECT sum(o.outstanding) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=t.id AND o.status NOT IN ('Settled','Cancelled')),0)`,
  ),
  Orders: n(
    `(SELECT count(*) FROM sales_orders so WHERE so.customer_id=t.id AND so.deleted_at IS NULL)`,
  ),
  'Order Value': m(
    `(SELECT COALESCE(sum(so.grand_total),0) FROM sales_orders so WHERE so.customer_id=t.id AND so.deleted_at IS NULL AND so.status NOT IN ${NOT_OPEN})`,
  ),
  Approval: t('t.approval_status'),
  Tier: t('t.tier'),
  Owner: t(`(SELECT u.name FROM users u WHERE u.id=t.sales_person_id)`),
  'State Code': t('t.state_code'),
  'GST Type': t('t.gst_registration_type'),
  PAN: t('t.pan'),
  ...approvalCols('t.code'),
  Docs: none('docs'),
  Actions: ACTIONS,
};
const CUSTOMERS: PageDef = {
  from: `customers t ${apJoin('master-customers')}`,
  unit: null,
  owner: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 't.gstin'],
  order: 't.name, t.id',
  cols: CUSTOMER_COLS,
  register: [
    'Customer ID',
    'Company Name',
    'Contact Person',
    'Mobile Number',
    'Email',
    'GST Number',
    'Billing Address',
    'Shipping Address',
    'Credit Limit',
    'Payment Terms',
    'Status',
    'Project Number',
    'Docs',
    'Actions',
  ],
  compact: CUST_COMPACT,
  views: [
    {
      match: /^addresses$/i,
      labels: [...CUST_COMPACT.slice(0, 7), 'Shipping Address', 'Status', 'Actions'],
    },
    {
      match: /^credit & payment$/i,
      labels: [
        ...CUST_COMPACT.slice(0, 6),
        'Credit Limit',
        'Used Limit',
        'Payment Terms',
        'Status',
        'Actions',
      ],
      panel: settlementPanel('Customer invoices and what is allocated'),
    },
    {
      match: /^gst details$/i,
      labels: [...CUST_COMPACT.slice(0, 7), 'GST Type', 'State Code', 'PAN', 'Status', 'Actions'],
    },
    {
      match: /^order history$/i,
      labels: [...CUST_COMPACT.slice(0, 7), 'Orders', 'Order Value', 'Status', 'Actions'],
    },
    {
      match: /^controls$/i,
      labels: [
        ...CUST_COMPACT.slice(0, 7),
        'Approval',
        'Credit Limit',
        'Tier',
        'Status',
        'Actions',
      ],
    },
  ],
};
const C360: PageDef = {
  ...CUSTOMERS,
  from: `customers t ${apJoin('crm-customer360')}`,
  cols: {
    ...CUSTOMER_COLS,
    'Customer Company': t('t.name'),
    'Record No': t('t.code'),
    Name: t(contact('name')),
    Stage: t(
      `CASE WHEN EXISTS (SELECT 1 FROM sales_orders so WHERE so.customer_id=t.id AND so.deleted_at IS NULL) THEN 'Customer' WHEN EXISTS (SELECT 1 FROM opportunities o WHERE o.customer_id=t.id AND o.deleted_at IS NULL) THEN 'Prospect' ELSE 'New' END`,
    ),
    Priority: t('t.tier'),
    'Due Date': d(
      `(SELECT min(i.due_date) FROM sales_invoices i WHERE i.customer_id=t.id AND i.status='Posted' AND i.grand_total - i.received_amount > 0)`,
    ),
    'Next Action': t(
      `(SELECT f.title FROM crm_followups f WHERE f.customer_id=t.id AND f.status='Open' AND f.deleted_at IS NULL ORDER BY f.due_at LIMIT 1)`,
    ),
  },
  register: [
    'Customer Company',
    'Due Date',
    'Status',
    'Record No',
    'Name',
    'Owner',
    'Stage',
    'Actions',
  ],
  compact: [
    'Record No',
    'Name',
    'Customer Company',
    'Owner',
    'Stage',
    'Priority',
    'Next Action',
    'Status',
    'Actions',
  ],
  views: [
    {
      match: /^customer 360.? (details|workflow|performance|controls)$/i,
      labels: [
        'Customer Company',
        'Due Date',
        'Status',
        'Record No',
        'Name',
        'Owner',
        'Stage',
        'Actions',
      ],
    },
    {
      match: /^customer 360.? exceptions$/i,
      labels: ['Customer Company', 'Due Date', 'Status', 'Record No', 'Name', 'Stage', 'Actions'],
      panel: {
        title: 'Customers with an open exception',
        from: `customers p`,
        unit: null,
        soft: 'p.deleted_at',
        where: [
          `(p.approval_status <> 'APPROVED' OR p.status <> 'ACTIVE' OR EXISTS (SELECT 1 FROM sales_invoices i WHERE i.customer_id=p.id AND i.status='Posted' AND i.grand_total - i.received_amount > 0 AND i.due_date < CURRENT_DATE))`,
        ],
        order: 'p.name',
        cols: [
          [
            'Exception',
            `CASE WHEN p.approval_status <> 'APPROVED' THEN 'Customer not approved' WHEN p.status <> 'ACTIVE' THEN 'Customer inactive' ELSE 'Overdue invoice' END`,
            'text',
          ],
          ['Record', 'p.code', 'text'],
          [
            'Severity',
            `CASE WHEN p.approval_status <> 'APPROVED' OR p.status <> 'ACTIVE' THEN 'High' ELSE 'Medium' END`,
            'text',
          ],
          [
            'Age',
            `(SELECT max(CURRENT_DATE - i.due_date) FROM sales_invoices i WHERE i.customer_id=p.id AND i.status='Posted' AND i.grand_total - i.received_amount > 0 AND i.due_date < CURRENT_DATE)`,
            'num',
          ],
          [
            'Root Cause',
            `(SELECT string_agg(i.number, ', ') FROM sales_invoices i WHERE i.customer_id=p.id AND i.status='Posted' AND i.grand_total - i.received_amount > 0 AND i.due_date < CURRENT_DATE)`,
            'text',
          ],
          ['Owner', `(SELECT u.name FROM users u WHERE u.id=p.sales_person_id)`, 'text'],
          ['Action', undefined, 'actions'],
        ],
      },
    },
  ],
};

const ENQ_COMPACT = [
  'Enquiry Number',
  'Customer ID',
  'Customer',
  'Product ID',
  'Product',
  'Quantity',
  'Expected Delivery Date',
  'Status',
  'Actions',
];
const ENQUIRIES: PageDef = {
  from: `sales_enquiries t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN users sp ON sp.id=t.assigned_to_id LEFT JOIN units un ON un.id=t.unit_id LEFT JOIN sales_quotations sq ON sq.id=t.quotation_id ${apJoin('sales-enquiries')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 't.prospect_name', 't.product'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Enquiry Number': t('t.number'),
    'Customer ID': t('cu.code'),
    Customer: t('COALESCE(cu.name, t.prospect_name)'),
    'Product ID': t(`(SELECT i.code FROM items i WHERE i.id=t.item_id)`),
    Product: t('t.product'),
    Quantity: n('t.qty'),
    'Expected Delivery Date': d('t.required_date'),
    'Price Discussion': t('t.price_discussion'),
    'Sales Person': t('sp.name'),
    'Next Follow-up': d(
      `COALESCE((SELECT min(f.due_at)::date FROM crm_followups f WHERE f.related_type='ENQUIRY' AND f.related_id=t.id AND f.status='Open' AND f.deleted_at IS NULL), t.next_follow_up)`,
    ),
    Status: { e: 't.status', type: 'pill' },
    'Company Code': t('un.code'),
    'Customer PO Number': t(
      `(SELECT so.customer_po_no FROM sales_orders so WHERE so.quotation_id=t.quotation_id AND so.deleted_at IS NULL ORDER BY so.created_at LIMIT 1)`,
    ),
    'Sales Order': t(
      `(SELECT so.number FROM sales_orders so WHERE so.quotation_id=t.quotation_id AND so.deleted_at IS NULL ORDER BY so.created_at LIMIT 1)`,
    ),
    Quotation: t('sq.number'),
    'Lost Reason': t('t.lost_reason'),
    Docs: DOCS('sales-enquiries'),
    Actions: ACTIONS,
  },
  register: [
    'Enquiry Number',
    'Customer ID',
    'Customer',
    'Product ID',
    'Product',
    'Quantity',
    'Expected Delivery Date',
    'Price Discussion',
    'Sales Person',
    'Next Follow-up',
    'Status',
    'Company Code',
    'Docs',
    'Actions',
  ],
  compact: ENQ_COMPACT,
  views: [
    {
      match: /^quotation link$/i,
      labels: [
        'Customer ID',
        'Customer',
        'Expected Delivery Date',
        'Sales Person',
        'Status',
        'Customer PO Number',
        'Sales Order',
        'Quotation',
        'Actions',
      ],
    },
    {
      match: /^win loss$/i,
      labels: [...ENQ_COMPACT.slice(0, 7), 'Lost Reason', 'Status', 'Actions'],
    },
  ],
};

const RES_PANEL: PanelDef = {
  title: 'Stock against the reservations',
  id: 'p.id',
  from: `stock_reservations p LEFT JOIN warehouses pw ON pw.id=p.warehouse_id LEFT JOIN stock_balances sb ON sb.item_id=p.item_id AND sb.warehouse_id=p.warehouse_id`,
  unit: 'p.unit_id',
  soft: null,
  order: 'p.created_at DESC, p.id',
  cols: [
    ['Record', 'p.code', 'text'],
    ['Demand', 'p.required_qty', 'num'],
    ['Available', 'COALESCE(sb.on_hand,0) - COALESCE(sb.reserved_qty,0)', 'num'],
    ['Allocated', 'p.reserved_qty', 'num'],
    ['Issued', 'p.fulfilled_qty', 'num'],
    // an issued, released or expired reservation waits for nothing
    ['Short', `CASE WHEN p.status IN ('Waiting','Partial','Reserved') THEN GREATEST(p.required_qty - p.reserved_qty - p.fulfilled_qty, 0) ELSE 0 END`, 'num'],
    ['Location', 'pw.code', 'text'],
    ['Action', `CASE WHEN p.status IN ('Waiting','Partial') AND p.required_qty > p.reserved_qty + p.fulfilled_qty THEN 'Reallocate' END`, 'actions'],
  ],
};
const RES_COMPACT = [
  'Reservation No',
  'Demand Ref',
  'Customer',
  'Item',
  'Warehouse',
  'Batch Serial',
  'Required Qty',
  'Status',
  'Actions',
];
const RESERVATIONS: PageDef = {
  from: `stock_reservations t LEFT JOIN items it ON it.id=t.item_id LEFT JOIN warehouses wh ON wh.id=t.warehouse_id LEFT JOIN LATERAL (SELECT so.id, c.name AS cname FROM sales_orders so LEFT JOIN customers c ON c.id=so.customer_id WHERE t.demand_type='SALES_ORDER' AND (so.number=t.demand_ref OR so.id::text=t.demand_ref) LIMIT 1) dm ON true LEFT JOIN stock_balances sb ON sb.item_id=t.item_id AND sb.warehouse_id=t.warehouse_id ${apJoin('sales-reservations')}`,
  soft: null,
  owner: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.demand_ref', 'it.code', 'it.name', 'dm.cname'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.code'),
    'Reservation No': t('t.code'),
    'Demand Ref': t('t.demand_ref'),
    Customer: t('dm.cname'),
    Item: t(`it.code || ' · ' || it.name`),
    Warehouse: t(`wh.code || ' · ' || wh.name`),
    'Batch Serial': t(`(SELECT b.batch_no FROM batches b WHERE b.id=t.batch_id)`),
    'Required Qty': n('t.required_qty'),
    'Reserved Qty': n('t.reserved_qty'),
    'Short Qty': n(`CASE WHEN t.status IN ('Waiting','Partial','Reserved') THEN GREATEST(t.required_qty - t.reserved_qty - t.fulfilled_qty, 0) ELSE 0 END`),
    'Reserved Until': d('t.reserved_until'),
    Status: { e: 't.status', type: 'pill' },
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: RES_COMPACT,
  compact: RES_COMPACT,
  views: [
    { match: /^reservation queue$/i, labels: RES_COMPACT, panel: RES_PANEL },
    {
      match: /^warehouse allocation$/i,
      labels: [
        'Item',
        'Warehouse',
        'Batch Serial',
        'Required Qty',
        'Reserved Qty',
        'Short Qty',
        'Status',
        'Actions',
      ],
      panel: RES_PANEL,
    },
    {
      match: /^batch serial allocation$/i,
      labels: [
        'Item',
        'Warehouse',
        'Batch Serial',
        'Required Qty',
        'Reserved Qty',
        'Short Qty',
        'Status',
        'Actions',
      ],
      panel: RES_PANEL,
    },
    {
      match: /^expiry priority$/i,
      order: 't.reserved_until NULLS LAST, t.id',
      labels: RES_COMPACT,
    },
    {
      match: /^release & reallocate$/i,
      where: [`t.status NOT IN ('Released','Cancelled','Fulfilled')`],
      labels: RES_COMPACT,
    },
    {
      match: /^reservation exceptions$/i,
      where: [`t.status IN ('Waiting','Partial','Reserved')`, 't.required_qty > t.reserved_qty + t.fulfilled_qty'],
      labels: [
        'Reservation No',
        'Demand Ref',
        'Customer',
        'Item',
        'Warehouse',
        'Batch Serial',
        'Required Qty',
        'Status',
        'Actions',
      ],
      panel: RES_PANEL,
    },
  ],
};

const DEL_COMPACT = [
  'Delivery Plan No',
  'Sales Order',
  'Customer',
  'Ship To',
  'Promise Date',
  'Route',
  'Transporter',
  'Status',
  'Actions',
];
const DELIVERY_STATUS = `CASE WHEN COALESCE(ln.qty - ln.disp - ln.closed,0) <= 0 THEN 'Delivered' WHEN t.delivery_date < CURRENT_DATE THEN 'Delayed' WHEN ln.disp > 0 THEN 'Partly delivered' ELSE 'Planned' END`;
const DELIVERY: PageDef = {
  base: [`t.status NOT IN ${NOT_OPEN}`],
  from: `sales_orders t LEFT JOIN customers cu ON cu.id=t.customer_id ${soLines}`,
  number: 't.number',
  status: DELIVERY_STATUS,
  search: ['t.number', 'cu.name'],
  order: 't.delivery_date NULLS LAST, t.number',
  cols: {
    ...approvalCols('t.number'),
    'Delivery Plan No': t('t.number'),
    'Sales Order': t('t.number'),
    Customer: t('cu.name'),
    'Ship To': t(`COALESCE(NULLIF(t.ship_to,''), (SELECT d.ship_to FROM sales_dispatches d WHERE d.order_id=t.id AND d.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 1))`),
    'Promise Date': d('t.delivery_date'),
    Route: t(
      `(SELECT NULLIF(concat_ws(' · ', d.transporter, d.vehicle_no), '') FROM sales_dispatches d WHERE d.order_id=t.id AND d.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 1)`,
    ),
    Transporter: t(
      `(SELECT dp.transporter FROM sales_dispatches dp WHERE dp.order_id=t.id AND dp.deleted_at IS NULL AND dp.transporter IS NOT NULL ORDER BY dp.created_at DESC LIMIT 1)`,
    ),
    Status: { e: DELIVERY_STATUS, type: 'pill' },
    'Balance Qty': n('GREATEST(ln.qty - ln.disp - ln.closed, 0)'),
    'Days Late': n(
      `CASE WHEN COALESCE(ln.qty - ln.disp - ln.closed,0) > 0 AND t.delivery_date < CURRENT_DATE THEN CURRENT_DATE - t.delivery_date END`,
    ),
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: DEL_COMPACT,
  compact: DEL_COMPACT,
  views: [
    {
      match: /^promise dates$/i,
      order: 't.delivery_date NULLS LAST, t.number',
      labels: DEL_COMPACT,
    },
    {
      match: /^route & vehicle$/i,
      labels: [...DEL_COMPACT.slice(0, 7), 'Status', 'Actions'],
    },
    {
      match: /^load planning$/i,
      labels: [...DEL_COMPACT.slice(0, 7), 'Balance Qty', 'Status', 'Actions'],
    },
    {
      match: /^delivery exceptions$/i,
      where: [`t.delivery_date < CURRENT_DATE`],
      labels: [...DEL_COMPACT.slice(0, 8), 'Days Late', 'Actions'],
    },
    { match: /^otif performance$/i, labels: [...DEL_COMPACT.slice(0, 8), 'Days Late', 'Actions'] },
  ],
};
DELIVERY.from = `sales_orders t LEFT JOIN customers cu ON cu.id=t.customer_id ${soLines} ${apJoin('sales-delivery')}`;

const CRED_COMPACT = [
  'Customer Code',
  'Customer',
  'Credit Limit',
  'Used Limit',
  'Available Limit',
  'Overdue',
  'Oldest Due Days',
  'Status',
  'Actions',
];
const openItems = (extra = ''): string =>
  `(SELECT COALESCE(sum(o.outstanding),0) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=t.id AND o.status NOT IN ('Settled','Cancelled')${extra})`;
const USED = `(${openItems()} + COALESCE((SELECT sum((l.qty - l.dispatched_qty - l.closed_qty) * l.rate * (1 - l.discount_pct/100)) FROM sales_order_lines l JOIN sales_orders so ON so.id=l.order_id WHERE so.customer_id=t.id AND so.status='Approved' AND so.deleted_at IS NULL AND l.qty - l.dispatched_qty - l.closed_qty > 0),0))`;
const CREDIT_STATUS = `CASE WHEN t.credit_limit IS NULL THEN 'No limit' WHEN ${USED} > t.credit_limit THEN 'Over limit' ELSE 'Within limit' END`;
const CREDIT_PANEL: PanelDef = {
  title: 'Customers over their limit',
  from: `customers p`,
  unit: null,
  soft: 'p.deleted_at',
  where: [`p.credit_limit IS NOT NULL`],
  order: 'p.name',
  cols: [
    ['Exception', `'Credit limit exceeded'`, 'text'],
    ['Record', 'p.code', 'text'],
    ['Severity', `'High'`, 'text'],
    [
      'Age',
      `(SELECT max(CURRENT_DATE - o.due_date) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=p.id AND o.outstanding > 0 AND o.due_date < CURRENT_DATE)`,
      'num',
    ],
    ['Root Cause', `p.name`, 'text'],
    ['Owner', `(SELECT u.name FROM users u WHERE u.id=p.sales_person_id)`, 'text'],
    ['Action', `'Ask for credit override'`, 'text'],
  ],
};
const CREDIT: PageDef = {
  base: [`t.status = 'ACTIVE'`],
  from: `customers t LEFT JOIN customer_credit_profiles cp ON cp.customer_id=t.id LEFT JOIN projects cpj ON cpj.id=cp.project_id ${apJoin('sales-credit')}`,
  unit: null,
  owner: null,
  number: 't.code',
  status: CREDIT_STATUS,
  search: ['t.code', 't.name'],
  order: 't.name, t.id',
  cols: {
    ...approvalCols('t.code'),
    'Customer Code': t('t.code'),
    Customer: t('t.name'),
    'Credit Limit': m('t.credit_limit'),
    'Used Limit': m(USED),
    'Available Limit': m(`t.credit_limit - ${USED}`),
    Overdue: m(openItems(' AND o.due_date < CURRENT_DATE')),
    'Oldest Due Days': n(
      `(SELECT max(CURRENT_DATE - o.due_date) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=t.id AND o.status NOT IN ('Settled','Cancelled') AND o.outstanding > 0 AND o.due_date < CURRENT_DATE)`,
    ),
    Status: { e: CREDIT_STATUS, type: 'pill' },
    'Credit Days': n('t.credit_days'),
    Tier: t('t.tier'),
    'Risk Grade': t('cp.risk_grade'),
    'Review Date': d('cp.review_date'),
    'Hold Status': t(`CASE WHEN t.credit_limit IS NOT NULL AND ${USED} > t.credit_limit THEN 'On hold' ELSE 'Not on hold' END`),
    'Limit Request': t(`(SELECT 'Waiting for approval' FROM customer_credit_requests q WHERE q.customer_id=t.id AND q.status='PENDING' LIMIT 1)`),
    'Sales Owner': t(`(SELECT u.name FROM users u WHERE u.id=t.sales_person_id)`),
    'Project Number': t('cpj.code'),
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: [
    ...CRED_COMPACT.slice(0, -2),
    'Credit Days',
    'Risk Grade',
    'Review Date',
    'Hold Status',
    'Limit Request',
    'Sales Owner',
    'Project Number',
    'Status',
    'Actions',
  ],
  compact: CRED_COMPACT,
  views: [
    {
      match: /^overdue exposure$/i,
      where: [`${openItems(' AND o.due_date < CURRENT_DATE')} > 0`],
      labels: CRED_COMPACT,
    },
    {
      match: /^credit holds$/i,
      where: [`t.credit_limit IS NOT NULL`, `${USED} > t.credit_limit`],
      labels: CRED_COMPACT,
      panel: CREDIT_PANEL,
    },
    {
      match: /^approval overrides$/i,
      where: [
        `EXISTS (SELECT 1 FROM sales_orders so WHERE so.customer_id=t.id AND so.credit_override_reason IS NOT NULL AND so.deleted_at IS NULL)`,
      ],
      labels: CRED_COMPACT,
    },
    { match: /^risk scoring$/i, labels: CRED_COMPACT, panel: CREDIT_PANEL },
  ],
};

const RET_COMPACT = [
  'Return No',
  'Customer',
  'Invoice Ref',
  'Return Date',
  'Item',
  'Qty',
  'Reason',
  'Status',
  'Actions',
];
const RETURNS: PageDef = {
  from: `sales_returns t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN sales_invoices iv ON iv.id=t.invoice_id LEFT JOIN LATERAL (SELECT (array_agg(i.code || ' · ' || i.name ORDER BY l.line_no))[1] AS item, sum(l.qty) AS qty, count(*) AS n FROM sales_return_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.return_id=t.id) ln ON true ${apJoin('sales-returns')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'cu.name', 'iv.number', 't.credit_note_no'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.number'),
    'Return No': t('t.number'),
    Customer: t('cu.name'),
    'Invoice Ref': t('iv.number'),
    'Return Date': d('t.return_date'),
    Item: t(`ln.item || CASE WHEN ln.n > 1 THEN ' +' || (ln.n - 1) || ' more' ELSE '' END`),
    Qty: n('ln.qty'),
    Reason: t('t.reason'),
    Condition: none(),
    Disposition: none(),
    'Credit Note Ref': t('t.credit_note_no'),
    'Replacement Ref': none(),
    Status: { e: 't.status', type: 'pill' },
    'Return Value': m('t.grand_total'),
    Docs: DOCS('sales-returns'),
    Actions: ACTIONS,
  },
  register: [
    'Return No',
    'Customer',
    'Invoice Ref',
    'Return Date',
    'Item',
    'Qty',
    'Reason',
    'Condition',
    'Disposition',
    'Credit Note Ref',
    'Replacement Ref',
    'Status',
    'Docs',
    'Actions',
  ],
  compact: RET_COMPACT,
  views: [
    { match: /^return reason$/i, labels: RET_COMPACT },
    { match: /^inspection & disposition$/i, labels: RET_COMPACT },
    {
      match: /^credit note link$/i,
      labels: [...RET_COMPACT.slice(0, 7), 'Credit Note Ref', 'Return Value', 'Status', 'Actions'],
      panel: {
        title: 'Credit notes of these returns',
        from: `sales_returns p LEFT JOIN customers pc ON pc.id=p.customer_id`,
        unit: 'p.unit_id',
        soft: 'p.deleted_at',
        where: [`p.status = 'Posted'`],
        order: 'p.return_date DESC, p.number',
        cols: [
          ['Reference', 'COALESCE(p.credit_note_no, p.number)', 'text'],
          ['Due', 'p.return_date', 'date'],
          ['Amount', 'p.grand_total', 'inr'],
          ['Allocated', 'p.grand_total', 'inr'],
          ['Balance', '0', 'inr'],
          ['Action', undefined, 'actions'],
        ],
      },
    },
    {
      match: /^replacement flow$/i,
      labels: [...RET_COMPACT.slice(0, 8), 'Replacement Ref', 'Actions'],
    },
    {
      match: /^return analytics$/i,
      labels: [...RET_COMPACT.slice(0, 7), 'Return Value', 'Status', 'Actions'],
    },
  ],
};

const PRICE_COMPACT = [
  'Price List Code',
  'Price List Name',
  'Customer Segment',
  'Item Category',
  'Currency',
  'Base Price',
  'Min Qty',
  'Status',
  'Actions',
];
const PRICELIST: PageDef = {
  from: `price_lists t LEFT JOIN customers cu ON cu.id=t.customer_id ${apJoin('sales-pricelist')}`,
  unit: null,
  owner: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 'cu.name'],
  order: 't.created_at DESC, t.id',
  cols: {
    ...approvalCols('t.code'),
    'Price List Code': t('t.code'),
    'Price List Name': t('t.name'),
    'Customer Segment': t(
      `COALESCE(cu.name, (SELECT g.name FROM party_groups g WHERE g.id=t.customer_group_id), t.kind)`,
    ),
    'Item Category': t(
      `(SELECT string_agg(DISTINCT i.category, ', ') FROM price_list_items pi JOIN items i ON i.id=pi.item_id WHERE pi.price_list_id=t.id)`,
    ),
    Currency: t('t.currency_code'),
    'Base Price': m(`(SELECT min(pi.rate) FROM price_list_items pi WHERE pi.price_list_id=t.id)`),
    'Min Qty': n(`(SELECT min(pi.min_qty) FROM price_list_items pi WHERE pi.price_list_id=t.id)`),
    'Margin %': n(
      `(SELECT round(avg((pi.rate - i.standard_cost) / NULLIF(pi.rate,0) * 100),2) FROM price_list_items pi JOIN items i ON i.id=pi.item_id WHERE pi.price_list_id=t.id AND i.standard_cost > 0)`,
    ),
    Status: { e: 't.status', type: 'pill' },
    'Valid From': d('t.valid_from'),
    'Valid To': d('t.valid_to'),
    Items: n(`(SELECT count(*) FROM price_list_items pi WHERE pi.price_list_id=t.id)`),
    Docs: none('docs'),
    Actions: ACTIONS,
  },
  register: ['Margin %', ...PRICE_COMPACT],
  compact: PRICE_COMPACT,
  views: [
    {
      match: /^customer pricing$/i,
      labels: [
        'Customer Segment',
        'Status',
        'Price List Code',
        'Price List Name',
        'Item Category',
        'Currency',
        'Base Price',
        'Actions',
      ],
    },
    {
      match: /^effective dates$/i,
      labels: [...PRICE_COMPACT.slice(0, 7), 'Valid From', 'Valid To', 'Status', 'Actions'],
    },
    {
      match: /^margin simulation$/i,
      labels: [
        'Margin %',
        'Price List Code',
        'Price List Name',
        'Customer Segment',
        'Item Category',
        'Currency',
        'Base Price',
        'Status',
        'Actions',
      ],
    },
  ],
};

export const SALES_V40_PAGES: Record<string, PageDef> = {
  'sales-orders': ORDERS,
  'sales-quotations': QUOTES,
  'sales-invoices': INVOICES,
  'sales-dispatch': DISPATCH,
  'sales-collections': COLLECTIONS,
  'crm-leads': LEADS,
  'crm-opportunities': OPPS,
  'crm-followups': FOLLOWUPS,
  'crm-meetings': MEETINGS,
  'crm-feedback': FEEDBACK,
  'crm-sources': SOURCES,
  'master-customers': CUSTOMERS,
  'crm-customer360': C360,
  'sales-enquiries': ENQUIRIES,
  'sales-reservations': RESERVATIONS,
  'sales-delivery': DELIVERY,
  'sales-credit': CREDIT,
  'sales-returns': RETURNS,
  'sales-pricelist': PRICELIST,
};

/** Columns V40 shows on a tab that this ERP cannot fill from any table yet (reported to the owner, shown as a dash). */
export function noSourceColumns(pageId: string, pages: Record<string, PageDef> = SALES_V40_PAGES): string[] {
  const p = pages[pageId];
  if (!p) return [];
  return Object.entries(p.cols)
    .filter(([label, c]) => !c.e && label !== 'Actions')
    .map(([label]) => label);
}

// ------------------------------------------------------------------------------------------------ engine
export interface V40Query {
  tab: string;
  first: boolean;
  /** Department filter: only these record ids, or every id except these. */
  held?: { only?: string[]; except?: string[] };
  q?: string | undefined;
  status?: string | undefined;
  /** "c3" ascending, "-c3" descending, by the tab's column of that key */
  sort?: string | undefined;
  page: number;
  size: number;
}
export interface V40Column {
  key: string;
  label: string;
  type: ColType;
  /** false = V40 shows this column but the database has no source for it (dash) */
  source: boolean;
}
export interface V40Result {
  /** set when the rows belong to another page than the one asked for */
  recordPage?: string;
  columns: V40Column[];
  rows: Row[];
  total: number;
  panel?: { title: string; columns: V40Column[]; rows: Row[] };
  audit: boolean;
  view: string;
}

function resolveView(def: PageDef, q: V40Query): { labels: string[]; view: ViewDef | null } {
  const name = q.tab.trim();
  const hit = def.views.find((v) => v.match.test(name));
  if (hit) return { labels: hit.labels, view: hit };
  if (q.first) return { labels: def.register, view: null };
  if (/approval/i.test(name))
    return {
      labels: [...APPROVAL_LABELS, ...def.compact.filter((l) => l !== 'Status' && l !== 'Actions')],
      view: {
        match: /./,
        labels: [],
        where: ['ap.id IS NOT NULL'],
        cols: { Department: approvalCols('').Department as Col, Amount: approvalCols('').Amount as Col },
      },
    };
  return { labels: def.compact, view: null };
}

const cast = (c: Col): string => {
  if (!c.e) return 'NULL::text';
  if (c.type === 'date') return `to_char((${c.e})::date,'YYYY-MM-DD')`;
  if (c.type === 'inr' || c.type === 'num') return `round((${c.e})::numeric, 0)::text`;
  return `(${c.e})::text`;
};

async function scopeParts(
  caller: Caller,
  pageId: string,
  unit: string | null,
  soft: string | null,
  owner: string | null,
  args: unknown[],
): Promise<string[]> {
  const parts: string[] = [];
  if (soft) parts.push(`${soft} IS NULL`);
  if (unit) {
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      parts.push(`${unit} = $${args.length}::uuid`);
    } else if (!caller.ctx.allUnits) parts.push('false');
  }
  if (owner && (await scopeFor(accessUserOf(caller.auth.user), pageId)) === 'OWN') {
    args.push(caller.auth.userId);
    parts.push(`${owner} = $${args.length}::uuid`);
  }
  return parts;
}

export async function salesV40View(
  caller: Caller,
  pageId: string,
  q: V40Query,
): Promise<V40Result> {
  const def = SALES_V40_PAGES[pageId];
  if (!def) throw new Error(`No V40 views for ${pageId}`);
  return runV40View(def, caller, pageId, q);
}

/** The engine: any family's PageDef (Sales, Manufacturing, Quality, Maintenance) is answered the same way. */
export async function runV40View(
  def: PageDef,
  caller: Caller,
  pageId: string,
  q: V40Query,
): Promise<V40Result> {
  const resolved = resolveView(def, q);
  const { view } = resolved;
  // on the Sales pages the row buttons close the row, after the status they act on
  const labels =
    pageId.startsWith('sales-') && resolved.labels.includes('Actions')
      ? [...resolved.labels.filter((l) => l !== 'Actions'), 'Actions']
      : resolved.labels;
  const cols: Record<string, Col> = { ...def.cols, ...(view?.cols ?? {}) };
  const columns: V40Column[] = labels.map((label, i) => {
    const c = cols[label] ?? none();
    return {
      key: `c${i}`,
      label,
      type: c.type,
      source: Boolean(c.e) || c.type === 'actions' || c.type === 'docs',
    };
  });
  const args: unknown[] = [];
  const where = await scopeParts(
    caller,
    pageId,
    def.unit === undefined ? 't.unit_id' : def.unit,
    def.soft === undefined ? 't.deleted_at' : def.soft,
    def.owner === undefined ? 't.created_by_id' : def.owner,
    args,
  );
  where.push(...(def.base ?? []), ...(view?.where ?? []));
  if (q.held?.only) {
    args.push(q.held.only);
    where.push(`t.id = ANY($${args.length}::uuid[])`);
  }
  if (q.held?.except?.length) {
    args.push(q.held.except);
    where.push(`NOT (t.id = ANY($${args.length}::uuid[]))`);
  }
  if (q.q) {
    args.push(`%${q.q}%`);
    where.push(`(${(view?.search ?? def.search).map((s) => `${s}::text ILIKE $${args.length}`).join(' OR ')})`);
  }
  if (q.status) {
    args.push(q.status);
    where.push(`${def.status} = $${args.length}`);
  }
  const from = view?.from ?? def.from;
  // "c3" / "-c3": order by the column the person picked (a column of this tab that has a source), else the tab's own order
  let order = view?.order ?? def.order;
  const pick = /^(-?)c(\d{1,2})$/.exec(q.sort ?? '');
  const picked = pick ? cols[labels[Number(pick[2])] ?? ''] : undefined;
  if (pick && picked?.e && picked.type !== 'docs' && picked.type !== 'actions') order = `(${picked.e}) ${pick[1] ? 'DESC' : 'ASC'} NULLS LAST, t.id`;
  const recordSql = view?.recordId ?? def.recordId;
  const record = recordSql ? `${recordSql}::text AS record_id, ` : '';
  const w = where.length ? where.join(' AND ') : 'true';
  const total = Number(
    (await query(prisma, `SELECT count(*)::int AS n FROM ${from} WHERE ${w}`, ...args))[0]?.n ?? 0,
  );
  const sel = labels.map((label, i) => `${cast(cols[label] ?? none())} AS c${i}`).join(', ');
  const rows = await query(
    prisma,
    `SELECT t.id::text AS id, ${record}${def.number} AS number, ${def.status} AS status, ${def.version === null ? 'NULL::text' : `${def.version ?? 't.version'}::text`} AS version, ${sel} FROM ${from} WHERE ${w}
      ORDER BY ${order} LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
    ...args,
  );
  const out: V40Result = {
    columns,
    rows: rows.map((r) => ({ ...r })),
    total,
    audit: Boolean(view?.audit),
    view: view?.labels === undefined ? (q.first ? 'register' : 'compact') : q.tab,
    ...(view?.recordPage ? { recordPage: view.recordPage } : {}),
  };
  const p = view?.panel;
  if (p) {
    const pargs: unknown[] = [];
    const pw = await scopeParts(caller, pageId, p.unit, p.soft, null, pargs);
    pw.push(...(p.where ?? []));
    const pcols = p.cols.map(([label, e, type], i): [V40Column, string] => [
      { key: `p${i}`, label, type, source: Boolean(e) || type === 'actions' },
      e ? (type === 'date' ? `to_char((${e})::date,'YYYY-MM-DD')` : `(${e})::text`) : 'NULL::text',
    ]);
    const scoped = pw.length ? pw.join(' AND ') : 'true';
    // panels built from unions carry {SCOPE} / {SCOPE:alias[:nosoft]} markers: each is the plant / soft-delete scope of that alias
    let pfrom = p.from;
    let pwhere = scoped;
    if (p.from.includes('{SCOPE')) {
      pargs.length = 0;
      const re = /\{SCOPE(?::(\w+))?(?::(nosoft))?\}/g;
      const found = [...p.from.matchAll(re)];
      for (const mt of found) {
        const alias = mt[1] ?? 'p';
        const sc = await scopeParts(
          caller,
          pageId,
          `${alias}.unit_id`,
          mt[2] ? null : `${alias}.deleted_at`,
          null,
          pargs,
        );
        pfrom = pfrom.replace(mt[0], sc.length ? sc.join(' AND ') : 'true');
      }
      pwhere = 'true';
    }
    const prows = await query(
      prisma,
      `SELECT ${p.id ? `${p.id}::text AS id, ` : ''}${pcols.map(([c, e]) => `${e} AS ${c.key}`).join(', ')} FROM ${pfrom} WHERE ${pwhere} ORDER BY ${p.order} LIMIT 50`,
      ...pargs,
    );
    out.panel = {
      title: p.title,
      columns: pcols.map(([c]) => c),
      rows: prows.map((r) => ({ ...r })),
    };
  }
  return out;
}

export interface V40Summary {
  total: number;
  byStatus: { status: string; count: number }[];
  /** records created per month, oldest first, the last 6 months */
  byMonth: { month: string; count: number }[];
  /** records past their date and still open (page rule below); null for a page with no such rule */
  atRisk: number | null;
  /** Lead Management cards: share of key details filled in, share of open leads without a follow-up ahead, open value */
  lead?: { completeness: number; open: number; riskScore: number; openValue: string };
  /** Credit Limits and Sales Returns cards (CARD_RULES below says what each figure counts) */
  cards?: { completeness: number; open: number; riskScore: number; metric: string | null };
}

/** What the cards of a Sales page count: the details that should be filled in, what is still open, and what is at risk. */
const CARD_RULES: Record<string, { filled: string[]; open: string; scope: string; risk: string; metric?: string }> = {
  'sales-credit': {
    filled: ['t.credit_limit', 't.credit_days', 'cp.risk_grade', 'cp.review_date'],
    // no limit yet, or a higher limit waiting for approval
    open: `t.credit_limit IS NULL OR EXISTS (SELECT 1 FROM customer_credit_requests q WHERE q.customer_id=t.id AND q.status='PENDING')`,
    scope: 't.credit_limit IS NOT NULL',
    risk: `${USED} > t.credit_limit OR ${openItems(' AND o.due_date < CURRENT_DATE')} > 0`,
  },
  'sales-returns': {
    filled: ['t.customer_id', 't.invoice_id', 't.warehouse_id', 't.return_date', `NULLIF(t.reason, '')`, 't.credit_note_no'],
    open: `t.status NOT IN ('Posted','Cancelled')`,
    scope: `t.status NOT IN ('Posted','Cancelled')`,
    risk: 't.return_date < CURRENT_DATE - 7',
    metric: 'COALESCE(sum(ln.qty), 0)',
  },
};

/** What "At Risk" means on a page: a condition on the table row (alias t) that is true for a record that is late or went wrong. */
const AT_RISK_SQL: Record<string, string> = {
  'crm-leads': "t.status = 'Unqualified'",
  'crm-opportunities': "t.status NOT IN ('Won', 'Lost') AND t.expected_close < current_date",
  'crm-followups': "t.status = 'Open' AND t.due_at < now()",
  'crm-meetings': "t.status = 'Planned' AND t.starts_at < now()",
  'crm-feedback': "t.status <> 'Closed' AND t.rating <= 6",
  'master-customers': "t.status <> 'ACTIVE'",
  'crm-customer360': "t.status <> 'ACTIVE'",
};

/** Whole-set figures for the Analytics / Reports tabs: two grouped counts under the same plant / ownership scope as the register. */
export async function runV40Summary(def: PageDef, caller: Caller, pageId: string): Promise<V40Summary> {
  const args: unknown[] = [];
  const where = await scopeParts(
    caller,
    pageId,
    def.unit === undefined ? 't.unit_id' : def.unit,
    def.soft === undefined ? 't.deleted_at' : def.soft,
    def.owner === undefined ? 't.created_by_id' : def.owner,
    args,
  );
  where.push(...(def.base ?? []));
  const w = where.length ? where.join(' AND ') : 'true';
  const byStatus = await query(
    prisma,
    `SELECT COALESCE(${def.status}::text, '-') AS status, count(*)::int AS count FROM ${def.from} WHERE ${w} GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
    ...args,
  );
  const byMonth = await query(
    prisma,
    `SELECT to_char(date_trunc('month', t.created_at), 'YYYY-MM') AS month, count(*)::int AS count FROM ${def.from}
      WHERE ${w} AND t.created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1 ORDER BY 1`,
    ...args,
  ).catch(() => []);
  const riskSql = AT_RISK_SQL[pageId];
  const risk = riskSql
    ? await query(prisma, `SELECT count(*)::int AS n FROM ${def.from} WHERE ${w} AND (${riskSql})`, ...args).catch(() => null)
    : null;
  let lead: V40Summary['lead'];
  if (pageId === 'crm-leads') {
    const filled = ['t.company', 't.mobile', 't.email', 't.source_id', 't.assigned_to_id', 't.est_value', 't.consent_status', LEAD_NEXT]
      .map((c) => `((${c}) IS NOT NULL)::int`)
      .join(' + ');
    const openLead = `t.status IN ('New','Contacted','Qualified')`;
    const r = (
      await query(
        prisma,
        `SELECT COALESCE(round(avg(${filled}) * 100 / 8), 0)::int AS completeness,
            count(*) FILTER (WHERE ${openLead})::int AS open,
            count(*) FILTER (WHERE ${openLead} AND (${LEAD_NEXT} IS NULL OR ${LEAD_NEXT} < current_date))::int AS risky,
            COALESCE(sum(t.est_value) FILTER (WHERE ${openLead}), 0)::text AS value
          FROM ${def.from} WHERE ${w}`,
        ...args,
      )
    )[0]!;
    const open = Number(r.open);
    lead = { completeness: Number(r.completeness), open, riskScore: open ? Math.round((Number(r.risky) / open) * 100) : 0, openValue: String(r.value) };
  }
  const rule = CARD_RULES[pageId];
  let cards: V40Summary['cards'];
  if (rule) {
    const filled = rule.filled.map((c) => `((${c}) IS NOT NULL)::int`).join(' + ');
    const r = (
      await query(
        prisma,
        `SELECT COALESCE(round(avg(${filled}) * 100 / ${rule.filled.length}), 0)::int AS completeness,
            count(*) FILTER (WHERE ${rule.open})::int AS open,
            count(*) FILTER (WHERE ${rule.scope})::int AS scoped,
            count(*) FILTER (WHERE (${rule.scope}) AND (${rule.risk}))::int AS risky,
            ${rule.metric ? `round(${rule.metric})::text` : 'NULL::text'} AS metric
          FROM ${def.from} WHERE ${w}`,
        ...args,
      )
    )[0]!;
    const scoped = Number(r.scoped);
    cards = { completeness: Number(r.completeness), open: Number(r.open), riskScore: scoped ? Math.round((Number(r.risky) / scoped) * 100) : 0, metric: r.metric === null ? null : String(r.metric) };
  }
  return {
    ...(cards ? { cards } : {}),
    ...(lead ? { lead } : {}),
    atRisk: risk ? Number(risk[0]?.n ?? 0) : null,
    total: byStatus.reduce((n, r) => n + Number(r.count), 0),
    byStatus: byStatus.map((r) => ({ status: String(r.status), count: Number(r.count) })),
    byMonth: byMonth.map((r) => ({ month: String(r.month), count: Number(r.count) })),
  };
}
