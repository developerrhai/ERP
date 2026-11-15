// V40 tab views of the Maintenance pages. GET /maint/v40/:pageId?tab=<V40 tab name>: the columns V40 shows on each tab with values read
// from the real tables (assets, PM plans and schedules, breakdown tickets, maintenance work orders, downtime events, alerts, spare items).
// MTBF / MTTR come from the logged unplanned downtime of the last 365 days. Same engine and rules as the Sales views: a label with no real
// source returns NULL (a dash on screen) and is listed by noSourceColumns(); nothing is invented.
import { ACTIONS, DOCS, apJoin, approvalCols, d, m, n, none, t } from '../sales/v40-views';
import type { PageDef, PanelDef, ViewDef } from '../sales/v40-views';

const V = (re: string, labels: string[], extra: Partial<ViewDef> = {}): ViewDef => ({
  match: new RegExp(`^(${re})$`, 'i'),
  labels,
  ...extra,
});
const pill = (e: string) => ({ e, type: 'pill' as const });

/** V40's "Equipment / Type / Due-Start / Downtime / Spare / Status / Action" strip: the open maintenance work of the unit. */
const queuePanel: PanelDef = {
  title: 'Maintenance queue',
  from: `(SELECT a.asset_no || ' · ' || a.name AS equipment, 'Preventive' AS typ, s.due_date::text AS due, NULL::numeric AS down_min,
      (SELECT count(*) FROM pm_plan_spares ps WHERE ps.plan_id=s.plan_id) AS spares, s.status AS st,
      CASE WHEN s.status='PLANNED' THEN 'Create work order' END AS act, s.due_date AS sort_on
    FROM pm_schedules s JOIN pm_plans pp ON pp.id=s.plan_id JOIN assets a ON a.id=pp.asset_id
    WHERE s.status IN ('PLANNED','WO_CREATED') AND {SCOPE:s:nosoft} AND {SCOPE:a}
   UNION ALL
   SELECT a.asset_no || ' · ' || a.name, 'Breakdown', to_char(b.reported_at,'YYYY-MM-DD'),
      round(EXTRACT(EPOCH FROM (COALESCE(b.repaired_at, now()) - b.reported_at))/60),
      (SELECT count(*) FROM mwo_spares ms WHERE ms.wo_id=b.wo_id), b.status,
      CASE WHEN b.status='OPEN' THEN 'Acknowledge' END, b.reported_at::date
    FROM breakdown_tickets b JOIN assets a ON a.id=b.asset_id
    WHERE b.status IN ('OPEN','ACK','IN_REPAIR') AND {SCOPE:b} AND {SCOPE:a}) p`,
  unit: null,
  soft: null,
  order: 'p.sort_on, p.equipment',
  cols: [
    ['Equipment', 'p.equipment', 'text'],
    ['Type', 'p.typ', 'text'],
    ['Due / Start', 'p.due', 'text'],
    ['Downtime', 'p.down_min', 'num'],
    ['Spare', 'p.spares', 'num'],
    ['Status', 'p.st', 'text'],
    ['Action', 'p.act', 'actions'],
  ],
};

const TECH_OF_WO = (wo: string): string =>
  `(SELECT u.name FROM mwo_labour l JOIN users u ON u.id=l.employee_id WHERE l.wo_id=${wo} ORDER BY l.start_at NULLS LAST LIMIT 1)`;
const WO_COST = (wo: string): string =>
  `(COALESCE((SELECT sum(s.amount) FROM mwo_spares s WHERE s.wo_id=${wo}),0) + COALESCE((SELECT sum(l.amount) FROM mwo_labour l WHERE l.wo_id=${wo}),0) + COALESCE((SELECT sum(v.amount) FROM mwo_vendor_charges v WHERE v.wo_id=${wo}),0))`;
const LAST_WO = (col: string): string =>
  `(SELECT w.${col} FROM maint_work_orders w WHERE w.asset_id=t.id AND w.status IN ('COMPLETED','CLOSED') AND w.deleted_at IS NULL ORDER BY w.actual_end DESC NULLS LAST LIMIT 1)`;

