// V40 tab views of the Quality (QMS) pages. GET /qms/v40/:pageId?tab=<V40 tab name>: the columns V40 shows on each tab with values read
// from the real tables (inspection sheets, rejections, 8D / CI forms, 5-why cases, instruments, plans). Same engine and rules as the
// Sales views: a label with no real source returns NULL (a dash on screen) and is listed by noSourceColumns(); nothing is invented.
import { ACTIONS, DOCS, apJoin, approvalCols, d, n, none, t } from '../sales/v40-views';
import type { PageDef, ViewDef } from '../sales/v40-views';

const V = (re: string, labels: string[], extra: Partial<ViewDef> = {}): ViewDef => ({
  match: new RegExp(`^(${re})$`, 'i'),
  labels,
  ...extra,
});
const pill = (e: string) => ({ e, type: 'pill' as const });

// ------------------------------------------------------------------------------------------------ inspection sheets
const INSP_FROM = (page: string): string =>
  `qms_inspections t LEFT JOIN items it ON it.id=t.item_id LEFT JOIN suppliers su ON su.id=t.supplier_id
   LEFT JOIN goods_receipt_lines gl ON t.source_type='GRN_LINE' AND gl.id=t.source_id LEFT JOIN goods_receipts gr ON gr.id=gl.grn_id LEFT JOIN purchase_orders po ON po.id=gr.po_id
   LEFT JOIN mfg_lots ml ON t.source_type='MFG_LOT' AND ml.id=t.source_id LEFT JOIN mfg_orders mo ON mo.id=ml.order_id LEFT JOIN mfg_order_ops mop ON mop.id=ml.op_id
   LEFT JOIN sales_order_lines sl ON sl.id=mo.so_line_id LEFT JOIN sales_orders so ON so.id=COALESCE(sl.order_id, CASE WHEN mo.source_type='SALES_ORDER' THEN mo.source_id END)
   LEFT JOIN mfg_production_receipts fr ON fr.lot_id=ml.id LEFT JOIN projects pj ON pj.id=t.project_id ${apJoin(page)}`;
const FIRST_ROW = (col: string): string =>
  `(SELECT r.${col} FROM qms_inspection_rows r WHERE r.inspection_id=t.id ORDER BY r.row_no LIMIT 1)`;
const INSP_COLS = (page: string): PageDef['cols'] => ({
  'Inspection Number': t('t.number'),
  'Inspection No': t('t.number'),
  'Inspection Type': t(
    `CASE t.kind WHEN 'INCOMING' THEN 'Incoming' WHEN 'IN_PROCESS' THEN 'In process' WHEN 'PRE_DISPATCH' THEN 'Pre-dispatch' WHEN 'ISIR' THEN 'Supplier ISIR' WHEN 'WELDING' THEN 'Welding' WHEN 'VT' THEN 'Visual test' ELSE t.kind END`,
  ),
  'Inspection Date': d('t.doc_date'),
  'GRN Number': t('gr.number'),
  'PO Number': t('po.number'),
  'Sales Order': t('so.number'),
  Vendor: t('su.name'),
  'Material Code': t('it.code'),
  Material: t('it.name'),
  'Product ID': t('it.code'),
  Product: t('it.name'),
  Item: t(`it.code || ' · ' || it.name`),
  'Production Order': t('mo.number'),
  Operation: t(`mop.seq || ' · ' || mop.name`),
  'Batch Number': t('fr.batch_no'),
  'Produced Quantity': n('t.lot_qty'),
  'Lot Quantity': n('t.lot_qty'),
  'Accepted Quantity': n('t.accepted_qty'),
  'Rejected Quantity': n('t.rejected_qty'),
  Result: t('t.result'),
  Decision: t('t.decision'),
  'Decision Note': t('t.decision_note'),
  'Sample Time': t(`to_char(t.submitted_at,'YYYY-MM-DD HH24:MI')`),
  Parameter: t(FIRST_ROW('label')),
  Specification: t(FIRST_ROW('spec')),
  Parameters: n(`(SELECT count(*) FROM qms_inspection_rows r WHERE r.inspection_id=t.id)`),
  'Out of Limit': n(
    `(SELECT count(*) FROM qms_inspection_rows r WHERE r.inspection_id=t.id AND r.row_status IN ('FAIL','OUT','REJECT'))`,
  ),
  Reference: t(`COALESCE(gr.number, mo.number)`),
  'Lot Batch': t('COALESCE(fr.batch_no, gr.number)'),
  'Sample Qty': none('num'),
  'Inventory Posted': t(`CASE WHEN gr.id IS NULL THEN NULL WHEN gr.posted_at IS NOT NULL THEN 'Yes' ELSE 'No' END`),
  'Project Code': t('pj.code'),
  'Project Number': t('pj.code'),
  Status: pill('t.status'),
  ...approvalCols('t.number'),
  Docs: DOCS(page),
  Actions: ACTIONS,
});
const inspPage = (
  page: string,
  kinds: string[] | null,
  register: string[],
  extraViews: ViewDef[],
  compact = register,
): PageDef => ({
  from: INSP_FROM(page),
  number: 't.number',
  status: 't.status',
  base: kinds ? [`t.kind IN (${kinds.map((k) => `'${k}'`).join(',')})`] : [],
  search: ['t.number', 'gr.number', 'po.number', 'su.name', 'it.code', 'it.name', 'mo.number', 'so.number'],
  order: 't.doc_date DESC, t.number DESC',
  cols: INSP_COLS(page),
  register,
  compact,
  views: extraViews,
});

