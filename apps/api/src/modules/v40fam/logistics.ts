// V40 tab views of the Logistics, Fleet and Gate pages. Every column maps to a real table; a column the database cannot fill
// (Allocation Ref of a container, Count Team ...) has no expression and shows a dash.
import { ageDays, allocPanel, apJoin, common, d, exceptionPanel, m, n, none, pill, rulePanel, securityPanel, t, tm, view } from './shared';
import type { PageDef, PanelDef } from './shared';

// ---------------------------------------------------------------------------------------------- shipments
const SHIP_FROM = (page: string): string => `shipments t LEFT JOIN customers cu ON cu.id = t.customer_id LEFT JOIN suppliers tr ON tr.id = t.transporter_id
  LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN routes rt ON rt.id = t.route_id LEFT JOIN units un ON un.id = t.unit_id
  LEFT JOIN LATERAL (SELECT te.location, te.milestone, te.recorded_at, te.delay_mins FROM tracking_events te WHERE te.shipment_id = t.id ORDER BY te.recorded_at DESC LIMIT 1) lt ON true
  ${apJoin(page)}`;
const shipOrders = `(SELECT string_agg(DISTINCT so.number, ', ') FROM shipment_lines sl JOIN sales_orders so ON so.id = sl.sales_order_id WHERE sl.shipment_id = t.id)`;
const shipCols = (page: string): PageDef['cols'] => ({
  'Shipment No': t('t.shipment_no'),
  'Sales Orders': t(shipOrders),
  Customer: t('cu.name'),
  Origin: t('COALESCE(rt.origin_place, un.name)'),
  Destination: t('rt.destination_place'),
  Transporter: t('tr.name'),
  Vehicle: t('COALESCE(v.reg_no, t.hired_vehicle_no)'),
  'Last Location': t('lt.location'),
  'Last Update': tm('lt.recorded_at'),
  'Current Milestone': t('lt.milestone'),
  Status: pill('t.status'),
  ...common(page, 't.shipment_no'),
});
const SHIP_REG = ['Shipment No', 'Sales Orders', 'Customer', 'Origin', 'Destination', 'Transporter', 'Vehicle', 'Status', 'Actions'];
const shipAlloc = (): PanelDef =>
  allocPanel({
    title: 'Shipment weight against the carrier allocated',
    from: `shipments p LEFT JOIN suppliers ptr ON ptr.id = p.transporter_id LEFT JOIN routes pr ON pr.id = p.route_id`,
    unit: 'p.unit_id',
    soft: 'p.deleted_at',
    where: [`p.status NOT IN ('CANCELLED','CLOSED')`],
    id: 'p.id',
    order: 'p.planned_dispatch_at DESC NULLS LAST, p.shipment_no DESC',
    record: 'p.shipment_no',
    demand: 'p.weight_kg',
    available: 'NULL',
    allocated: `CASE WHEN p.transporter_id IS NOT NULL OR p.hired_vehicle_no IS NOT NULL THEN p.weight_kg ELSE 0 END`,
    short: `CASE WHEN p.transporter_id IS NULL AND p.hired_vehicle_no IS NULL THEN p.weight_kg ELSE 0 END`,
    location: 'pr.destination_place',
    action: `CASE WHEN p.transporter_id IS NULL THEN 'Allocate' ELSE 'Reallocate' END`,
  });
const SHIPMENTS: PageDef = {
  from: SHIP_FROM('log-shipments'),
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.shipment_no',
  status: 't.status',
  search: ['t.shipment_no', 'cu.name', 'tr.name', 'v.reg_no', 't.hired_vehicle_no', 't.lr_no', shipOrders],
  order: 't.planned_dispatch_at DESC NULLS LAST, t.shipment_no DESC',
  cols: shipCols('log-shipments'),
  register: SHIP_REG,
  compact: SHIP_REG,
  views: [
    view('Shipment Plan', SHIP_REG),
    view('Order Consolidation', ['Sales Orders', 'Customer', 'Status', 'Shipment No', 'Origin', 'Destination', 'Transporter', 'Actions'], {
      order: `(SELECT count(*) FROM shipment_lines sl WHERE sl.shipment_id = t.id) DESC, t.shipment_no DESC`,
    }),
    view('Carrier Allocation', ['Status', 'Shipment No', 'Sales Orders', 'Customer', 'Origin', 'Destination', 'Transporter', 'Actions'], { panel: shipAlloc() }),
    view('Vehicle Load', SHIP_REG, { order: 't.weight_kg DESC NULLS LAST, t.shipment_no DESC' }),
    view('Dispatch Window', SHIP_REG, { order: 't.planned_dispatch_at NULLS LAST, t.shipment_no' }),
    view('Shipment SLA', SHIP_REG, { order: `(t.planned_delivery_at < now() AND t.status IN ('DISPATCHED','IN_TRANSIT')) DESC, t.planned_delivery_at NULLS LAST` }),
  ],
};