// ------------------------------------------------------------------------------------------------ Machines and equipment (assets)
const ASSET_COLS = (page: string): PageDef['cols'] => ({
  'Machine Code': t('t.asset_no'),
  'Machine Name': t('t.name'),
  'Equipment Code': t('t.asset_no'),
  'Equipment Name': t('t.name'),
  'Parent Asset': t(`(SELECT pa.asset_no FROM assets pa WHERE pa.id=t.parent_asset_id)`),
  Department: t('t.department'),
  Location: t('t.location'),
  Criticality: t('t.criticality'),
  Make: t('t.make'),
  Model: t('t.model'),
  'Serial No': t('t.serial_no'),
  Commissioned: d('t.commission_date'),
  'Warranty End': d('t.warranty_end'),
  Owner: t(`(SELECT cc.name FROM cost_centers cc WHERE cc.id=t.cost_centre_id)`),
  'Work Orders Done': n(
    `(SELECT count(*) FROM maint_work_orders w WHERE w.asset_id=t.id AND w.status IN ('COMPLETED','CLOSED') AND w.deleted_at IS NULL)`,
  ),
  'Last Service': d(LAST_WO('actual_end')),
  'Last Service Type': t(LAST_WO('wo_type')),
  'Open Breakdowns': n(
    `(SELECT count(*) FROM breakdown_tickets b WHERE b.asset_id=t.id AND b.status IN ('OPEN','ACK','IN_REPAIR') AND b.deleted_at IS NULL)`,
  ),
  'Latest Meter Reading': t(
    `(SELECT r.value::text || ' ' || mt.uom FROM meters mt JOIN meter_readings r ON r.meter_id=mt.id WHERE mt.asset_id=t.id ORDER BY r.reading_at DESC LIMIT 1)`,
  ),
  'Maintenance Cost': m(
    `COALESCE((SELECT sum(${WO_COST('w.id')}) FROM maint_work_orders w WHERE w.asset_id=t.id AND w.status IN ('COMPLETED','CLOSED') AND w.deleted_at IS NULL),0)`,
  ),
  Status: pill('t.status'),
  ...approvalCols('t.asset_no'),
  Docs: DOCS(page),
  Actions: ACTIONS,
});
const assetPage = (
  page: string,
  kind: string,
  register: string[],
  views: ViewDef[],
): PageDef => ({
  from: `assets t ${apJoin(page)}`,
  base: [`t.asset_kind='${kind}'`],
  number: 't.asset_no',
  status: 't.status',
  search: ['t.asset_no', 't.name', 't.make', 't.model', 't.serial_no', 't.location'],
  order: 't.asset_no',
  cols: ASSET_COLS(page),
  register,
  compact: register,
  views,
});
const MC = ['Machine Code', 'Machine Name', 'Department', 'Location', 'Make', 'Model', 'Serial No', 'Status', 'Actions'];
const MACHINES = assetPage('maint-machines', 'MACHINE', MC, [
  V('technical specifications', [...MC.slice(0, 2), 'Make', 'Model', 'Serial No', 'Commissioned', 'Warranty End', 'Latest Meter Reading', 'Status', 'Actions']),
  V('location & ownership', [...MC.slice(0, 4), 'Owner', 'Criticality', 'Status', 'Actions']),
  V('service history', [...MC.slice(0, 2), 'Work Orders Done', 'Last Service', 'Last Service Type', 'Maintenance Cost', 'Status', 'Actions']),
  V('machine health', [...MC.slice(0, 2), 'Criticality', 'Open Breakdowns', 'Last Service', 'Status', 'Actions']),
]);
const EQ = ['Equipment Code', 'Equipment Name', 'Parent Asset', 'Department', 'Location', 'Criticality', 'Make', 'Status', 'Actions'];
const EQUIPMENT = assetPage('maint-equipment', 'EQUIPMENT', EQ, [
  V('criticality', [...EQ.slice(0, 2), 'Criticality', 'Department', 'Open Breakdowns', 'Status', 'Actions']),
  V('component hierarchy', EQ, { where: ['(t.parent_asset_id IS NOT NULL OR t.is_component)'] }),
  V('operating parameters', [...EQ.slice(0, 2), 'Make', 'Model', 'Latest Meter Reading', 'Status', 'Actions']),
  V('maintenance history', [...EQ.slice(0, 2), 'Work Orders Done', 'Last Service', 'Last Service Type', 'Status', 'Actions']),
  V('lifecycle cost', [...EQ.slice(0, 2), 'Commissioned', 'Maintenance Cost', 'Status', 'Actions']),
]);

