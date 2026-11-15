// V40 tab views of the Manufacturing pages (page-by-page build). GET /mfg/v40/:pageId?tab=<V40 tab name> answers every tab with the
// columns V40 shows there, values read from the real tables (orders, plans, MRP, job cards, scrap, rework, receipts, cost ledger).
// Same engine and rules as the Sales views (sales/v40-views.ts): a label with no real source returns NULL (the screen shows a dash)
// and is listed by noSourceColumns(); nothing is invented. Plant scope and soft delete are applied like the page lists.
import { ACTIONS, DOCS, apJoin, approvalCols, d, m, n, none, t } from '../sales/v40-views';
import type { PageDef, PanelDef, ViewDef } from '../sales/v40-views';

const V = (re: string, labels: string[], extra: Partial<ViewDef> = {}): ViewDef => ({
  match: new RegExp(`^(${re})$`, 'i'),
  labels,
  ...extra,
});
const pill = (e: string) => ({ e, type: 'pill' as const });

/** Sales order of a production order alias (mo): through the order line, or the order the MO was made for. */
const SO_OF = (mo: string): string =>
  `LEFT JOIN sales_order_lines sl ON sl.id=${mo}.so_line_id LEFT JOIN sales_orders so ON so.id=COALESCE(sl.order_id, CASE WHEN ${mo}.source_type='SALES_ORDER' THEN ${mo}.source_id END)`;

const MATERIAL_WORD = (e: string): string =>
  `CASE ${e} WHEN 'NOT_ISSUED' THEN 'Not issued' WHEN 'PARTIAL' THEN 'Partly issued' WHEN 'ISSUED' THEN 'Issued' ELSE ${e} END`;

/** Quality status of an order from the inspection sheets of its operations and lots. */
const QUALITY_OF = (mo: string): string =>
  `(SELECT CASE WHEN count(*)=0 THEN 'No inspection'
      WHEN count(*) FILTER (WHERE qi.status IN ('Draft','Submitted'))>0 THEN 'Pending'
      WHEN count(*) FILTER (WHERE qi.decision IN ('REJECTED','PARTIAL'))>0 THEN 'Rejected'
      ELSE 'Accepted' END
    FROM qms_inspections qi WHERE qi.deleted_at IS NULL AND qi.status <> 'Cancelled'
      AND (qi.id IN (SELECT l.inspection_id FROM mfg_lots l WHERE l.order_id=${mo}.id)
        OR qi.id IN (SELECT o.inspection_id FROM mfg_order_ops o WHERE o.order_id=${mo}.id)))`;

const ON_HAND = (item: string, unit: string): string =>
  `(SELECT COALESCE(sum(b.on_hand),0) FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id WHERE b.item_id=${item} AND w.unit_id=${unit})`;
const RESERVED = (item: string, unit: string): string =>
  `(SELECT COALESCE(sum(b.reserved_qty),0) FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id WHERE b.item_id=${item} AND w.unit_id=${unit})`;
const WH_CODE = (item: string, unit: string): string =>
  `(SELECT w.code FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id WHERE b.item_id=${item} AND w.unit_id=${unit} AND b.on_hand>0 ORDER BY b.on_hand DESC LIMIT 1)`;

/** The "Record / Demand / Available / Allocated / Short / Location" panel V40 shows next to the availability tabs. */
const availabilityPanel = (
  title: string,
  from: string,
  unit: string,
  soft: string,
  record: string,
  item: string,
  demand: string,
  order: string,
  extra: string[] = [],
): PanelDef => ({
  title,
  from,
  unit,
  soft,
  where: extra,
  order,
  cols: [
    ['Record', record, 'text'],
    ['Demand', demand, 'num'],
    ['Available', ON_HAND(item, unit), 'num'],
    ['Allocated', RESERVED(item, unit), 'num'],
    [
      'Short',
      `GREATEST(${demand} - GREATEST(${ON_HAND(item, unit)} - ${RESERVED(item, unit)}, 0), 0)`,
      'num',
    ],
    ['Location', WH_CODE(item, unit), 'text'],
    ['Action', undefined, 'actions'],
  ],
});

/** Output balance of the open production orders: planned quantity, received into stock, still to receive. */
const outputPanel: PanelDef = {
  title: 'Output balance',
  from: 'mfg_orders p',
  unit: 'p.unit_id',
  soft: 'p.deleted_at',
  id: 'p.id',
  where: [`p.status NOT IN ('Cancelled','Draft')`],
  order: 'p.due_date NULLS LAST, p.number',
  cols: [
    ['Reference', 'p.number', 'text'],
    ['Due', 'p.due_date', 'date'],
    ['Amount', 'p.qty', 'num'],
    ['Allocated', 'p.qty_received', 'num'],
    ['Balance', 'GREATEST(p.qty - p.qty_received, 0)', 'num'],
    [
      'Action',
      `CASE WHEN p.qty - p.qty_received > 0 AND p.status IN ('Released','In Progress','Completed') THEN 'Allocate' END`,
      'actions',
    ],
  ],
};

