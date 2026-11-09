// Phase 12 inspection engine: one table pair for every inspection form (incoming, in-process, pre-dispatch, ISIR,
// welding, VT). The form is a template (data), a plan pre-fills the rows, readings are judged against the limits, the
// inspector submits and the in-charge takes the Usage Decision. A decision on a goods-receipt lot moves the stock out of
// Quality Inspection through the Phase 9 qcDecide (accepted -> Unrestricted, rejected -> Blocked).
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { qcDecide } from '../procurement/grn-service';
import type { Caller } from '../records/service';
import {
  TX,
  audit,
  checkVersion,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
  scopeSql,
  todayIst,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import { D } from '../inventory/money';
import { headerErrors, judgeRow, overallResult } from './logic';
import type { HeaderField, RowStatus, RowType } from './logic';

export const S = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  // Decimals and Dates have their own toString; only plain objects and arrays are JSON
  if (typeof v === 'object' && v.toString === Object.prototype.toString) return JSON.stringify(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v as string);
};

export type Kind = 'INCOMING' | 'IN_PROCESS' | 'PRE_DISPATCH' | 'ISIR' | 'WELDING' | 'VT';
export const KINDS: Kind[] = ['INCOMING', 'IN_PROCESS', 'PRE_DISPATCH', 'ISIR', 'WELDING', 'VT'];
/** which menu page owns which form (permissions follow the page) */
export const PAGE_OF_KIND: Record<Kind, string> = {
  INCOMING: 'qms-incoming',
  IN_PROCESS: 'qms-process',
  PRE_DISPATCH: 'qms-final',
  WELDING: 'qms-final',
  VT: 'qms-final',
  ISIR: 'qms-supplier',
};
const SERIES_PREFIX: Record<Kind, string> = {
  INCOMING: 'IQC',
  IN_PROCESS: 'IPQC',
  PRE_DISPATCH: 'PDI',
  ISIR: 'ISIR',
  WELDING: 'WLD',
  VT: 'VT',
};
const PROCESS_NAME: Record<Kind, string> = {
  INCOMING: 'Incoming inspection',
  IN_PROCESS: 'In-process',
  PRE_DISPATCH: 'Pre-dispatch',
  ISIR: 'ISIR',
  WELDING: 'Welding',
  VT: 'Visual test',
};

export interface RowInput {
  label: string;
  spec?: string | null;
  method?: string | null;
  unit?: string | null;
  rowType?: RowType;
  lsl?: string | number | null;
  usl?: string | number | null;
  readings?: (string | number | null)[];
  extra?: Record<string, string>;
  remark?: string | null;
}
export interface InspectionInput {
  kind: Kind;
  templateId?: string | undefined;
  planId?: string | undefined;
  docDate?: string | undefined;
  header?: Record<string, unknown> | undefined;
  rows?: RowInput[] | undefined;
  lotQty?: string | number | null | undefined;
  inspectorId?: string | undefined;
  /** Phase 13: the item and the source document of a production sheet (a header "part" is free text). */
  itemId?: string | undefined;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
}

const num = (v: string | number | null | undefined): string | null =>
  v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();

// ------------------------------------------------------------------------------------------------ templates and plans
export async function resolveTemplate(
  db: Db,
  kind: string,
  customerId: string | null,
  unitId: string | null,
  templateId?: string,
): Promise<Row> {
  if (templateId) {
    const t = (
      await query(
        db,
        `SELECT * FROM qms_templates WHERE id=$1::uuid AND kind=$2 AND status='ACTIVE'`,
        templateId,
        kind,
      )
    )[0];
    if (!t) throw Errors.validation({ templateId: 'Choose an active form template of this type.' });
    return t;
  }
  const t = (
    await query(
      db,
      `SELECT * FROM qms_templates WHERE kind=$1 AND status='ACTIVE'
         AND (customer_id IS NULL OR customer_id=$2::uuid) AND (unit_id IS NULL OR unit_id=$3::uuid)
       ORDER BY (customer_id IS NOT NULL) DESC, (unit_id IS NOT NULL) DESC LIMIT 1`,
      kind,
      customerId,
      unitId,
    )
  )[0];
  if (!t) throw Errors.conflict('There is no active form template for this inspection type.');
  return t;
}