// ------------------------------------------------------------------------------------------------ Preventive maintenance plans
const NEXT_DUE = `(SELECT min(s.due_date) FROM pm_schedules s WHERE s.plan_id=t.id AND s.status IN ('PLANNED','WO_CREATED'))`;
const PM_C = ['PM Plan No', 'Machine', 'Frequency', 'Checklist', 'Last Done', 'Next Due', 'Estimated Hrs', 'Status', 'Actions'];
const PM_DONE = `(SELECT count(*) FROM pm_schedules s JOIN maint_work_orders w ON w.id=s.wo_id WHERE s.plan_id=t.id AND w.status IN ('COMPLETED','CLOSED'))`;
const PM_DUE_SO_FAR = `(SELECT count(*) FROM pm_schedules s WHERE s.plan_id=t.id AND s.due_date <= current_date AND s.status <> 'SKIPPED')`;
const PREVENTIVE: PageDef = {
  from: `pm_plans t JOIN assets a ON a.id=t.asset_id LEFT JOIN checklist_templates ct ON ct.id=t.checklist_template_id ${apJoin('maint-preventive')}`,
  number: 't.plan_no',
  status: `CASE WHEN t.active THEN 'Active' ELSE 'Inactive' END`,
  search: ['t.plan_no', 't.title', 'a.asset_no', 'a.name'],
  order: 't.plan_no',
  cols: {
    'PM Plan No': t('t.plan_no'),
    Title: t('t.title'),
    Machine: t(`a.asset_no || ' · ' || a.name`),
    Frequency: t(
      `CASE t.trigger_type WHEN 'METER' THEN 'Every ' || trim(trailing '.' from trim(trailing '0' from t.interval_meter::text)) || ' (meter)' ELSE 'Every ' || t.interval_days || ' days' END`,
    ),
    Checklist: t('ct.name'),
    'Last Done': d('t.last_done_on'),
    'Next Due': d(NEXT_DUE),
    'Estimated Hrs': n('t.est_hours'),
    'Spares Planned': n(`(SELECT count(*) FROM pm_plan_spares ps WHERE ps.plan_id=t.id)`),
    'Schedules Done': n(PM_DONE),
    'Schedules Due': n(PM_DUE_SO_FAR),
    'Compliance %': n(`round(100 * ${PM_DONE}::numeric / NULLIF(${PM_DUE_SO_FAR},0), 1)`),
    Status: pill(`CASE WHEN t.active THEN 'Active' ELSE 'Inactive' END`),
    ...approvalCols('t.plan_no'),
    Docs: DOCS('maint-preventive'),
    Actions: ACTIONS,
  },
  register: PM_C,
  compact: PM_C,
  views: [
    V('maintenance plans', [...PM_C.slice(0, 3), 'Title', 'Estimated Hrs', 'Status', 'Actions']),
    V('due work', PM_C, { where: [`${NEXT_DUE} <= current_date + COALESCE(t.lead_days,0)`], order: `${NEXT_DUE}, t.plan_no` }),
    V('checklist execution', [...PM_C.slice(0, 5), 'Schedules Done', 'Status', 'Actions']),
    V('spare planning', [...PM_C.slice(0, 3), 'Spares Planned', 'Next Due', 'Status', 'Actions']),
    V('pm compliance', [...PM_C.slice(0, 3), 'Schedules Due', 'Schedules Done', 'Compliance %', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Maintenance schedule (PM schedules)
const SC_C = ['Schedule Ref', 'Period', 'Machine', 'Maintenance Type', 'Planned Date', 'Duration Hrs', 'Technician', 'Status', 'Actions'];
const SCHEDULE: PageDef = {
  from: `pm_schedules t JOIN pm_plans pp ON pp.id=t.plan_id JOIN assets a ON a.id=pp.asset_id LEFT JOIN maint_work_orders w ON w.id=t.wo_id ${apJoin('maint-schedule')}`,
  soft: null,
  owner: null,
  version: null,
  number: `pp.plan_no || '/' || to_char(t.due_date,'YYYYMMDD')`,
  status: 't.status',
  search: ['pp.plan_no', 'pp.title', 'a.asset_no', 'a.name'],
  order: 't.due_date, pp.plan_no',
  cols: {
    'Schedule Ref': t(`pp.plan_no || '/' || to_char(t.due_date,'YYYYMMDD')`),
    Period: t(`to_char(t.due_date,'Mon YYYY')`),
    Machine: t(`a.asset_no || ' · ' || a.name`),
    'Maintenance Type': t(`COALESCE(w.wo_type, 'PM')`),
    'Planned Date': d('t.due_date'),
    'Duration Hrs': n('pp.est_hours'),
    Technician: t(TECH_OF_WO('t.wo_id')),
    'Work Order': t('w.mwo_no'),
    'Work Order Status': t('w.status'),
    'Completed On': d('w.actual_end'),
    'On Time': t(
      `CASE WHEN w.actual_end IS NULL THEN CASE WHEN t.due_date < current_date AND t.status <> 'SKIPPED' THEN 'Overdue' END WHEN w.actual_end::date <= t.due_date THEN 'On time' ELSE 'Late' END`,
    ),
    Status: pill('t.status'),
    ...approvalCols(`pp.plan_no`),
    Docs: DOCS('maint-schedule'),
    Actions: ACTIONS,
  },
  register: SC_C,
  compact: SC_C,
  views: [
    V('weekly plan', SC_C, { where: [`t.due_date >= date_trunc('week', current_date)::date`, `t.due_date < date_trunc('week', current_date)::date + 7`] }),
    V('monthly plan', SC_C, { where: [`t.due_date >= date_trunc('month', current_date)::date`, `t.due_date < date_trunc('month', current_date)::date + interval '1 month'`] }),
    V('resource loading', [...SC_C.slice(0, 3), 'Duration Hrs', 'Technician', 'Planned Date', 'Status', 'Actions']),
    V('shutdown plan', [...SC_C.slice(0, 3), 'Planned Date', 'Duration Hrs', 'Status', 'Actions'], {
      where: [`a.criticality = 'A'`],
    }),
    V('schedule compliance', [...SC_C.slice(0, 3), 'Planned Date', 'Completed On', 'On Time', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Breakdowns
const BD_C = ['Breakdown No', 'Machine', 'Reported At', 'Reported By', 'Failure Symptom', 'Priority', 'Technician', 'Status', 'Actions'];
const BREAKDOWN: PageDef = {
  from: `breakdown_tickets t JOIN assets a ON a.id=t.asset_id LEFT JOIN users rb ON rb.id=t.reported_by_id LEFT JOIN maint_work_orders w ON w.id=t.wo_id ${apJoin('maint-breakdown')}`,
  number: 't.bd_no',
  status: 't.status',
  search: ['t.bd_no', 'a.asset_no', 'a.name', 't.symptom', 'w.mwo_no'],
  order: 't.reported_at DESC',
  cols: {
    'Breakdown No': t('t.bd_no'),
    Machine: t(`a.asset_no || ' · ' || a.name`),
    'Reported At': t(`to_char(t.reported_at,'YYYY-MM-DD HH24:MI')`),
    'Reported By': t('rb.name'),
    'Failure Symptom': t('t.symptom'),
    Priority: t('t.priority'),
    Technician: t(TECH_OF_WO('t.wo_id')),
    'Machine Stopped': t(`CASE WHEN t.machine_stopped THEN 'Yes' ELSE 'No' END`),
    'Failure Mode': t('t.failure_mode'),
    'Failure Cause': t('t.failure_cause'),
    'Failure Mechanism': t('t.failure_mechanism'),
    'Acknowledged At': t(`to_char(t.acknowledged_at,'YYYY-MM-DD HH24:MI')`),
    'Repair Started': t(`to_char(t.repair_started_at,'YYYY-MM-DD HH24:MI')`),
    'Repaired At': t(`to_char(t.repaired_at,'YYYY-MM-DD HH24:MI')`),
    'Response Minutes': n(`round(EXTRACT(EPOCH FROM (t.acknowledged_at - t.reported_at))/60)`),
    'Repair Minutes': n(`round(EXTRACT(EPOCH FROM (t.repaired_at - t.repair_started_at))/60)`),
    'Work Order': t('w.mwo_no'),
    'Work Order Status': t('w.status'),
    'Root Cause': t('t.root_cause'),
    'Spare Cost': m(`COALESCE((SELECT sum(s.amount) FROM mwo_spares s WHERE s.wo_id=t.wo_id),0)`),
    'Labour Cost': m(`COALESCE((SELECT sum(l.amount) FROM mwo_labour l WHERE l.wo_id=t.wo_id),0)`),
    'Vendor Cost': m(`COALESCE((SELECT sum(v.amount) FROM mwo_vendor_charges v WHERE v.wo_id=t.wo_id),0)`),
    'Total Cost': m(WO_COST('t.wo_id')),
    Status: pill('t.status'),
    ...approvalCols('t.bd_no'),
    Docs: DOCS('maint-breakdown'),
    Actions: ACTIONS,
  },
  register: BD_C,
  compact: BD_C,
  views: [
    V('failure details', [...BD_C.slice(0, 2), 'Failure Symptom', 'Failure Mode', 'Failure Cause', 'Failure Mechanism', 'Machine Stopped', 'Status', 'Actions']),
    V('response timeline', [...BD_C.slice(0, 3), 'Acknowledged At', 'Repair Started', 'Repaired At', 'Response Minutes', 'Status', 'Actions']),
    V('repair actions', [...BD_C.slice(0, 2), 'Work Order', 'Work Order Status', 'Technician', 'Repair Minutes', 'Status', 'Actions']),
    V('root cause', [...BD_C.slice(0, 2), 'Root Cause', 'Failure Cause', 'Priority', 'Status', 'Actions']),
    V('breakdown cost', [...BD_C.slice(0, 2), 'Spare Cost', 'Labour Cost', 'Vendor Cost', 'Total Cost', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Maintenance work orders
const WO_C = ['MWO No', 'Machine', 'Job Description', 'Priority', 'Technician', 'Planned Start', 'Status', 'Actions'];
const partsPanel: PanelDef = {
  title: 'Parts and tools of the work orders',
  from: 'mwo_spares p JOIN maint_work_orders w ON w.id=p.wo_id LEFT JOIN items pi ON pi.id=p.item_id',
  unit: 'w.unit_id',
  soft: 'w.deleted_at',
  order: 'w.created_at DESC, pi.code',
  cols: [
    ['MWO No', 'w.mwo_no', 'text'],
    ['Item / Service', `pi.code || ' · ' || pi.name`, 'text'],
    ['Qty', 'p.required_qty', 'num'],
    ['Issued', 'p.issued_qty', 'num'],
    ['Rate', 'p.rate', 'inr'],
    ['Net', 'p.amount', 'inr'],
  ],
};
const MWO: PageDef = {
  from: `maint_work_orders t JOIN assets a ON a.id=t.asset_id ${apJoin('maint-workorders')}`,
  number: 't.mwo_no',
  status: 't.status',
  search: ['t.mwo_no', 'a.asset_no', 'a.name', 't.description'],
  order: 't.created_at DESC',
  cols: {
    'MWO No': t('t.mwo_no'),
    Type: t('t.wo_type'),
    Machine: t(`a.asset_no || ' · ' || a.name`),
    'Job Description': t('t.description'),
    Priority: t('t.priority'),
    Technician: t(TECH_OF_WO('t.id')),
    'Planned Start': t(`to_char(t.planned_start,'YYYY-MM-DD HH24:MI')`),
    'Planned End': t(`to_char(t.planned_end,'YYYY-MM-DD HH24:MI')`),
    'Actual Start': t(`to_char(t.actual_start,'YYYY-MM-DD HH24:MI')`),
    'Actual End': t(`to_char(t.actual_end,'YYYY-MM-DD HH24:MI')`),
    Tasks: n(`(SELECT count(*) FROM mwo_tasks k WHERE k.wo_id=t.id)`),
    'Tasks Done': n(`(SELECT count(*) FROM mwo_tasks k WHERE k.wo_id=t.id AND k.done_at IS NOT NULL)`),
    'Estimated Cost': m('t.est_cost'),
    'Actual Cost': m(WO_COST('t.id')),
    'Signed Off': t(`to_char(t.sign_off_at,'YYYY-MM-DD HH24:MI')`),
    'Approval': t('t.approval_status'),
    Status: pill('t.status'),
    ...approvalCols('t.mwo_no'),
    Docs: DOCS('maint-workorders'),
    Actions: ACTIONS,
  },
  register: WO_C,
  compact: WO_C,
  views: [
    V('job plan', [...WO_C.slice(0, 4), 'Tasks', 'Tasks Done', 'Planned Start', 'Status', 'Actions']),
    V('technician assignment', WO_C),
    V('parts & tools', [...WO_C.slice(0, 3), 'Type', 'Priority', 'Technician', 'Planned Start', 'Status', 'Actions'], { panel: partsPanel }),
    V('completion & signoff', [...WO_C.slice(0, 3), 'Actual Start', 'Actual End', 'Signed Off', 'Status', 'Actions']),
    V('work order kpi', ['Planned Start', 'Status', 'MWO No', 'Type', 'Machine', 'Job Description', 'Priority', 'Estimated Cost', 'Actual Cost', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Downtime
const DT_C = ['Downtime No', 'Machine', 'Start Time', 'End Time', 'Duration Min', 'Reason', 'Status', 'Actions'];
const DT_STATUS = `CASE WHEN t.end_at IS NULL THEN 'Open' ELSE 'Closed' END`;
const paretoPanel = (title: string, group: string, label: string): PanelDef => ({
  title,
  from: `(SELECT ${group} AS grp, count(*) AS n, COALESCE(sum(x.duration_min),0) AS mins, COALESCE(sum(x.lost_qty),0) AS lost FROM downtime_events x WHERE {SCOPE:x} GROUP BY 1) p`,
  unit: null,
  soft: null,
  order: 'p.mins DESC NULLS LAST, p.grp',
  cols: [
    [label, `COALESCE(p.grp,'(no reason)')`, 'text'],
    ['Events', 'p.n', 'num'],
    ['Minutes', 'p.mins', 'num'],
    ['Lost Qty', 'p.lost', 'num'],
  ],
});
const DOWNTIME: PageDef = {
  from: `downtime_events t JOIN assets a ON a.id=t.asset_id LEFT JOIN mfg_orders po ON po.id=t.production_order_id ${apJoin('maint-downtime')}`,
  version: null,
  number: 't.dt_no',
  status: DT_STATUS,
  search: ['t.dt_no', 'a.asset_no', 'a.name', 't.reason', 'po.number'],
  order: 't.start_at DESC',
  cols: {
    'Downtime No': t('t.dt_no'),
    Machine: t(`a.asset_no || ' · ' || a.name`),
    'Start Time': t(`to_char(t.start_at,'YYYY-MM-DD HH24:MI')`),
    'End Time': t(`to_char(t.end_at,'YYYY-MM-DD HH24:MI')`),
    'Duration Min': n('t.duration_min'),
    Reason: t('t.reason'),
    Type: t(`CASE t.dt_type WHEN 'PLANNED' THEN 'Planned' WHEN 'UNPLANNED' THEN 'Unplanned' ELSE t.dt_type END`),
    'Production Order': t('po.number'),
    'Lost Qty': n('t.lost_qty'),
    'Cost Impact': m('t.cost_impact'),
    Status: pill(DT_STATUS),
    ...approvalCols('t.dt_no'),
    Docs: DOCS('maint-downtime'),
    Actions: ACTIONS,
  },
  register: DT_C,
  compact: DT_C,
  views: [
    V('planned downtime', DT_C, { where: [`t.dt_type='PLANNED'`] }),
    V('unplanned downtime', DT_C, { where: [`t.dt_type='UNPLANNED'`] }),
    V('reason pareto', DT_C, { panel: paretoPanel('Downtime by reason', 'x.reason', 'Reason') }),
    V('production loss', ['Start Time', 'Production Order', 'Lost Qty', 'Status', 'Downtime No', 'Machine', 'End Time', 'Cost Impact', 'Actions'], {
      where: ['(t.production_order_id IS NOT NULL OR t.lost_qty > 0)'],
    }),
    V('downtime trend', DT_C, { panel: paretoPanel('Downtime by month', `to_char(x.start_at,'YYYY-MM')`, 'Month') }),
  ],
};

// ------------------------------------------------------------------------------------------------ MTBF / MTTR (per maintainable asset, last 365 days)
const EV = (cond: string): string =>
  `(SELECT COALESCE(sum(e.duration_min),0) FROM downtime_events e WHERE e.asset_id=t.id AND e.deleted_at IS NULL AND e.start_at >= current_date - 365 ${cond})`;
const FAILS = `(SELECT count(*) FROM downtime_events e WHERE e.asset_id=t.id AND e.deleted_at IS NULL AND e.dt_type='UNPLANNED' AND e.end_at IS NOT NULL AND e.start_at >= current_date - 365)`;
const OPER_H = `((365 * 1440 - ${EV('')}) / 60)`;
const MT_C = ['Machine', 'Period', 'Operating Hours', 'Failures', 'MTBF Hrs', 'Repair Hours', 'MTTR Hrs', 'Actions'];
const MTBF: PageDef = {
  from: `assets t ${apJoin('maint-mtbf')}`,
  base: ['t.is_maintainable', `t.status <> 'DISPOSED'`],
  number: 't.asset_no',
  status: 't.criticality',
  search: ['t.asset_no', 't.name'],
  order: 't.asset_no',
  cols: {
    Machine: t(`t.asset_no || ' · ' || t.name`),
    Period: t(`'Last 365 days'`),
    'Operating Hours': n(`round(${OPER_H}, 1)`),
    Failures: n(FAILS),
    'MTBF Hrs': n(`round(${OPER_H} / NULLIF(${FAILS},0), 2)`),
    'Repair Hours': n(`round(${EV(`AND e.dt_type='UNPLANNED'`)} / 60, 2)`),
    'MTTR Hrs': n(`round(${EV(`AND e.dt_type='UNPLANNED'`)} / 60 / NULLIF(${FAILS},0), 2)`),
    'Availability %': n(`round(100 * (365 * 1440 - ${EV('')}) / (365 * 1440), 2)`),
    Criticality: t('t.criticality'),
    'Open Breakdowns': n(
      `(SELECT count(*) FROM breakdown_tickets b WHERE b.asset_id=t.id AND b.status IN ('OPEN','ACK','IN_REPAIR') AND b.deleted_at IS NULL)`,
    ),
    Status: pill('t.criticality'),
    ...approvalCols('t.asset_no'),
    Docs: DOCS('maint-mtbf'),
    Actions: ACTIONS,
  },
  register: MT_C,
  compact: MT_C,
  views: [
    V('mtbf by asset', [...MT_C.slice(0, 5), 'Availability %', 'Actions']),
    V('mttr by asset', [...MT_C.slice(0, 2), 'Failures', 'Repair Hours', 'MTTR Hrs', 'Actions']),
    V('failure frequency', [...MT_C.slice(0, 2), 'Failures', 'Open Breakdowns', 'Criticality', 'Actions'], {
      order: `${FAILS} DESC, t.asset_no`,
    }),
    V('reliability trend', MT_C),
    V('improvement actions', [...MT_C.slice(0, 2), 'Failures', 'MTBF Hrs', 'MTTR Hrs', 'Open Breakdowns', 'Actions'], {
      where: [`${FAILS} > 0`],
    }),
  ],
};

// ------------------------------------------------------------------------------------------------ Spares (items of type Spare Part)
const ONH = `(SELECT COALESCE(sum(b.on_hand),0) FROM stock_balances b WHERE b.item_id=t.id)`;
const RSV = `(SELECT COALESCE(sum(b.reserved_qty),0) FROM stock_balances b WHERE b.item_id=t.id)`;
const SP_C = ['Spare Code', 'Spare Name', 'Machine Category', 'Warehouse', 'On Hand', 'Reserved', 'Reorder Level', 'Status', 'Actions'];
const spareAvail: PanelDef = {
  title: 'Open work-order demand against stock',
  from: `mwo_spares p JOIN maint_work_orders w ON w.id=p.wo_id LEFT JOIN items pi ON pi.id=p.item_id`,
  unit: 'w.unit_id',
  soft: 'w.deleted_at',
  where: [`w.status NOT IN ('COMPLETED','CLOSED','CANCELLED')`, 'p.required_qty > p.issued_qty'],
  order: 'w.created_at DESC, pi.code',
  cols: [
    ['Record', `w.mwo_no || ' · ' || pi.code`, 'text'],
    ['Demand', 'p.required_qty - p.issued_qty + p.returned_qty', 'num'],
    ['Available', `(SELECT COALESCE(sum(b.on_hand),0) FROM stock_balances b WHERE b.item_id=p.item_id)`, 'num'],
    ['Allocated', 'p.reserved_qty', 'num'],
    ['Short', `GREATEST(p.required_qty - p.issued_qty + p.returned_qty - (SELECT COALESCE(sum(b.on_hand),0) FROM stock_balances b WHERE b.item_id=p.item_id), 0)`, 'num'],
    ['Location', `(SELECT wh.code FROM stock_balances b JOIN warehouses wh ON wh.id=b.warehouse_id WHERE b.item_id=p.item_id AND b.on_hand>0 ORDER BY b.on_hand DESC LIMIT 1)`, 'text'],
  ],
};
const SPARES: PageDef = {
  from: `items t ${apJoin('maint-spares')}`,
  unit: null,
  owner: 't.created_by_id',
  base: [`t.item_type='Spare Part'`],
  number: 't.code',
  status: 't.status::text',
  search: ['t.code', 't.name', 't.category'],
  order: 't.code',
  cols: {
    'Spare Code': t('t.code'),
    'Spare Name': t('t.name'),
    'Machine Category': t('t.category'),
    Warehouse: t(
      `(SELECT wh.name FROM stock_balances b JOIN warehouses wh ON wh.id=b.warehouse_id WHERE b.item_id=t.id AND b.on_hand>0 ORDER BY b.on_hand DESC LIMIT 1)`,
    ),
    'On Hand': n(ONH),
    Reserved: n(RSV),
    'Reorder Level': n('t.reorder_level'),
    'Lead Time': t(
      `(SELECT ip.lead_time_days || ' days' FROM mfg_item_planning ip WHERE ip.item_id=t.id)`,
    ),
    'Unit Cost': m('t.standard_cost'),
    'Stock Value': m(`${ONH} * t.standard_cost`),
    'Issued to Work Orders': n(
      `(SELECT COALESCE(sum(s.issued_qty - s.returned_qty),0) FROM mwo_spares s WHERE s.item_id=t.id)`,
    ),
    Short: n(`GREATEST(t.reorder_level - ${ONH}, 0)`),
    Status: pill('t.status::text'),
    ...approvalCols('t.code'),
    Docs: DOCS('maint-spares'),
    Actions: ACTIONS,
  },
  register: SP_C,
  compact: SP_C,
  views: [
    V('stock availability', ['Spare Code', 'Spare Name', 'Machine Category', 'On Hand', 'Reserved', 'Status', 'Actions'], { panel: spareAvail }),
    V('critical spares', [...SP_C.slice(0, 3), 'On Hand', 'Reorder Level', 'Short', 'Status', 'Actions'], {
      where: [`${ONH} <= t.reorder_level`],
    }),
    V('consumption history', [...SP_C.slice(0, 3), 'Issued to Work Orders', 'On Hand', 'Status', 'Actions']),
    V('reorder planning', [...SP_C.slice(0, 3), 'Reorder Level', 'Lead Time', 'Warehouse', 'Short', 'Actions']),
    V('spare cost', ['Unit Cost', ...SP_C.slice(0, 3), 'Warehouse', 'On Hand', 'Reserved', 'Stock Value', 'Status', 'Actions']),
  ],
};

// ------------------------------------------------------------------------------------------------ Alerts
const AL_C = ['Alert No', 'Alert Type', 'Asset', 'Due Date', 'Days Remaining', 'Owner', 'Escalation Level', 'Status', 'Actions'];
const ALERT_TYPE = `CASE ar.alert_type WHEN 'PM_DUE' THEN 'PM due' WHEN 'PM_OVERDUE' THEN 'PM overdue' WHEN 'BREAKDOWN_UNACK' THEN 'Breakdown not acknowledged' WHEN 'WARRANTY_EXPIRY' THEN 'Warranty expiry' WHEN 'SPARE_LOW' THEN 'Spare low' WHEN 'LOAN_RETURN_DUE' THEN 'Loan return due' ELSE ar.alert_type END`;
const ALERTS: PageDef = {
  from: `alerts t JOIN alert_rules ar ON ar.id=t.rule_id LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN users ak ON ak.id=t.acknowledged_by_id ${apJoin('maint-alerts')}`,
  soft: null,
  owner: null,
  version: null,
  number: `'AL-' || upper(left(t.id::text,8))`,
  status: 't.status',
  search: ['a.asset_no', 'a.name', 't.message', 'ar.alert_type'],
  order: 't.due_at NULLS LAST, t.created_at DESC',
  cols: {
    'Alert No': t(`'AL-' || upper(left(t.id::text,8))`),
    'Alert Type': t(ALERT_TYPE),
    Asset: t(`a.asset_no || ' · ' || a.name`),
    'Due Date': d('t.due_at'),
    'Days Remaining': n('t.due_at::date - current_date'),
    Owner: t('ak.name'),
    'Escalation Level': n('t.escalation_level'),
    Message: t('t.message'),
    Status: pill('t.status'),
    ...approvalCols(`'AL-' || upper(left(t.id::text,8))`),
    Docs: DOCS('maint-alerts'),
    Actions: ACTIONS,
  },
  register: AL_C,
  compact: AL_C,
  views: [
    V('service due', AL_C, { where: [`ar.alert_type IN ('PM_DUE','PM_OVERDUE')`] }),
    V('calibration due', AL_C, {
      from: `(SELECT i.*, NULL::text AS message FROM qms_instruments i) t LEFT JOIN alert_rules ar ON false LEFT JOIN assets a ON false`,
      where: [`t.status='ACTIVE'`, `(t.valid_until IS NULL OR t.valid_until <= current_date + 30)`],
      order: 't.valid_until NULLS FIRST',
      cols: {
        'Alert No': t(`'CAL-' || t.history_card_no`),
        'Alert Type': t(`CASE WHEN t.valid_until IS NULL THEN 'Never calibrated' WHEN t.valid_until < current_date THEN 'Calibration overdue' ELSE 'Calibration due' END`),
        Asset: t(`t.history_card_no || ' · ' || t.name`),
        'Due Date': d('t.valid_until'),
        'Days Remaining': n('t.valid_until - current_date'),
        Owner: none(),
        'Escalation Level': none('num'),
        Status: pill(`CASE WHEN t.valid_until < current_date THEN 'OVERDUE' ELSE 'DUE' END`),
        Actions: ACTIONS,
      },
      labels: ['Alert No', 'Alert Type', 'Asset', 'Due Date', 'Days Remaining', 'Owner', 'Escalation Level', 'Status', 'Actions'],
    }),
    V('document expiry', [...AL_C.slice(0, 3), 'Due Date', 'Days Remaining', 'Owner', 'Escalation Level', 'Status', 'Actions'], {
      where: [`ar.alert_type IN ('WARRANTY_EXPIRY','LOAN_RETURN_DUE')`],
    }),
    V('breakdown escalation', AL_C, { where: [`ar.alert_type = 'BREAKDOWN_UNACK'`] }),
    V('alert rules', AL_C, {
      panel: {
        title: 'Alert rules',
        from: 'alert_rules p',
        unit: null,
        soft: null,
        order: 'p.alert_type',
        cols: [
          ['Alert Type', 'p.alert_type', 'text'],
          ['Lead Days', 'p.lead_days', 'num'],
          ['Escalation Minutes', `array_to_string(p.escalation_minutes, ', ')`, 'text'],
          ['Channel', 'p.channel', 'text'],
          ['Active', `CASE WHEN p.active THEN 'Yes' ELSE 'No' END`, 'text'],
        ],
      },
    }),
  ],
};

// the maintenance queue strip sits on the first tab of the pages V40 shows it on
for (const p of [MACHINES, EQUIPMENT, PREVENTIVE, SCHEDULE, BREAKDOWN, MWO, DOWNTIME, MTBF]) {
  p.views.unshift(
    V(
      p === MACHINES
        ? 'machine register'
        : p === EQUIPMENT
          ? 'equipment register'
          : p === PREVENTIVE
            ? 'pm schedule'
            : p === SCHEDULE
              ? 'maintenance calendar'
              : p === BREAKDOWN
                ? 'breakdown queue'
                : p === MWO
                  ? 'maintenance wo'
                  : p === DOWNTIME
                    ? 'downtime register'
                    : 'reliability dashboard',
      p.register,
      { panel: queuePanel },
    ),
  );
}

export const MAINT_V40_PAGES: Record<string, PageDef> = {
  'maint-machines': MACHINES,
  'maint-equipment': EQUIPMENT,
  'maint-preventive': PREVENTIVE,
  'maint-schedule': SCHEDULE,
  'maint-breakdown': BREAKDOWN,
  'maint-workorders': MWO,
  'maint-downtime': DOWNTIME,
  'maint-mtbf': MTBF,
  'maint-spares': SPARES,
  'maint-alerts': ALERTS,
};