// ------------------------------------------------------------------------------------------------ Production Orders
const ORDER_FROM = `mfg_orders t LEFT JOIN items it ON it.id=t.item_id LEFT JOIN mfg_boms bm ON bm.id=t.bom_id LEFT JOIN mfg_routings rt ON rt.id=t.routing_id
  LEFT JOIN mfg_production_plan_lines pl ON pl.id=t.plan_line_id LEFT JOIN mfg_production_plans pp ON pp.id=pl.plan_id ${SO_OF('t')} ${apJoin('mfg-orders')}`;
const ORDER_COLS: PageDef['cols'] = {
  'Production Order Number': t('t.number'),
  'Production Plan': t('pp.number'),
  'Start Date': d('t.start_date'),
  'Due Date': d('t.due_date'),
  'Material Status': t(MATERIAL_WORD('t.material_status')),
  'Quality Status': t(QUALITY_OF('t')),
  Status: pill('t.status'),
  'Sales Order': t('so.number'),
  'Product ID': t('it.code'),
  Product: t('it.name'),
  'BOM Number': t('bm.number'),
  Routing: t('rt.number'),
  'Planned Quantity': n('t.qty'),
  'Made Quantity': n('t.qty_completed'),
  'Scrap Quantity': n('t.qty_scrapped'),
  'Received Quantity': n('t.qty_received'),
  'In Stock': n(
    `CASE WHEN t.item_id IS NULL THEN NULL ELSE ${ON_HAND('t.item_id', 't.unit_id')} END`,
  ),
  ...approvalCols('t.number'),
  Docs: DOCS('mfg-orders'),
  Actions: ACTIONS,
};
const ORDER_COMPACT = [
  'Production Order Number',
  'Sales Order',
  'Production Plan',
  'Product ID',
  'Product',
  'BOM Number',
  'Routing',
  'Status',
  'Actions',
];
const ORDERS: PageDef = {
  from: ORDER_FROM,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'so.number', 'pp.number', 'it.code', 'it.name', 't.customer_po_no'],
  order: 't.created_at DESC, t.id',
  cols: ORDER_COLS,
  register: [
    'Production Order Number',
    'Production Plan',
    'Start Date',
    'Material Status',
    'Quality Status',
    'Status',
    'Sales Order',
    'Actions',
  ],
  compact: ORDER_COMPACT,
  views: [
    V(
      'material status',
      [...ORDER_COMPACT.slice(0, 8), 'Material Status', 'Actions'],
      { where: [`t.status NOT IN ('Cancelled')`] },
    ),
    V('schedule', [...ORDER_COMPACT.slice(0, 8), 'Start Date', 'Due Date', 'Actions'], {
      where: [`t.status NOT IN ('Cancelled','Closed')`],
      order: 't.due_date NULLS LAST, t.number',
    }),
    V(
      'output balance',
      [...ORDER_COMPACT.slice(0, 8), 'Planned Quantity', 'Received Quantity', 'Actions'],
      { panel: outputPanel },
    ),
    V('quality', [...ORDER_COMPACT.slice(0, 8), 'Quality Status', 'Actions']),
    V('audit', ORDER_COMPACT, { audit: true }),
  ],
};

// ------------------------------------------------------------------------------------------------ Production Plans
const PLAN_LINES = `LEFT JOIN LATERAL (SELECT (array_agg(i.code ORDER BY l.required_date, l.id))[1] AS code, (array_agg(i.name ORDER BY l.required_date, l.id))[1] AS pname,
    (array_agg(bm.number ORDER BY l.required_date, l.id))[1] AS bom, (array_agg(so.number ORDER BY l.required_date, l.id) FILTER (WHERE so.number IS NOT NULL))[1] AS so_no,
    sum(l.planned_qty) AS qty, sum(l.demand_qty) AS demand, max(l.capacity_load_pct) AS load, avg(l.material_avail_pct) AS mat, min(l.required_date) AS req, count(*) AS n
  FROM mfg_production_plan_lines l LEFT JOIN items i ON i.id=l.item_id LEFT JOIN mfg_boms bm ON bm.id=l.bom_id
  LEFT JOIN sales_order_lines sl ON sl.id=l.so_line_id LEFT JOIN sales_orders so ON so.id=sl.order_id WHERE l.plan_id=t.id) ln ON true`;
const planMore = (e: string): string =>
  `${e} || CASE WHEN ln.n > 1 THEN ' +' || (ln.n - 1) || ' more' ELSE '' END`;
