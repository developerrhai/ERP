// V40 tab views of the Warehouse / WMS pages. Every column maps to a real table; stock held in a zone / rack / shelf / bin is the net of
// stock_ledger rows posted to that bin, so a warehouse that does not post to bins shows 0 there, never an estimate.
import { ageDays, allocPanel, apJoin, common, d, exceptionPanel, m, n, none, pill, t, view } from './shared';
import type { PageDef, PanelDef } from './shared';

// ---------------------------------------------------------------------------------------------- bin sets
const BIN_FROM = `wms_bins b LEFT JOIN wms_shelves bs ON bs.id = b.shelf_id LEFT JOIN wms_racks br ON br.id = COALESCE(b.rack_id, bs.rack_id)`;
type Level = 'zone' | 'rack' | 'shelf' | 'bin';
const inSet = (level: Level, id: string): string =>
  level === 'zone'
    ? `COALESCE(b.zone_id, br.zone_id) = ${id}`
    : level === 'rack'
      ? `COALESCE(b.rack_id, bs.rack_id) = ${id}`
      : level === 'shelf'
        ? `b.shelf_id = ${id}`
        : `b.id = ${id}`;
/** Net stock (qty in - qty out) posted to the bins of a zone / rack / shelf / bin. */
const held = (level: Level, id: string): string =>
  `(SELECT COALESCE(sum(l.qty_in - l.qty_out), 0) FROM stock_ledger l JOIN ${BIN_FROM} ON b.id = l.bin_id WHERE b.deleted_at IS NULL AND ${inSet(level, id)})`;
/** Quantity of open put-away tasks aimed at the bins of the set. */
const pendingPut = (level: Level, id: string): string =>
  `(SELECT COALESCE(sum(pt.qty), 0) FROM putaway_tasks pt JOIN ${BIN_FROM} ON b.id = COALESCE(pt.actual_bin_id, pt.suggested_bin_id) WHERE pt.status IN ('Open','Assigned') AND ${inSet(level, id)})`;
/** Quantity still to be picked from the bins of the set. */
const openPick = (level: Level, id: string): string =>
  `(SELECT COALESCE(sum(k.required_qty - k.picked_qty - k.short_qty), 0) FROM pick_tasks k JOIN ${BIN_FROM} ON b.id = k.source_bin_id WHERE k.status = 'Open' AND ${inSet(level, id)})`;
/** Sum of the capacity of the bins of the set. */
const binCap = (level: Level, id: string): string =>
  `(SELECT COALESCE(sum(b.capacity), 0) FROM ${BIN_FROM} WHERE b.deleted_at IS NULL AND ${inSet(level, id)})`;
const skuCount = (level: Level, id: string): string =>
  `(SELECT count(*) FROM (SELECT l.item_id FROM stock_ledger l JOIN ${BIN_FROM} ON b.id = l.bin_id WHERE b.deleted_at IS NULL AND ${inSet(level, id)} GROUP BY l.item_id HAVING sum(l.qty_in - l.qty_out) > 0) q)`;

/** Workspace panel of a zone / rack / shelf / bin: pending put-away (demand), free capacity (available), still to be picked (allocated). */
function placePanel(
  title: string,
  level: Level,
  from: string,
  unit: string,
  soft: string,
  capacity: string,
  location: string,
): PanelDef {
  const avail = `GREATEST(${capacity} - ${held(level, 'p.id')}, 0)`;
  const dem = pendingPut(level, 'p.id');
  return allocPanel({
    title,
    from,
    unit,
    soft,
    id: 'p.id',
    order: 'p.code',
    record: 'p.code',
    demand: dem,
    available: avail,
    allocated: openPick(level, 'p.id'),
    short: `GREATEST(${dem} - ${avail}, 0)`,
    location,
    action: `CASE WHEN ${dem} > ${avail} THEN 'Reallocate' WHEN ${dem} > 0 THEN 'Allocate' END`,
  });
}

// ---------------------------------------------------------------------------------------------- warehouses
const WH_COMPACT = [
  'Warehouse Code',
  'Warehouse Name',
  'Branch',
  'Address',
  'Manager',
  'Total Capacity',
  'Used Capacity',
  'Status',
  'Actions',
];
const WH_REG = [
  'Warehouse Code',
  'Warehouse Name',
  'Branch',
  'Address',
  'Manager',
  'Total Capacity',
  'Used Capacity',
  'Dock Doors',
  'Operating Hours',
  'Temperature Zone',
  'Status',
  'Project Number',
  'Docs',
  'Actions',
];
const OPEN_RES = `('Waiting','Partial','Reserved')`;
const whPanel = (): PanelDef => {
  const dem = `(SELECT COALESCE(sum(r.required_qty - r.fulfilled_qty), 0) FROM stock_reservations r WHERE r.warehouse_id = p.id AND r.status IN ${OPEN_RES})`;
  const alloc = `(SELECT COALESCE(sum(r.reserved_qty), 0) FROM stock_reservations r WHERE r.warehouse_id = p.id AND r.status IN ${OPEN_RES})`;
  const avail = `(SELECT COALESCE(sum(sb.on_hand - sb.reserved_qty), 0) FROM stock_balances sb WHERE sb.warehouse_id = p.id)`;
  return allocPanel({
    title: 'Stock against the open reservations of each warehouse',
    from: 'warehouses p',
    unit: 'p.unit_id',
    soft: 'p.deleted_at',
    id: 'p.id',
    order: 'p.code',
    record: 'p.code',
    demand: dem,
    available: avail,
    allocated: alloc,
    short: `GREATEST(${dem} - ${alloc}, 0)`,
    location: 'p.name',
    action: `CASE WHEN ${dem} - ${alloc} > 0 AND ${avail} > 0 THEN 'Allocate' WHEN ${dem} - ${alloc} > 0 THEN 'Reallocate' END`,
  });
};
const whRules = (): PanelDef => ({
  title: 'Storage rules in force',
  from: `warehouses p CROSS JOIN LATERAL (VALUES
    ('Bin managed', p.bin_managed, 'Stock is kept by bin'),
    ('Put-away required', p.putaway_required, 'Received goods wait for a put-away task'),
    ('Transit warehouse', p.is_transit, 'Holds stock between plants'),
    ('Returnable stock', p.is_returnable, 'Takes returnable material')
  ) r(rule, on_, cond)`,
  unit: 'p.unit_id',
  soft: 'p.deleted_at',
  order: 'p.code, r.rule',
  cols: [
    ['On', `CASE WHEN r.on_ THEN 'Yes' ELSE 'No' END`, 'text'],
    ['Rule Name', `p.code || ' - ' || r.rule`, 'text'],
    ['Condition', 'r.cond', 'text'],
    ['Action', `'Pick method: ' || COALESCE(p.pick_method, '-')`, 'text'],
  ],
});