interface PlanChar {
  name: string;
  spec?: string;
  method?: string;
  unit?: string;
  type?: RowType;
  lsl?: string | number | null;
  usl?: string | number | null;
}
async function pickPlan(
  db: Db,
  kind: string,
  itemId: string | null,
  customerId: string | null,
  planId?: string,
): Promise<Row | null> {
  if (planId) {
    const p = (
      await query(
        db,
        `SELECT * FROM qms_plans WHERE id=$1::uuid AND kind=$2 AND status='ACTIVE'`,
        planId,
        kind,
      )
    )[0];
    if (!p) throw Errors.validation({ planId: 'Choose an active inspection plan of this type.' });
    return p;
  }
  if (!itemId) return null;
  return (
    (
      await query(
        db,
        `SELECT * FROM qms_plans WHERE kind=$1 AND status='ACTIVE' AND item_id=$2::uuid AND (customer_id IS NULL OR customer_id=$3::uuid)
         ORDER BY (customer_id IS NOT NULL) DESC, created_at DESC LIMIT 1`,
        kind,
        itemId,
        customerId,
      )
    )[0] ?? null
  );
}
const planRows = (p: Row | null): RowInput[] =>
  ((p?.characteristics as PlanChar[] | undefined) ?? []).map((c) => ({
    label: c.name,
    spec: c.spec ?? null,
    method: c.method ?? null,
    unit: c.unit ?? null,
    rowType: c.type ?? 'NUMERIC',
    lsl: c.lsl ?? null,
    usl: c.usl ?? null,
    readings: [],
  }));

// ------------------------------------------------------------------------------------------------ rows
interface JudgedRow {
  rowNo: number;
  label: string;
  spec: string | null;
  method: string | null;
  unit: string | null;
  rowType: RowType;
  lsl: string | null;
  usl: string | null;
  readings: string[];
  extra: Record<string, string>;
  status: RowStatus;
  remark: string | null;
}
function judgeAll(rows: RowInput[], maxReadings: number): JudgedRow[] {
  const errs: Record<string, string> = {};
  const out = rows.map((r, i) => {
    const label = (r.label ?? '').trim();
    if (!label) errs[`rows.${i}.label`] = 'Name the characteristic.';
    const rowType: RowType = r.rowType === 'ATTRIBUTE' ? 'ATTRIBUTE' : 'NUMERIC';
    const lsl = num(r.lsl);
    const usl = num(r.usl);
    if (rowType === 'NUMERIC') {
      for (const [k, v] of [
        ['lsl', lsl],
        ['usl', usl],
      ] as const)
        if (v !== null && !/^-?\d+(\.\d+)?$/.test(v)) errs[`rows.${i}.${k}`] = 'Enter a number.';
      if (
        lsl !== null &&
        usl !== null &&
        /^-?\d+(\.\d+)?$/.test(lsl) &&
        /^-?\d+(\.\d+)?$/.test(usl) &&
        D(lsl).gt(D(usl))
      )
        errs[`rows.${i}.lsl`] = 'The lower limit is above the upper limit.';
    }
    const readings = (r.readings ?? []).map((x) =>
      x === null || x === undefined ? '' : String(x).trim(),
    );
    if (readings.length > maxReadings)
      errs[`rows.${i}.readings`] = `At most ${maxReadings} readings per row.`;
    const j = judgeRow({ rowType, lsl, usl, readings });
    if (j.invalid[0]) errs[`rows.${i}.readings`] = j.invalid[0];
    return {
      rowNo: i + 1,
      label,
      spec: r.spec?.trim() || null,
      method: r.method?.trim() || null,
      unit: r.unit?.trim() || null,
      rowType,
      lsl,
      usl,
      readings,
      extra: r.extra ?? {},
      status: j.status,
      remark: r.remark?.trim() || null,
    };
  });
  if (Object.keys(errs).length) throw Errors.validation(errs);
  return out;
}
async function writeRows(tx: Db, id: string, rows: JudgedRow[]): Promise<void> {
  await exec(tx, `DELETE FROM qms_inspection_rows WHERE inspection_id=$1::uuid`, id);
  for (const r of rows)
    await insertRow(tx, 'qms_inspection_rows', {
      inspectionId: id,
      rowNo: r.rowNo,
      label: r.label,
      spec: r.spec,
      method: r.method,
      unit: r.unit,
      rowType: r.rowType,
      lsl: r.lsl,
      usl: r.usl,
      readings: JSON.stringify(r.readings),
      extra: JSON.stringify(r.extra),
      rowStatus: r.status,
      remark: r.remark,
    });
}