const TRACK_REG = ['Shipment No', 'Customer', 'Transporter', 'Vehicle', 'Last Location', 'Last Update', 'Current Milestone', 'Status', 'Actions'];
const LATE = `p.status IN ('DISPATCHED','IN_TRANSIT') AND p.planned_delivery_at < now()`;
const TRACKING: PageDef = {
  from: SHIP_FROM('log-tracking'),
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.shipment_no',
  status: 't.status',
  search: ['t.shipment_no', 'cu.name', 'tr.name', 'v.reg_no', 't.hired_vehicle_no', 'lt.location'],
  order: 'lt.recorded_at DESC NULLS LAST, t.shipment_no DESC',
  cols: shipCols('log-tracking'),
  register: TRACK_REG,
  compact: TRACK_REG,
  views: [
    view('Milestones', TRACK_REG),
    view('Current Status', TRACK_REG, { where: [`t.status NOT IN ('CLOSED','CANCELLED')`] }),
    view('Delay Exceptions', TRACK_REG, {
      where: [`t.status IN ('DISPATCHED','IN_TRANSIT')`, `(t.planned_delivery_at < now() OR COALESCE(lt.delay_mins, 0) > 0)`],
      panel: exceptionPanel({
        title: 'Shipments running late',
        from: `shipments p LEFT JOIN suppliers ptr ON ptr.id = p.transporter_id
          LEFT JOIN LATERAL (SELECT te.note, te.delay_mins FROM tracking_events te WHERE te.shipment_id = p.id ORDER BY te.recorded_at DESC LIMIT 1) pl ON true`,
        unit: 'p.unit_id',
        soft: 'p.deleted_at',
        where: [`p.status IN ('DISPATCHED','IN_TRANSIT')`, `(p.planned_delivery_at < now() OR COALESCE(pl.delay_mins, 0) > 0)`],
        id: 'p.id',
        order: 'p.planned_delivery_at NULLS LAST',
        exception: `'Delivery delay'`,
        record: 'p.shipment_no',
        severity: `CASE WHEN p.planned_delivery_at < now() - interval '2 days' THEN 'High' ELSE 'Medium' END`,
        age: `COALESCE(GREATEST(CURRENT_DATE - p.planned_delivery_at::date, 0)::text || ' d', COALESCE(pl.delay_mins, 0)::text || ' min')`,
        cause: `COALESCE(pl.note, 'Past the planned delivery time')`,
        owner: 'ptr.name',
      }),
    }),
    view('Customer ETA', ['Customer', 'Last Update', 'Status', 'Shipment No', 'Transporter', 'Vehicle', 'Last Location', 'Actions'], {
      order: 't.planned_delivery_at NULLS LAST, t.shipment_no',
    }),
    view('Tracking Performance', TRACK_REG, {
      panel: allocPanel({
        title: 'Shipment weight by delivery state',
        from: `shipments p LEFT JOIN LATERAL (SELECT te.location FROM tracking_events te WHERE te.shipment_id = p.id ORDER BY te.recorded_at DESC LIMIT 1) pl ON true`,
        unit: 'p.unit_id',
        soft: 'p.deleted_at',
        where: [`p.status <> 'CANCELLED'`],
        id: 'p.id',
        order: 'p.planned_dispatch_at DESC NULLS LAST',
        record: 'p.shipment_no',
        demand: 'p.weight_kg',
        available: `CASE WHEN p.status IN ('DELIVERED','POD_RECEIVED','CLOSED') THEN p.weight_kg ELSE 0 END`,
        allocated: `CASE WHEN p.status IN ('DISPATCHED','IN_TRANSIT') THEN p.weight_kg ELSE 0 END`,
        short: `CASE WHEN ${LATE} THEN p.weight_kg ELSE 0 END`,
        location: 'pl.location',
        action: 'NULL',
      }),
    }),
  ],
};

// ---------------------------------------------------------------------------------------------- freight
const FREIGHT_REG = ['Calculation Ref', 'Shipment Ref', 'Transporter', 'Route', 'Weight KG', 'Volume CBM', 'Base Freight', 'Status', 'Actions'];
const FREIGHT: PageDef = {
  from: `freight_calculations t JOIN shipments sh ON sh.id = t.shipment_id LEFT JOIN suppliers tr ON tr.id = sh.transporter_id LEFT JOIN routes rt ON rt.id = sh.route_id
    ${apJoin('log-freight')}`,
  unit: 't.unit_id',
  soft: null,
  version: null,
  number: 't.calc_no',
  status: 't.status',
  search: ['t.calc_no', 'sh.shipment_no', 'tr.name', 'rt.name'],
  order: 't.created_at DESC',
  cols: {
    'Calculation Ref': t('t.calc_no'),
    'Shipment Ref': t('sh.shipment_no'),
    Transporter: t('tr.name'),
    Route: t(`COALESCE(rt.code || ' ' || rt.name, rt.name)`),
    'Weight KG': n('t.weight_kg'),
    'Volume CBM': n('t.volume_cbm'),
    'Base Freight': m('t.base_amount'),
    Status: pill('t.status'),
    ...common('log-freight', 't.calc_no'),
  },
  register: FREIGHT_REG,
  compact: FREIGHT_REG,
  views: [
    view('Rate Contracts', FREIGHT_REG),
    view('Weight Volume Slab', FREIGHT_REG, { order: 't.weight_kg DESC NULLS LAST, t.created_at DESC' }),
    view('Fuel Surcharge', FREIGHT_REG, { order: 't.fuel_surcharge DESC NULLS LAST, t.created_at DESC' }),
    view('Additional Charges', FREIGHT_REG, { order: '(t.toll_amount + t.loading_amount + t.other_amount) DESC, t.created_at DESC' }),
    view('Freight Variance', FREIGHT_REG, { order: 'abs(t.variance_amount) DESC NULLS LAST, t.created_at DESC' }),
  ],
};

// ---------------------------------------------------------------------------------------------- routes, transporters
const ROUTE_REG = ['Route Code', 'Route Name', 'Origin', 'Destination', 'Stops', 'Distance KM', 'Standard Transit Hrs', 'Status', 'Actions'];
const ROUTES: PageDef = {
  from: `routes t ${apJoin('log-routes')}`,
  unit: 't.origin_unit_id',
  soft: 't.deleted_at',
  version: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 't.origin_place', 't.destination_place'],
  order: 't.code',
  cols: {
    'Route Code': t('t.code'),
    'Route Name': t('t.name'),
    Origin: t('t.origin_place'),
    Destination: t('t.destination_place'),
    Stops: n(`(SELECT count(*) FROM route_stops rs WHERE rs.route_id = t.id)`),
    'Distance KM': n('t.distance_km'),
    'Standard Transit Hrs': n('t.std_transit_hrs'),
    'Toll Cost': m('t.toll_cost'),
    Status: pill('t.status'),
    ...common('log-routes', 't.code'),
  },
  register: ROUTE_REG,
  compact: ROUTE_REG,
  views: [
    view('Route Master', ROUTE_REG),
    view('Stops & Distance', ROUTE_REG, { order: 't.distance_km DESC NULLS LAST, t.code' }),
    view('Transit Time', ROUTE_REG, { order: 't.std_transit_hrs DESC NULLS LAST, t.code' }),
    view('Toll & Restriction', ROUTE_REG, { order: `(t.restriction_text IS NOT NULL) DESC, t.toll_cost DESC NULLS LAST, t.code` }),
    view('Route Cost', ['Toll Cost', 'Route Code', 'Route Name', 'Origin', 'Destination', 'Stops', 'Distance KM', 'Status', 'Actions'], {
      order: 't.toll_cost DESC NULLS LAST, t.code',
    }),
    view('Route Performance', ROUTE_REG, {
      order: `(SELECT count(*) FROM shipments s WHERE s.route_id = t.id AND s.deleted_at IS NULL) DESC, t.code`,
    }),
  ],
};

