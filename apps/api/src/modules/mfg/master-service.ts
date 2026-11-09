// Phase 13 v2 masters other than BOM and routing (see bom-service / routing-service): work centres with their rates, shifts and
// calendar, the weekday calendars, downtime and scrap reasons, the planning data of an item (lead time, safety stock, lot
// sizing, warehouses) and the manufacturing settings. Rates are Finance's: a work centre without them cannot be used on a
// released order (WC_RATE_MISSING).
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Caller } from '../records/service';
import {
  TX,
  audit,
  checkVersion,
  exec,
  insertRow,
  norm,
  query,
  scopeSql,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import { D } from './calc';

export const S = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v.toString === Object.prototype.toString) return JSON.stringify(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v as string);
};
/** A date column as YYYY-MM-DD (raw queries return a JS Date for a date column). */
export const dateOf = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : S(v);
export const oneUnit = (caller: Caller): string => {
  if (!caller.ctx.unitId)
    throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
  return caller.ctx.unitId;
};
export const WORK_CENTRE_KINDS = ['MACHINE', 'LINE', 'MANUAL', 'OUTSIDE'] as const;
const num = (v: string | number | undefined | null): string | null =>
  v === undefined || v === null || String(v).trim() === '' ? null : D(String(v)).toFixed();

export interface WorkCentreInput {
  code: string;
  name: string;
  kind?: (typeof WORK_CENTRE_KINDS)[number] | undefined;
  department?: string | undefined;
  costCentreId?: string | undefined;
  machineCount?: number | undefined;
  labourCount?: number | undefined;
  calendarId?: string | undefined;
  hoursPerShift?: string | number | undefined;
  shiftsPerDay?: number | undefined;
  normalCapacityHrs?: string | number | undefined;
  labourRatePerHr?: string | number | undefined;
  overheadRatePerHr?: string | number | undefined;
  oeeTargetPct?: string | number | undefined;
  efficiencyPct?: string | number | undefined;
  notes?: string | undefined;
  assetRef?: string | undefined;
}