// ------------------------------------------------------------------------------------------------ header
/** the customer / supplier / item named in the header values (types customer, supplier, item) */
function refsOf(fields: HeaderField[], header: Record<string, unknown>) {
  const pick = (t: string): string | null => {
    const f = fields.find((x) => x.type === t);
    const v = f ? S(header[f.key]).trim() : '';
    return v === '' ? null : v;
  };
  return { customerId: pick('customer'), supplierId: pick('supplier'), itemId: pick('item') };
}
async function assertRefs(
  db: Db,
  ids: { customerId: string | null; supplierId: string | null; itemId: string | null },
) {
  const bad: Record<string, string> = {};
  const check = async (table: string, id: string | null, key: string, msg: string) => {
    if (id && !(await query(db, `SELECT 1 FROM ${table} WHERE id=$1::uuid`, id))[0]) bad[key] = msg;
  };
  await check('customers', ids.customerId, 'customer', 'This customer does not exist.');
  await check('suppliers', ids.supplierId, 'supplier', 'This supplier does not exist.');
  await check('items', ids.itemId, 'item', 'This item does not exist.');
  if (Object.keys(bad).length) throw Errors.validation(bad);
}
const fieldsOf = (t: Row): HeaderField[] => (t.header_fields as HeaderField[] | undefined) ?? [];
const rowCfg = (t: Row): { readings?: number } =>
  (t.row_config as { readings?: number } | undefined) ?? {};

// ------------------------------------------------------------------------------------------------ read
const SELECT = `SELECT t.*, i.name AS item_name, i.code AS item_code, c.name AS customer_name, s.name AS supplier_name,
    u.name AS inspector_name, d.name AS decided_by_name
  FROM qms_inspections t
  LEFT JOIN items i ON i.id=t.item_id LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN suppliers s ON s.id=t.supplier_id
  LEFT JOIN users u ON u.id=t.inspector_id LEFT JOIN users d ON d.id=t.decided_by_id`;