const TRANS_REG = ['Transporter Code', 'Transporter Name', 'GSTIN', 'Contact', 'Primary Lanes', 'Vehicle Types', 'Rate Card', 'Status', 'Actions'];
const TRANSPORTERS: PageDef = {
  from: `suppliers t LEFT JOIN supplier_transporter_profiles tp ON tp.supplier_id = t.id ${apJoin('log-transporters')}`,
  unit: null,
  soft: 't.deleted_at',
  owner: null,
  base: ['t.is_transporter = true'],
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 't.gstin'],
  order: 't.code',
  cols: {
    'Transporter Code': t('t.code'),
    'Transporter Name': t('t.name'),
    GSTIN: t('t.gstin'),
    Contact: t(`(SELECT c.name || COALESCE(' ' || c.mobile, '') FROM supplier_contacts c WHERE c.supplier_id = t.id ORDER BY c.is_primary DESC, c.name LIMIT 1)`),
    'Primary Lanes': t(
      `(SELECT string_agg(r.code, ', ' ORDER BY r.code) FROM transporter_lanes tl JOIN routes r ON r.id = tl.route_id WHERE tl.supplier_id = t.id)`,
    ),
    'Vehicle Types': t(`(SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(tp.vehicle_types) = 'array' THEN tp.vehicle_types ELSE '[]'::jsonb END) x)`),
    'Rate Card': t(`(SELECT string_agg(rc.code, ', ' ORDER BY rc.code) FROM freight_rate_cards rc WHERE rc.supplier_id = t.id AND rc.deleted_at IS NULL AND rc.status = 'ACTIVE')`),
    Status: pill('t.status'),
    ...common('log-transporters', 't.code'),
  },
  register: TRANS_REG,
  compact: TRANS_REG,
  views: [
    view('Transporter Master', TRANS_REG),
    view('Lane Capability', TRANS_REG, { order: `(SELECT count(*) FROM transporter_lanes tl WHERE tl.supplier_id = t.id) DESC, t.code` }),
    view('Rate Cards', TRANS_REG, { order: `(SELECT count(*) FROM freight_rate_cards rc WHERE rc.supplier_id = t.id AND rc.deleted_at IS NULL) DESC, t.code` }),
    view('Compliance Documents', ['GSTIN', 'Transporter Code', 'Transporter Name', 'Contact', 'Primary Lanes', 'Vehicle Types', 'Rate Card', 'Status', 'Actions'], {
      panel: rulePanel(
        'Transporter compliance',
        [
          { rule: 'GSTIN on file', pass: `COALESCE(t.gstin, '') <> ''`, warn: 'false', fail: `COALESCE(t.gstin, '') = ''` },
          { rule: 'PAN on file', pass: `COALESCE(t.pan, '') <> ''`, warn: 'false', fail: `COALESCE(t.pan, '') = ''` },
          {
            rule: 'Insurance valid',
            pass: `tp.insurance_valid_till >= CURRENT_DATE + 30`,
            warn: `tp.insurance_valid_till >= CURRENT_DATE AND tp.insurance_valid_till < CURRENT_DATE + 30`,
            fail: `tp.insurance_valid_till IS NULL OR tp.insurance_valid_till < CURRENT_DATE`,
          },
        ],
        `suppliers t LEFT JOIN supplier_transporter_profiles tp ON tp.supplier_id = t.id`,
        `t.is_transporter = true AND t.deleted_at IS NULL`,
      ),
    }),
    view('Performance Score', TRANS_REG, { order: 'tp.rating DESC NULLS LAST, t.code' }),
    view('Transporter Risk', TRANS_REG, { order: `tp.insurance_valid_till NULLS FIRST, t.code` }),
  ],
};

// ---------------------------------------------------------------------------------------------- POD, containers
const POD_REG = ['POD No', 'Shipment No', 'Customer', 'Delivery Date', 'Receiver', 'Receiver Mobile', 'POD File', 'Status', 'Actions'];
const PODS: PageDef = {
  from: `pods t JOIN shipments sh ON sh.id = t.shipment_id LEFT JOIN customers cu ON cu.id = sh.customer_id ${apJoin('log-pod')}`,
  unit: 'sh.unit_id',
  soft: null,
  owner: 't.created_by_id',
  version: null,
  number: `'POD-' || sh.shipment_no`,
  status: `CASE WHEN t.billing_released THEN 'Billing released' ELSE 'Received' END`,
  search: ['sh.shipment_no', 'cu.name', 't.receiver_name'],
  order: 't.delivered_at DESC NULLS LAST',
  cols: {
    'POD No': t(`'POD-' || sh.shipment_no`),
    'Shipment No': t('sh.shipment_no'),
    Customer: t('cu.name'),
    'Delivery Date': d('t.delivered_at'),
    Receiver: t('t.receiver_name'),
    'Receiver Mobile': t('t.receiver_mobile'),
    'POD File': t(`CASE WHEN t.stored_file_id IS NOT NULL THEN 'Attached' END`),
    Status: pill(`CASE WHEN t.billing_released THEN 'Billing released' ELSE 'Received' END`),
    ...common('log-pod', `'POD-' || sh.shipment_no`),
  },
  register: POD_REG,
  compact: POD_REG,
  views: [
    view('POD Register', POD_REG),
    view('Delivery Evidence', POD_REG, { order: `(t.stored_file_id IS NOT NULL) DESC, t.delivered_at DESC NULLS LAST` }),
    view('Receiver Details', POD_REG, { order: 't.receiver_name' }),
    view('Short Damage', POD_REG, {
      where: [`EXISTS (SELECT 1 FROM pod_lines pl WHERE pl.pod_id = t.id AND (pl.short_qty > 0 OR pl.damage_qty > 0))`],
    }),
    view('Billing Release', POD_REG, { order: `t.billing_released, t.delivered_at DESC NULLS LAST` }),
    view('POD Turnaround', POD_REG, { order: `(t.delivered_at - sh.actual_delivery_at) DESC NULLS LAST` }),
  ],
};

const CONT_REG = [
  'Container No', 'Type', 'Owner', 'Allocation Ref', 'Loading Date', 'Shipment', 'Current Location', 'ETA', 'Unloading Date', 'Return Due', 'Return Date', 'Status', 'Docs', 'Actions',
];
const CONT_SHORT = ['Container No', 'Type', 'Owner', 'Allocation Ref', 'Loading Date', 'Shipment', 'Current Location', 'Status', 'Actions'];
const movement = (type: string): string =>
  `(SELECT max(cm.event_at) FROM container_movements cm WHERE cm.container_id = t.id AND cm.event_type = '${type}')`;
