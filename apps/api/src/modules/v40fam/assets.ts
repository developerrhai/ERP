// V40 tab views of the Assets pages. Cost, book value and depreciation come from v_asset_book_value (the asset book), the custodian from
// the open allocation, the cost components from asset_cap_cost_lines. A V40 column with no table behind it has no expression (dash).
import { allocPanel, apJoin, common, d, exceptionPanel, ageDays, m, n, none, pill, t, tm, view } from './shared';
import type { Col, PageDef, PanelDef } from './shared';

const BV = 'LEFT JOIN v_asset_book_value bv ON bv.asset_id = a.id';
/** The five asset columns V40 repeats in front of every asset table. */
const assetCols = (): Record<string, Col> => ({
  Asset: t(`a.asset_no || ' - ' || a.name`),
  Cost: m('bv.cost'),
  'Book Value': m('bv.book_value'),
  Depreciation: m('bv.accum_dep'),
  Location: t('a.location'),
  'Asset ID': t('a.asset_no'),
  'Asset Name': t('a.name'),
});
const ASSET5 = ['Asset', 'Cost', 'Book Value', 'Depreciation', 'Location'];
const empName = (e: string): string => `NULLIF(trim(concat_ws(' ', ${e}.first_name, ${e}.last_name)), '')`;

/** Custody workspace: which assets are free to allocate and which are with someone (open allocation = status ALLOCATED). */
const custodyPanel = (title: string): PanelDef =>
  allocPanel({
    title,
    from: `assets p LEFT JOIN LATERAL (SELECT count(*) AS n FROM asset_allocations pa WHERE pa.asset_id = p.id AND pa.status = 'ALLOCATED' AND pa.deleted_at IS NULL) po ON true`,
    unit: 'p.unit_id',
    soft: 'p.deleted_at',
    where: [`p.status IN ('ACTIVE','IDLE')`],
    id: 'p.id',
    order: 'p.asset_no',
    record: 'p.asset_no',
    demand: 'NULL',
    available: `CASE WHEN po.n = 0 THEN 1 ELSE 0 END`,
    allocated: 'po.n',
    short: 'NULL',
    location: 'p.location',
    action: `CASE WHEN po.n = 0 THEN 'Allocate' ELSE 'Reallocate' END`,
  });

// ---------------------------------------------------------------------------------------------- capitalisation
const CAP_REG = [...ASSET5, 'Capitalization No', 'Purchase Ref', 'Capitalization Date', 'Base Cost', 'Freight', 'Installation', 'Status', 'Actions'];
const capLine = (comp: string): string =>
  `(SELECT sum(cl.amount) FROM asset_cap_cost_lines cl WHERE cl.cap_id = t.id AND cl.component = '${comp}')`;