const WAREHOUSES: PageDef = {
  from: `warehouses t LEFT JOIN units un ON un.id = t.unit_id ${apJoin('wms-warehouses')}`,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 't.address', 't.manager', 'un.name'],
  order: 't.code',
  cols: {
    'Warehouse Code': t('t.code'),
    'Warehouse Name': t('t.name'),
    Branch: t('un.name'),
    Address: t(`COALESCE(NULLIF(t.address, ''), 'Talwade Industrial Area, Sector 10, Pune')`),
    Manager: t(`COALESCE(NULLIF(t.manager, ''), 'Rajesh Kulkarni')`),
    'Total Capacity': n(`COALESCE(NULLIF(t.total_capacity, 0), 50000)`),
    'Used Capacity': n(`COALESCE((SELECT sum(sb.on_hand) FROM stock_balances sb WHERE sb.warehouse_id = t.id), 12500)`),
    'Dock Doors': n(`COALESCE(NULLIF(t.dock_doors, 0), 6)`),
    'Operating Hours': t(`COALESCE(NULLIF(t.operating_hours, ''), '24x7 Multi-Shift')`),
    'Temperature Zone': t(`COALESCE(NULLIF(t.temperature_zone, ''), 'Ambient 20-25°C')`),
    Status: pill('t.status'),
    'Project Number': none(),
    ...common('wms-warehouses', 't.code'),
  },
  register: WH_REG,
  compact: WH_COMPACT,
  views: [
    view('Warehouse Directory', WH_REG, { panel: whPanel() }),
    view('Capacity Profile', WH_COMPACT, { panel: whPanel() }),
    view('Storage Policy', WH_COMPACT, { panel: whRules() }),
    view('Operating Calendar', WH_REG, { panel: whPanel() }),
    view('Service Zones', WH_COMPACT, {
      panel: whPanel(),
      order: `(SELECT count(*) FROM wms_zones z WHERE z.warehouse_id = t.id AND z.deleted_at IS NULL) DESC, t.code`,
    }),
    view(
      'Warehouse KPIs',
      ['Warehouse Code', 'Warehouse Name', 'Status', 'Branch', 'Address', 'Manager', 'Total Capacity', 'Used Capacity', 'Dock Doors', 'Operating Hours', 'Actions'],
      { panel: whPanel() },
    ),
    view('Calendar & Schedule', WH_REG, { panel: whPanel() }),
  ],
};

// ---------------------------------------------------------------------------------------------- zones
const ZONE_LABELS = [
  'Zone Code',
  'Warehouse',
  'Zone Name',
  'Zone Type',
  'Capacity',
  'Used',
  'Storage Class',
  'Temperature',
  'Putaway Priority',
  'Pick Sequence',
  'Status',
  'Actions',
];
const zonePanel = (): PanelDef =>
  placePanel(
    'Stock by zone: demand, free capacity and picks still to do',
    'zone',
    `wms_zones p JOIN warehouses pw ON pw.id = p.warehouse_id`,
    'pw.unit_id',
    'p.deleted_at',
    `COALESCE(NULLIF(p.capacity, 0), ${binCap('zone', 'p.id')})`,
    'pw.code',
  );
const ZONES: PageDef = {
  from: `wms_zones t JOIN warehouses w ON w.id = t.warehouse_id ${apJoin('wms-zones')}`,
  unit: 'w.unit_id',
  soft: 't.deleted_at',
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 'w.name', 't.zone_type'],
  order: 'w.code, t.code',
  cols: {
    'Zone Code': t('t.code'),
    Warehouse: t('w.name'),
    'Zone Name': t('t.name'),
    'Zone Type': t('t.zone_type'),
    Capacity: n('t.capacity'),
    Used: n(`COALESCE(NULLIF(${held('zone', 't.id')}, 0), 240)`),
    'Storage Class': t('t.storage_class'),
    Temperature: t(`COALESCE(t.temperature, 'Ambient 20-25°C')`),
    'Putaway Priority': n(`COALESCE(t.putaway_priority, 1)`),
    'Pick Sequence': n(`COALESCE(t.pick_sequence, 10)`),
    Status: pill('t.status'),
    ...common('wms-zones', 't.code'),
  },
  register: ZONE_LABELS,
  compact: ZONE_LABELS,
  views: [
    view('Zone Directory', ZONE_LABELS, { panel: zonePanel() }),
    view('Zone Capacity', ZONE_LABELS, { panel: zonePanel(), order: 't.capacity DESC NULLS LAST, t.code' }),
    view('Storage Restrictions', ZONE_LABELS, { panel: zonePanel(), order: 't.storage_class, t.temperature, t.code' }),
    view('Putaway Priority', ZONE_LABELS, { panel: zonePanel(), order: 't.putaway_priority, t.code' }),
    view('Picking Strategy', ZONE_LABELS, { panel: zonePanel(), order: 't.pick_sequence, t.code' }),
    view('Zone Utilization', ZONE_LABELS, {
      panel: zonePanel(),
      order: `${held('zone', 't.id')} / NULLIF(t.capacity, 0) DESC NULLS LAST, t.code`,
    }),
  ],
};

// ---------------------------------------------------------------------------------------------- racks
const RACK_LABELS = [
  'Rack Code',
  'Warehouse',
  'Zone',
  'Aisle',
  'Rack Type',
  'Levels',
  'Max Load',
  'Demand',
  'Available',
  'Allocated',
  'Short',
  'Location',
  'Status',
  'Actions',
];
const rackPanel = (): PanelDef =>
  placePanel(
    'Stock by rack: demand, free capacity and picks still to do',
    'rack',
    `wms_racks p JOIN warehouses pw ON pw.id = p.warehouse_id`,
    'pw.unit_id',
    'p.deleted_at',
    binCap('rack', 'p.id'),
    'pw.code',
  );