const CONTAINERS: PageDef = {
  from: `containers t LEFT JOIN LATERAL (SELECT sh.shipment_no, sh.planned_delivery_at FROM container_movements cm JOIN shipments sh ON sh.id = cm.shipment_id WHERE cm.container_id = t.id AND cm.shipment_id IS NOT NULL ORDER BY cm.event_at DESC LIMIT 1) ls ON true ${apJoin('container-track')}`,
  unit: null,
  soft: null,
  owner: null,
  version: null,
  number: 't.container_no',
  status: 't.current_status',
  search: ['t.container_no', 't.current_location', 't.owner'],
  order: 't.last_move_at DESC NULLS LAST, t.container_no',
  cols: {
    'Container No': t('t.container_no'),
    Type: t('t.container_type'),
    Owner: t('t.owner'),
    'Allocation Ref': none(),
    'Loading Date': d(movement('STUFFED')),
    Shipment: t('ls.shipment_no'),
    'Current Location': t('t.current_location'),
    ETA: d('ls.planned_delivery_at'),
    'Unloading Date': d(movement('DESTUFFED')),
    'Return Due': d(`${movement('STUFFED')}::date + t.free_days`),
    'Return Date': d(movement('EMPTY_RETURN')),
    Status: pill('t.current_status'),
    ...common('container-track', 't.container_no'),
  },
  register: CONT_REG,
  compact: CONT_SHORT,
  views: [
    view('Allocation', ['Status', 'Container No', 'Type', 'Owner', 'Allocation Ref', 'Loading Date', 'Shipment', 'Actions'], {
      panel: allocPanel({
        title: 'Containers against the shipments that need them',
        from: `containers p LEFT JOIN LATERAL (SELECT sh.shipment_no FROM container_movements cm JOIN shipments sh ON sh.id = cm.shipment_id WHERE cm.container_id = p.id AND cm.shipment_id IS NOT NULL ORDER BY cm.event_at DESC LIMIT 1) pls ON true`,
        unit: null,
        soft: null,
        id: 'p.id',
        order: 'p.container_no',
        record: 'p.container_no',
        demand: 'NULL',
        available: `CASE WHEN p.current_status IN ('EMPTY','AVAILABLE','Empty','Available') THEN 1 ELSE 0 END`,
        allocated: `CASE WHEN pls.shipment_no IS NOT NULL THEN 1 ELSE 0 END`,
        short: 'NULL',
        location: 'p.current_location',
        action: `CASE WHEN pls.shipment_no IS NULL THEN 'Allocate' ELSE 'Reallocate' END`,
      }),
    }),
    view('Loading', CONT_SHORT, { order: `${movement('STUFFED')} DESC NULLS LAST, t.container_no` }),
    view('Transit', CONT_SHORT, { order: 't.last_move_at DESC NULLS LAST, t.container_no' }),
    view('Unloading & Return', CONT_SHORT, { order: `${movement('DESTUFFED')} DESC NULLS LAST, t.container_no` }),
    view('Container Turnaround', CONT_SHORT, { order: `${movement('EMPTY_RETURN')} DESC NULLS LAST, t.container_no` }),
  ],
};

// ---------------------------------------------------------------------------------------------- fleet
const VEH_REG = ['Vehicle No', 'Vehicle Type', 'Branch', 'Driver', 'Make Model', 'Insurance Expiry', 'Fitness Expiry', 'Status', 'Actions'];
const docExpiry = (code: string, alias = 't'): string =>
  `(SELECT max(vd.expiry_date) FROM vehicle_documents vd WHERE vd.vehicle_id = ${alias}.id AND vd.doc_type_code = '${code}')`;
const docRule = (rule: string, code: string): { rule: string; pass: string; warn: string; fail: string } => ({
  rule,
  pass: `${docExpiry(code)} >= CURRENT_DATE + 30`,
  warn: `${docExpiry(code)} >= CURRENT_DATE AND ${docExpiry(code)} < CURRENT_DATE + 30`,
  fail: `${docExpiry(code)} IS NULL OR ${docExpiry(code)} < CURRENT_DATE`,
});
const VEHICLES: PageDef = {
  from: `vehicles t LEFT JOIN units un ON un.id = t.unit_id
    LEFT JOIN LATERAL (SELECT dr.name FROM vehicle_assignments va JOIN drivers dr ON dr.id = va.driver_id WHERE va.vehicle_id = t.id AND va.is_active ORDER BY va.assigned_from DESC LIMIT 1) ad ON true
    ${apJoin('fleet-vehicles')}`,
  unit: 't.unit_id',
  soft: 't.deleted_at',
  number: 't.reg_no',
  status: 't.status',
  search: ['t.reg_no', 't.make_model', 't.vehicle_type', 'ad.name', 'un.name'],
  order: 't.reg_no',
  cols: {
    'Vehicle No': t('t.reg_no'),
    'Vehicle Type': t('t.vehicle_type'),
    Branch: t('un.name'),
    Driver: t('ad.name'),
    'Make Model': t('t.make_model'),
    'Insurance Expiry': d(docExpiry('INS')),
    'Fitness Expiry': d(docExpiry('FIT')),
    Status: pill('t.status'),
    ...common('fleet-vehicles', 't.reg_no'),
  },
  register: VEH_REG,
  compact: VEH_REG,
  views: [
    view('Vehicle Register', VEH_REG),
    view(
      'Compliance Documents',
      ['Vehicle No', 'Vehicle Type', 'Branch', 'Driver', 'Make Model', 'Insurance Expiry', 'Fitness Expiry', 'Status', 'Actions'],
      {
        panel: rulePanel(
          'Vehicle document validation',
          [
            docRule('Registration certificate valid', 'RC'),
            docRule('Insurance valid', 'INS'),
            docRule('Pollution certificate valid', 'PUC'),
            docRule('Fitness certificate valid', 'FIT'),
            docRule('Permit valid', 'PERMIT'),
          ],
          'vehicles t',
          '{SCOPE:t}',
        ),
      },
    ),
    view('Odometer & Usage', VEH_REG, { order: 't.current_odometer DESC NULLS LAST, t.reg_no' }),
    view('Fuel Performance', VEH_REG, { order: `(SELECT avg(f.kmpl) FROM fuel_logs f WHERE f.vehicle_id = t.id) DESC NULLS LAST, t.reg_no` }),
    view('Service Schedule', VEH_REG, { order: `(SELECT min(s.due_date) FROM vehicle_services s WHERE s.vehicle_id = t.id AND s.status = 'SCHEDULED') NULLS LAST, t.reg_no` }),
    view('Vehicle Cost', VEH_REG, {
      order: `((SELECT COALESCE(sum(f.amount), 0) FROM fuel_logs f WHERE f.vehicle_id = t.id) + (SELECT COALESCE(sum(s.total_amount), 0) FROM vehicle_services s WHERE s.vehicle_id = t.id)) DESC, t.reg_no`,
    }),
  ],
};