export const masterService = {
  // ---------------------------------------------------------------------------------------------- work centres
  async listWorkCentres(
    caller: Caller,
    pageId: string,
    q: { q?: string | undefined; status?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(t.code ILIKE $${args.length} OR t.name ILIKE $${args.length})`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM mfg_work_centres t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, c.name AS calendar_name, cc.code AS cost_centre_code
         FROM mfg_work_centres t LEFT JOIN mfg_wc_calendars c ON c.id=t.calendar_id LEFT JOIN cost_centers cc ON cc.id=t.cost_centre_id
        WHERE ${w} ORDER BY t.code LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async createWorkCentre(caller: Caller, pageId: string, b: WorkCentreInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const code = b.code.trim().toUpperCase();
    const id = await prisma.$transaction(async (tx) => {
      if (
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_work_centres WHERE unit_id=$1::uuid AND code=$2 AND deleted_at IS NULL`,
            unitId,
            code,
          )
        ).length
      )
        throw Errors.validation({ code: `Work centre ${code} already exists.` });
      const perShift = D(String(b.hoursPerShift ?? 8));
      const shifts = b.shiftsPerDay ?? 1;
      if (perShift.lte(0) || perShift.gt(24))
        throw Errors.validation({
          hoursPerShift: 'Hours per shift must be more than 0 and at most 24.',
        });
      const perDay = perShift.mul(shifts);
      if (perDay.gt(24))
        throw Errors.validation({
          shiftsPerDay: 'Shifts together cannot be more than 24 hours a day.',
        });
      const rid = await insertRow(tx, 'mfg_work_centres', {
        unitId,
        code,
        name: b.name.trim(),
        kind: b.kind ?? 'MACHINE',
        department: b.department ?? null,
        costCentreId: b.costCentreId ?? null,
        machineCount: b.machineCount ?? 1,
        labourCount: b.labourCount ?? 1,
        calendarId: b.calendarId ?? null,
        hoursPerShift: perShift.toFixed(2),
        shiftsPerDay: shifts,
        capacityHours: perDay.toFixed(2),
        normalCapacityHrs: num(b.normalCapacityHrs) ?? perDay.toFixed(2),
        labourRatePerHr: num(b.labourRatePerHr),
        overheadRatePerHr: num(b.overheadRatePerHr),
        costPerHour: num(b.labourRatePerHr) ?? '0',
        oeeTargetPct: num(b.oeeTargetPct),
        efficiencyPct: num(b.efficiencyPct) ?? '100',
        notes: b.notes ?? null,
        assetRef: b.assetRef ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_WORKCENTRE_CREATED',
        'mfg_work_centre',
        { id: rid, code },
        pageId,
        {},
      );
      return rid;
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_work_centres WHERE id=$1::uuid`, id))[0]!,
    );
  },

  async updateWorkCentre(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: Partial<WorkCentreInput> & { status?: 'ACTIVE' | 'INACTIVE' | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_work_centres t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Work centre not found.');
      checkVersion(norm<Row>(cur), version);
      if (
        b.status === 'INACTIVE' &&
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_order_ops o JOIN mfg_orders d ON d.id=o.order_id WHERE o.work_centre_id=$1::uuid AND d.status IN ('Released','In Progress') LIMIT 1`,
            id,
          )
        ).length
      )
        throw Errors.conflict('Open production orders still use this work centre.');
      const perShift =
        b.hoursPerShift === undefined ? D(S(cur.hours_per_shift)) : D(String(b.hoursPerShift));
      const shifts = b.shiftsPerDay ?? Number(cur.shifts_per_day);
      if (perShift.lte(0) || perShift.gt(24) || perShift.mul(shifts).gt(24))
        throw Errors.validation({
          hoursPerShift: 'The shifts together cannot be more than 24 hours a day.',
        });
      await exec(
        tx,
        `UPDATE mfg_work_centres SET name=COALESCE($1,name), kind=COALESCE($2,kind), department=COALESCE($3,department), cost_centre_id=COALESCE($4::uuid,cost_centre_id),
           machine_count=COALESCE($5,machine_count), labour_count=COALESCE($6,labour_count), calendar_id=COALESCE($7::uuid,calendar_id),
           hours_per_shift=$8::numeric, shifts_per_day=$9, capacity_hours=$10::numeric, normal_capacity_hrs=COALESCE($11::numeric,normal_capacity_hrs),
           labour_rate_per_hr=COALESCE($12::numeric,labour_rate_per_hr), overhead_rate_per_hr=COALESCE($13::numeric,overhead_rate_per_hr),
           cost_per_hour=COALESCE($12::numeric,cost_per_hour), oee_target_pct=COALESCE($14::numeric,oee_target_pct), efficiency_pct=COALESCE($15::numeric,efficiency_pct),
           status=COALESCE($16,status), notes=COALESCE($17,notes), asset_ref=COALESCE($18,asset_ref), updated_by_id=$19::uuid, updated_at=now(), version=version+1
         WHERE id=$20::uuid`,
        b.name?.trim() ?? null,
        b.kind ?? null,
        b.department ?? null,
        b.costCentreId ?? null,
        b.machineCount ?? null,
        b.labourCount ?? null,
        b.calendarId ?? null,
        perShift.toFixed(2),
        shifts,
        perShift.mul(shifts).toFixed(2),
        num(b.normalCapacityHrs),
        num(b.labourRatePerHr),
        num(b.overheadRatePerHr),
        num(b.oeeTargetPct),
        num(b.efficiencyPct),
        b.status ?? null,
        b.notes ?? null,
        b.assetRef ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_WORKCENTRE_UPDATED',
        'mfg_work_centre',
        { id, code: S(cur.code) },
        pageId,
        {},
      );
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_work_centres WHERE id=$1::uuid`, id))[0]!,
    );
  },

  // ---------------------------------------------------------------------------------------------- calendars
  async listCalendars(caller: Caller) {
    const unitId = oneUnit(caller);
    const rows = await query(
      prisma,
      `SELECT * FROM mfg_wc_calendars WHERE unit_id=$1::uuid AND deleted_at IS NULL ORDER BY name`,
      unitId,
    );
    const exc = await query(
      prisma,
      `SELECT calendar_id::text, exc_date, available_hrs::text, reason FROM mfg_wc_calendar_exceptions WHERE calendar_id = ANY($1::uuid[]) ORDER BY exc_date`,
      rows.map((r) => S(r.id)),
    );
    return rows.map(
      (r): Row => ({
        ...norm<Row>(r),
        exceptions: exc.filter((e) => S(e.calendar_id) === S(r.id)).map((e) => norm<Row>(e)),
      }),
    );
  },
  async saveCalendar(
    caller: Caller,
    pageId: string,
    id: string | null,
    b: {
      name: string;
      workDays: number[];
      exceptions?:
        | { date: string; availableHrs: string | number; reason?: string | undefined }[]
        | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    if (b.workDays.length === 0 || b.workDays.some((d) => d < 0 || d > 6))
      throw Errors.validation({
        workDays: 'Choose the working days (0 = Sunday to 6 = Saturday).',
      });
    const days = `{${[...new Set(b.workDays)].join(',')}}`;
    const rid = await prisma.$transaction(async (tx) => {
      let cid = id;
      if (cid) {
        if (
          !(
            await query(
              tx,
              `SELECT 1 FROM mfg_wc_calendars WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
              cid,
              unitId,
            )
          ).length
        )
          throw Errors.notFound('Calendar not found.');
        await exec(
          tx,
          `UPDATE mfg_wc_calendars SET name=$1, work_days=$2::smallint[], version=version+1 WHERE id=$3::uuid`,
          b.name.trim(),
          days,
          cid,
        );
        if (b.exceptions)
          await exec(tx, `DELETE FROM mfg_wc_calendar_exceptions WHERE calendar_id=$1::uuid`, cid);
      } else {
        if (
          (
            await query(
              tx,
              `SELECT 1 FROM mfg_wc_calendars WHERE unit_id=$1::uuid AND name=$2 AND deleted_at IS NULL`,
              unitId,
              b.name.trim(),
            )
          ).length
        )
          throw Errors.validation({ name: 'A calendar with this name exists.' });
        const rows = await query(
          tx,
          `INSERT INTO mfg_wc_calendars (unit_id, name, work_days, created_by_id) VALUES ($1::uuid, $2, $3::smallint[], $4::uuid) RETURNING id::text`,
          unitId,
          b.name.trim(),
          days,
          caller.auth.userId,
        );
        cid = S(rows[0]!.id);
      }
      for (const e of b.exceptions ?? [])
        await insertRow(tx, 'mfg_wc_calendar_exceptions', {
          calendarId: cid,
          excDate: e.date,
          availableHrs: D(String(e.availableHrs)).toFixed(2),
          reason: e.reason ?? null,
        });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_CALENDAR_SAVED',
        'mfg_wc_calendar',
        { id: cid, code: b.name },
        pageId,
        {},
      );
      return cid;
    }, TX);
    return (await masterService.listCalendars(caller)).find((c) => S(c.id) === rid)!;
  },

  // ---------------------------------------------------------------------------------------------- reasons
  async listReasons(kind: 'downtime' | 'scrap') {
    const rows = await query(
      prisma,
      kind === 'downtime'
        ? `SELECT * FROM mfg_downtime_reasons ORDER BY code`
        : `SELECT * FROM mfg_scrap_reasons ORDER BY code`,
    );
    return rows.map((r) => norm<Row>(r));
  },
  async saveReason(
    caller: Caller,
    pageId: string,
    kind: 'downtime' | 'scrap',
    b: {
      code: string;
      name: string;
      category?: 'PLANNED' | 'UNPLANNED' | undefined;
      countsAgainstAvailability?: boolean | undefined;
      normal?: boolean | undefined;
      status?: 'ACTIVE' | 'INACTIVE' | undefined;
    },
  ): Promise<Row> {
    const code = b.code.trim().toUpperCase();
    if (kind === 'downtime') {
      if (!b.category) throw Errors.validation({ category: 'Choose planned or unplanned.' });
      await exec(
        prisma,
        `INSERT INTO mfg_downtime_reasons (code, name, category, counts_against_availability, status) VALUES ($1,$2,$3,$4,COALESCE($5,'ACTIVE'))
         ON CONFLICT (code) DO UPDATE SET name=$2, category=$3, counts_against_availability=$4, status=COALESCE($5,mfg_downtime_reasons.status)`,
        code,
        b.name.trim(),
        b.category,
        b.countsAgainstAvailability ?? b.category === 'UNPLANNED',
        b.status ?? null,
      );
    } else
      await exec(
        prisma,
        `INSERT INTO mfg_scrap_reasons (code, name, normal, status) VALUES ($1,$2,$3,COALESCE($4,'ACTIVE'))
         ON CONFLICT (code) DO UPDATE SET name=$2, normal=$3, status=COALESCE($4,mfg_scrap_reasons.status)`,
        code,
        b.name.trim(),
        b.normal === true,
        b.status ?? null,
      );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_REASON_SAVED',
      'mfg_reason',
      { id: code, code },
      pageId,
      { kind },
    );
    return (await masterService.listReasons(kind)).find((r) => S(r.code) === code)!;
  },

  // ---------------------------------------------------------------------------------------------- item planning
  async getPlanning(itemId: string): Promise<Row> {
    const it = (
      await query(
        prisma,
        `SELECT id::text, code, name, base_uom FROM items WHERE id=$1::uuid AND deleted_at IS NULL`,
        itemId,
      )
    )[0];
    if (!it) throw Errors.notFound('Item not found.');
    const p = (
      await query(prisma, `SELECT * FROM mfg_item_planning WHERE item_id=$1::uuid`, itemId)
    )[0];
    return {
      itemId,
      itemCode: S(it.code),
      itemName: S(it.name),
      ...(p
        ? norm<Row>(p)
        : {
            makeOrBuy: 'BUY',
            lowLevelCode: 0,
            leadTimeDays: 0,
            safetyStock: '0.000',
            lotSizing: 'LFL',
            fixedLotQty: null,
            minOrderQty: null,
            orderMultiple: null,
          }),
    };
  },
  async savePlanning(
    caller: Caller,
    pageId: string,
    itemId: string,
    b: {
      makeOrBuy?: 'MAKE' | 'BUY' | undefined;
      leadTimeDays?: number | undefined;
      safetyStock?: string | number | undefined;
      lotSizing?: 'LFL' | 'FIXED' | 'EOQ' | undefined;
      fixedLotQty?: string | number | null | undefined;
      minOrderQty?: string | number | null | undefined;
      orderMultiple?: string | number | null | undefined;
      eoqSetupCost?: string | number | null | undefined;
      eoqHoldingRate?: string | number | null | undefined;
      backflushWhId?: string | null | undefined;
      wipWhId?: string | null | undefined;
      fgWhId?: string | null | undefined;
    },
  ): Promise<Row> {
    await masterService.getPlanning(itemId);
    const cur = (
      await query(prisma, `SELECT * FROM mfg_item_planning WHERE item_id=$1::uuid`, itemId)
    )[0];
    const pick = (v: unknown, old: unknown): unknown => (v === undefined ? (old ?? null) : v);
    const lot = b.lotSizing ?? (cur ? S(cur.lot_sizing) : 'LFL');
    const fixed = pick(b.fixedLotQty, cur?.fixed_lot_qty) as string | number | null;
    if (lot === 'FIXED' && (fixed === null || D(String(fixed)).lte(0)))
      throw Errors.validation({ fixedLotQty: 'Enter the fixed lot quantity.' });
    const setup = pick(b.eoqSetupCost, cur?.eoq_setup_cost) as string | number | null;
    const hold = pick(b.eoqHoldingRate, cur?.eoq_holding_rate) as string | number | null;
    if (lot === 'EOQ' && (setup === null || hold === null))
      throw Errors.validation({ eoqSetupCost: 'EOQ needs the setup cost and the holding rate.' });
    await exec(
      prisma,
      `INSERT INTO mfg_item_planning (item_id, make_or_buy, lead_time_days, safety_stock, lot_sizing, fixed_lot_qty, min_order_qty, order_multiple, eoq_setup_cost, eoq_holding_rate, backflush_wh_id, wip_wh_id, fg_wh_id, updated_by_id)
       VALUES ($1::uuid, COALESCE($2,'BUY'), COALESCE($3,0), COALESCE($4::numeric,0), $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::uuid, $12::uuid, $13::uuid, $14::uuid)
       ON CONFLICT (item_id) DO UPDATE SET make_or_buy=COALESCE($2, mfg_item_planning.make_or_buy), lead_time_days=COALESCE($3, mfg_item_planning.lead_time_days),
         safety_stock=COALESCE($4::numeric, mfg_item_planning.safety_stock), lot_sizing=$5, fixed_lot_qty=$6::numeric, min_order_qty=$7::numeric, order_multiple=$8::numeric,
         eoq_setup_cost=$9::numeric, eoq_holding_rate=$10::numeric, backflush_wh_id=$11::uuid, wip_wh_id=$12::uuid, fg_wh_id=$13::uuid, updated_by_id=$14::uuid, updated_at=now()`,
      itemId,
      b.makeOrBuy ?? null,
      b.leadTimeDays ?? null,
      num(b.safetyStock),
      lot,
      num(fixed),
      num(pick(b.minOrderQty, cur?.min_order_qty) as string | number | null),
      num(pick(b.orderMultiple, cur?.order_multiple) as string | number | null),
      num(setup),
      num(hold),
      (pick(b.backflushWhId, cur?.backflush_wh_id) as string | null) ?? null,
      (pick(b.wipWhId, cur?.wip_wh_id) as string | null) ?? null,
      (pick(b.fgWhId, cur?.fg_wh_id) as string | null) ?? null,
      caller.auth.userId,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_ITEM_PLANNING_SAVED',
      'mfg_item_planning',
      { id: itemId, code: itemId },
      pageId,
      {},
    );
    return masterService.getPlanning(itemId);
  },

  // ---------------------------------------------------------------------------------------------- settings
  async settings(unitId: string | null): Promise<Record<string, string>> {
    const rows = await query(
      prisma,
      `SELECT key, value::text AS v FROM mfg_settings WHERE unit_id IS NULL OR unit_id=$1::uuid ORDER BY (unit_id IS NULL) DESC`,
      unitId ?? '00000000-0000-0000-0000-000000000000',
    );
    const out: Record<string, string> = {};
    for (const r of rows) out[S(r.key)] = S(r.v);
    return out;
  },
  async saveSetting(
    caller: Caller,
    pageId: string,
    key: 'OVER_ISSUE_PCT' | 'ORDER_APPROVAL_VALUE' | 'SCRAP_APPROVAL_VALUE',
    value: string | number | null,
  ): Promise<Record<string, string>> {
    const unitId = oneUnit(caller);
    if (value === null)
      await exec(prisma, `DELETE FROM mfg_settings WHERE key=$1 AND unit_id=$2::uuid`, key, unitId);
    else {
      if (D(String(value)).lt(0)) throw Errors.validation({ value: 'Enter 0 or more.' });
      await exec(
        prisma,
        `INSERT INTO mfg_settings (unit_id, key, value, updated_by_id) VALUES ($1::uuid, $2, $3::numeric, $4::uuid)
         ON CONFLICT (key, COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET value=$3::numeric, needs_review=false, updated_at=now(), updated_by_id=$4::uuid`,
        unitId,
        key,
        D(String(value)).toFixed(4),
        caller.auth.userId,
      );
    }
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_SETTING_SAVED',
      'mfg_setting',
      { id: key, code: key },
      pageId,
      {
        value: value === null ? 'cleared' : String(value),
      },
    );
    return masterService.settings(unitId);
  },
};