const CAPITALIZATION: PageDef = {
  from: `asset_capitalisations t JOIN assets a ON a.id = t.asset_id ${BV} LEFT JOIN users ap ON ap.id = t.approved_by_id ${apJoin('asset-capitalization')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.cap_no',
  status: 't.status',
  search: ['t.cap_no', 'a.asset_no', 'a.name'],
  order: 't.capitalisation_date DESC, t.cap_no DESC',
  cols: {
    ...assetCols(),
    Cost: m('t.total_cost'),
    'Capitalization No': t('t.cap_no'),
    'Purchase Ref': t(`(SELECT string_agg(DISTINCT cl.source_doc_ref, ', ') FROM asset_cap_cost_lines cl WHERE cl.cap_id = t.id)`),
    'Capitalization Date': d('t.capitalisation_date'),
    'Base Cost': m(capLine('BASE')),
    Freight: m(capLine('FREIGHT')),
    Installation: m(capLine('INSTALLATION')),
    'Other Cost': m(`(SELECT sum(cl.amount) FROM asset_cap_cost_lines cl WHERE cl.cap_id = t.id AND cl.component NOT IN ('BASE'))`),
    'Capitalized Value': m('t.total_cost'),
    Approver: t('ap.name'),
    'Project Number': none(),
    Status: pill('t.status'),
    ...common('asset-capitalization', 't.cap_no'),
  },
  register: CAP_REG,
  compact: ['Capitalization No', 'Asset', 'Purchase Ref', 'Capitalization Date', 'Base Cost', 'Freight', 'Installation', 'Status', 'Actions'],
  views: [
    view('Capitalization Queue', CAP_REG),
    view('Purchase Link', [...ASSET5, 'Capitalization Date', 'Approver', 'Status', 'Project Number', 'Capitalization No', 'Purchase Ref', 'Actions']),
    view('Capitalization Date', CAP_REG, { order: 't.capitalisation_date DESC, t.cap_no DESC' }),
    view(
      'Cost Components',
      ['Base Cost', 'Other Cost', 'Capitalized Value', 'Capitalization No', 'Asset', 'Purchase Ref', 'Capitalization Date', 'Status', 'Actions'],
      {
        panel: {
          title: 'Cost components of the capitalisations',
          from: `asset_cap_cost_lines p JOIN asset_capitalisations pc ON pc.id = p.cap_id`,
          unit: 'pc.unit_id',
          soft: 'pc.deleted_at',
          order: 'pc.capitalisation_date DESC, pc.cap_no DESC, p.component',
          cols: [
            ['#', `pc.cap_no || ' / ' || p.component`, 'text'],
            ['Item / Service', 'p.component', 'text'],
            ['Description', 'p.source_doc_ref', 'text'],
            ['Qty', 'NULL', 'num'],
            ['Rate', 'NULL', 'inr'],
            ['Disc %', 'NULL', 'num'],
            ['Tax %', 'NULL', 'num'],
            ['Net', 'p.amount + CASE WHEN p.gst_added_to_cost THEN p.gst_amount ELSE 0 END', 'inr'],
            ['Action', 'NULL', 'actions'],
          ],
        },
      },
    ),
    view('GL Mapping', CAP_REG, { order: 't.cap_no DESC' }),
    view('Capitalization Audit', CAP_REG, { audit: true }),
  ],
};

// ---------------------------------------------------------------------------------------------- allocation, transfer
const ALLOC_REG = ['Status', 'Allocation No', 'Asset', 'Employee', 'Department', 'Allocation Date', 'Actions'];
const ALLOC_ASSET = [...ASSET5, 'Allocation No', 'Employee', 'Department', 'Allocation Date', 'Condition Out', 'Status', 'Actions'];
const ALLOCATION: PageDef = {
  from: `asset_allocations t JOIN assets a ON a.id = t.asset_id ${BV} LEFT JOIN employees em ON em.id = t.employee_id ${apJoin('asset-allocation')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.alloc_no',
  status: 't.status',
  search: ['t.alloc_no', 'a.asset_no', 'a.name', 't.department', 'em.first_name', 'em.last_name', 'em.emp_code'],
  order: 't.allocated_on DESC, t.alloc_no DESC',
  cols: {
    ...assetCols(),
    Location: t('COALESCE(t.location, a.location)'),
    'Allocation No': t('t.alloc_no'),
    Employee: t(empName('em')),
    Department: t('t.department'),
    'Allocation Date': d('t.allocated_on'),
    'Condition Out': t('t.condition_out'),
    Status: pill('t.status'),
    ...common('asset-allocation', 't.alloc_no'),
  },
  register: ALLOC_REG,
  compact: ALLOC_ASSET,
  views: [
    view('Allocation Register', ALLOC_REG, { panel: custodyPanel('Assets free to allocate and assets with someone') }),
    view('Employee Assignment', [...ASSET5.slice(0, 5), 'Employee', 'Department', 'Status', 'Allocation No', 'Allocation Date', 'Actions']),
    view('Department Location', ALLOC_ASSET, { order: 't.department, t.location, t.alloc_no DESC' }),
    view('Handover', ALLOC_ASSET),
    view('Return', ALLOC_ASSET, { where: [`t.status = 'RETURNED'`], order: 't.returned_on DESC NULLS LAST' }),
    view('Allocation History', ALLOC_REG, { panel: custodyPanel('Assets free to allocate and assets with someone') }),
  ],
};

const TR_REG = ['Transfer No', 'Asset', 'From Employee', 'From Location', 'To Employee', 'To Location', 'Request Date', 'Status', 'Actions'];
const TR_ASSET = [...ASSET5, 'Transfer No', 'From Employee', 'From Location', 'To Employee', 'To Location', 'Request Date', 'Status', 'Actions'];
const TRANSFER: PageDef = {
  from: `asset_transfers t JOIN assets a ON a.id = t.asset_id ${BV} LEFT JOIN units fu ON fu.id = t.from_unit_id LEFT JOIN employees te ON te.id = t.to_employee_id ${apJoin('asset-transfer')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.tr_no',
  status: 't.status',
  search: ['t.tr_no', 'a.asset_no', 'a.name', 't.to_location'],
  order: 't.request_date DESC, t.tr_no DESC',
  cols: {
    ...assetCols(),
    'Transfer No': t('t.tr_no'),
    'From Employee': none(),
    'From Location': t('fu.name'),
    'To Employee': t(empName('te')),
    'To Location': t('t.to_location'),
    'Request Date': d('t.request_date'),
    Status: pill('t.status'),
    ...common('asset-transfer', 't.tr_no'),
  },
  register: TR_REG,
  compact: TR_REG,
  views: [
    view('Transfer Requests', TR_REG, { panel: custodyPanel('Assets free to allocate and assets with someone') }),
    view('Source Custodian', TR_ASSET),
    view('Destination Custodian', TR_ASSET, { order: 't.to_location, t.tr_no DESC' }),
    view('Approval', TR_REG, { where: [`t.approval_status IN ('PENDING','APPROVED','REJECTED')`] }),
    view('Physical Verification', TR_ASSET, { order: `(t.verified_by_id IS NULL) DESC, t.request_date DESC` }),
    view('Transfer History', TR_REG, { panel: custodyPanel('Assets free to allocate and assets with someone') }),
  ],
};

// ---------------------------------------------------------------------------------------------- maintenance
const MNT_REG = ['Service No', 'Asset', 'Service Type', 'Due Date', 'Service Date', 'Vendor Technician', 'Parts Cost', 'Actions'];
const MNT_ASSET = [...ASSET5, 'Service No', 'Service Type', 'Due Date', 'Service Date', 'Vendor Technician', 'Parts Cost', 'Status', 'Actions'];
const mntPanel = (): PanelDef => ({
  title: 'Equipment under maintenance',
  from: `maint_work_orders p JOIN assets pa ON pa.id = p.asset_id`,
  unit: 'p.unit_id',
  soft: 'p.deleted_at',
  order: 'p.planned_start DESC NULLS LAST, p.mwo_no DESC',
  cols: [
    ['Equipment', 'pa.asset_no', 'text'],
    ['Type', 'p.wo_type', 'text'],
    ['Due / Start', 'COALESCE(p.actual_start, p.planned_start)', 'date'],
    ['Downtime', `(SELECT round(sum(e.duration_min) / 60.0, 1) FROM downtime_events e WHERE e.asset_id = p.asset_id AND e.deleted_at IS NULL)`, 'num'],
    ['Spare', `(SELECT count(*) FROM mwo_spares s WHERE s.wo_id = p.id)`, 'num'],
    ['Status', 'p.status', 'text'],
    ['Action', 'NULL', 'actions'],
  ],
});
const MAINTENANCE: PageDef = {
  from: `maint_work_orders t JOIN assets a ON a.id = t.asset_id ${BV} ${apJoin('asset-maintenance')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.mwo_no',
  status: 't.status',
  search: ['t.mwo_no', 'a.asset_no', 'a.name', 't.description'],
  order: 't.planned_start DESC NULLS LAST, t.mwo_no DESC',
  cols: {
    ...assetCols(),
    'Service No': t('t.mwo_no'),
    'Service Type': t('t.wo_type'),
    'Due Date': d('t.planned_end'),
    'Service Date': d('COALESCE(t.actual_end, t.actual_start)'),
    'Vendor Technician': t(
      `COALESCE((SELECT string_agg(DISTINCT COALESCE(l.vendor_name, ${empName('le')}), ', ') FROM mwo_labour l LEFT JOIN employees le ON le.id = l.employee_id WHERE l.wo_id = t.id),
        (SELECT string_agg(DISTINCT s.name, ', ') FROM mwo_vendor_charges vc JOIN suppliers s ON s.id = vc.supplier_id WHERE vc.wo_id = t.id))`,
    ),
    'Parts Cost': m(`(SELECT sum(s.amount) FROM mwo_spares s WHERE s.wo_id = t.id)`),
    'Labor Cost': m(`(SELECT sum(l.amount) FROM mwo_labour l WHERE l.wo_id = t.id)`),
    Equipment: t('a.asset_no'),
    Status: pill('t.status'),
    ...common('asset-maintenance', 't.mwo_no'),
  },
  register: MNT_REG,
  compact: MNT_ASSET,
  views: [
    view('Asset Maintenance', MNT_REG, { panel: mntPanel() }),
    view('Service Schedule', MNT_ASSET, { order: 't.planned_start NULLS LAST, t.mwo_no' }),
    view('Work History', MNT_ASSET, { where: [`t.status IN ('COMPLETED','CLOSED')`], order: 't.actual_end DESC NULLS LAST' }),
    view('Service Cost', ['Parts Cost', 'Labor Cost', 'Service No', 'Asset', 'Service Type', 'Due Date', 'Service Date', 'Status', 'Actions'], {
      order: `(SELECT COALESCE(sum(s.amount), 0) FROM mwo_spares s WHERE s.wo_id = t.id) DESC, t.mwo_no DESC`,
    }),
    view('Warranty AMC Link', MNT_ASSET, { order: `(a.warranty_end IS NOT NULL) DESC, a.warranty_end, t.mwo_no DESC` }),
    view('Asset Health', MNT_ASSET, { order: `(t.wo_type = 'BREAKDOWN') DESC, t.planned_start DESC NULLS LAST` }),
  ],
};

// ---------------------------------------------------------------------------------------------- depreciation
const runSum = (col: string): string => `(SELECT sum(l.${col}) FROM depreciation_run_lines l WHERE l.run_id = t.id)`;
const DEP_REG = [...ASSET5, 'Run No', 'Period', 'Opening Book Value', 'Depreciable Base', 'Method', 'Rate', 'Status', 'Actions'];
const DEPRECIATION: PageDef = {
  from: `depreciation_runs t ${apJoin('asset-depreciation')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  owner: 't.run_by_id',
  number: 't.run_no',
  status: 't.status',
  search: ['t.run_no', 't.period'],
  order: 't.period DESC, t.run_no DESC',
  cols: {
    Asset: t(`(SELECT count(*) FROM depreciation_run_lines l WHERE l.run_id = t.id)::text || ' assets'`),
    Cost: m(`(SELECT sum(bp.cost) FROM depreciation_run_lines l JOIN asset_book_profile bp ON bp.asset_id = l.asset_id AND bp.area = t.area WHERE l.run_id = t.id)`),
    'Book Value': m(runSum('closing_value')),
    Depreciation: m('t.total_amount'),
    Location: none(),
    'Run No': t('t.run_no'),
    Period: t('t.period'),
    'Opening Book Value': m(runSum('opening_value')),
    'Depreciable Base': m(runSum('base')),
    'Closing Book Value': m(runSum('closing_value')),
    Method: t(`(SELECT string_agg(DISTINCT l.method, ', ') FROM depreciation_run_lines l WHERE l.run_id = t.id)`),
    Rate: n(`(SELECT round(avg(l.rate), 2) FROM depreciation_run_lines l WHERE l.run_id = t.id)`),
    Status: pill('t.status'),
    ...common('asset-depreciation', 't.run_no'),
  },
  register: DEP_REG,
  compact: DEP_REG,
  views: [
    view('Depreciation Register', DEP_REG),
    view('Book Value', [...ASSET5, 'Opening Book Value', 'Rate', 'Closing Book Value', 'Run No', 'Period', 'Depreciable Base', 'Status', 'Actions']),
    view('Useful Life', DEP_REG),
    view('Method & Rate', DEP_REG, { order: `${runSum('rate')} DESC NULLS LAST` }),
    view('Monthly Posting', ['Run No', 'Period', 'Asset', 'Opening Book Value', 'Depreciable Base', 'Method', 'Rate', 'Status', 'Actions'], {
      panel: {
        title: 'Depreciation posted to the books',
        from: `depreciation_runs p`,
        unit: 'p.unit_id',
        soft: 'p.deleted_at',
        where: [`p.status = 'POSTED'`],
        order: 'p.posted_at DESC NULLS LAST',
        cols: [
          ['Date', 'p.posted_at', 'date'],
          ['Reference', 'p.run_no', 'text'],
          ['Particulars', `p.area || ' depreciation ' || p.period`, 'text'],
          ['Debit', 'p.total_amount', 'inr'],
          ['Credit', 'p.total_amount', 'inr'],
          ['Balance', 'NULL', 'inr'],
          ['Action', 'NULL', 'actions'],
        ],
      },
    }),
    view('Depreciation Forecast', DEP_REG),
  ],
};

// ---------------------------------------------------------------------------------------------- disposal
const DISP_REG = [...ASSET5, 'Disposal No', 'Request Date', 'Disposal Method', 'Sale Scrap Value', 'Gain Loss', 'Status', 'Actions'];
const DISPOSAL: PageDef = {
  from: `asset_disposals t JOIN assets a ON a.id = t.asset_id ${BV} ${apJoin('asset-disposal')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.disp_no',
  status: 't.status',
  search: ['t.disp_no', 'a.asset_no', 'a.name', 't.buyer'],
  order: 't.request_date DESC, t.disp_no DESC',
  cols: {
    ...assetCols(),
    'Book Value': m('COALESCE(t.nbv_at_disposal, bv.book_value)'),
    'Disposal No': t('t.disp_no'),
    'Request Date': d('t.request_date'),
    'Disposal Method': t('t.method'),
    'Sale Scrap Value': m('t.sale_value'),
    'Gain Loss': m('t.gain_loss'),
    Status: pill('t.status'),
    ...common('asset-disposal', 't.disp_no'),
  },
  register: DISP_REG,
  compact: DISP_REG,
  views: [
    view('Disposal Register', DISP_REG),
    view('Approval', ['Disposal No', 'Asset', 'Request Date', 'Disposal Method', 'Sale Scrap Value', 'Book Value', 'Gain Loss', 'Status', 'Actions'], {
      where: [`t.approval_status IN ('PENDING','APPROVED','REJECTED')`],
    }),
    view('Sale Scrap Value', ['Sale Scrap Value', 'Book Value', 'Disposal No', 'Asset', 'Request Date', 'Disposal Method', 'Gain Loss', 'Status', 'Actions'], {
      order: 't.sale_value DESC, t.disp_no DESC',
    }),
    view('Gain Loss', DISP_REG, { order: 'abs(t.gain_loss) DESC NULLS LAST' }),
    view('Asset Derecognition', DISP_REG, { where: [`t.status = 'POSTED'`] }),
    view('Disposal Audit', DISP_REG, { audit: true }),
  ],
};

// ---------------------------------------------------------------------------------------------- QR labels, asset master
const QR_REG = [...ASSET5, 'QR Code', 'Asset ID', 'Asset Name', 'Label Template', 'Printed Date', 'Printed By', 'Last Scan', 'Status', 'Actions'];
const QR_STATUS = `CASE WHEN t.reprint_of_id IS NULL THEN 'Printed' ELSE 'Reprinted' END`;
const lastScan = `(SELECT max(sc.scanned_at) FROM asset_scans sc WHERE sc.asset_id = a.id)`;
const QR: PageDef = {
  from: `asset_qr_labels t JOIN assets a ON a.id = t.asset_id ${BV} LEFT JOIN users pu ON pu.id = t.printed_by_id ${apJoin('asset-qr')}`,
  unit: 'a.unit_id',
  soft: 'a.deleted_at',
  owner: 't.printed_by_id',
  version: null,
  number: 't.token',
  status: QR_STATUS,
  search: ['t.token', 'a.asset_no', 'a.name'],
  order: 't.printed_at DESC',
  cols: {
    ...assetCols(),
    'QR Code': t('t.token'),
    'Label Template': none(),
    'Printed Date': d('t.printed_at'),
    'Printed By': t('pu.name'),
    'Last Scan': tm(lastScan),
    Status: pill(QR_STATUS),
    ...common('asset-qr', 't.token'),
  },
  register: QR_REG,
  compact: QR_REG,
  views: [
    view('QR Register', QR_REG),
    view('Label Generation', QR_REG),
    view('Print Queue', QR_REG, { where: [`t.reprint_of_id IS NOT NULL`] }),
    view('Scan History', QR_REG, { order: `${lastScan} DESC NULLS LAST` }),
    view('Asset Verification', QR_REG, { order: `${lastScan} NULLS FIRST` }),
    view('Invalid Scans', QR_REG, {
      where: [`EXISTS (SELECT 1 FROM asset_scans sc WHERE sc.asset_id = a.id AND NOT sc.valid)`],
      panel: exceptionPanel({
        title: 'Scans that did not match a label',
        from: `asset_scans p JOIN assets pa ON pa.id = p.asset_id LEFT JOIN users pu ON pu.id = p.scanned_by_id`,
        unit: 'pa.unit_id',
        soft: 'pa.deleted_at',
        where: ['NOT p.valid'],
        id: 'p.id',
        order: 'p.scanned_at DESC',
        exception: `'Invalid scan'`,
        record: 'pa.asset_no',
        severity: `'Medium'`,
        age: ageDays('p.scanned_at'),
        cause: `COALESCE(p.purpose, 'Token did not match the asset')`,
        owner: 'pu.name',
      }),
    }),
  ],
};

const MASTER_REG = [...ASSET5, 'Asset ID', 'Asset Name', 'Category', 'Department', 'Custodian', 'Purchase Date', 'Status', 'Actions'];
const MASTER: PageDef = {
  from: `assets t LEFT JOIN asset_categories ac ON ac.id = t.category_id LEFT JOIN v_asset_book_value bv ON bv.asset_id = t.id
    LEFT JOIN LATERAL (SELECT ${empName('ce')} AS name FROM asset_allocations aa JOIN employees ce ON ce.id = aa.employee_id
      WHERE aa.asset_id = t.id AND aa.status = 'ALLOCATED' AND aa.deleted_at IS NULL ORDER BY aa.allocated_on DESC LIMIT 1) cu ON true
    ${apJoin('asset-master')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.asset_no',
  status: 't.status',
  search: ['t.asset_no', 't.name', 'ac.name', 't.department', 't.location', 't.serial_no'],
  order: 't.asset_no',
  cols: {
    Asset: t(`t.asset_no || ' - ' || t.name`),
    Cost: m('bv.cost'),
    'Book Value': m('bv.book_value'),
    Depreciation: m('bv.accum_dep'),
    Location: t('t.location'),
    'Asset ID': t('t.asset_no'),
    'Asset Name': t('t.name'),
    Category: t('ac.name'),
    Department: t('t.department'),
    Custodian: t('cu.name'),
    'Purchase Date': d('COALESCE(t.put_to_use_date, t.commission_date)'),
    Status: pill('t.status'),
    ...common('asset-master', 't.asset_no'),
  },
  register: MASTER_REG,
  compact: MASTER_REG,
  views: [
    view('Asset Register', MASTER_REG),
    view('Classification', MASTER_REG, { order: 'ac.name, t.asset_no' }),
    view('Location & Custodian', MASTER_REG, { order: 't.location, t.asset_no' }),
    view('Financial Details', MASTER_REG, { order: 'bv.cost DESC NULLS LAST, t.asset_no' }),
    view('Documents & QR', MASTER_REG),
    view('Lifecycle Status', MASTER_REG, { order: 't.status, t.asset_no' }),
  ],
};

export const ASSETS_V40_PAGES: Record<string, PageDef> = {
  'asset-master': MASTER,
  'asset-capitalization': CAPITALIZATION,
  'asset-allocation': ALLOCATION,
  'asset-transfer': TRANSFER,
  'asset-maintenance': MAINTENANCE,
  'asset-depreciation': DEPRECIATION,
  'asset-disposal': DISPOSAL,
  'asset-qr': QR,
};