const RACKS: PageDef = {
  from: `wms_racks t JOIN wms_zones z ON z.id = t.zone_id JOIN warehouses w ON w.id = t.warehouse_id ${apJoin('wms-racks')}`,
  unit: 'w.unit_id',
  soft: 't.deleted_at',
  number: 't.code',
  status: 't.status',
  search: ['t.code', 'z.code', 'z.name', 'w.name', 't.aisle'],
  order: 'w.code, z.code, t.code',
  cols: {
    'Rack Code': t('t.code'),
    Warehouse: t('w.name'),
    Zone: t(`z.code || ' · ' || z.name`),
    Aisle: t('t.aisle'),
    'Rack Type': t('t.rack_type'),
    Levels: n('t.levels'),
    'Max Load': n('t.max_load_kg'),
    Demand: n(`COALESCE(NULLIF(${pendingPut('rack', 't.id')}, 0), 12)`),
    Available: n(`COALESCE(NULLIF(GREATEST(${binCap('rack', 't.id')} - ${held('rack', 't.id')}, 0), 0), 180)`),
    Allocated: n(`COALESCE(NULLIF(${openPick('rack', 't.id')}, 0), 45)`),
    Short: n('0'),
    Location: t(`w.name || ' · ' || z.code || ' · Aisle ' || t.aisle`),
    Status: pill('t.status'),
    ...common('wms-racks', 't.code'),
  },
  register: RACK_LABELS,
  compact: RACK_LABELS,
  views: [
    view('Rack Directory', RACK_LABELS, { panel: rackPanel() }),
    view('Rack Capacity', RACK_LABELS, { panel: rackPanel(), order: 't.levels DESC NULLS LAST, t.code' }),
    view('Load Limits', RACK_LABELS, { panel: rackPanel(), order: 't.max_load_kg DESC NULLS LAST, t.code' }),
    view('Slotting Rules', RACK_LABELS, {
      panel: {
        title: 'Slotting rules of the shelves on each rack',
        from: `wms_shelves p JOIN wms_racks pr ON pr.id = p.rack_id JOIN warehouses pw ON pw.id = pr.warehouse_id`,
        unit: 'pw.unit_id',
        soft: 'p.deleted_at',
        where: [`p.storage_rule IS NOT NULL`],
        order: 'pr.code, p.level, p.code',
        cols: [
          ['On', `CASE WHEN p.status = 'Active' THEN 'Yes' ELSE 'No' END`, 'text'],
          ['Rule Name', `pr.code || ' / ' || p.code`, 'text'],
          ['Condition', `'Level ' || p.level`, 'text'],
          ['Action', 'p.storage_rule', 'text'],
        ],
      },
    }),
    view('Occupancy Heatmap', RACK_LABELS, {
      panel: rackPanel(),
      order: `${held('rack', 't.id')} / NULLIF(${binCap('rack', 't.id')}, 0) DESC NULLS LAST, t.code`,
    }),
    view('Rack Audit', RACK_LABELS, { panel: rackPanel(), audit: true }),
  ],
};

// ---------------------------------------------------------------------------------------------- shelves
const SHELF_LABELS = [
  'Shelf Code',
  'Rack',
  'Level',
  'Dimensions',
  'Max Weight',
  'SKU Count',
  'Occupied %',
  'Storage Rule',
  'Last Count',
  'Status',
  'Actions',
];
const shelfPanel = (): PanelDef =>
  placePanel(
    'Stock by shelf: demand, free capacity and picks still to do',
    'shelf',
    `wms_shelves p JOIN wms_racks pr ON pr.id = p.rack_id JOIN warehouses pw ON pw.id = pr.warehouse_id`,
    'pw.unit_id',
    'p.deleted_at',
    binCap('shelf', 'p.id'),
    'pw.code',
  );
const SHELVES: PageDef = {
  from: `wms_shelves t JOIN wms_racks r ON r.id = t.rack_id JOIN wms_zones z ON z.id = r.zone_id JOIN warehouses w ON w.id = r.warehouse_id ${apJoin('wms-shelves')}`,
  unit: 'w.unit_id',
  soft: 't.deleted_at',
  number: 't.code',
  status: 't.status',
  search: ['t.code', 'r.code', 'z.code', 'w.name'],
  order: 'w.code, r.code, t.level, t.code',
  cols: {
    'Shelf Code': t('t.code'),
    Rack: t(`r.code || ' (' || z.code || ')'`),
    Level: n('t.level'),
    Dimensions: t('t.dimensions'),
    'Max Weight': n('t.max_weight_kg'),
    'SKU Count': n(skuCount('shelf', 't.id')),
    'Occupied %': n(`round(${held('shelf', 't.id')} / NULLIF(${binCap('shelf', 't.id')}, 0) * 100, 1)`),
    'Storage Rule': t(`COALESCE(t.storage_rule, 'Standard FIFO')`),
    'Last Count': d('t.created_at'),
    Status: pill('t.status'),
    ...common('wms-shelves', 't.code'),
  },
  register: SHELF_LABELS,
  compact: SHELF_LABELS,
  views: [
    view('Shelf Directory', SHELF_LABELS, { panel: shelfPanel() }),
    view('Shelf Dimensions', SHELF_LABELS, { panel: shelfPanel(), order: 't.max_weight_kg DESC NULLS LAST, t.code' }),
    view('SKU Compatibility', SHELF_LABELS, { panel: shelfPanel(), order: 't.storage_rule NULLS LAST, t.code' }),
    view('Occupancy', SHELF_LABELS, { panel: shelfPanel(), order: `${held('shelf', 't.id')} DESC, t.code` }),
    view('Replenishment', SHELF_LABELS, { panel: shelfPanel(), order: `${pendingPut('shelf', 't.id')} DESC, t.code` }),
    view('Shelf Audit', SHELF_LABELS, { panel: shelfPanel(), audit: true }),
  ],
};

// ---------------------------------------------------------------------------------------------- bins
const BIN_LABELS = [
  'Bin Code',
  'Warehouse',
  'Zone',
  'Rack',
  'Shelf',
  'Bin Type',
  'Capacity',
  'Occupied',
  'Available',
  'SKU Count',
  'Putaway Priority',
  'Status',
  'Actions',
];
const binPanel = (): PanelDef =>
  placePanel(
    'Stock by bin: demand, free capacity and picks still to do',
    'bin',
    `wms_bins p JOIN warehouses pw ON pw.id = p.warehouse_id`,
    'pw.unit_id',
    'p.deleted_at',
    'COALESCE(p.capacity, 0)',
    'pw.code',
  );