const DRV_REG = ['Driver ID', 'Driver Name', 'Mobile', 'License No', 'License Expiry', 'Vehicle Assigned', 'Trips Month', 'Status', 'Actions'];
const DRIVERS: PageDef = {
  from: `drivers t LEFT JOIN employees em ON em.id = t.employee_id
    LEFT JOIN LATERAL (SELECT v.reg_no FROM vehicle_assignments va JOIN vehicles v ON v.id = va.vehicle_id WHERE va.driver_id = t.id AND va.is_active ORDER BY va.assigned_from DESC LIMIT 1) av ON true
    ${apJoin('fleet-drivers')}`,
  unit: null,
  soft: 't.deleted_at',
  number: 't.name',
  status: 't.status',
  search: ['t.name', 't.mobile', 't.licence_no', 'em.emp_code'],
  order: 't.name',
  cols: {
    'Driver ID': t('em.emp_code'),
    'Driver Name': t('t.name'),
    Mobile: t('t.mobile'),
    'License No': t('t.licence_no'),
    'License Expiry': d('t.licence_expiry'),
    'Vehicle Assigned': t('av.reg_no'),
    'Trips Month': n(
      `(SELECT count(*) FROM shipments s WHERE s.driver_id = t.id AND s.deleted_at IS NULL AND date_trunc('month', COALESCE(s.actual_dispatch_at, s.planned_dispatch_at)) = date_trunc('month', now()))`,
    ),
    Document: t(`'Driving licence'`),
    Category: t('t.licence_class'),
    Revision: none(),
    'Linked Record': t('t.name'),
    Expiry: d('t.licence_expiry'),
    Status: pill('t.status'),
    ...common('fleet-drivers', 't.name'),
  },
  register: DRV_REG,
  compact: DRV_REG,
  views: [
    view('Driver Register', DRV_REG),
    view('License & Documents', ['Document', 'Category', 'Revision', 'Linked Record', 'Expiry', 'Status', 'Driver ID', 'Driver Name', 'Mobile', 'License No', 'License Expiry', 'Vehicle Assigned', 'Trips Month', 'Actions'], {
      order: 't.licence_expiry NULLS LAST, t.name',
    }),
    view('Vehicle Assignment', DRV_REG, { order: `(av.reg_no IS NULL), t.name` }),
    view('Trip History', DRV_REG, { order: `(SELECT count(*) FROM shipments s WHERE s.driver_id = t.id) DESC, t.name` }),
    view('Safety Incidents', DRV_REG),
    view('Driver Score', DRV_REG, { order: `(SELECT count(*) FROM shipments s WHERE s.driver_id = t.id AND s.status IN ('DELIVERED','POD_RECEIVED','CLOSED')) DESC, t.name` }),
  ],
};

const FUEL_REG = ['Fuel Entry No', 'Date', 'Vehicle', 'Driver', 'Odometer', 'Fuel Qty', 'Rate', 'Amount', 'Vendor', 'Mileage', 'Variance %', 'Status', 'Docs', 'Actions'];
const FUEL_SHORT = ['Fuel Entry No', 'Date', 'Vehicle', 'Driver', 'Odometer', 'Fuel Qty', 'Rate', 'Status', 'Actions'];
const FUEL: PageDef = {
  from: `fuel_logs t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id LEFT JOIN suppliers vn ON vn.id = t.vendor_id ${apJoin('fleet-fuel')}`,
  unit: 't.unit_id',
  soft: null,
  version: null,
  number: 't.fuel_no',
  status: 't.status',
  search: ['t.fuel_no', 'v.reg_no', 'dr.name', 'vn.name'],
  order: 't.filled_at DESC, t.fuel_no DESC',
  cols: {
    'Fuel Entry No': t('t.fuel_no'),
    Date: d('t.filled_at'),
    Vehicle: t('v.reg_no'),
    Driver: t('dr.name'),
    Odometer: n('t.odometer'),
    'Fuel Qty': n('t.litres'),
    Rate: m('t.rate'),
    Amount: m('t.amount'),
    Vendor: t('vn.name'),
    Mileage: n('t.kmpl'),
    'Variance %': n('t.variance_pct'),
    'Project Number': none(),
    Status: pill('t.status'),
    ...common('fleet-fuel', 't.fuel_no'),
  },
  register: FUEL_REG,
  compact: FUEL_SHORT,
  views: [
    view('Fuel Register', FUEL_REG),
    view('Fuel Issues', FUEL_SHORT, {
      where: [`(t.anomaly_codes IS NOT NULL AND t.anomaly_codes <> '[]'::jsonb)`],
      panel: exceptionPanel({
        title: 'Fuel entries flagged by the checks',
        from: `fuel_logs p JOIN vehicles pv ON pv.id = p.vehicle_id LEFT JOIN drivers pd ON pd.id = p.driver_id`,
        unit: 'p.unit_id',
        soft: null,
        where: [`(p.anomaly_codes IS NOT NULL AND p.anomaly_codes <> '[]'::jsonb)`],
        id: 'p.id',
        order: 'p.filled_at DESC',
        exception: `'Fuel check'`,
        record: `p.fuel_no || ' / ' || pv.reg_no`,
        severity: `CASE WHEN abs(COALESCE(p.variance_pct, 0)) >= 25 THEN 'High' ELSE 'Medium' END`,
        age: ageDays('p.filled_at'),
        cause: 'p.anomaly_codes::text',
        owner: 'pd.name',
      }),
    }),
    view('Mileage Calculation', FUEL_SHORT, { order: 't.kmpl DESC NULLS LAST, t.filled_at DESC' }),
    view('Fuel Variance', FUEL_SHORT, { order: 'abs(t.variance_pct) DESC NULLS LAST, t.filled_at DESC' }),
    view('Vendor Bills', ['Date', 'Amount', 'Vendor', 'Status', 'Project Number', 'Fuel Entry No', 'Vehicle', 'Actions'], { order: 'vn.name, t.filled_at DESC' }),
    view('Fuel Trend', FUEL_SHORT, { order: 't.filled_at DESC, t.fuel_no DESC' }),
  ],
};

const SVC_REG = ['Service Job No', 'Vehicle', 'Service Type', 'Due KM Date', 'Service Date', 'Odometer', 'Vendor Workshop', 'Status', 'Actions'];
const svcLines = (type: string): string =>
  `(SELECT COALESCE(sum(l.amount), 0) FROM vehicle_service_lines l WHERE l.service_id = t.id AND l.line_type = '${type}')`;