const INC = [
  'Inspection Number',
  'GRN Number',
  'PO Number',
  'Sales Order',
  'Vendor',
  'Material Code',
  'Material',
  'Status',
  'Actions',
];
const INCOMING = inspPage('qms-incoming', ['INCOMING'], INC, [
  V('results', [...INC.slice(0, 7), 'Lot Quantity', 'Accepted Quantity', 'Rejected Quantity', 'Status', 'Actions']),
  V('accepted stock', ['Batch Number', 'Status', 'Inspection Number', 'GRN Number', 'PO Number', 'Sales Order', 'Vendor', 'Accepted Quantity', 'Actions'], {
    where: [`t.decision IN ('ACCEPTED','PARTIAL','CONDITIONAL')`],
  }),
  V('rejected & vendor return', ['PO Number', 'Vendor', 'Inspection Date', 'Inventory Posted', 'Status', 'Project Code', 'Project Number', 'Rejected Quantity', 'Actions'], {
    where: ['t.rejected_qty > 0'],
  }),
  V('ncr', [...INC.slice(0, 7), 'Rejected Quantity', 'Decision Note', 'Status', 'Actions'], {
    where: ['t.rejected_qty > 0'],
  }),
  V('audit', INC, { audit: true }),
]);

const PRC = [
  'Inspection No',
  'Production Order',
  'Operation',
  'Item',
  'Sample Time',
  'Parameter',
  'Specification',
  'Status',
  'Actions',
];
const PROCESS = inspPage('qms-process', ['IN_PROCESS'], PRC, [
  V('operation checkpoints', PRC),
  V('spc readings', [...PRC.slice(0, 7), 'Parameters', 'Out of Limit', 'Status', 'Actions']),
  V('hold release', [...PRC.slice(0, 5), 'Decision', 'Decision Note', 'Status', 'Actions'], {
    where: [`t.status IN ('Submitted','Decided')`],
  }),
  V('defect escalation', [...PRC.slice(0, 5), 'Rejected Quantity', 'Decision Note', 'Status', 'Actions'], {
    where: ['t.rejected_qty > 0'],
  }),
  V('process capability', [...PRC.slice(0, 7), 'Parameters', 'Out of Limit', 'Status', 'Actions']),
]);

const FIN = [
  'Inspection Number',
  'Production Order',
  'Sales Order',
  'Product ID',
  'Product',
  'Batch Number',
  'Produced Quantity',
  'Status',
  'Actions',
];
const FINAL = inspPage('qms-final', ['PRE_DISPATCH', 'WELDING', 'VT'], FIN, [
  V('test results', [...FIN.slice(0, 7), 'Result', 'Status', 'Actions']),
  V('accepted fg', [...FIN.slice(0, 7), 'Accepted Quantity', 'Status', 'Actions'], {
    where: ['t.accepted_qty > 0'],
  }),
  V('rework', [...FIN.slice(0, 7), 'Rejected Quantity', 'Status', 'Actions'], {
    where: [`EXISTS (SELECT 1 FROM mfg_rework rw WHERE rw.order_id=mo.id AND rw.deleted_at IS NULL)`],
  }),
  V('scrap', [...FIN.slice(0, 7), 'Rejected Quantity', 'Status', 'Actions'], {
    where: [`EXISTS (SELECT 1 FROM mfg_scrap sc WHERE sc.order_id=mo.id AND sc.deleted_at IS NULL)`],
  }),
  V('audit', FIN, { audit: true }),
]);