export interface ListQuery {
  kind?: Kind | undefined;
  status?: string | undefined;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  size: number;
}
export async function listInspections(caller: Caller, pageId: string, q: ListQuery) {
  const sc = await scopeSql(caller, pageId);
  const args = [...sc.args];
  const where = [sc.sql];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace('?', `$${args.length}`));
  };
  if (q.kind) add('t.kind = ?', q.kind);
  if (q.status) add('t.status = ?', q.status);
  if (q.from) add('t.doc_date >= ?::date', q.from);
  if (q.to) add('t.doc_date <= ?::date', q.to);
  if (q.q) {
    args.push(`%${q.q}%`);
    const n = `$${args.length}`;
    where.push(
      `(t.number ILIKE ${n} OR i.name ILIKE ${n} OR s.name ILIKE ${n} OR c.name ILIKE ${n} OR t.header::text ILIKE ${n})`,
    );
  }
  const w = where.join(' AND ');
  const total = Number(
    (
      await query(
        prisma,
        `SELECT count(*)::int AS n FROM qms_inspections t LEFT JOIN items i ON i.id=t.item_id LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN suppliers s ON s.id=t.supplier_id WHERE ${w}`,
        ...args,
      )
    )[0]!.n,
  );
  const rows = await query(
    prisma,
    `${SELECT} WHERE ${w} ORDER BY t.doc_date DESC, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
    ...args,
  );
  return { rows: rows.map((r) => slim(norm(r))), total };
}
function slim(r: Row): Row {
  const { templateSnapshot: _t, header: _h, ...rest } = r;
  void _t;
  void _h;
  return rest;
}

export async function getInspection(caller: Caller, pageId: string, id: string): Promise<Row> {
  const sc = await scopeSql(caller, pageId);
  const r = (
    await query(
      prisma,
      `${SELECT} WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
      ...sc.args,
      id,
    )
  )[0];
  if (!r) throw Errors.notFound('Inspection not found.');
  const rows = await query(
    prisma,
    `SELECT * FROM qms_inspection_rows WHERE inspection_id=$1::uuid ORDER BY row_no`,
    id,
  );
  const out = norm(r);
  out.rows = rows.map((x) => norm(x));
  out.headerLabels = await headerLabels(
    prisma,
    (r.template_snapshot as { headerFields: HeaderField[] }).headerFields,
    r.header as Record<string, unknown>,
  );
  if (S(out.sourceType) === 'GRN_LINE') {
    const g = (
      await query(
        prisma,
        `SELECT g.number AS grn_no, g.id::text AS grn_id, l.line_no, l.received_qty::text AS received_qty, l.uom FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.grn_id WHERE l.id=$1::uuid`,
        S(out.sourceId),
      )
    )[0];
    out.grn = g ? norm(g) : null;
  }
  return out;
}

/** display names for the item / customer / supplier / instrument values of a form, so the screen can show them */
export async function headerLabels(
  db: Db,
  fields: HeaderField[],
  values: Record<string, unknown>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const table: Record<string, string> = {
    item: 'items',
    customer: 'customers',
    supplier: 'suppliers',
    instrument: 'qms_instruments',
  };
  for (const f of fields) {
    const t = f.type ? table[f.type] : undefined;
    const id = S(values[f.key]).trim();
    if (!t || !id || !/^[0-9a-f-]{36}$/i.test(id)) continue;
    const sql =
      f.type === 'instrument'
        ? `SELECT equipment_no AS code, name FROM qms_instruments WHERE id=$1::uuid`
        : `SELECT code, name FROM ${t} WHERE id=$1::uuid`;
    const r = (await query(db, sql, id))[0];
    if (r) out[f.key] = `${S(r.code)} · ${S(r.name)}`;
  }
  return out;
}

export async function kindOf(id: string): Promise<Kind> {
  const r = (
    await query(
      prisma,
      `SELECT kind FROM qms_inspections WHERE id=$1::uuid AND deleted_at IS NULL`,
      id,
    )
  )[0];
  if (!r) throw Errors.notFound('Inspection not found.');
  return S(r.kind) as Kind;
}

// ------------------------------------------------------------------------------------------------ create / update
async function number(tx: Db, kind: Kind, unitId: string, fyId: string): Promise<string> {
  return NumberingService.allocate(tx, {
    pageId: `qms:${kind}`,
    unitId,
    fyId,
    prefix: SERIES_PREFIX[kind],
  });
}