const SERVICE: PageDef = {
  from: `vehicle_services t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN suppliers vn ON vn.id = t.vendor_id ${apJoin('fleet-service')}`,
  unit: 't.unit_id',
  soft: null,
  version: null,
  number: 't.service_no',
  status: 't.status',
  search: ['t.service_no', 'v.reg_no', 't.service_type', 'vn.name'],
  order: 't.service_date DESC NULLS LAST, t.service_no DESC',
  cols: {
    'Service Job No': t('t.service_no'),
    Vehicle: t('v.reg_no'),
    'Service Type': t('t.service_type'),
    'Due KM Date': t(`COALESCE(to_char(t.due_date, 'YYYY-MM-DD'), t.due_km::text || ' km')`),
    'Service Date': d('t.service_date'),
    Odometer: n('t.odometer'),
    'Vendor Workshop': t('vn.name'),
    'Parts Cost': m(svcLines('PART')),
    'Labor Cost': m(svcLines('LABOUR')),
    Status: pill('t.status'),
    ...common('fleet-service', 't.service_no'),
  },
  register: SVC_REG,
  compact: SVC_REG,
  views: [
    view('Service Register', SVC_REG),
    view('Due Service', SVC_REG, { where: [`t.status = 'SCHEDULED'`], order: 't.due_date NULLS LAST, t.due_km NULLS LAST' }),
    view('Job Card', SVC_REG, { where: [`t.status IN ('SCHEDULED','IN_PROGRESS')`] }),
    view('Parts & Labor', ['Service Job No', 'Vehicle', 'Service Type', 'Due KM Date', 'Service Date', 'Odometer', 'Vendor Workshop', 'Status', 'Actions'], {
      panel: {
        title: 'Parts and labour lines',
        from: `vehicle_service_lines p JOIN vehicle_services ps ON ps.id = p.service_id LEFT JOIN items pi ON pi.id = p.item_id`,
        unit: 'ps.unit_id',
        soft: null,
        order: 'ps.service_date DESC NULLS LAST, ps.service_no DESC, p.line_type',
        cols: [
          ['#', `ps.service_no || ' / ' || p.line_type`, 'text'],
          ['Item / Service', `COALESCE(pi.name, p.description)`, 'text'],
          ['Description', 'p.description', 'text'],
          ['Qty', 'p.qty', 'num'],
          ['Rate', 'p.rate', 'inr'],
          ['Disc %', 'NULL', 'num'],
          ['Tax %', 'NULL', 'num'],
          ['Net', 'p.amount', 'inr'],
          ['Action', 'NULL', 'actions'],
        ],
      },
    }),
    view('Downtime', ['Service Job No', 'Vehicle', 'Service Type', 'Due KM Date', 'Service Date', 'Odometer', 'Vendor Workshop', 'Actions'], {
      panel: {
        title: 'Vehicle downtime for service',
        from: `vehicle_services p JOIN vehicles pv ON pv.id = p.vehicle_id`,
        unit: 'p.unit_id',
        soft: null,
        order: 'p.service_date DESC NULLS LAST, p.service_no DESC',
        cols: [
          ['Equipment', 'pv.reg_no', 'text'],
          ['Type', 'p.service_type', 'text'],
          ['Due / Start', 'COALESCE(p.service_date, p.due_date)', 'date'],
          ['Downtime', `p.downtime_hrs`, 'num'],
          ['Spare', `(SELECT count(*) FROM vehicle_service_lines l WHERE l.service_id = p.id AND l.line_type = 'PART')`, 'num'],
          ['Status', 'p.status', 'text'],
          ['Action', 'NULL', 'actions'],
        ],
      },
    }),
    view('Service Cost', ['Parts Cost', 'Labor Cost', 'Service Job No', 'Vehicle', 'Service Type', 'Due KM Date', 'Service Date', 'Status', 'Actions'], {
      order: 't.total_amount DESC NULLS LAST, t.service_no DESC',
    }),
  ],
};

const FDOC_REG = ['Document Ref', 'Vehicle', 'Document Type', 'Document No', 'Issue Date', 'Expiry Date', 'Authority', 'Status', 'Actions'];
const FDOCS: PageDef = {
  from: `vehicle_documents t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN vehicle_document_types dt ON dt.code = t.doc_type_code ${apJoin('fleet-documents')}`,
  unit: 'v.unit_id',
  soft: 'v.deleted_at',
  owner: 't.created_by_id',
  version: null,
  number: `t.doc_type_code || ' / ' || v.reg_no`,
  status: 't.status',
  search: ['v.reg_no', 't.doc_no', 'dt.name', 't.authority'],
  order: 't.expiry_date NULLS LAST, v.reg_no',
  cols: {
    'Document Ref': t(`t.doc_type_code || ' / ' || v.reg_no`),
    Vehicle: t('v.reg_no'),
    'Document Type': t('dt.name'),
    'Document No': t('t.doc_no'),
    'Issue Date': d('t.issue_date'),
    'Expiry Date': d('t.expiry_date'),
    Authority: t('t.authority'),
    Status: pill('t.status'),
    ...common('fleet-documents', `t.doc_type_code || ' / ' || v.reg_no`),
  },
  register: FDOC_REG,
  compact: FDOC_REG,
  views: [
    view('Document Register', FDOC_REG),
    view('Insurance', FDOC_REG, { where: [`t.doc_type_code = 'INS'`] }),
    view('Fitness', FDOC_REG, { where: [`t.doc_type_code = 'FIT'`] }),
    view('Permit', FDOC_REG, { where: [`t.doc_type_code = 'PERMIT'`] }),
    view('Pollution Certificate', FDOC_REG, { where: [`t.doc_type_code = 'PUC'`] }),
    view('Expiry Alerts', FDOC_REG, { where: [`t.expiry_date IS NOT NULL AND t.expiry_date < CURRENT_DATE + COALESCE(dt.alert_days, 30)`] }),
  ],
};