const INS = [
  'Inspection No',
  'Inspection Type',
  'Reference',
  'Item',
  'Lot Batch',
  'Sample Qty',
  'Parameters',
  'Status',
  'Actions',
];
const INSPECTIONS = inspPage('qms-inspections', null, INS, [
  V('parameter results', [...INS.slice(0, 5), 'Parameters', 'Out of Limit', 'Status', 'Actions']),
  V('sample details', INS),
  V('accept reject', [...INS.slice(0, 5), 'Accepted Quantity', 'Rejected Quantity', 'Decision', 'Status', 'Actions']),
  V('attachments & certificates', INS),
  V('inspection analytics', INS),
]);

// ------------------------------------------------------------------------------------------------ Supplier quality (per supplier, last 12 months)
const SUPQ = `LEFT JOIN LATERAL (SELECT count(*) AS lots, count(*) FILTER (WHERE x.rejected_qty > 0) AS bad, COALESCE(sum(x.lot_qty),0) AS qty, COALESCE(sum(x.rejected_qty),0) AS rej
  FROM qms_inspections x WHERE x.supplier_id=t.id AND x.kind IN ('INCOMING','ISIR') AND x.status='Decided' AND x.deleted_at IS NULL AND x.doc_date >= current_date - 365) q ON true`;
const SQ = ['Vendor', 'Period', 'Lots Received', 'Lots Rejected', 'PPM', 'Quality Score', 'OTIF', 'Status', 'Actions'];
const SUPPLIER: PageDef = {
  from: `suppliers t ${SUPQ} ${apJoin('qms-supplier')}`,
  unit: null,
  owner: null,
  base: ['q.lots > 0'],
  number: 't.code',
  status: 't.status',
  search: ['t.name', 't.code'],
  order: 't.name',
  cols: {
    Vendor: t('t.name'),
    Period: t(`'Last 12 months'`),
    'Lots Received': n('q.lots'),
    'Lots Rejected': n('q.bad'),
    PPM: n('round(q.rej / NULLIF(q.qty,0) * 1000000)'),
    'Quality Score': n('round(100 * (1 - q.bad::numeric / NULLIF(q.lots,0)), 1)'),
    OTIF: none('num'),
    'Project Number': none(),
    Status: pill('t.status'),
    ...approvalCols('t.name'),
    Docs: DOCS('qms-supplier'),
    Actions: ACTIONS,
  },
  register: ['Vendor', 'Status', 'Project Number', 'Period', 'Lots Received', 'Lots Rejected', 'PPM', 'Actions'],
  compact: SQ,
  views: [V('supplier quality score', SQ)],
};

// ------------------------------------------------------------------------------------------------ NCR (rejection register)
const NCR_C = [
  'NCR No',
  'Date',
  'Source',
  'Reference',
  'Item',
  'Problem Description',
  'Containment',
  'Disposition',
  'Rework No',
  'Rework Status',
  'CAPA No',
  'CAPA Status',
  'Status',
  'Actions',
];
const FIVE = `(SELECT fw.root_cause FROM five_why_cases fw WHERE fw.ncr_ref=t.number AND fw.deleted_at IS NULL ORDER BY fw.created_at DESC LIMIT 1)`;
const REWORK = (col: string): string =>
  `(SELECT rw.${col} FROM mfg_rework rw WHERE rw.rejection_id=t.id ORDER BY rw.created_at DESC LIMIT 1)`;
const CAPA_OF_NCR = (col: string): string =>
  `(SELECT f.${col} FROM qms_forms f WHERE f.kind='EIGHT_D' AND f.deleted_at IS NULL AND f.data->>'ncr_ref'=t.number ORDER BY f.created_at DESC LIMIT 1)`;