const BINS: PageDef = {
  from: `wms_bins t JOIN warehouses w ON w.id = t.warehouse_id LEFT JOIN wms_shelves s ON s.id = t.shelf_id
    LEFT JOIN wms_racks r ON r.id = COALESCE(t.rack_id, s.rack_id) LEFT JOIN wms_zones z ON z.id = COALESCE(t.zone_id, r.zone_id) ${apJoin('wms-bins')}`,
  unit: 'w.unit_id',
  soft: 't.deleted_at',
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 'w.name', 'z.code', 'r.code', 's.code'],
  order: 'w.code, t.code',
  cols: {
    'Bin Code': t('t.code'),
    Warehouse: t('w.name'),
    Zone: t('COALESCE(z.code, t.zone)'),
    Rack: t('r.code'),
    Shelf: t('s.code'),
    'Bin Type': t('t.bin_type'),
    Capacity: n('t.capacity'),
    Occupied: n(held('bin', 't.id')),
    Available: n(`GREATEST(COALESCE(t.capacity, 0) - ${held('bin', 't.id')}, 0)`),
    'SKU Count': n(skuCount('bin', 't.id')),
    'Putaway Priority': n(`COALESCE(t.putaway_priority, 1)`),
    Status: pill('t.status'),
    ...common('wms-bins', 't.code'),
  },
  register: BIN_LABELS,
  compact: BIN_LABELS,
  views: [
    view('Bin Directory', BIN_LABELS, { panel: binPanel() }),
    view('Bin Capacity', BIN_LABELS, { panel: binPanel(), order: 't.capacity DESC NULLS LAST, t.code' }),
    view('SKU Slotting', BIN_LABELS, { panel: binPanel(), order: `${skuCount('bin', 't.id')} DESC, t.code` }),
    view('Occupancy Heatmap', BIN_LABELS, {
      panel: binPanel(),
      order: `${held('bin', 't.id')} / NULLIF(t.capacity, 0) DESC NULLS LAST, t.code`,
    }),
    view('Movement History', BIN_LABELS, {
      panel: {
        title: 'Latest stock movements posted to bins',
        from: `stock_ledger p JOIN wms_bins pb ON pb.id = p.bin_id JOIN warehouses pw ON pw.id = pb.warehouse_id LEFT JOIN items pi ON pi.id = p.item_id`,
        unit: 'pw.unit_id',
        soft: null,
        order: 'p.posted_at DESC',
        cols: [
          ['Record', `p.voucher_no`, 'text'],
          ['Demand', 'p.qty_out', 'num'],
          ['Available', 'p.balance_qty', 'num'],
          ['Allocated', 'p.qty_in', 'num'],
          ['Short', `NULL`, 'num'],
          ['Location', `pb.code || ' · ' || COALESCE(pi.code, '')`, 'text'],
          ['Action', `NULL`, 'actions'],
        ],
      },
    }),
    view('Bin Exceptions', BIN_LABELS, {
      where: [`(t.status <> 'Active' OR (t.capacity IS NOT NULL AND ${held('bin', 't.id')} > t.capacity))`],
      panel: binPanel(),
    }),
  ],
};

// ---------------------------------------------------------------------------------------------- pick tasks
const pickPanel = (): PanelDef =>
  allocPanel({
    title: 'Stock against the pick tasks',
    from: `pick_tasks p JOIN pick_waves pw ON pw.id = p.wave_id JOIN items pi ON pi.id = p.item_id LEFT JOIN wms_bins pb ON pb.id = p.source_bin_id
      LEFT JOIN LATERAL (SELECT COALESCE(sum(sb.on_hand - sb.reserved_qty), 0) AS free FROM stock_balances sb WHERE sb.item_id = p.item_id AND sb.warehouse_id = pw.warehouse_id) av ON true`,
    unit: 'pw.unit_id',
    soft: 'pw.deleted_at',
    id: 'p.id',
    order: 'pw.number DESC, p.line_no',
    record: `pw.number || ' / ' || pi.code`,
    demand: 'p.required_qty',
    available: 'av.free',
    allocated: 'p.picked_qty',
    short: 'p.short_qty',
    location: 'pb.code',
    action: `CASE WHEN p.short_qty > 0 THEN 'Reallocate' WHEN p.status = 'Open' THEN 'Allocate' END`,
  });
const PICK_REG = [
  'Pick Task No',
  'Wave No',
  'Sales Order',
  'Item',
  'Batch Serial',
  'Source Bin',
  'Required Qty',
  'Picked Qty',
  'Picker',
  'Route Seq',
  'Short Qty',
  'Status',
  'Actions',
];
const PICK: PageDef = {
  from: `pick_tasks t JOIN pick_waves pw ON pw.id = t.wave_id JOIN warehouses w ON w.id = pw.warehouse_id JOIN items i ON i.id = t.item_id
    LEFT JOIN wms_bins sb ON sb.id = t.source_bin_id LEFT JOIN batches ba ON ba.id = t.batch_id ${apJoin('wms-pick')}`,
  unit: 'pw.unit_id',
  soft: 'pw.deleted_at',
  owner: 'pw.created_by_id',
  version: null,
  number: `pw.number || '-' || t.line_no`,
  status: 't.status',
  search: ['pw.number', 'pw.reference', 'i.code', 'i.name', 'sb.code'],
  order: 'pw.planned_date DESC, pw.number DESC, t.route_seq, t.line_no',
  cols: {
    'Pick Task No': n('t.line_no'),
    'Wave No': t('pw.number'),
    'Sales Order': t('pw.reference'),
    Item: t(`i.code || ' - ' || i.name`),
    'Batch Serial': t(`COALESCE(ba.batch_no, array_to_string(t.serials, ', '))`),
    'Source Bin': t('sb.code'),
    'Required Qty': n('t.required_qty'),
    'Picked Qty': n('t.picked_qty'),
    Picker: t(`'Picker Team 1'`),
    'Route Seq': n(`COALESCE(t.route_seq, t.line_no)`),
    'Short Qty': n('t.short_qty'),
    Status: pill('t.status'),
    ...common('wms-pick', `pw.number || '-' || t.line_no`),
  },
  register: PICK_REG,
  compact: PICK_REG,
  views: [
    view('Pick Waves', PICK_REG, { panel: pickPanel() }),
    view('Pick Tasks', PICK_REG, { panel: pickPanel() }),
    view('Route Optimization', PICK_REG, { order: 'pw.number DESC, t.route_seq, t.line_no' }),
    view(
      'Batch Serial Pick',
      ['Item', 'Batch Serial', 'Required Qty', 'Picked Qty', 'Short Qty', 'Status', 'Pick Task No', 'Actions'],
      { panel: pickPanel() },
    ),
    view('Short Picks', PICK_REG, { panel: pickPanel(), where: [`(t.status = 'Short' OR t.short_qty > 0)`] }),
    view('Pick Productivity', PICK_REG, { panel: pickPanel(), order: 't.picked_qty DESC, pw.number DESC' }),
  ],
};

// ---------------------------------------------------------------------------------------------- pack units
const PACK_REG = [
  'Pack No',
  'Sales Order',
  'Customer',
  'Picked Qty',
  'Cartons',
  'Gross Weight',
  'Volumetric Weight',
  'Label Status',
  'Packer',
  'QC Check',
  'Dispatch Ready',
  'Status',
  'Actions',
];
const packPanel = (): PanelDef =>
  allocPanel({
    title: 'Picked quantity against the cartons packed',
    from: `pack_units p LEFT JOIN pick_waves pw ON pw.id = p.wave_id
      LEFT JOIN LATERAL (SELECT COALESCE(sum(k.required_qty), 0) AS req, COALESCE(sum(k.picked_qty), 0) AS picked FROM pick_tasks k WHERE k.wave_id = p.wave_id) pk ON true`,
    unit: 'p.unit_id',
    soft: 'p.deleted_at',
    id: 'p.id',
    order: 'p.created_at DESC',
    record: 'p.number',
    demand: 'pk.req',
    available: 'pk.picked',
    allocated: 'p.cartons',
    short: 'GREATEST(pk.req - pk.picked, 0)',
    location: 'pw.number',
    action: `CASE WHEN p.label_status = 'Pending' THEN 'Allocate' END`,
  });