// ---------------------------------------------------------------------------------------------- gate passes
const GATE_FROM = (page: string): string => `gate_passes t LEFT JOIN suppliers gs ON gs.id = t.supplier_id LEFT JOIN customers gc ON gc.id = t.customer_id ${apJoin(page)}`;
const gMaterial = `(SELECT string_agg(COALESCE(i.name, l.description), ', ' ORDER BY l.id) FROM gate_pass_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.gate_pass_id = t.id)`;
const gQty = `(SELECT sum(l.qty) FROM gate_pass_lines l WHERE l.gate_pass_id = t.id)`;
const gateCols = (page: string): PageDef['cols'] => ({
  'Gate Pass No': t('t.pass_no'),
  'Pass No': t('t.pass_no'),
  Date: d('t.entry_at'),
  Vehicle: t('t.vehicle_no'),
  Driver: t('t.driver_name'),
  Vendor: t('COALESCE(gs.name, t.party_name)'),
  Customer: t('COALESCE(gc.name, t.party_name)'),
  Party: t('COALESCE(gs.name, gc.name, t.party_name)'),
  Material: t(gMaterial),
  Quantity: n(gQty),
  'PO GRN Ref': t(
    `(SELECT string_agg(DISTINCT COALESCE(po.number, g.number), ', ') FROM gate_pass_lines l LEFT JOIN purchase_orders po ON po.id = l.po_id LEFT JOIN goods_receipts g ON g.id = l.grn_id WHERE l.gate_pass_id = t.id)`,
  ),
  'Dispatch Ref': t(
    `COALESCE((SELECT string_agg(DISTINCT sd.number, ', ') FROM gate_pass_lines l JOIN sales_dispatches sd ON sd.id = l.dispatch_id WHERE l.gate_pass_id = t.id), t.challan_ref)`,
  ),
  'E Way Bill': t('t.eway_bill_no'),
  'Entry Time': tm('t.entry_at'),
  'Exit Time': tm('t.exit_at'),
  'Weigh In': n('t.weigh_in_kg'),
  'Weigh Out': n('t.weigh_out_kg'),
  'Security Check': none(),
  Purpose: t('t.purpose'),
  'Expected Return': d('t.expected_return_date'),
  'Returned Qty': n(`(SELECT sum(l.returned_qty) FROM gate_pass_lines l WHERE l.gate_pass_id = t.id)`),
  'Return Date': d(`(SELECT max(r.received_at) FROM gate_return_receipts r JOIN gate_pass_lines l ON l.id = r.out_line_id WHERE l.gate_pass_id = t.id)`),
  'Balance Qty': n(`(SELECT sum(l.balance_qty) FROM gate_pass_lines l WHERE l.gate_pass_id = t.id)`),
  'Authorized By': none(),
  Value: m(`(SELECT sum(l.value) FROM gate_pass_lines l WHERE l.gate_pass_id = t.id)`),
  Reason: t('t.purpose'),
  Status: pill('t.status'),
  ...common(page, 't.pass_no'),
});
const gateLines = (where: string[]): PanelDef => ({
  title: 'Material lines of the gate passes',
  from: `gate_pass_lines p JOIN gate_passes pg ON pg.id = p.gate_pass_id LEFT JOIN items pi ON pi.id = p.item_id`,
  unit: 'pg.unit_id',
  soft: 'pg.deleted_at',
  where,
  order: 'pg.entry_at DESC NULLS LAST, pg.pass_no DESC, p.id',
  cols: [
    ['#', `pg.pass_no || ' / ' || row_number() OVER (PARTITION BY p.gate_pass_id ORDER BY p.id)`, 'text'],
    ['Item / Service', `COALESCE(pi.name, p.description)`, 'text'],
    ['Description', 'p.description', 'text'],
    ['Qty', 'p.qty', 'num'],
    ['Rate', 'p.unit_rate', 'inr'],
    ['Disc %', 'NULL', 'num'],
    ['Tax %', 'NULL', 'num'],
    ['Net', 'p.value', 'inr'],
    ['Action', 'NULL', 'actions'],
  ],
});
const gateRules = (outward: boolean): PanelDef =>
  rulePanel(
    'Gate pass document validation',
    [
      { rule: 'Vehicle number recorded', pass: `COALESCE(t.vehicle_no, '') <> ''`, warn: 'false', fail: `COALESCE(t.vehicle_no, '') = ''` },
      { rule: 'Driver recorded', pass: `COALESCE(t.driver_name, '') <> ''`, warn: 'false', fail: `COALESCE(t.driver_name, '') = ''` },
      outward
        ? { rule: 'E-way bill present', pass: `t.eway_bill_no IS NOT NULL`, warn: `t.eway_bill_no IS NULL AND NOT t.is_challan`, fail: `t.eway_bill_no IS NULL AND t.is_challan` }
        : { rule: 'Challan reference present', pass: `COALESCE(t.challan_ref, '') <> ''`, warn: `COALESCE(t.challan_ref, '') = ''`, fail: 'false' },
      { rule: 'Weighment recorded', pass: `t.net_kg IS NOT NULL`, warn: `t.net_kg IS NULL`, fail: 'false' },
    ],
    'gate_passes t',
    `{SCOPE:t} AND ${outward ? `t.direction = 'OUT'` : `t.direction = 'IN'`}`,
  );