const NCR: PageDef = {
  from: `qms_rejections t LEFT JOIN items it ON it.id=t.item_id LEFT JOIN qms_inspections si ON si.id=t.source_inspection_id ${apJoin('qms-ncr')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'it.code', 'it.name', 't.defect', 't.process', 'si.number'],
  order: 't.reject_date DESC, t.number DESC',
  cols: {
    'NCR No': t('t.number'),
    Date: d('t.reject_date'),
    Source: t('t.process'),
    Reference: t('si.number'),
    Item: t(`COALESCE(it.code || ' · ' || it.name, t.part)`),
    'Problem Description': t(`t.defect || COALESCE(' (' || t.defect_type || ')', '')`),
    Containment: t(`'Held ' || trim(trailing '.' from trim(trailing '0' from t.hold_qty::text))`),
    'Root Cause': t(FIVE),
    Disposition: t('t.disposition'),
    'Disposition Note': t('t.disposition_note'),
    Responsibility: t('t.operator'),
    'Due Date': none('date'),
    'Rework No': t(REWORK('number')),
    'Rework Qty': n(REWORK('qty')),
    'Rework OK Qty': n(REWORK('qty_ok')),
    'Rework Scrap Qty': n(REWORK('qty_scrap')),
    'Rework Status': t(REWORK('status')),
    'CAPA No': t(CAPA_OF_NCR('number')),
    'CAPA Status': t(CAPA_OF_NCR('status')),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('qms-ncr'),
    Actions: ACTIONS,
  },
  register: NCR_C,
  compact: NCR_C,
  views: [
    V('containment', [...NCR_C.slice(0, 6), 'Containment', 'Status', 'Actions']),
    V('root cause', [...NCR_C.slice(0, 6), 'Root Cause', 'Status', 'Actions']),
    V('disposition', [...NCR_C.slice(0, 6), 'Disposition', 'Disposition Note', 'Status', 'Actions']),
    V('responsibility & due date', [...NCR_C.slice(0, 6), 'Responsibility', 'Due Date', 'Status', 'Actions']),
    V('ncr trend', NCR_C),
  ],
};

// ------------------------------------------------------------------------------------------------ CAPA (8D and continuous-improvement forms)
const CAPA_C = [
  'CAPA No',
  'NCR Ref',
  'Problem Statement',
  'Root Cause',
  'Corrective Action',
  'Preventive Action',
  'Owner',
  'Status',
  'Actions',
];
const CAPA: PageDef = {
  from: `qms_forms t ${apJoin('qms-capa')}`,
  base: [`t.kind IN ('EIGHT_D','CI')`],
  number: 't.number',
  status: 't.status',
  search: ['t.number', 't.title', 't.capa_ref'],
  order: 't.doc_date DESC, t.number DESC',
  cols: {
    'CAPA No': t('t.number'),
    'NCR Ref': t(`COALESCE((SELECT r.number FROM qms_rejections r WHERE r.number = t.data->>'ncr_ref' LIMIT 1), NULL)`),
    'Problem Statement': t(`COALESCE(t.data->>'d2_problem', t.data->>'issue', t.title)`),
    'Root Cause': t(`COALESCE(t.data->>'d4_root_cause', t.data->>'root_cause')`),
    'Corrective Action': t(`COALESCE(t.data->>'d5_corrective', t.data->>'actions')`),
    'Preventive Action': t(`t.data->>'d7_prevent'`),
    Owner: t(`COALESCE(t.data->>'d1_team', t.data->>'team')`),
    Type: t(`CASE t.kind WHEN 'EIGHT_D' THEN '8D' ELSE 'Continuous improvement' END`),
    'CAPA Reference': t('t.capa_ref'),
    'Effectiveness Check': t(`COALESCE(t.data->>'d6_implemented', t.data->>'after')`),
    Date: d('t.doc_date'),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('qms-capa'),
    Actions: ACTIONS,
  },
  register: CAPA_C,
  compact: CAPA_C,
  views: [
    V('problem statement', [...CAPA_C.slice(0, 3), 'Owner', 'Status', 'Actions']),
    V('root cause', [...CAPA_C.slice(0, 2), 'Root Cause', 'Owner', 'Status', 'Actions']),
    V('corrective action', [...CAPA_C.slice(0, 2), 'Corrective Action', 'Owner', 'Status', 'Actions']),
    V('preventive action', [...CAPA_C.slice(0, 2), 'Preventive Action', 'Owner', 'Status', 'Actions']),
    V('effectiveness check', [...CAPA_C.slice(0, 2), 'Effectiveness Check', 'CAPA Reference', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ MOM (minutes of meeting)
const MOM_C = [
  'MOM No',
  'Date',
  'Title',
  'Location',
  'Attendees',
  'Action Items',
  'Next Meeting Date',
  'Status',
  'Actions',
];
const MOM: PageDef = {
  from: `qms_forms t ${apJoin('qms-mom')}`,
  base: [`t.kind='MOM'`],
  number: 't.number',
  status: 't.status',
  search: ['t.number', 't.title'],
  order: 't.doc_date DESC, t.number DESC',
  cols: {
    'MOM No': t('t.number'),
    Date: d('t.doc_date'),
    Title: t('t.title'),
    Location: t(`t.data->>'location'`),
    Attendees: n(`jsonb_array_length(COALESCE(t.data->'attendees','[]'::jsonb))`),
    'Action Items': n(`jsonb_array_length(COALESCE(t.data->'action_items','[]'::jsonb))`),
    'Open Action Items': n(
      `(SELECT count(*) FROM jsonb_array_elements(COALESCE(t.data->'action_items','[]'::jsonb)) a WHERE COALESCE(a->>'status','') NOT IN ('Done','Closed'))`,
    ),
    Agenda: t(`t.data->>'agenda'`),
    'Next Meeting Date': t(`t.data->>'next_meeting_date'`),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('qms-mom'),
    Actions: ACTIONS,
  },
  register: MOM_C,
  compact: MOM_C,
  views: [
    V('action items', [...MOM_C.slice(0, 4), 'Action Items', 'Open Action Items', 'Status', 'Actions']),
    V('agenda', [...MOM_C.slice(0, 4), 'Agenda', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ 5 Why
const WHY = (k: number): string =>
  `(SELECT s.answer FROM five_why_steps s WHERE s.case_id=t.id AND s.step_no=${k})`;
const FW_C = ['Case No', 'NCR Ref', 'Problem', 'Why 1', 'Why 2', 'Why 3', 'Why 4', 'Status', 'Actions'];
const FIVEWHY: PageDef = {
  from: `five_why_cases t ${apJoin('qms-5why')}`,
  number: 't.number',
  status: 't.status',
  search: ['t.number', 't.title', 't.ncr_ref', 't.problem'],
  order: 't.created_at DESC',
  cols: {
    'Case No': t('t.number'),
    'NCR Ref': t('t.ncr_ref'),
    Problem: t('COALESCE(t.title, t.problem)'),
    'Why 1': t(WHY(1)),
    'Why 2': t(WHY(2)),
    'Why 3': t(WHY(3)),
    'Why 4': t(WHY(4)),
    'Why 5': t(WHY(5)),
    'Root Cause': t('t.root_cause'),
    'Corrective Action': t('t.corrective_action'),
    'CAPA Reference': t('t.capa_ref'),
    Department: t('t.department'),
    Closed: d('t.closed_at'),
    Status: pill('t.status'),
    ...approvalCols('t.number'),
    Docs: DOCS('qms-5why'),
    Actions: ACTIONS,
  },
  register: FW_C,
  compact: FW_C,
  views: [
    V('problem definition', ['Case No', 'NCR Ref', 'Problem', 'Department', 'Status', 'Actions']),
    V('why chain', [...FW_C.slice(0, 7), 'Why 5', 'Status', 'Actions']),
    V('root cause evidence', ['Case No', 'NCR Ref', 'Problem', 'Root Cause', 'Status', 'Actions']),
    V('action linkage', ['Case No', 'NCR Ref', 'Root Cause', 'Corrective Action', 'CAPA Reference', 'Status', 'Actions']),
    V('closure review', ['Case No', 'NCR Ref', 'Problem', 'Root Cause', 'Closed', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Calibration
const LAST_CAL = (col: string): string =>
  `(SELECT c.${col} FROM qms_calibrations c WHERE c.instrument_id=t.id ORDER BY c.calibrated_on DESC, c.created_at DESC LIMIT 1)`;
const CAL_C = [
  'Instrument ID',
  'Instrument Name',
  'Department',
  'Range',
  'Accuracy',
  'Calibration Frequency',
  'Last Calibration',
  'Status',
  'Actions',
];
const CAL: PageDef = {
  from: `qms_instruments t ${apJoin('qms-calibration')}`,
  number: 't.history_card_no',
  status: 't.status',
  search: ['t.history_card_no', 't.name', 't.equipment_no', 't.location'],
  order: 't.history_card_no',
  cols: {
    'Instrument ID': t('t.history_card_no'),
    'Instrument Name': t('t.name'),
    Department: t('t.division'),
    Range: t('t.measuring_range'),
    Accuracy: none(),
    'Least Count': t('t.least_count'),
    'Calibration Frequency': t(`t.frequency_months || ' months'`),
    'Last Calibration': d('t.last_calibrated_on'),
    'Next Due': d('t.valid_until'),
    'Days Remaining': n('t.valid_until - current_date'),
    Result: t(LAST_CAL('result')),
    'Error Found': t(LAST_CAL('error_found')),
    'Certificate No': t(LAST_CAL('certificate_no')),
    Agency: t(LAST_CAL('agency')),
    Location: t('t.location'),
    Compliance: t(
      `CASE WHEN t.status <> 'ACTIVE' THEN 'Not in use' WHEN t.valid_until IS NULL THEN 'Never calibrated' WHEN t.valid_until < current_date THEN 'Overdue' ELSE 'In date' END`,
    ),
    Status: pill('t.status'),
    ...approvalCols('t.history_card_no'),
    Docs: DOCS('qms-calibration'),
    Actions: ACTIONS,
  },
  register: CAL_C,
  compact: CAL_C,
  views: [
    V('calibration schedule', [...CAL_C.slice(0, 2), 'Calibration Frequency', 'Last Calibration', 'Next Due', 'Days Remaining', 'Status', 'Actions'], {
      order: 't.valid_until NULLS FIRST, t.history_card_no',
    }),
    V('calibration results', [...CAL_C.slice(0, 2), 'Last Calibration', 'Result', 'Error Found', 'Agency', 'Status', 'Actions']),
    V('out of tolerance', [...CAL_C.slice(0, 2), 'Last Calibration', 'Result', 'Error Found', 'Status', 'Actions'], {
      where: [`${LAST_CAL('result')} = 'FAIL'`],
    }),
    V('certificates', [...CAL_C.slice(0, 2), 'Last Calibration', 'Certificate No', 'Agency', 'Next Due', 'Status', 'Actions']),
    V('compliance status', [...CAL_C.slice(0, 2), 'Next Due', 'Compliance', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Inspection plans
const PL_C = [
  'Plan Code',
  'Plan Name',
  'Inspection Type',
  'Item Category',
  'Revision',
  'Sampling Standard',
  'Sample Size',
  'Status',
  'Actions',
];
const PLANS: PageDef = {
  from: `qms_plans t LEFT JOIN items it ON it.id=t.item_id ${apJoin('qms-plans')}`,
  unit: null,
  soft: null,
  owner: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 'it.code', 'it.name'],
  order: 't.code',
  cols: {
    'Plan Code': t('t.code'),
    'Plan Name': t('t.name'),
    'Inspection Type': t(
      `CASE t.kind WHEN 'INCOMING' THEN 'Incoming' WHEN 'IN_PROCESS' THEN 'In process' WHEN 'PRE_DISPATCH' THEN 'Pre-dispatch' WHEN 'ISIR' THEN 'Supplier ISIR' ELSE t.kind END`,
    ),
    'Item Category': t('it.category'),
    Item: t(`it.code || ' · ' || it.name`),
    Revision: n('t.version'),
    'Sampling Standard': none(),
    'Sample Size': none('num'),
    Characteristics: n('jsonb_array_length(COALESCE(t.characteristics, \'[]\'::jsonb))'),
    'Revision Reason': none(),
    Status: pill('t.status'),
    ...approvalCols('t.code'),
    Docs: DOCS('qms-plans'),
    Actions: ACTIONS,
  },
  register: PL_C,
  compact: PL_C,
  views: [
    V('characteristics', [...PL_C.slice(0, 4), 'Item', 'Characteristics', 'Status', 'Actions']),
    V('revision control', PL_C),
  ],
};

export const QMS_V40_PAGES: Record<string, PageDef> = {
  'qms-incoming': INCOMING,
  'qms-process': PROCESS,
  'qms-final': FINAL,
  'qms-inspections': INSPECTIONS,
  'qms-supplier': SUPPLIER,
  'qms-ncr': NCR,
  'qms-capa': CAPA,
  'qms-mom': MOM,
  'qms-5why': FIVEWHY,
  'qms-calibration': CAL,
  'qms-plans': PLANS,
};