const PLAN_COMPACT = [
  'Plan No',
  'Sales Order',
  'Product ID',
  'Product',
  'Required Quantity',
  'BOM Number',
  'Production Capacity / Day',
  'Status',
  'Actions',
];
const PLANS: PageDef = {
  from: `mfg_production_plans t ${PLAN_LINES} ${apJoin('mfg-plan')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'ln.so_no', 'ln.code', 'ln.pname'],
  order: 't.plan_date DESC, t.number DESC',
  cols: {
    'Plan No': t('t.number'),
    'Sales Order': t('ln.so_no'),
    'Product ID': t('ln.code'),
    Product: t(planMore('ln.pname')),
    'Required Quantity': n('ln.qty'),
    'BOM Number': t('ln.bom'),
    'Production Capacity / Day': none('num'),
    'Estimated Start': d(
      `(SELECT min(mo.start_date) FROM mfg_orders mo JOIN mfg_production_plan_lines l ON l.id=mo.plan_line_id WHERE l.plan_id=t.id AND mo.deleted_at IS NULL)`,
    ),
    'Plan Date': d('t.plan_date'),
    'Horizon Days': n('t.horizon_days'),
    'Capacity Load %': n('ln.load'),
    'Material Available %': n('ln.mat'),
    'Required Date': d('ln.req'),
    'Orders Released': n(
      `(SELECT count(*) FROM mfg_orders mo JOIN mfg_production_plan_lines l ON l.id=mo.plan_line_id WHERE l.plan_id=t.id AND mo.deleted_at IS NULL)`,
    ),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('mfg-plan'),
    Actions: ACTIONS,
  },
  register: [
    'Production Capacity / Day',
    'Estimated Start',
    'Status',
    'Plan No',
    'Sales Order',
    'Product ID',
    'Product',
    'Actions',
  ],
  compact: PLAN_COMPACT,
  views: [
    V('capacity', [...PLAN_COMPACT.slice(0, 7), 'Capacity Load %', 'Status', 'Actions'], {
      panel: availabilityPanel(
        'Material against the plan',
        'mfg_production_plan_lines p JOIN mfg_production_plans pp ON pp.id=p.plan_id LEFT JOIN items pi ON pi.id=p.item_id',
        'pp.unit_id',
        'pp.deleted_at',
        `pp.number || ' · ' || pi.code`,
        'p.item_id',
        'p.planned_qty',
        'pp.plan_date DESC, pi.code',
        [`pp.status NOT IN ('Cancelled','Closed')`],
      ),
    }),
    V('material readiness', [...PLAN_COMPACT.slice(0, 6), 'Material Available %', 'Status', 'Actions']),
    V('delivery commitment', [...PLAN_COMPACT.slice(0, 6), 'Required Date', 'Status', 'Actions'], {
      order: 'ln.req NULLS LAST, t.number',
    }),
    V('release', [...PLAN_COMPACT.slice(0, 6), 'Orders Released', 'Status', 'Actions']),
    V('audit', PLAN_COMPACT, { audit: true }),
  ],
};

// ------------------------------------------------------------------------------------------------ MRP (suggestion lines)
const MRP_PEG = `LEFT JOIN LATERAL (SELECT (array_agg(so.number) FILTER (WHERE so.number IS NOT NULL))[1] AS so_no, (array_agg(pi.code) FILTER (WHERE pi.code IS NOT NULL))[1] AS pcode,
    (array_agg(pp.number) FILTER (WHERE pp.number IS NOT NULL))[1] AS plan_no
  FROM mfg_mrp_pegging pg LEFT JOIN sales_order_lines sl ON pg.source_type='SO_LINE' AND sl.id::text=pg.source_id LEFT JOIN sales_orders so ON so.id=sl.order_id
  LEFT JOIN items pi ON pi.id=sl.item_id LEFT JOIN mfg_production_plan_lines pl ON pg.source_type='PLAN_LINE' AND pl.id::text=pg.source_id
  LEFT JOIN mfg_production_plans pp ON pp.id=pl.plan_id WHERE pg.suggestion_id=t.id) pg ON true`;
const MRP_COMPACT = [
  'MRP Line No',
  'MRP Run No',
  'Sales Order',
  'Production Plan',
  'Product ID',
  'Material Code',
  'Material',
  'Status',
  'Actions',
];
const MRP_ONHAND = ON_HAND('t.item_id', 't.unit_id');
const MRP: PageDef = {
  from: `mfg_mrp_suggestions t JOIN mfg_mrp_runs rn ON rn.id=t.run_id LEFT JOIN items it ON it.id=t.item_id LEFT JOIN mfg_production_plans rp ON rp.id=rn.plan_id
    LEFT JOIN purchase_requisitions pr ON pr.id=t.converted_doc_id AND t.converted_doc_type='PURCHASE_REQUISITION' ${MRP_PEG} ${apJoin('mfg-mrp','rn.id')}`,
  soft: 'rn.deleted_at',
  owner: 'rn.created_by_id',
  number: `rn.number || '-' || (SELECT count(*) FROM mfg_mrp_suggestions x WHERE x.run_id=t.run_id AND x.id<=t.id)`,
  status: 't.status',
  search: ['rn.number', 'it.code', 'it.name', 'pg.so_no', 'pg.plan_no'],
  order: 'rn.created_at DESC, it.code, t.due_date',
  cols: {
    'MRP Line No': t(
      `rn.number || '-' || (SELECT count(*) FROM mfg_mrp_suggestions x WHERE x.run_id=t.run_id AND x.id<=t.id)`,
    ),
    'MRP Run No': t('rn.number'),
    'Sales Order': t('pg.so_no'),
    'Production Plan': t('COALESCE(pg.plan_no, rp.number)'),
    'Product ID': t('pg.pcode'),
    'Material Code': t('it.code'),
    Material: t('it.name'),
    Type: t(`CASE t.type WHEN 'BUY' THEN 'Buy' WHEN 'MAKE' THEN 'Make' ELSE t.type END`),
    'Required Qty': n('t.qty'),
    'On Hand': n(MRP_ONHAND),
    'Shortage Qty': n(`GREATEST(t.qty - ${MRP_ONHAND}, 0)`),
    'Reserved Qty': n(RESERVED('t.item_id', 't.unit_id')),
    'Required Date': d('t.due_date'),
    'Release Date': d('t.release_date'),
    'PR Number': t('pr.number'),
    'Project Code': none(),
    'Customer PO Number': t(
      `(SELECT so2.customer_po_no FROM mfg_mrp_pegging pg2 JOIN sales_order_lines sl2 ON pg2.source_type='SO_LINE' AND sl2.id::text=pg2.source_id JOIN sales_orders so2 ON so2.id=sl2.order_id WHERE pg2.suggestion_id=t.id AND so2.customer_po_no IS NOT NULL LIMIT 1)`,
    ),
    Status: pill('t.status'),
    ...approvalCols('rn.number'),
    Docs: DOCS('mfg-mrp'),
    Actions: ACTIONS,
  },
  register: MRP_COMPACT,
  compact: MRP_COMPACT,
  views: [
    V('available material', [...MRP_COMPACT.slice(0, 7), 'Required Qty', 'On Hand', 'Status', 'Actions'], {
      where: [`${MRP_ONHAND} >= t.qty`],
    }),
    V('shortage material', [...MRP_COMPACT.slice(0, 7), 'Required Qty', 'On Hand', 'Shortage Qty', 'Status', 'Actions'], {
      where: [`${MRP_ONHAND} < t.qty`, `t.status IN ('OPEN','FIRMED')`],
    }),
    V('reservation', [
      'Record', // replaced by the panel; the table keeps the MRP columns
      ...MRP_COMPACT.slice(0, 7),
      'Reserved Qty',
      'Status',
      'Actions',
    ].filter((l) => l !== 'Record'), {
      panel: availabilityPanel(
        'Material availability of the MRP lines',
        'mfg_mrp_suggestions p JOIN mfg_mrp_runs rn ON rn.id=p.run_id LEFT JOIN items pi ON pi.id=p.item_id',
        'p.unit_id',
        'rn.deleted_at',
        `rn.number || ' · ' || pi.code`,
        'p.item_id',
        'p.qty',
        'rn.created_at DESC, pi.code',
        [`p.status IN ('OPEN','FIRMED')`],
      ),
    }),
    V(
      'purchase link',
      ['Production Plan', 'Product ID', 'Required Date', 'PR Number', 'Status', 'Project Code', 'Customer PO Number', 'Actions'],
      { where: [`t.type='BUY'`] },
    ),
    V('audit', MRP_COMPACT, { audit: true }),
  ],
};

// ------------------------------------------------------------------------------------------------ Material issue (order material lines)
const ISSUE_STATUS = `CASE WHEN t.issued_qty - t.returned_qty >= t.required_qty AND t.required_qty > 0 THEN 'Issued' WHEN t.issued_qty > 0 THEN 'Partly issued' ELSE 'Not issued' END`;
const ISSUE_COMPACT = [
  'Issue No',
  'Production Order',
  'Sales Order',
  'Material Code',
  'Material',
  'Required Qty',
  'Reserved Qty',
  'Status',
  'Actions',
];
const RESERVED_FOR_LINE = `(SELECT COALESCE(sum(r.reserved_qty),0) FROM stock_reservations r WHERE r.demand_ref=mo.number AND r.item_id=t.item_id AND r.status NOT IN ('Released','Cancelled'))`;
const ISSUES: PageDef = {
  from: `mfg_order_materials t JOIN mfg_orders mo ON mo.id=t.order_id LEFT JOIN items it ON it.id=t.item_id LEFT JOIN warehouses wh ON wh.id=COALESCE(mo.rm_warehouse_id, mo.warehouse_id) ${SO_OF('mo')} ${apJoin('mfg-material-issue','mo.id')}`,
  unit: 'mo.unit_id',
  soft: 'mo.deleted_at',
  owner: 'mo.created_by_id',
  version: null,
  number: `mo.number || '/' || t.line_no`,
  status: ISSUE_STATUS,
  search: ['mo.number', 'it.code', 'it.name', 'so.number'],
  order: 'mo.created_at DESC, mo.id, t.line_no',
  cols: {
    'Issue No': t(
      `(SELECT x.number FROM mfg_order_moves x WHERE x.order_id=mo.id AND x.kind='ISSUE' AND x.status <> 'Reversed' ORDER BY x.seq DESC LIMIT 1)`,
    ),
    'Production Order': t('mo.number'),
    'Sales Order': t('so.number'),
    'Material Code': t('it.code'),
    Material: t('it.name'),
    'Required Qty': n('t.required_qty'),
    'Reserved Qty': n(RESERVED_FOR_LINE),
    'Issued Qty': n('t.issued_qty'),
    'Returned Qty': n('t.returned_qty'),
    'Consumed Qty': n('t.consumed_qty'),
    Warehouse: t('wh.name'),
    Status: pill(ISSUE_STATUS),
    ...approvalCols('mo.number'),
    Docs: DOCS('mfg-material-issue'),
    Actions: ACTIONS,
  },
  register: ISSUE_COMPACT,
  compact: ISSUE_COMPACT,
  views: [
    V(
      'reservation check',
      [...ISSUE_COMPACT.slice(0, 7), 'Status', 'Actions'],
      {
        panel: availabilityPanel(
          'Stock against the open material lines',
          'mfg_order_materials p JOIN mfg_orders mo ON mo.id=p.order_id LEFT JOIN items pi ON pi.id=p.item_id',
          'mo.unit_id',
          'mo.deleted_at',
          `mo.number || ' · ' || pi.code`,
          'p.item_id',
          'GREATEST(p.required_qty - p.issued_qty + p.returned_qty, 0)',
          'mo.created_at DESC, pi.code',
          [`mo.status IN ('Released','In Progress')`, 'p.required_qty > p.issued_qty - p.returned_qty'],
        ),
      },
    ),
    V('batch allocation', [
      'Production Order',
      'Required Qty',
      'Reserved Qty',
      'Issued Qty',
      'Returned Qty',
      'Consumed Qty',
      'Warehouse',
      'Status',
      'Actions',
    ]),
    V('consumption', [...ISSUE_COMPACT.slice(0, 6), 'Consumed Qty', 'Status', 'Actions']),
    V('returns', [...ISSUE_COMPACT.slice(0, 6), 'Returned Qty', 'Status', 'Actions'], {
      where: ['t.returned_qty > 0'],
    }),
    V('audit', ISSUE_COMPACT, { audit: true }),
  ],
};

// ------------------------------------------------------------------------------------------------ WIP (orders holding WIP)
const WIP_VALUE = `COALESCE((SELECT sum(c.amount) FROM mfg_cost_ledger c WHERE c.order_id=t.id),0)`;
const CURRENT_OP = `(SELECT o.name FROM mfg_order_ops o WHERE o.order_id=t.id AND o.status <> 'Done' ORDER BY o.seq LIMIT 1)`;
const WIP_COMPACT = [
  'WIP Reference',
  'Production Order',
  'Sales Order',
  'Product ID',
  'Process',
  'Plant / Unit',
  'Input Quantity',
  'Status',
  'Actions',
];
const WIP: PageDef = {
  from: `mfg_orders t LEFT JOIN items it ON it.id=t.item_id LEFT JOIN units un ON un.id=t.unit_id ${SO_OF('t')} ${apJoin('mfg-wip')}`,
  base: [`t.status IN ('Released','In Progress','Completed')`],
  number: `'WIP-' || t.number`,
  status: 't.status',
  search: ['t.number', 'so.number', 'it.code', 'it.name'],
  order: 't.due_date NULLS LAST, t.number',
  cols: {
    'WIP Reference': t(`'WIP-' || t.number`),
    'Production Order': t('t.number'),
    'Sales Order': t('so.number'),
    'Product ID': t('it.code'),
    Process: t(CURRENT_OP),
    'Plant / Unit': t('un.name'),
    'Input Quantity': n('t.qty'),
    'Start Time': t(`to_char(COALESCE(t.released_at, t.start_date::timestamptz),'YYYY-MM-DD HH24:MI')`),
    'Completed Quantity': n('t.qty_completed'),
    'Scrap Quantity': n('t.qty_scrapped'),
    'Rework Quantity': n(`COALESCE((SELECT sum(o.qty_rework) FROM mfg_order_ops o WHERE o.order_id=t.id),0)`),
    'Unit Cost': m(`${WIP_VALUE} / NULLIF(t.qty,0)`),
    'WIP Value': m(WIP_VALUE),
    'Age (days)': n(`(current_date - COALESCE(t.released_at::date, t.start_date))`),
    'Due Date': d('t.due_date'),
    Exception: t(
      `CASE WHEN t.due_date < current_date AND t.status <> 'Completed' THEN 'Overdue' WHEN t.qty_scrapped > 0 THEN 'Scrap booked' END`,
    ),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('mfg-wip'),
    Actions: ACTIONS,
  },
  register: ['Production Order', 'Start Time', 'Status', 'WIP Reference', 'Sales Order', 'Product ID', 'Process', 'Actions'],
  compact: WIP_COMPACT,
  views: [
    V('process quantity', [...WIP_COMPACT.slice(0, 7), 'Completed Quantity', 'Scrap Quantity', 'Rework Quantity', 'Status', 'Actions']),
    V('value', ['Unit Cost', 'WIP Value', 'WIP Reference', 'Production Order', 'Sales Order', 'Product ID', 'Process', 'Status', 'Actions']),
    V('ageing', [...WIP_COMPACT.slice(0, 7), 'Age (days)', 'Status', 'Actions'], {
      order: `COALESCE(t.released_at::date, t.start_date) NULLS LAST, t.number`,
    }),
    V('exceptions', [...WIP_COMPACT.slice(0, 7), 'Exception', 'Status', 'Actions'], {
      where: [`((t.due_date < current_date AND t.status <> 'Completed') OR t.qty_scrapped > 0)`],
    }),
    V('audit', WIP_COMPACT, { audit: true }),
  ],
};

// ------------------------------------------------------------------------------------------------ FG receipts
const FG_COMPACT = [
  'FG Receipt Number',
  'Production Order',
  'Sales Order',
  'Product ID',
  'Product',
  'Batch Number',
  'Receipt Date',
  'Status',
  'Actions',
];
const FG_AVAIL = `(SELECT COALESCE(sum(b.on_hand - b.reserved_qty),0) FROM stock_balances b WHERE b.item_id=t.item_id AND b.warehouse_id=COALESCE(mo.warehouse_id,b.warehouse_id))`;
const FG: PageDef = {
  from: `mfg_production_receipts t JOIN mfg_orders mo ON mo.id=t.order_id LEFT JOIN items it ON it.id=t.item_id LEFT JOIN warehouses wh ON wh.id=mo.warehouse_id ${SO_OF('mo')} ${apJoin('mfg-fg')}`,
  soft: 'mo.deleted_at',
  owner: 't.created_by_id',
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'mo.number', 'so.number', 'it.code', 't.batch_no'],
  order: 't.receipt_date DESC, t.number DESC',
  cols: {
    'FG Receipt Number': t('t.number'),
    'Receipt Date': d('t.receipt_date'),
    Status: pill('t.status'),
    'Production Order': t('mo.number'),
    'Sales Order': t('so.number'),
    'Product ID': t('it.code'),
    Product: t('it.name'),
    'Batch Number': t('t.batch_no'),
    Quantity: n('t.qty'),
    'Quality Status': t('t.qc_status'),
    Warehouse: t('wh.name'),
    'Available for Dispatch': n(FG_AVAIL),
    ...approvalCols('t.number'),
    Docs: DOCS('mfg-fg'),
    Actions: ACTIONS,
  },
  register: ['FG Receipt Number', 'Receipt Date', 'Status', 'Production Order', 'Sales Order', 'Product ID', 'Product', 'Actions'],
  compact: FG_COMPACT,
  views: [
    V('so reservation|dispatch availability', [...FG_COMPACT.slice(0, 7), 'Receipt Date', 'Status', 'Actions'], {
      panel: availabilityPanel(
        'Open sales order lines against stock',
        'sales_order_lines p JOIN sales_orders so ON so.id=p.order_id LEFT JOIN items pi ON pi.id=p.item_id',
        'so.unit_id',
        'so.deleted_at',
        `so.number || ' · ' || pi.code`,
        'p.item_id',
        'GREATEST(p.qty - p.dispatched_qty - p.closed_qty, 0)',
        'so.delivery_date NULLS LAST, so.number',
        [`so.status='Approved'`, 'p.qty - p.dispatched_qty - p.closed_qty > 0', `p.item_id IN (SELECT r.item_id FROM mfg_production_receipts r)`],
      ),
    }),
    V('warehouse', ['Production Order', 'Product ID', 'Product', 'Batch Number', 'Warehouse', 'Available for Dispatch', 'Status', 'Actions']),
    V('returns|audit', FG_COMPACT, { audit: true }),
  ],
};
// the FG Receipts tab shows the output balance beside the register
FG.views.unshift(
  V('fg receipts', [...FG_COMPACT.slice(0, 7), 'Quantity', 'Status', 'Actions'], { panel: outputPanel }),
);

// ------------------------------------------------------------------------------------------------ Scrap
const SCRAP_COMPACT = [
  'Scrap No',
  'Production Order',
  'Operation',
  'Item',
  'Scrap Qty',
  'Reason',
  'Recoverable Qty',
  'Status',
  'Actions',
];
const SCRAP: PageDef = {
  from: `mfg_scrap t LEFT JOIN mfg_orders mo ON mo.id=t.order_id LEFT JOIN mfg_order_ops op ON op.id=t.op_id LEFT JOIN items it ON it.id=t.item_id LEFT JOIN items ri ON ri.id=t.recovery_item_id ${apJoin('mfg-scrap')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'mo.number', 'it.code', 'it.name', 't.reason'],
  order: 't.scrap_date DESC, t.number DESC',
  cols: {
    'Scrap No': t('t.number'),
    'Production Order': t('mo.number'),
    Operation: t('op.name'),
    Item: t(`it.code || ' · ' || it.name`),
    'Scrap Qty': n('t.qty'),
    Reason: t('t.reason'),
    'Recoverable Qty': n('t.recoverable_qty'),
    'Recovery Item': t('ri.code'),
    'Recovery Value': m('t.recovery_value'),
    'Disposal Method': t('t.disposal_method'),
    Type: t(`CASE WHEN t.is_normal THEN 'Normal' ELSE 'Abnormal' END`),
    'Unit Cost': m('t.loss_value / NULLIF(t.qty,0)'),
    'Loss Value': m('t.loss_value'),
    'Scrap Date': d('t.scrap_date'),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('mfg-scrap'),
    Actions: ACTIONS,
  },
  register: SCRAP_COMPACT,
  compact: SCRAP_COMPACT,
  views: [
    V('scrap reasons', [...SCRAP_COMPACT.slice(0, 5), 'Reason', 'Type', 'Status', 'Actions']),
    V('material recovery', [...SCRAP_COMPACT.slice(0, 5), 'Recoverable Qty', 'Recovery Item', 'Recovery Value', 'Status', 'Actions'], {
      where: ['t.recoverable_qty > 0'],
    }),
    V('approval & disposal', [...SCRAP_COMPACT.slice(0, 7), 'Disposal Method', 'Status', 'Actions']),
    V('cost impact', ['Unit Cost', 'Loss Value', 'Scrap No', 'Production Order', 'Operation', 'Item', 'Scrap Qty', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Rework
const REWORK_COMPACT = [
  'Rework No',
  'Source NCR',
  'Production Order',
  'Item',
  'Qty',
  'Defect',
  'Rework Routing',
  'Status',
  'Actions',
];
const REWORK: PageDef = {
  from: `mfg_rework t LEFT JOIN mfg_orders mo ON mo.id=t.order_id LEFT JOIN mfg_order_ops op ON op.id=t.op_id LEFT JOIN items it ON it.id=t.item_id LEFT JOIN qms_rejections qr ON qr.id=t.rejection_id ${apJoin('mfg-rework')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'mo.number', 'it.code', 'it.name', 't.reason', 'qr.number'],
  order: 't.rework_date DESC, t.number DESC',
  cols: {
    'Rework No': t('t.number'),
    'Source NCR': t('COALESCE(qr.number, t.source_ncr_ref)'),
    'Production Order': t('mo.number'),
    Item: t(`it.code || ' · ' || it.name`),
    Qty: n('t.qty'),
    Defect: t('t.reason'),
    'Rework Routing': t('op.name'),
    'Accepted Qty': n('t.qty_ok'),
    'Scrapped Qty': n('t.qty_scrap'),
    'Labour Hrs': n('t.labour_hrs'),
    'Material Cost': m('t.material_cost'),
    'Rework Cost': m('t.cost'),
    Reinspection: t('t.reinspection_result'),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('mfg-rework'),
    Actions: ACTIONS,
  },
  register: REWORK_COMPACT,
  compact: REWORK_COMPACT,
  views: [
    V('rework routing', ['Rework No', 'Production Order', 'Item', 'Qty', 'Rework Routing', 'Status', 'Source NCR', 'Actions']),
    V('material labor', [...REWORK_COMPACT.slice(0, 6), 'Labour Hrs', 'Material Cost', 'Status', 'Actions']),
    V('reinspection', [...REWORK_COMPACT.slice(0, 6), 'Accepted Qty', 'Scrapped Qty', 'Reinspection', 'Status', 'Actions']),
    V('rework cost', ['Material Cost', 'Rework No', 'Source NCR', 'Production Order', 'Item', 'Qty', 'Defect', 'Rework Cost', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Costing
const COST_COMPACT = [
  'Cost Sheet No',
  'Production Order',
  'Item',
  'Standard Material',
  'Actual Material',
  'Standard Labor',
  'Actual Labor',
  'Status',
  'Actions',
];
const COSTING: PageDef = {
  from: `mfg_cost_sheets t JOIN mfg_orders mo ON mo.id=t.order_id LEFT JOIN items it ON it.id=mo.item_id ${apJoin('mfg-costing','mo.id')}`,
  unit: 'mo.unit_id',
  soft: 'mo.deleted_at',
  owner: 'mo.created_by_id',
  version: null,
  number: `'CS-' || mo.number`,
  status: `CASE WHEN t.finalised_at IS NOT NULL THEN 'Finalised' ELSE 'Open' END`,
  search: ['mo.number', 'it.code', 'it.name'],
  order: 'mo.created_at DESC, t.id',
  cols: {
    'Cost Sheet No': t(`'CS-' || mo.number`),
    'Production Order': t('mo.number'),
    Item: t(`it.code || ' · ' || it.name`),
    'Standard Material': m('t.std_material'),
    'Actual Material': m('t.act_material'),
    'Standard Labor': m('t.std_labour'),
    'Actual Labor': m('t.act_labour'),
    'Standard Overhead': m('t.std_overhead'),
    'Actual Overhead': m('t.act_overhead'),
    'Standard Total': m('t.std_total'),
    'Actual Total': m('t.act_total'),
    'Abnormal Scrap': m('t.abnormal_scrap'),
    'Variance': m('t.act_total - t.std_total'),
    'Variance %': n('t.variance_pct'),
    Status: pill(`CASE WHEN t.finalised_at IS NOT NULL THEN 'Finalised' ELSE 'Open' END`),
    ...approvalCols('mo.number'),
    Docs: DOCS('mfg-costing'),
    Actions: ACTIONS,
  },
  register: ['Cost Sheet No', 'Standard Total', 'Actual Total', 'Production Order', 'Item', 'Standard Material', 'Actual Material', 'Status', 'Actions'],
  compact: COST_COMPACT,
  views: [
    V('labor cost', ['Cost Sheet No', 'Production Order', 'Item', 'Standard Labor', 'Actual Labor', 'Status', 'Actions']),
    V('machine overhead', ['Cost Sheet No', 'Production Order', 'Item', 'Standard Overhead', 'Actual Overhead', 'Status', 'Actions']),
    V('variance analysis', [...COST_COMPACT.slice(0, 3), 'Standard Total', 'Actual Total', 'Variance', 'Variance %', 'Status', 'Actions']),
    V('actual vs standard', COST_COMPACT),
  ],
};

// ------------------------------------------------------------------------------------------------ Work orders (job cards = order operations)
const WO_STATUS = 't.status';
const WO_COMPACT = [
  'WO No',
  'Production Order',
  'Operation',
  'Work Center',
  'Machine',
  'Operator',
  'Planned Qty',
  'Status',
  'Actions',
];
const WORKORDERS: PageDef = {
  from: `mfg_order_ops t JOIN mfg_orders mo ON mo.id=t.order_id LEFT JOIN mfg_work_centres wc ON wc.id=t.work_centre_id LEFT JOIN assets ma ON ma.id=wc.asset_id ${apJoin('mfg-workorders','mo.id')}`,
  unit: 'mo.unit_id',
  soft: 'mo.deleted_at',
  owner: 'mo.created_by_id',
  version: null,
  number: `mo.number || '-' || lpad(t.seq::text,2,'0')`,
  status: WO_STATUS,
  search: ['mo.number', 't.name', 'wc.code', 'wc.name'],
  order: 'mo.created_at DESC, mo.id, t.seq',
  cols: {
    'WO No': t(`mo.number || '-' || lpad(t.seq::text,2,'0')`),
    'Production Order': t('mo.number'),
    Operation: t(`t.seq || ' · ' || t.name`),
    'Work Center': t(`wc.code || ' · ' || wc.name`),
    Machine: t('ma.name'),
    Operator: t(
      `(SELECT l.operator_name FROM mfg_job_card_time_logs l WHERE l.op_id=t.id AND l.operator_name IS NOT NULL ORDER BY l.created_at DESC LIMIT 1)`,
    ),
    'Planned Qty': n('t.planned_qty'),
    'Completed Qty': n('t.qty_done'),
    'Scrap Qty': n('t.qty_scrap'),
    'Rework Qty': n('t.qty_rework'),
    'Start Time': t(`to_char(t.started_at,'YYYY-MM-DD HH24:MI')`),
    'Completed At': t(`to_char(t.completed_at,'YYYY-MM-DD HH24:MI')`),
    'Actual Minutes': n('t.actual_minutes'),
    'Planned Minutes': n('t.setup_minutes + t.run_minutes * COALESCE(t.planned_qty, mo.qty)'),
    'Downtime Minutes': n(
      `(SELECT COALESCE(sum(x.minutes),0) FROM mfg_downtime_logs x WHERE x.op_id=t.id)`,
    ),
    Status: pill(WO_STATUS),
    ...approvalCols('mo.number'),
    Docs: DOCS('mfg-workorders'),
    Actions: ACTIONS,
  },
  register: ['Production Order', 'Work Center', 'Planned Qty', 'Completed Qty', 'Start Time', 'Scrap Qty', 'Status', 'Actions'],
  compact: WO_COMPACT,
  views: [
    V('operation details', [...WO_COMPACT.slice(0, 7), 'Planned Minutes', 'Actual Minutes', 'Status', 'Actions']),
    V('operator assignment', WO_COMPACT),
    V('material consumption', [...WO_COMPACT.slice(0, 3), 'Planned Qty', 'Completed Qty', 'Status', 'Actions'], {
      panel: {
        title: 'Material of the production order',
        from: 'mfg_order_materials p JOIN mfg_orders mo ON mo.id=p.order_id LEFT JOIN items pi ON pi.id=p.item_id',
        unit: 'mo.unit_id',
        soft: 'mo.deleted_at',
        where: [`mo.status IN ('Released','In Progress','Completed')`],
        order: 'mo.created_at DESC, p.line_no',
        cols: [
          ['Production Order', 'mo.number', 'text'],
          ['#', 'p.line_no', 'num'],
          ['Item / Service', `pi.code || ' · ' || pi.name`, 'text'],
          ['Required Qty', 'p.required_qty', 'num'],
          ['Issued Qty', 'p.issued_qty', 'num'],
          ['Consumed Qty', 'p.consumed_qty', 'num'],
        ],
      },
    }),
    V('downtime & scrap', [...WO_COMPACT.slice(0, 7), 'Scrap Qty', 'Downtime Minutes', 'Status', 'Actions']),
    V('completion', [...WO_COMPACT.slice(0, 7), 'Completed Qty', 'Completed At', 'Status', 'Actions']),
  ],
};

export const MFG_V40_PAGES: Record<string, PageDef> = {
  'mfg-orders': ORDERS,
  'mfg-plan': PLANS,
  'mfg-mrp': MRP,
  'mfg-material-issue': ISSUES,
  'mfg-wip': WIP,
  'mfg-fg': FG,
  'mfg-scrap': SCRAP,
  'mfg-rework': REWORK,
  'mfg-costing': COSTING,
  'mfg-workorders': WORKORDERS,
};