async function instrumentCheck(
  db: Db,
  fields: HeaderField[],
  header: Record<string, unknown>,
  onDate: string,
) {
  for (const f of fields.filter((x) => x.type === 'instrument')) {
    const id = S(header[f.key]).trim();
    if (!id) continue;
    const ins = (
      await query(
        db,
        `SELECT name, equipment_no, valid_until, status FROM qms_instruments WHERE id=$1::uuid AND deleted_at IS NULL`,
        id,
      )
    )[0];
    if (!ins) throw Errors.validation({ [f.key]: 'This instrument does not exist.' });
    const until =
      ins.valid_until instanceof Date
        ? ins.valid_until.toISOString().slice(0, 10)
        : S(ins.valid_until).slice(0, 10);
    if (S(ins.status) !== 'ACTIVE' || !until || until < onDate)
      throw new AppError(
        422,
        'QMS_INSTRUMENT_EXPIRED',
        `${S(ins.name)} (${S(ins.equipment_no)}) is not in calibration on ${onDate}.`,
        {
          [f.key]: 'This instrument is out of calibration.',
        },
      );
  }
}

export async function createInspection(
  caller: Caller,
  pageId: string,
  input: InspectionInput,
): Promise<Row> {
  const unitId = caller.ctx.unitId;
  if (!unitId) throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
  const fy = await fyOfCaller(caller);
  const id = await prisma.$transaction(async (tx) => {
    const header = input.header ?? {};
    // the customer comes from the header (the form may be customer specific), so read it before picking the template
    const provisional = input.templateId
      ? await resolveTemplate(tx, input.kind, null, unitId, input.templateId)
      : null;
    const baseFields = provisional ? fieldsOf(provisional) : await defaultFields(tx, input.kind);
    const tpl =
      provisional ??
      (await resolveTemplate(tx, input.kind, refsOf(baseFields, header).customerId, unitId));
    const fields = fieldsOf(tpl);
    const refs = refsOf(fields, header);
    const errs = headerErrors(fields, header, { requireAll: false });
    if (Object.keys(errs).length) throw Errors.validation(errs);
    await assertRefs(tx, refs);
    const plan = await pickPlan(
      tx,
      input.kind,
      refs.itemId ?? input.itemId ?? null,
      refs.customerId,
      input.planId,
    );
    const rows = judgeAll(input.rows ?? planRows(plan), Math.max(rowCfg(tpl).readings ?? 5, 1));
    const date = input.docDate ?? todayIst();
    const no = await number(tx, input.kind, unitId, fy.id);
    const rid = await insertRow(tx, 'qms_inspections', {
      unitId,
      fyId: fy.id,
      number: no,
      kind: input.kind,
      status: 'Draft',
      templateId: S(tpl.id),
      templateSnapshot: {
        code: tpl.code,
        name: tpl.name,
        version: tpl.version,
        headerFields: fields,
        rowConfig: tpl.row_config,
      },
      planId: plan ? S(plan.id) : null,
      docDate: date,
      customerId: refs.customerId,
      supplierId: refs.supplierId,
      itemId: refs.itemId ?? input.itemId ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      header,
      lotQty: num(input.lotQty),
      inspectorId: input.inspectorId ?? caller.auth.userId,
      createdById: caller.auth.userId,
      updatedById: caller.auth.userId,
    });
    await writeRows(tx, rid, rows);
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'QMS_INSPECTION_CREATED',
      'qms_inspection',
      { id: rid, code: no },
      pageId,
      { kind: input.kind },
    );
    return rid;
  }, TX);
  return getInspection(caller, pageId, id);
}
async function defaultFields(db: Db, kind: string): Promise<HeaderField[]> {
  const t = (
    await query(
      db,
      `SELECT header_fields FROM qms_templates WHERE kind=$1 AND status='ACTIVE' AND customer_id IS NULL AND unit_id IS NULL`,
      kind,
    )
  )[0];
  return (t?.header_fields as HeaderField[] | undefined) ?? [];
}