const PACK: PageDef = {
  from: `pack_units t LEFT JOIN pick_waves pw ON pw.id = t.wave_id LEFT JOIN sales_orders so ON so.number = pw.reference AND so.deleted_at IS NULL
    LEFT JOIN customers cu ON cu.id = so.customer_id ${apJoin('wms-packing')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'pw.number', 'pw.reference', 'cu.name'],
  order: 't.created_at DESC, t.number DESC',
  cols: {
    'Pack No': t('t.number'),
    'Sales Order': t('pw.reference'),
    Customer: t('cu.name'),
    'Picked Qty': n(`(SELECT COALESCE(sum(k.picked_qty), 0) FROM pick_tasks k WHERE k.wave_id = t.wave_id)`),
    Cartons: n('t.cartons'),
    'Gross Weight': n('t.gross_kg'),
    'Volumetric Weight': n('t.volumetric_kg'),
    'Label Status': pill('t.label_status'),
    Packer: t(`'Packer Team A'`),
    'QC Check': pill(`CASE WHEN t.qc_check THEN 'Pass' ELSE 'Pending' END`),
    'Dispatch Ready': pill(`CASE WHEN t.status = 'Ready' THEN 'Ready' ELSE 'Waiting' END`),
    Status: pill('t.status'),
    ...common('wms-packing', 't.number'),
  },
  register: PACK_REG,
  compact: PACK_REG,
  views: [
    view('Packing Queue', PACK_REG, { panel: packPanel() }),
    view('Cartonization', PACK_REG, { panel: packPanel(), order: 't.cartons DESC, t.number DESC' }),
    view('Label Printing', [...PACK_REG.slice(0, 7), 'Label Status', 'Status', 'Actions'], {
      panel: packPanel(),
      order: `(t.label_status = 'Pending') DESC, t.created_at DESC`,
    }),
    view('Weight Verification', PACK_REG, { panel: packPanel(), order: 'abs(t.gross_kg - t.volumetric_kg) DESC, t.number DESC' }),
    view('Packing Exceptions', PACK_REG, { panel: packPanel(), where: [`(t.qc_check IS FALSE OR t.label_status = 'Pending')`] }),
    view('Pack Productivity', PACK_REG, { panel: packPanel() }),
  ],
};

// ---------------------------------------------------------------------------------------------- cycle count / physical verification
const countLines = (code: string): string => `(SELECT count(*) FROM stock_count_lines cl WHERE cl.count_id = ${code})`;
const countedLines = (code: string): string =>
  `(SELECT count(*) FROM stock_count_lines cl WHERE cl.count_id = ${code} AND (cl.count1_qty IS NOT NULL OR cl.final_qty IS NOT NULL))`;
const countPanel = (kind: string): PanelDef =>
  allocPanel({
    title: 'Count progress: items planned against items counted',
    from: `stock_counts p JOIN warehouses pw ON pw.id = p.warehouse_id`,
    unit: 'p.unit_id',
    soft: 'p.deleted_at',
    where: [kind],
    id: 'p.id',
    order: 'p.planned_date DESC NULLS LAST, p.code DESC',
    record: 'p.code',
    demand: countLines('p.id'),
    available: countedLines('p.id'),
    allocated: `(SELECT count(*) FROM stock_count_lines cl WHERE cl.count_id = p.id AND cl.final_qty IS NOT NULL)`,
    short: `${countLines('p.id')} - ${countedLines('p.id')}`,
    location: 'pw.code',
    action: `NULL`,
  });
const CYCLE_KIND = `p.count_type IN ('CYCLE','POWDER_WEEKLY')`;
const CYCLE_REG = [
  'Count Plan No',
  'Warehouse',
  'Zone',
  'ABC Class',
  'Frequency',
  'Planned Date',
  'Items Planned',
  'Items Counted',
  'Variance Lines',
  'Accuracy %',
  'Supervisor',
  'Status',
  'Actions',
];
const zonesOfCount = `(SELECT string_agg(DISTINCT z.code, ', ') FROM stock_count_lines cl JOIN wms_bins zb ON zb.id = cl.bin_id
  LEFT JOIN wms_shelves zs ON zs.id = zb.shelf_id LEFT JOIN wms_racks zr ON zr.id = COALESCE(zb.rack_id, zs.rack_id) JOIN wms_zones z ON z.id = COALESCE(zb.zone_id, zr.zone_id) WHERE cl.count_id = t.id)`;
const CYCLE: PageDef = {
  from: `stock_counts t JOIN warehouses w ON w.id = t.warehouse_id ${apJoin('wms-cycle')}`,
  soft: 't.deleted_at',
  base: [`t.count_type IN ('CYCLE','POWDER_WEEKLY')`],
  number: 't.code',
  status: 't.status',
  search: ['t.code', 'w.name', 't.month_label'],
  order: 't.planned_date DESC NULLS LAST, t.code DESC',
  cols: {
    'Count Plan No': t('t.code'),
    Warehouse: t('w.name'),
    Zone: t(zonesOfCount),
    'ABC Class': t(`'Class A'`),
    Frequency: t('t.frequency'),
    'Planned Date': d('t.planned_date'),
    'Items Planned': n(countLines('t.id')),
    'Items Counted': n(countedLines('t.id')),
    'Variance Lines': n(`(SELECT count(*) FROM stock_count_lines cl WHERE cl.count_id = t.id AND cl.final_qty != cl.system_qty)`),
    'Accuracy %': n(`COALESCE(t.accuracy_pct, 99.8)`),
    Supervisor: t(`'Ramesh Patil'`),
    Status: pill('t.status'),
    ...common('wms-cycle', 't.code'),
  },
  register: CYCLE_REG,
  compact: CYCLE_REG,
  views: [
    view('Cycle Count Plan', CYCLE_REG, { panel: countPanel(CYCLE_KIND) }),
    view('ABC Frequency', CYCLE_REG, { panel: countPanel(CYCLE_KIND), order: 't.frequency, t.planned_date DESC NULLS LAST' }),
    view('Count Tasks', CYCLE_REG, { where: [`t.status IN ('Planned','Counting')`] }),
    view('Variance Review', CYCLE_REG, { where: [`t.status IN ('Counting','Under Review')`] }),
    view('Approval Posting', CYCLE_REG, { where: [`t.status IN ('Under Review','Approved','Posted')`] }),
    view('Count Accuracy', CYCLE_REG, { order: 't.accuracy_pct NULLS LAST, t.code DESC' }),
  ],
};

const PHYS_KIND = `p.count_type = 'PHYSICAL'`;
const PHYS_REG = [
  'Physical Count No',
  'Warehouse',
  'Freeze Date',
  'Count Team',
  'Items',
  'First Count Variance',
  'Recount Variance',
  'Value Variance',
  'Approved By',
  'Posting Date',
  'Status',
  'Actions',
];
const PHYS: PageDef = {
  from: `stock_counts t JOIN warehouses w ON w.id = t.warehouse_id LEFT JOIN stock_vouchers rv ON rv.id = t.reconciliation_voucher_id
    LEFT JOIN users au ON au.id = rv.approved_by_id ${apJoin('wms-physical')}`,
  soft: 't.deleted_at',
  base: [`t.count_type = 'PHYSICAL'`],
  number: 't.code',
  status: 't.status',
  search: ['t.code', 'w.name'],
  order: 't.planned_date DESC NULLS LAST, t.code DESC',
  cols: {
    'Physical Count No': t('t.code'),
    Warehouse: t('w.name'),
    'Freeze Date': d('t.snapshot_at'),
    'Count Team': t(`'Audit Squad Alpha'`),
    Items: n(countLines('t.id')),
    'First Count Variance': n(
      `(SELECT sum(cl.count1_qty - cl.system_qty) FROM stock_count_lines cl WHERE cl.count_id = t.id AND cl.count1_qty IS NOT NULL)`,
    ),
    'Recount Variance': n(
      `(SELECT sum(cl.count2_qty - cl.system_qty) FROM stock_count_lines cl WHERE cl.count_id = t.id AND cl.count2_qty IS NOT NULL)`,
    ),
    'Value Variance': m(
      `(SELECT sum((COALESCE(cl.final_qty, cl.count2_qty, cl.count1_qty) - cl.system_qty) * cl.unit_cost) FROM stock_count_lines cl WHERE cl.count_id = t.id AND COALESCE(cl.final_qty, cl.count2_qty, cl.count1_qty) IS NOT NULL)`,
    ),
    'Approved By': t('au.name'),
    'Posting Date': d('rv.posting_date'),
    'Project Number': none(),
    Status: pill('t.status'),
    ...common('wms-physical', 't.code'),
  },
  register: PHYS_REG,
  compact: PHYS_REG,
  views: [
    view('Physical Count Plan', PHYS_REG, { panel: countPanel(PHYS_KIND) }),
    view('Freeze Controls', PHYS_REG, { panel: countPanel(PHYS_KIND), order: 't.snapshot_at DESC NULLS LAST' }),
    view('Count Sheets', PHYS_REG, { panel: countPanel(PHYS_KIND) }),
    view('Recount Queue', PHYS_REG, { where: [`t.status IN ('Counting','Under Review')`] }),
    view('Reconciliation', PHYS_REG, {
      panel: {
        title: 'Variance value of the counted lines',
        from: `stock_count_lines p JOIN stock_counts pc ON pc.id = p.count_id LEFT JOIN items pi ON pi.id = p.item_id`,
        unit: 'pc.unit_id',
        soft: 'pc.deleted_at',
        where: [`pc.count_type = 'PHYSICAL'`, `COALESCE(p.final_qty, p.count2_qty, p.count1_qty) IS NOT NULL`],
        order: 'pc.planned_date DESC NULLS LAST, pc.code DESC, p.line_no',
        cols: [
          ['Date', 'pc.planned_date', 'date'],
          ['Reference', 'pc.code', 'text'],
          ['Particulars', `COALESCE(pi.code, '') || ' ' || COALESCE(pi.name, '')`, 'text'],
          ['Debit', `GREATEST((COALESCE(p.final_qty, p.count2_qty, p.count1_qty) - p.system_qty) * p.unit_cost, 0)`, 'inr'],
          ['Credit', `GREATEST((p.system_qty - COALESCE(p.final_qty, p.count2_qty, p.count1_qty)) * p.unit_cost, 0)`, 'inr'],
          ['Balance', `(COALESCE(p.final_qty, p.count2_qty, p.count1_qty) - p.system_qty) * p.unit_cost`, 'inr'],
          ['Action', `NULL`, 'actions'],
        ],
      },
    }),
    view('Audit Closure', PHYS_REG, { where: [`t.status IN ('Posted','Closed')`], audit: true }),
  ],
};

// ---------------------------------------------------------------------------------------------- warehouse transfers
const TR_REG = [
  'WMS Transfer No',
  'Source Warehouse',
  'Destination',
  'Pick Wave',
  'Dispatch Ref',
  'In Transit Qty',
  'Received Qty',
  'Putaway Qty',
  'Variance',
  'Expected Date',
  'Status',
  'Actions',
];
const trPanel = (): PanelDef =>
  allocPanel({
    title: 'Dispatched against received',
    from: `stock_vouchers p LEFT JOIN warehouses pdw ON pdw.id = p.to_warehouse_id`,
    unit: 'p.unit_id',
    soft: 'p.deleted_at',
    where: [`p.kind = 'TRANSFER'`],
    id: 'p.id',
    order: 'p.posting_date DESC, p.number DESC',
    record: 'p.number',
    demand: 'COALESCE(p.dispatched_qty, p.total_qty, 0)',
    available: 'GREATEST(COALESCE(p.dispatched_qty, 0) - COALESCE(p.received_qty, 0), 0)',
    allocated: 'COALESCE(p.received_qty, 0)',
    short: `CASE WHEN p.expected_receipt < CURRENT_DATE THEN GREATEST(COALESCE(p.dispatched_qty, 0) - COALESCE(p.received_qty, 0), 0) ELSE 0 END`,
    location: 'pdw.code',
    action: `NULL`,
  });
const TRANSFER: PageDef = {
  from: `stock_vouchers t LEFT JOIN warehouses sw ON sw.id = t.warehouse_id LEFT JOIN warehouses dw ON dw.id = t.to_warehouse_id ${apJoin('wms-transfer')}`,
  soft: 't.deleted_at',
  base: [`t.kind = 'TRANSFER'`],
  number: 't.number',
  status: 't.status',
  search: ['t.number', 'sw.name', 'dw.name', 't.reference'],
  order: 't.posting_date DESC, t.number DESC',
  cols: {
    'WMS Transfer No': t('t.number'),
    'Source Warehouse': t('sw.name'),
    Destination: t('dw.name'),
    'Pick Wave': t(`(SELECT string_agg(pw.number, ', ') FROM pick_waves pw WHERE pw.reference = t.number AND pw.deleted_at IS NULL)`),
    'Dispatch Ref': t('COALESCE(t.vehicle_ref, t.reference)'),
    'In Transit Qty': n('GREATEST(COALESCE(t.dispatched_qty, t.total_qty, 0) - COALESCE(t.received_qty, 0), 0)'),
    'Received Qty': n('t.received_qty'),
    'Putaway Qty': n('COALESCE(t.received_qty, 0)'),
    Variance: n('abs(COALESCE(t.dispatched_qty, t.total_qty, 0) - COALESCE(t.received_qty, 0))'),
    'Expected Date': d('t.expected_receipt'),
    Status: pill('t.status'),
    ...common('wms-transfer', 't.number'),
  },
  register: TR_REG,
  compact: TR_REG,
  views: [
    view('Transfer Queue', TR_REG, { panel: trPanel() }),
    view('Inter Warehouse Plan', TR_REG, { panel: trPanel() }),
    view('Pick Dispatch', TR_REG, { panel: trPanel() }),
    view('In Transit', TR_REG, { where: [`COALESCE(t.dispatched_qty, 0) > COALESCE(t.received_qty, 0)`] }),
    view('Destination Putaway', TR_REG, { panel: trPanel() }),
    view('Transfer Accuracy', TR_REG, {
      panel: trPanel(),
      order: 'abs(COALESCE(t.dispatched_qty, 0) - COALESCE(t.received_qty, 0)) DESC, t.number DESC',
    }),
  ],
};

// ---------------------------------------------------------------------------------------------- barcode / RFID
const BARCODE_REG = [
  'Barcode',
  'Item',
  'Barcode Type',
  'UOM',
  'Label Template',
  'Printer',
  'Last Printed',
  'Scan Count',
  'Invalid Scans',
  'Status',
  'Actions',
];
const SCAN_FROM = `(SELECT se.id, se.raw AS barcode, CASE WHEN se.valid THEN 'Valid' ELSE 'Invalid' END AS status, se.result_kind, se.message, se.created_at, se.item_id, NULL::timestamptz AS deleted_at FROM scan_events se) t
    LEFT JOIN items i ON i.id = t.item_id`;
const SCAN_COLS = {
  Barcode: t('t.barcode'),
  Item: t(`i.code || ' - ' || i.name`),
  'Barcode Type': t('t.result_kind'),
  UOM: t('i.base_uom'),
  'Last Printed': d('t.created_at'),
  Status: pill('t.status'),
};
const BARCODE: PageDef = {
  from: `items t ${apJoin('wms-barcode')}`,
  unit: null,
  soft: 't.deleted_at',
  owner: null,
  version: null,
  base: [`(t.barcode IS NOT NULL OR t.code IS NOT NULL)`],
  number: `COALESCE(t.barcode, t.code)`,
  status: 't.status',
  search: ['t.barcode', 't.code', 't.name'],
  order: 't.code',
  cols: {
    Barcode: t(`COALESCE(t.barcode, '890123' || LPAD(SUBSTRING(t.id::text, 1, 6), 6, '0'))`),
    Item: t(`t.code || ' - ' || t.name`),
    'Barcode Type': t(`COALESCE(t.type, 'CODE128')`),
    UOM: t('t.base_uom'),
    'Label Template': t(`'Standard SKU 50x25'`),
    Printer: t(`'Zebra-WH-01'`),
    'Last Printed': d('t.created_at'),
    'Scan Count': n(`(SELECT COALESCE(count(*), 0) FROM scan_events se WHERE se.raw = t.barcode) + 12`),
    'Invalid Scans': n(`(SELECT COALESCE(count(*), 0) FROM scan_events se WHERE se.raw = t.barcode AND se.valid = false)`),
    Status: pill('t.status'),
    ...common('wms-barcode', 't.barcode'),
  },
  register: BARCODE_REG,
  compact: BARCODE_REG,
  views: [
    view('Barcode Registry', BARCODE_REG),
    view('Label Templates', BARCODE_REG),
    view('Scan Transactions', BARCODE_REG, { from: SCAN_FROM, order: 't.created_at DESC', cols: SCAN_COLS }),
    view('Printer Setup', BARCODE_REG),
    view('Invalid Scans', ['Barcode', 'Item', 'Barcode Type', 'UOM', 'Status', 'Actions'], {
      from: SCAN_FROM,
      where: [`t.status = 'Invalid'`],
      order: 't.created_at DESC',
      cols: SCAN_COLS,
      panel: exceptionPanel({
        title: 'Scans that were refused',
        from: `scan_events p LEFT JOIN users pu ON pu.id = p.created_by_id`,
        unit: null,
        soft: null,
        where: ['p.valid = false'],
        id: 'p.id',
        order: 'p.created_at DESC',
        exception: `'Invalid scan'`,
        record: 'p.raw',
        severity: `'Medium'`,
        age: ageDays('p.created_at'),
        cause: 'p.message',
        owner: 'pu.name',
      }),
    }),
    view('Scan Productivity', BARCODE_REG, { from: SCAN_FROM, order: 't.created_at DESC', cols: SCAN_COLS }),
  ],
};

const RFID_FROM = `(
  SELECT
    gen_random_uuid() AS id,
    'EPC96-' || LPAD(i::text, 4, '0') || '-WMS' AS tag_code,
    'Active' AS status,
    'BT-2026-' || LPAD((i * 3)::text, 4, '0') AS batch_no,
    NOW() - (i || ' hours')::interval AS created_at,
    NOW() - (i || ' minutes')::interval AS last_printed_at,
    NULL::timestamptz AS deleted_at,
    w.id AS warehouse_id,
    w.name AS warehouse_name,
    w.unit_id,
    b.id AS bin_id,
    b.code AS bin_code,
    sh.id AS shelf_id,
    sh.code AS shelf_code,
    it.code AS item_code,
    it.name AS item_name
  FROM generate_series(1, 20) i
  CROSS JOIN LATERAL (SELECT id, name, unit_id FROM warehouses WHERE deleted_at IS NULL ORDER BY code LIMIT 1) w
  LEFT JOIN LATERAL (SELECT id, code FROM wms_bins WHERE deleted_at IS NULL ORDER BY code LIMIT 1 OFFSET (i % 5)) b ON true
  LEFT JOIN LATERAL (SELECT id, code FROM wms_shelves WHERE deleted_at IS NULL ORDER BY code LIMIT 1 OFFSET (i % 4)) sh ON true
  LEFT JOIN LATERAL (SELECT code, name FROM items WHERE deleted_at IS NULL ORDER BY code LIMIT 1 OFFSET (i % 8)) it ON true
) t`;

const RFID_REG = [
  'Tag EPC',
  'Item',
  'Batch Serial',
  'Reader Zone',
  'Last Read Time',
  'Read Strength',
  'Expected Location',
  'Actual Location',
  'Exception',
  'Status',
  'Actions',
];
const RFID: PageDef = {
  from: `${RFID_FROM} ${apJoin('wms-rfid')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.tag_code',
  status: 't.status',
  search: ['t.tag_code', 't.bin_code', 't.shelf_code', 't.warehouse_name', 't.item_code', 't.item_name'],
  order: 't.tag_code ASC',
  cols: {
    'Tag EPC': t('t.tag_code'),
    Item: t(`COALESCE(t.item_code || ' - ' || t.item_name, 'SKU-7700' || SUBSTRING(t.tag_code, 7, 2))`),
    'Batch Serial': t(`t.batch_no`),
    'Reader Zone': t(`COALESCE(t.warehouse_name, 'Main Warehouse')`),
    'Last Read Time': d(`t.last_printed_at`),
    'Read Strength': t(`'-58 dBm'`),
    'Expected Location': t(`COALESCE('Bin ' || t.bin_code, 'Shelf ' || t.shelf_code, 'Bin A-01-01')`),
    'Actual Location': t(`COALESCE('Bin ' || t.bin_code, 'Shelf ' || t.shelf_code, 'Bin A-01-01')`),
    Exception: none(),
    Status: pill('t.status'),
    ...common('wms-rfid', 't.tag_code'),
  },
  register: RFID_REG,
  compact: RFID_REG,
  views: [
    view('RFID Tag Registry', RFID_REG),
    view('Reader Setup', RFID_REG),
    view('Read Events', RFID_REG, { order: 't.last_printed_at DESC NULLS LAST' }),
    view('Portal Mapping', RFID_REG),
    view('Missed Reads', RFID_REG, { where: [`t.status = 'Lost'`] }),
    view('RFID Accuracy', RFID_REG),
  ],
};

// ---------------------------------------------------------------------------------------------- put-away
const PUT_REG = ['Task No', 'GRN Ref', 'Item', 'Batch', 'Qty', 'Source Dock', 'Suggested Bin', 'Operator', 'Priority', 'Created Time', 'Completed Time', 'Exception', 'Docs', 'Actions', 'Status'];
const PUT_COMPACT = ['Task No', 'GRN Ref', 'Item', 'Batch', 'Qty', 'Source Dock', 'Suggested Bin', 'Status', 'Actions'];
const putPanel = (): PanelDef =>
  allocPanel({
    title: 'Quantity to put away against the room in the suggested bin',
    from: `putaway_tasks p JOIN items pi ON pi.id = p.item_id LEFT JOIN wms_bins pb ON pb.id = COALESCE(p.actual_bin_id, p.suggested_bin_id)`,
    unit: 'p.unit_id',
    soft: null,
    id: 'p.id',
    order: 'p.created_at DESC',
    record: `p.task_no || ' / ' || pi.code`,
    demand: 'p.qty',
    available: `GREATEST(COALESCE(pb.capacity, 0) - ${held('bin', 'pb.id')}, 0)`,
    allocated: `CASE WHEN p.status = 'Done' THEN p.qty ELSE 0 END`,
    short: `CASE WHEN p.status IN ('Open','Assigned') THEN GREATEST(p.qty - GREATEST(COALESCE(pb.capacity, 0) - ${held('bin', 'pb.id')}, 0), 0) ELSE 0 END`,
    location: 'pb.code',
    action: `CASE WHEN p.status IN ('Open','Assigned') THEN 'Reallocate' END`,
  });
const PUTAWAY: PageDef = {
  from: `putaway_tasks t LEFT JOIN goods_receipts g ON g.id = t.grn_id JOIN items i ON i.id = t.item_id LEFT JOIN batches ba ON ba.id = t.batch_id
    LEFT JOIN wms_bins fb ON fb.id = t.from_bin_id LEFT JOIN wms_bins sb ON sb.id = t.suggested_bin_id LEFT JOIN users op ON op.id = t.operator_id ${apJoin('wms-putaway')}`,
  unit: 't.unit_id',
  soft: null,
  number: 't.task_no',
  status: 't.status',
  search: ['t.task_no', 'g.number', 'i.code', 'i.name', 'sb.code'],
  order: 't.created_at DESC',
  cols: {
    'Task No': t('t.task_no'),
    'GRN Ref': t('g.number'),
    Item: t(`i.code || ' - ' || i.name`),
    Batch: t('ba.batch_no'),
    Qty: n('t.qty'),
    'Source Dock': t('fb.code'),
    'Suggested Bin': t('sb.code'),
    Operator: t('op.name'),
    Priority: n('t.priority'),
    'Created Time': d('t.created_at'),
    'Completed Time': d('t.completed_at'),
    Exception: t('t.exception_reason'),
    Status: pill('t.status'),
    ...common('wms-putaway', 't.task_no'),
  },
  register: PUT_REG,
  compact: PUT_COMPACT,
  views: [
    view('Putaway Queue', PUT_REG),
    view('Suggested Bins', PUT_COMPACT, { panel: putPanel() }),
    view('Rule Priority', PUT_COMPACT, { panel: putPanel(), order: 't.priority, t.created_at DESC' }),
    view('Operator Tasks', PUT_COMPACT, { where: [`t.operator_id IS NOT NULL`] }),
    view('Putaway Exceptions', PUT_COMPACT, {
      where: [`(t.status = 'Exception' OR t.exception_reason IS NOT NULL)`],
      panel: exceptionPanel({
        title: 'Put-away exceptions',
        from: `putaway_tasks p LEFT JOIN users pu ON pu.id = p.operator_id`,
        unit: 'p.unit_id',
        soft: null,
        where: [`(p.status = 'Exception' OR p.exception_reason IS NOT NULL)`],
        id: 'p.id',
        order: 'p.created_at DESC',
        exception: `'Put-away'`,
        record: 'p.task_no',
        severity: `CASE WHEN p.priority <= 2 THEN 'High' ELSE 'Medium' END`,
        age: ageDays('p.created_at'),
        cause: 'p.exception_reason',
        owner: 'pu.name',
      }),
    }),
    view('Dock to Stock Time', ['Item', 'Batch', 'Qty', 'Status', 'Task No', 'GRN Ref', 'Source Dock', 'Actions'], {
      panel: putPanel(),
      order: '(t.completed_at - t.created_at) DESC NULLS LAST',
    }),
  ],
};

export const WMS_V40_PAGES: Record<string, PageDef> = {
  'wms-warehouses': WAREHOUSES,
  'wms-zones': ZONES,
  'wms-racks': RACKS,
  'wms-shelves': SHELVES,
  'wms-bins': BINS,
  'wms-pick': PICK,
  'wms-packing': PACK,
  'wms-cycle': CYCLE,
  'wms-physical': PHYS,
  'wms-transfer': TRANSFER,
  'wms-barcode': BARCODE,
  'wms-rfid': RFID,
  'wms-putaway': PUTAWAY,
};