const GIN_REG = ['Gate Pass No', 'Date', 'Vehicle', 'Driver', 'Vendor', 'Material', 'Quantity', 'PO GRN Ref', 'Entry Time', 'Weigh In', 'Security Check', 'Exit Time', 'Docs', 'Actions', 'Status'];
const GIN_SHORT = ['Gate Pass No', 'Date', 'Vehicle', 'Driver', 'Vendor', 'Material', 'Quantity', 'Status', 'Actions'];
const GATE_IN: PageDef = {
  from: GATE_FROM('gate-in'),
  unit: 't.unit_id',
  soft: 't.deleted_at',
  base: [`t.direction = 'IN'`],
  number: 't.pass_no',
  status: 't.status',
  search: ['t.pass_no', 't.vehicle_no', 't.driver_name', 'gs.name', 't.party_name', 't.challan_ref'],
  order: 't.entry_at DESC NULLS LAST, t.pass_no DESC',
  cols: gateCols('gate-in'),
  register: GIN_REG,
  compact: GIN_SHORT,
  views: [
    view('Inward Pass Register', GIN_REG),
    view('Vehicle Entry', GIN_SHORT),
    view('Material Details', GIN_SHORT, { panel: gateLines([`pg.direction = 'IN'`]) }),
    view('Security Checks', GIN_SHORT, { panel: securityPanel('gate-in') }),
    view('Weighment', GIN_SHORT, { order: 't.net_kg DESC NULLS LAST, t.entry_at DESC NULLS LAST' }),
    view('Exit Closure', GIN_SHORT, { where: [`t.status IN ('INSIDE','EXITED','CLOSED')`], order: 't.exit_at DESC NULLS LAST, t.pass_no DESC' }),
  ],
};
const GOUT_REG = ['Gate Pass No', 'Date', 'Vehicle', 'Driver', 'Customer', 'Material', 'Quantity', 'Dispatch Ref', 'E Way Bill', 'Entry Time', 'Weigh Out', 'Exit Time', 'Docs', 'Actions', 'Status'];
const GOUT_SHORT = ['Gate Pass No', 'Date', 'Vehicle', 'Driver', 'Customer', 'Material', 'Quantity', 'Status', 'Actions'];
const GATE_OUT: PageDef = {
  from: GATE_FROM('gate-out'),
  unit: 't.unit_id',
  soft: 't.deleted_at',
  base: [`t.direction = 'OUT'`, `t.pass_type = 'OUTWARD_DISPATCH'`],
  number: 't.pass_no',
  status: 't.status',
  search: ['t.pass_no', 't.vehicle_no', 't.driver_name', 'gc.name', 't.party_name', 't.eway_bill_no'],
  order: 't.entry_at DESC NULLS LAST, t.pass_no DESC',
  cols: gateCols('gate-out'),
  register: GOUT_REG,
  compact: GOUT_SHORT,
  views: [
    view('Outward Pass Register', GOUT_REG),
    view('Vehicle Dispatch', GOUT_SHORT),
    view('Material Details', GOUT_SHORT, { panel: gateLines([`pg.direction = 'OUT'`, `pg.pass_type = 'OUTWARD_DISPATCH'`]) }),
    view('Security Checks', GOUT_SHORT, { panel: securityPanel('gate-out') }),
    view('Document Validation', GOUT_SHORT, { panel: gateRules(true) }),
    view('Exit Closure', GOUT_SHORT, { where: [`t.status IN ('INSIDE','EXITED','CLOSED')`], order: 't.exit_at DESC NULLS LAST, t.pass_no DESC' }),
  ],
};
const GRET_REG = ['Pass No', 'Date', 'Party', 'Material', 'Quantity', 'Purpose', 'Expected Return', 'Returned Qty', 'Return Date', 'Balance Qty', 'Authorized By', 'Status', 'Docs', 'Actions'];
const GRET_SHORT = ['Pass No', 'Date', 'Party', 'Material', 'Quantity', 'Purpose', 'Expected Return', 'Status', 'Actions'];
const OVERDUE = `(t.expected_return_date < CURRENT_DATE AND COALESCE((SELECT sum(l.balance_qty) FROM gate_pass_lines l WHERE l.gate_pass_id = t.id), 0) > 0)`;
const GATE_RETURN: PageDef = {
  from: GATE_FROM('gate-return'),
  unit: 't.unit_id',
  soft: 't.deleted_at',
  base: [`t.pass_type = 'RETURNABLE'`],
  number: 't.pass_no',
  status: 't.status',
  search: ['t.pass_no', 't.party_name', 'gs.name', 'gc.name', 't.purpose'],
  order: 't.entry_at DESC NULLS LAST, t.pass_no DESC',
  cols: gateCols('gate-return'),
  register: GRET_REG,
  compact: GRET_SHORT,
  views: [
    view('Returnable Pass Register', GRET_REG),
    view('Material Out', GRET_SHORT),
    view('Expected Return', GRET_SHORT, { order: 't.expected_return_date NULLS LAST, t.pass_no' }),
    view('Return Receipt', ['Date', 'Return Date', 'Balance Qty', 'Status', 'Pass No', 'Party', 'Material', 'Actions'], {
      panel: {
        title: 'Returns received against the passes',
        from: `gate_return_receipts p JOIN gate_pass_lines pl ON pl.id = p.out_line_id JOIN gate_passes pg ON pg.id = pl.gate_pass_id`,
        unit: 'pg.unit_id',
        soft: 'pg.deleted_at',
        order: 'p.received_at DESC',
        cols: [
          ['Reference', 'pg.pass_no', 'text'],
          ['Due', 'pg.expected_return_date', 'date'],
          ['Amount', 'pl.qty', 'num'],
          ['Allocated', 'p.qty', 'num'],
          ['Balance', 'pl.balance_qty', 'num'],
          ['Action', 'NULL', 'actions'],
        ],
      },
    }),
    view('Overdue Items', GRET_SHORT, { where: [OVERDUE], order: 't.expected_return_date, t.pass_no' }),
    view('Pass History', GRET_SHORT, { audit: true }),
  ],
};
const GNR_REG = ['Pass No', 'Date', 'Party', 'Material', 'Quantity', 'Value', 'Reason', 'Status', 'Actions'];
const GATE_NONRETURN: PageDef = {
  from: GATE_FROM('gate-nonreturn'),
  unit: 't.unit_id',
  soft: 't.deleted_at',
  base: [`t.pass_type = 'NON_RETURNABLE'`],
  number: 't.pass_no',
  status: 't.status',
  search: ['t.pass_no', 't.party_name', 'gs.name', 'gc.name', 't.purpose'],
  order: 't.entry_at DESC NULLS LAST, t.pass_no DESC',
  cols: gateCols('gate-nonreturn'),
  register: GNR_REG,
  compact: GNR_REG,
  views: [
    view('Non-Returnable Register', GNR_REG),
    view('Material Out', GNR_REG),
    view('Authorization', GNR_REG, { order: `(t.approval_status = 'PENDING') DESC, t.entry_at DESC NULLS LAST` }),
    view('Value & Reason', ['Value', 'Pass No', 'Date', 'Party', 'Material', 'Quantity', 'Reason', 'Status', 'Actions'], {
      order: `(SELECT sum(l.value) FROM gate_pass_lines l WHERE l.gate_pass_id = t.id) DESC NULLS LAST`,
    }),
    view('Security Exit', GNR_REG, { order: 't.exit_at DESC NULLS LAST, t.pass_no DESC' }),
    view('Pass Audit', GNR_REG, { audit: true }),
  ],
};

export const LOGISTICS_V40_PAGES: Record<string, PageDef> = {
  'log-shipments': SHIPMENTS,
  'log-tracking': TRACKING,
  'log-freight': FREIGHT,
  'log-routes': ROUTES,
  'log-transporters': TRANSPORTERS,
  'log-pod': PODS,
  'container-track': CONTAINERS,
  'fleet-vehicles': VEHICLES,
  'fleet-drivers': DRIVERS,
  'fleet-fuel': FUEL,
  'fleet-service': SERVICE,
  'fleet-documents': FDOCS,
  'gate-in': GATE_IN,
  'gate-out': GATE_OUT,
  'gate-return': GATE_RETURN,
  'gate-nonreturn': GATE_NONRETURN,
};