export async function updateInspection(
  caller: Caller,
  pageId: string,
  id: string,
  ifMatch: number,
  body: Partial<Pick<InspectionInput, 'docDate' | 'header' | 'rows' | 'lotQty'>>,
): Promise<Row> {
  const sc = await scopeSql(caller, pageId);
  await prisma.$transaction(async (tx) => {
    const cur = (
      await query(
        tx,
        `SELECT t.* FROM qms_inspections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
        ...sc.args,
        id,
      )
    )[0];
    if (!cur) throw Errors.notFound('Inspection not found.');
    checkVersion(cur, ifMatch);
    if (S(cur.status) !== 'Draft') throw Errors.conflict('Only a Draft inspection can be edited.');
    const snap = cur.template_snapshot as {
      headerFields: HeaderField[];
      rowConfig: { readings?: number };
    };
    if (S(cur.source_type) === 'GRN_LINE' && body.lotQty !== undefined)
      throw Errors.conflict('The lot quantity of a goods-receipt lot cannot be changed.');
    const header = body.header ?? (cur.header as Record<string, unknown>);
    const errs = headerErrors(snap.headerFields, header, { requireAll: false });
    if (Object.keys(errs).length) throw Errors.validation(errs);
    const refs = refsOf(snap.headerFields, header);
    await assertRefs(tx, refs);
    if (body.rows)
      await writeRows(tx, id, judgeAll(body.rows, Math.max(snap.rowConfig.readings ?? 5, 1)));
    await exec(
      tx,
      `UPDATE qms_inspections SET header=$1::jsonb, doc_date=COALESCE($2::date, doc_date), lot_qty=CASE WHEN $3::boolean THEN $4::numeric ELSE lot_qty END,
         customer_id=$5::uuid, supplier_id=$6::uuid, item_id=$7::uuid, updated_by_id=$8::uuid, updated_at=now(), version=version+1 WHERE id=$9::uuid`,
      JSON.stringify(header),
      body.docDate ?? null,
      body.lotQty !== undefined,
      num(body.lotQty),
      refs.customerId,
      refs.supplierId,
      refs.itemId,
      caller.auth.userId,
      id,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'QMS_INSPECTION_UPDATED',
      'qms_inspection',
      { id, code: S(cur.number) },
      pageId,
    );
  }, TX);
  return getInspection(caller, pageId, id);
}

// ------------------------------------------------------------------------------------------------ submit / decide / cancel
export async function submitInspection(
  caller: Caller,
  pageId: string,
  id: string,
  ifMatch: number,
  body: { result?: 'ACCEPTED' | 'REJECTED' | 'CONDITIONAL' | undefined; note?: string | undefined },
): Promise<Row> {
  const sc = await scopeSql(caller, pageId);
  await prisma.$transaction(async (tx) => {
    const cur = (
      await query(
        tx,
        `SELECT t.* FROM qms_inspections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
        ...sc.args,
        id,
      )
    )[0];
    if (!cur) throw Errors.notFound('Inspection not found.');
    checkVersion(cur, ifMatch);
    if (S(cur.status) !== 'Draft')
      throw Errors.conflict('Only a Draft inspection can be submitted.');
    const snap = cur.template_snapshot as { headerFields: HeaderField[] };
    const header = cur.header as Record<string, unknown>;
    const errs = headerErrors(snap.headerFields, header);
    if (Object.keys(errs).length) throw Errors.validation(errs);
    await instrumentCheck(tx, snap.headerFields, header, todayIst());
    const rows = await query(
      tx,
      `SELECT row_status FROM qms_inspection_rows WHERE inspection_id=$1::uuid`,
      id,
    );
    if (rows.length === 0)
      throw Errors.validation({ rows: 'Add at least one characteristic to check.' });
    if (rows.some((r) => S(r.row_status) === 'PENDING'))
      throw Errors.validation({ rows: 'Fill in the readings of every row before submitting.' });
    const computed = overallResult(rows.map((r) => S(r.row_status) as RowStatus));
    const result = body.result ?? computed;
    if (!result)
      throw Errors.validation({ result: 'Choose accepted, rejected or conditionally accepted.' });
    if (computed === 'REJECTED' && result === 'ACCEPTED')
      throw new AppError(
        422,
        'QMS_READINGS_OUT_OF_LIMIT',
        'A reading is out of limit. The sheet cannot be marked accepted.',
        {
          result: 'A reading is out of limit. Choose rejected or conditionally accepted.',
        },
      );
    if (result === 'CONDITIONAL' && (body.note ?? '').trim().length < 3)
      throw Errors.validation({ note: 'Say on what condition the lot is accepted.' });
    await exec(
      tx,
      `UPDATE qms_inspections SET status='Submitted', result=$1, result_note=$2, inspector_id=COALESCE(inspector_id,$3::uuid), submitted_at=now(),
         updated_by_id=$3::uuid, updated_at=now(), version=version+1 WHERE id=$4::uuid`,
      result,
      body.note?.trim() || null,
      caller.auth.userId,
      id,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'QMS_INSPECTION_SUBMITTED',
      'qms_inspection',
      { id, code: S(cur.number) },
      pageId,
      { result },
    );
  }, TX);
  return getInspection(caller, pageId, id);
}

/** Phase 13: what happens to a production lot when its Usage Decision is made (the manufacturing module registers it). */
type LotDecisionHook = (tx: Db, caller: Caller, lotId: string, accepted: string, rejected: string) => Promise<void>;
let lotHook: LotDecisionHook | null = null;
export const registerLotDecisionHook = (h: LotDecisionHook): void => {
  lotHook = h;
};

export interface DecideInput {
  acceptedQty: string | number;
  rejectedQty: string | number;
  note?: string | undefined;
}
/** The Usage Decision. Only a Submitted sheet; accepted + rejected must equal the lot; rejected stock goes to Blocked. */
export async function decideInspection(
  caller: Caller,
  pageId: string,
  id: string,
  body: DecideInput,
): Promise<Row> {
  const sc = await scopeSql(caller, pageId);
  await prisma.$transaction(async (tx) => {
    const cur = (
      await query(
        tx,
        `SELECT t.* FROM qms_inspections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
        ...sc.args,
        id,
      )
    )[0];
    if (!cur) throw Errors.notFound('Inspection not found.');
    if (S(cur.status) !== 'Submitted')
      throw Errors.conflict('Only a submitted inspection can get a usage decision.');
    const acc = D(S(body.acceptedQty));
    const rej = D(S(body.rejectedQty));
    if (acc.lt(0) || rej.lt(0) || acc.plus(rej).lte(0))
      throw Errors.validation({ acceptedQty: 'Enter the accepted and the rejected quantity.' });
    const result = S(cur.result) as 'ACCEPTED' | 'REJECTED' | 'CONDITIONAL';
    if (result === 'REJECTED' && acc.gt(0))
      throw new AppError(
        422,
        'QMS_REJECTED_SHEET',
        'A rejected sheet cannot release stock. Set accepted quantity to 0.',
        {
          acceptedQty: 'Accepted quantity must be 0 for a rejected sheet.',
        },
      );
    const lot = cur.lot_qty === null ? null : D(S(cur.lot_qty));
    if (lot && !acc.plus(rej).eq(lot))
      throw new AppError(
        422,
        'QC_QTY_MISMATCH',
        `Accepted + rejected must equal the lot of ${lot.toFixed()}.`,
        {
          acceptedQty: `Accepted + rejected must equal ${lot.toFixed()}.`,
        },
      );
    const note = (body.note ?? '').trim();
    if ((rej.gt(0) || result === 'CONDITIONAL') && note.length < 3)
      throw Errors.validation({
        note: 'Give the reason (defect found, or the condition of acceptance).',
      });
    const decision = rej.isZero()
      ? result === 'CONDITIONAL'
        ? 'CONDITIONAL'
        : 'ACCEPTED'
      : acc.isZero()
        ? 'REJECTED'
        : 'PARTIAL';
    if (S(cur.source_type) === 'GRN_LINE')
      await qcDecide(tx, {
        grnLineId: S(cur.source_id),
        acceptedQty: acc.toFixed(),
        rejectedQty: rej.toFixed(),
        rejectReason: note || undefined,
        actorId: caller.auth.userId,
      });
    if (S(cur.source_type) === 'MFG_LOT' && lotHook)
      await lotHook(tx, caller, S(cur.source_id), acc.toFixed(), rej.toFixed());
    await exec(
      tx,
      `UPDATE qms_inspections SET status='Decided', decision=$1, decision_note=$2, accepted_qty=$3::numeric, rejected_qty=$4::numeric,
         decided_by_id=$5::uuid, decided_at=now(), updated_by_id=$5::uuid, updated_at=now(), version=version+1 WHERE id=$6::uuid`,
      decision,
      note || null,
      acc.toFixed(),
      rej.toFixed(),
      caller.auth.userId,
      id,
    );
    if (rej.gt(0)) {
      const kind = S(cur.kind) as Kind;
      const part = (
        await query(
          tx,
          `SELECT COALESCE((SELECT name FROM items WHERE id=$1::uuid), $2) AS p`,
          cur.item_id ?? null,
          S((cur.header as Record<string, unknown>).part) || S(cur.number),
        )
      )[0]!;
      const no = await NumberingService.allocate(tx, {
        pageId: 'qms:REJ',
        unitId: S(cur.unit_id),
        fyId: S(cur.fy_id),
        prefix: 'REJ',
      });
      await insertRow(tx, 'qms_rejections', {
        unitId: S(cur.unit_id),
        fyId: S(cur.fy_id),
        number: no,
        rejectDate: todayIst(),
        process: PROCESS_NAME[kind],
        itemId: cur.item_id ?? null,
        part: S(part.p).slice(0, 150),
        holdQty: rej.toFixed(),
        defect: note.slice(0, 200),
        defectType: 'INSPECTION',
        disposition: kind === 'INCOMING' ? 'RETURN_TO_VENDOR' : 'HOLD',
        sourceInspectionId: id,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    }
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'QMS_USAGE_DECISION',
      'qms_inspection',
      { id, code: S(cur.number) },
      pageId,
      {
        decision,
        accepted: acc.toFixed(),
        rejected: rej.toFixed(),
      },
    );
  }, TX);
  return getInspection(caller, pageId, id);
}

export async function cancelInspection(
  caller: Caller,
  pageId: string,
  id: string,
  reason: string,
): Promise<Row> {
  const sc = await scopeSql(caller, pageId);
  await prisma.$transaction(async (tx) => {
    const cur = (
      await query(
        tx,
        `SELECT t.* FROM qms_inspections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
        ...sc.args,
        id,
      )
    )[0];
    if (!cur) throw Errors.notFound('Inspection not found.');
    if (!['Draft', 'Submitted'].includes(S(cur.status)))
      throw Errors.conflict('A decided or cancelled inspection cannot be cancelled.');
    if (S(cur.source_type) === 'GRN_LINE')
      throw Errors.conflict(
        'This is the inspection lot of a goods receipt. Take the usage decision instead.',
      );
    await exec(
      tx,
      `UPDATE qms_inspections SET status='Cancelled', cancelled_at=now(), cancel_reason=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
      reason,
      caller.auth.userId,
      id,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'QMS_INSPECTION_CANCELLED',
      'qms_inspection',
      { id, code: S(cur.number) },
      pageId,
      { reason },
    );
  }, TX);
  return getInspection(caller, pageId, id);
}

/** Pre-fills a plan's rows for the screen (before the sheet exists). */
export async function planPreview(
  db: Db,
  kind: string,
  itemId: string | null,
  customerId: string | null,
  planId?: string,
) {
  const plan = await pickPlan(db, kind, itemId, customerId, planId);
  return { plan: plan ? norm(plan) : null, rows: planRows(plan) };
}
