// Phase 14 CMMS: PM plans (time, meter or whichever comes first) that raise schedules and work orders, breakdown tickets that raise
// a corrective work order (the SAP PM pattern), work orders with tasks / spares / labour / vendor charges, downtime events and
// alerts. MTBF, MTTR and availability come only from logged events. Spares leave stock through the Phase 8 StockService and
// post to the ledger in the same transaction (Dr maintenance expense / Cr inventory).
import { randomBytes, randomUUID } from 'node:crypto';
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
import { D as ID, round2, ZERO } from '../inventory/money';
import { StockGl } from '../inventory/stock/gl';
import { StockService } from '../inventory/stock/stock-service';
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
import type { Caller } from '../records/service';
import { S, oneUnit } from '../mfg/master-service';
import { assetService } from './asset-service';
import { D, addDays, r2 } from './calc';

const NO = { PMP: 'maint:PMP', BD: 'maint:BD', MWO: 'maint:MWO', DT: 'maint:DT' } as const;
const num = (v: unknown): string => D(S(v) || 0).toFixed();

async function nextNo(tx: Db, unitId: string, fyId: string, key: keyof typeof NO): Promise<string> {
  return NumberingService.allocate(tx, { pageId: NO[key], unitId, fyId, prefix: key });
}

const DT_ERR = (e: unknown): never => {
  if (String((e as Error).message).includes('DOWNTIME_OVERLAP'))
    throw Errors.validation({
      startAt: 'This asset already has downtime recorded for part of this time.',
    });
  throw e;
};

export interface PlanInput {
  assetId: string;
  title: string;
  triggerType: 'TIME' | 'METER' | 'BOTH';
  intervalDays?: number | undefined;
  meterId?: string | undefined;
  intervalMeter?: string | number | undefined;
  leadDays?: number | undefined;
  estHours?: string | number | undefined;
  skillDesignation?: string | undefined;
  checklistTemplateId?: string | undefined;
  startFrom?: string | undefined;
  spares?: { itemId: string; qty: string | number; uom?: string | undefined }[] | undefined;
}
export interface WoInput {
  assetId: string;
  woType: 'PM' | 'BREAKDOWN' | 'CORRECTIVE' | 'CALIBRATION' | 'AMC';
  description: string;
  priority?: 'P1' | 'P2' | 'P3' | undefined;
  plannedStart?: string | undefined;
  plannedEnd?: string | undefined;
  estCost?: string | number | undefined;
  checklistTemplateId?: string | undefined;
}

/** All the PM schedules due now for a unit; each raises its work order. Safe to run any number of times (generated_key). */
export async function generatePmSchedules(
  db: Db,
  unitId: string,
  fyId: string,
  actorId: string | null,
  today: string,
): Promise<number> {
  const plans = await query(
    db,
    `SELECT p.*, a.status AS asset_status FROM pm_plans p JOIN assets a ON a.id=p.asset_id
      WHERE p.unit_id=$1::uuid AND a.unit_id=p.unit_id AND p.active AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND a.status <> 'DISPOSED'`,
    unitId,
  );
  let made = 0;
  for (const p of plans) {
    // one open service per plan: a time and a meter trigger of the same plan never raise two jobs
    if (
      (
        await query(
          db,
          `SELECT 1 FROM pm_schedules WHERE plan_id=$1::uuid AND status IN ('PLANNED','WO_CREATED') LIMIT 1`,
          S(p.id),
        )
      ).length
    )
      continue;
    const due: { key: string; dueDate: string | null; dueMeter: string | null }[] = [];
    const type = S(p.trigger_type);
    if (type !== 'METER') {
      const base = S(p.last_done_on).slice(0, 10) || S(p.start_from).slice(0, 10);
      const d = addDays(base, Number(p.interval_days));
      if (d <= addDays(today, Number(p.lead_days)))
        due.push({ key: `${S(p.id)}:T:${d}`, dueDate: d, dueMeter: null });
    }
    if (type !== 'TIME' && p.meter_id) {
      const cur = (
        await query(
          db,
          `SELECT value::text FROM meter_readings WHERE meter_id=$1::uuid ORDER BY reading_at DESC, id DESC LIMIT 1`,
          S(p.meter_id),
        )
      )[0];
      const base = D(S(p.last_done_meter) || 0);
      const dm = base.plus(S(p.interval_meter));
      if (cur && D(S(cur.value)).gte(dm))
        due.push({ key: `${S(p.id)}:M:${dm.toFixed(3)}`, dueDate: null, dueMeter: dm.toFixed(3) });
    }
    for (const x of due) {
      const sid = randomUUID();
      const n = await exec(
        db,
        `INSERT INTO pm_schedules (id, unit_id, plan_id, due_date, due_meter, status, generated_key) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::date,$5::numeric,'PLANNED',$6)
         ON CONFLICT (generated_key) DO NOTHING`,
        sid,
        unitId,
        S(p.id),
        x.dueDate,
        x.dueMeter,
        x.key,
      );
      if (n === 0) continue;
      const wo = await createWo(db, unitId, fyId, actorId, {
        assetId: S(p.asset_id),
        woType: 'PM',
        description: S(p.title),
        priority: 'P3',
        ...(x.dueDate ? { plannedStart: x.dueDate } : {}),
        checklistTemplateId: p.checklist_template_id ? S(p.checklist_template_id) : undefined,
        source: { type: 'PM_SCHEDULE', id: sid },
        spares: (
          await query(
            db,
            `SELECT item_id::text, qty::text FROM pm_plan_spares WHERE plan_id=$1::uuid`,
            S(p.id),
          )
        ).map((r) => ({ itemId: S(r.item_id), qty: S(r.qty) })),
      });
      await exec(
        db,
        `UPDATE pm_schedules SET status='WO_CREATED', wo_id=$1::uuid WHERE id=$2::uuid`,
        wo,
        sid,
      );
      made++;
    }
  }
  return made;
}

async function createWo(
  db: Db,
  unitId: string,
  fyId: string,
  actorId: string | null,
  b: WoInput & {
    source?: { type: 'PM_SCHEDULE' | 'BREAKDOWN' | 'MANUAL'; id: string };
    spares?: { itemId: string; qty: string }[];
  },
): Promise<string> {
  const a = (
    await query(
      db,
      `SELECT unit_id::text, status FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
      b.assetId,
    )
  )[0];
  if (!a) throw Errors.validation({ assetId: 'Asset not found.' });
  if (S(a.unit_id) !== unitId)
    throw Errors.validation({ assetId: 'The asset belongs to another unit.' });
  if (S(a.status) === 'DISPOSED') throw Errors.validation({ assetId: 'The asset is disposed.' });
  const no = await nextNo(db, unitId, fyId, 'MWO');
  const id = await insertRow(db, 'maint_work_orders', {
    unitId,
    fyId,
    mwoNo: no,
    woType: b.woType,
    assetId: b.assetId,
    sourceType: b.source?.type ?? 'MANUAL',
    sourceId: b.source?.id ?? null,
    description: b.description.slice(0, 400),
    priority: b.priority ?? 'P2',
    plannedStart: b.plannedStart ?? null,
    plannedEnd: b.plannedEnd ?? null,
    estCost: b.estCost === undefined ? '0' : D(String(b.estCost)).toFixed(2),
    createdById: actorId,
    updatedById: actorId,
  });
  if (b.checklistTemplateId)
    await exec(
      db,
      `INSERT INTO mwo_tasks (wo_id, seq, text, answer_type, min_value, max_value)
       SELECT $1::uuid, seq, text, answer_type, min_value, max_value FROM checklist_template_items WHERE template_id=$2::uuid ORDER BY seq`,
      id,
      b.checklistTemplateId,
    );
  for (const s of b.spares ?? [])
    await insertRow(db, 'mwo_spares', {
      woId: id,
      itemId: s.itemId,
      requiredQty: D(s.qty).toFixed(3),
    });
  return id;
}

/** Locks one work order of the caller's unit. */
async function lockWo(tx: Db, caller: Caller, id: string): Promise<Row> {
  const w = (
    await query(
      tx,
      `SELECT w.*, a.asset_no, a.name AS asset_name FROM maint_work_orders w JOIN assets a ON a.id=w.asset_id
        WHERE w.id=$1::uuid AND w.deleted_at IS NULL AND ($2::uuid IS NULL OR w.unit_id=$2::uuid) FOR UPDATE OF w`,
      id,
      caller.ctx.unitId ?? null,
    )
  )[0];
  if (!w) throw Errors.notFound('Work order not found.');
  return w;
}

async function setAssetStatusAfter(tx: Db, assetId: string): Promise<void> {
  const busy = (
    await query(
      tx,
      `SELECT 1 FROM maint_work_orders WHERE asset_id=$1::uuid AND status='IN_PROGRESS' AND deleted_at IS NULL LIMIT 1`,
      assetId,
    )
  ).length;
  await exec(
    tx,
    `UPDATE assets SET status=$1, updated_at=now(), version=version+1 WHERE id=$2::uuid AND status IN ('ACTIVE','UNDER_MAINT','IDLE')`,
    busy ? 'UNDER_MAINT' : 'ACTIVE',
    assetId,
  );
}

export const maintService = {
  // ---------------------------------------------------------------------------------------------- checklists
  async listChecklists(): Promise<Row[]> {
    const t = await query(
      prisma,
      `SELECT * FROM checklist_templates WHERE deleted_at IS NULL ORDER BY code`,
    );
    const items = await query(
      prisma,
      `SELECT * FROM checklist_template_items ORDER BY template_id, seq`,
    );
    return t.map((x) => ({
      ...norm<Row>(x),
      items: items.filter((i) => S(i.template_id) === S(x.id)).map((i) => norm<Row>(i)),
    }));
  },

  async saveChecklist(
    caller: Caller,
    pageId: string,
    id: string | null,
    b: {
      code?: string | undefined;
      name: string;
      items: {
        text: string;
        answerType?: 'OK_NOTOK' | 'NUMBER' | 'TEXT' | undefined;
        min?: string | number | undefined;
        max?: string | number | undefined;
      }[];
    },
  ): Promise<Row[]> {
    if (!b.items.length) throw Errors.validation({ items: 'Add at least one check.' });
    await prisma.$transaction(async (tx) => {
      let tid = id;
      if (!tid) {
        if (!b.code) throw Errors.validation({ code: 'Enter a code.' });
        if (
          (
            await query(
              tx,
              `SELECT 1 FROM checklist_templates WHERE code=$1 AND deleted_at IS NULL`,
              b.code,
            )
          ).length
        )
          throw Errors.validation({ code: 'This code is already used.' });
        tid = await insertRow(tx, 'checklist_templates', {
          code: b.code.trim().toUpperCase(),
          name: b.name.trim(),
        });
      } else {
        await exec(
          tx,
          `UPDATE checklist_templates SET name=$1, version=version+1 WHERE id=$2::uuid`,
          b.name.trim(),
          tid,
        );
        await exec(tx, `DELETE FROM checklist_template_items WHERE template_id=$1::uuid`, tid);
      }
      let seq = 1;
      for (const i of b.items) {
        if (
          i.answerType === 'NUMBER' &&
          i.min !== undefined &&
          i.max !== undefined &&
          D(String(i.min)).gt(String(i.max))
        )
          throw Errors.validation({ items: 'A minimum cannot be above its maximum.' });
        await insertRow(tx, 'checklist_template_items', {
          templateId: tid,
          seq: seq++,
          text: i.text.slice(0, 300),
          answerType: i.answerType ?? 'OK_NOTOK',
          minValue: i.min === undefined ? null : D(String(i.min)).toFixed(3),
          maxValue: i.max === undefined ? null : D(String(i.max)).toFixed(3),
        });
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'CHECKLIST_SAVED',
        'checklist_template',
        { id: tid, code: b.code ?? tid },
        pageId,
        {},
      );
    });
    return maintService.listChecklists();
  },

  // ---------------------------------------------------------------------------------------------- PM plans
  async listPlans(
    caller: Caller,
    pageId: string,
    q: { assetId?: string | undefined; active?: boolean | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.assetId) {
      args.push(q.assetId);
      where.push(`t.asset_id=$${args.length}::uuid`);
    }
    if (q.active !== undefined) {
      args.push(q.active);
      where.push(`t.active=$${args.length}`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (await query(prisma, `SELECT count(*)::int AS n FROM pm_plans t WHERE ${w}`, ...args))[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name, m.meter_type,
              (SELECT min(s.due_date) FROM pm_schedules s WHERE s.plan_id=t.id AND s.status IN ('PLANNED','WO_CREATED')) AS next_due
         FROM pm_plans t JOIN assets a ON a.id=t.asset_id LEFT JOIN meters m ON m.id=t.meter_id
        WHERE ${w} ORDER BY t.plan_no LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getPlan(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const p = (
      await query(
        prisma,
        `SELECT t.*, a.asset_no, a.name AS asset_name FROM pm_plans t JOIN assets a ON a.id=t.asset_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!p) throw Errors.notFound('PM plan not found.');
    const spares = await query(
      prisma,
      `SELECT s.id::text, s.item_id::text, s.qty::text, s.uom, i.code AS item_code, i.name AS item_name FROM pm_plan_spares s JOIN items i ON i.id=s.item_id WHERE s.plan_id=$1::uuid`,
      id,
    );
    return { ...norm<Row>(p), spares: spares.map((r) => norm<Row>(r)) };
  },

  async createPlan(caller: Caller, pageId: string, b: PlanInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    checkPlan(b);
    const a = (
      await query(
        prisma,
        `SELECT unit_id::text, is_maintainable FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.assetId,
      )
    )[0];
    if (!a || S(a.unit_id) !== unitId)
      throw Errors.validation({ assetId: 'Choose an asset of this unit.' });
    if (a.is_maintainable !== true)
      throw Errors.validation({ assetId: 'This asset is not marked as maintainable.' });
    if (b.meterId) {
      const m = (
        await query(prisma, `SELECT asset_id::text FROM meters WHERE id=$1::uuid`, b.meterId)
      )[0];
      if (!m || S(m.asset_id) !== b.assetId)
        throw Errors.validation({ meterId: 'The meter belongs to another asset.' });
    }
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'PMP');
      const pid = await insertRow(tx, 'pm_plans', {
        unitId,
        planNo: no,
        assetId: b.assetId,
        title: b.title.trim(),
        triggerType: b.triggerType,
        intervalDays: b.intervalDays ?? null,
        meterId: b.meterId ?? null,
        intervalMeter: b.intervalMeter === undefined ? null : D(String(b.intervalMeter)).toFixed(3),
        leadDays: b.leadDays ?? 3,
        estHours: b.estHours === undefined ? null : D(String(b.estHours)).toFixed(2),
        skillDesignation: b.skillDesignation ?? null,
        checklistTemplateId: b.checklistTemplateId ?? null,
        startFrom: b.startFrom ?? todayIst(),
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      for (const s of b.spares ?? [])
        await insertRow(tx, 'pm_plan_spares', {
          planId: pid,
          itemId: s.itemId,
          qty: D(String(s.qty)).toFixed(3),
          uom: s.uom ?? null,
        });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'PM_PLAN_CREATED',
        'pm_plan',
        { id: pid, code: no },
        pageId,
        {},
      );
      return pid;
    }, TX);
    return maintService.getPlan(caller, pageId, id);
  },

  async setPlanActive(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    active: boolean,
  ): Promise<Row> {
    const cur = await maintService.getPlan(caller, pageId, id);
    checkVersion(cur, version);
    await exec(
      prisma,
      `UPDATE pm_plans SET active=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
      active,
      caller.auth.userId,
      id,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      active ? 'PM_PLAN_ACTIVATED' : 'PM_PLAN_DEACTIVATED',
      'pm_plan',
      { id, code: S(cur.planNo) },
      pageId,
      {},
    );
    return maintService.getPlan(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- PM schedule
  async listSchedules(
    caller: Caller,
    pageId: string,
    q: {
      status?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    // pm_schedules has no owner or soft-delete column, so only the unit filter applies
    void pageId;
    const args: unknown[] = [];
    const where: string[] = [];
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      where.push(`s.unit_id=$1::uuid`);
    } else if (!caller.ctx.allUnits) where.push('false');
    if (!where.length) where.push('true');
    for (const [cond, v] of [
      [`s.status=?`, q.status],
      [`s.due_date >= ?::date`, q.from],
      [`s.due_date <= ?::date`, q.to],
    ] as const)
      if (v) {
        args.push(v);
        where.push(cond.replace('?', `$${args.length}`));
      }
    const w = where.join(' AND ');
    const total = Number(
      (await query(prisma, `SELECT count(*)::int AS n FROM pm_schedules s WHERE ${w}`, ...args))[0]!
        .n,
    );
    const rows = await query(
      prisma,
      `SELECT s.*, p.plan_no, p.title, a.asset_no, a.name AS asset_name, w.mwo_no
         FROM pm_schedules s JOIN pm_plans p ON p.id=s.plan_id JOIN assets a ON a.id=p.asset_id LEFT JOIN maint_work_orders w ON w.id=s.wo_id
        WHERE ${w} ORDER BY s.due_date NULLS LAST, p.plan_no LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async generate(caller: Caller): Promise<{ created: number }> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const n = await prisma.$transaction(
      (tx) => generatePmSchedules(tx, unitId, fy.id, caller.auth.userId, todayIst()),
      TX,
    );
    return { created: n };
  },

  async skipSchedule(caller: Caller, pageId: string, id: string): Promise<Row> {
    const r = (
      await query(
        prisma,
        `SELECT s.status FROM pm_schedules s WHERE s.id=$1::uuid AND ($2::uuid IS NULL OR s.unit_id=$2::uuid)`,
        id,
        caller.ctx.unitId ?? null,
      )
    )[0];
    if (!r) throw Errors.notFound('Schedule not found.');
    if (S(r.status) !== 'PLANNED')
      throw Errors.conflict('Only a schedule without a work order can be skipped.');
    await exec(prisma, `UPDATE pm_schedules SET status='SKIPPED' WHERE id=$1::uuid`, id);
    await advancePlanPast(prisma, id);
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'PM_SCHEDULE_SKIPPED',
      'pm_schedule',
      { id, code: id },
      pageId,
      {},
    );
    return norm<Row>((await query(prisma, `SELECT * FROM pm_schedules WHERE id=$1::uuid`, id))[0]!);
  },

  // ---------------------------------------------------------------------------------------------- breakdown tickets
  async listBreakdowns(
    caller: Caller,
    pageId: string,
    q: { status?: string | undefined; assetId?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    for (const [cond, v] of [
      [`t.status=?`, q.status],
      [`t.asset_id=?::uuid`, q.assetId],
    ] as const)
      if (v) {
        args.push(v);
        where.push(cond.replace('?', `$${args.length}`));
      }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM breakdown_tickets t WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name, a.criticality, w.mwo_no FROM breakdown_tickets t JOIN assets a ON a.id=t.asset_id LEFT JOIN maint_work_orders w ON w.id=t.wo_id
        WHERE ${w} ORDER BY t.reported_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getBreakdown(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.*, a.asset_no, a.name AS asset_name, w.mwo_no, w.status AS wo_status FROM breakdown_tickets t JOIN assets a ON a.id=t.asset_id LEFT JOIN maint_work_orders w ON w.id=t.wo_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Breakdown ticket not found.');
    return norm<Row>(r);
  },

  async raise(
    caller: Caller,
    pageId: string,
    b: {
      assetId: string;
      symptom: string;
      priority?: 'P1' | 'P2' | 'P3' | undefined;
      machineStopped?: boolean | undefined;
      reportedAt?: string | undefined;
      photos?: string[] | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const a = (
      await query(
        prisma,
        `SELECT unit_id::text, status, work_centre_id::text FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.assetId,
      )
    )[0];
    if (!a || S(a.unit_id) !== unitId)
      throw Errors.validation({ assetId: 'Choose an asset of this unit.' });
    if (['DISPOSED', 'CWIP'].includes(S(a.status)))
      throw Errors.validation({ assetId: 'This asset is not in service.' });
    const at = b.reportedAt ?? new Date().toISOString();
    const stopped = b.machineStopped ?? true;
    const id = await prisma.$transaction(async (tx) => {
      const no = await nextNo(tx, unitId, fy.id, 'BD');
      const bid = await insertRow(tx, 'breakdown_tickets', {
        unitId,
        fyId: fy.id,
        bdNo: no,
        assetId: b.assetId,
        reportedAt: at,
        reportedById: caller.auth.userId,
        symptom: b.symptom.trim(),
        photos: JSON.stringify(b.photos ?? []),
        priority: b.priority ?? 'P2',
        machineStopped: stopped,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      if (stopped) {
        // a planned stop (a PM in progress) that runs into a real failure ends where the failure begins
        await exec(
          tx,
          `UPDATE downtime_events SET end_at=$1::timestamptz WHERE asset_id=$2::uuid AND dt_type='PLANNED' AND end_at IS NULL AND deleted_at IS NULL AND start_at < $1::timestamptz`,
          at,
          b.assetId,
        );
        try {
          await insertRow(tx, 'downtime_events', {
            unitId,
            dtNo: await nextNo(tx, unitId, fy.id, 'DT'),
            assetId: b.assetId,
            workCentreId: a.work_centre_id ? S(a.work_centre_id) : null,
            startAt: at,
            dtType: 'UNPLANNED',
            reason: b.symptom.slice(0, 200),
            breakdownId: bid,
            createdById: caller.auth.userId,
          });
        } catch (e) {
          DT_ERR(e);
        }
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'BREAKDOWN_RAISED',
        'breakdown_ticket',
        { id: bid, code: no },
        pageId,
        {},
      );
      return bid;
    }, TX);
    return maintService.getBreakdown(caller, pageId, id);
  },

  /** Acknowledge: the ticket raises its corrective work order and the asset goes under maintenance. */
  async acknowledge(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const t = await lockBd(tx, caller, id);
      checkVersion(norm<Row>(t), version);
      if (S(t.status) !== 'OPEN') throw Errors.conflict('Only an open ticket can be acknowledged.');
      const fy = await fyOfCaller(caller);
      const wo = await createWo(tx, S(t.unit_id), fy.id, caller.auth.userId, {
        assetId: S(t.asset_id),
        woType: 'BREAKDOWN',
        description: S(t.symptom),
        priority: S(t.priority) as 'P1' | 'P2' | 'P3',
        source: { type: 'BREAKDOWN', id },
      });
      await exec(
        tx,
        `UPDATE breakdown_tickets SET status='ACK', acknowledged_at=now(), wo_id=$1::uuid, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        wo,
        caller.auth.userId,
        id,
      );
      await exec(
        tx,
        `UPDATE assets SET status='UNDER_MAINT', updated_at=now(), version=version+1 WHERE id=$1::uuid AND status IN ('ACTIVE','IDLE')`,
        S(t.asset_id),
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'BREAKDOWN_ACKNOWLEDGED',
        'breakdown_ticket',
        { id, code: S(t.bd_no) },
        pageId,
        {},
      );
    }, TX);
    return maintService.getBreakdown(caller, pageId, id);
  },

  async startRepair(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const t = await lockBd(tx, caller, id);
      checkVersion(norm<Row>(t), version);
      if (S(t.status) !== 'ACK') throw Errors.conflict('Acknowledge the ticket first.');
      await exec(
        tx,
        `UPDATE breakdown_tickets SET status='IN_REPAIR', repair_started_at=now(), updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      if (t.wo_id) await startWoTx(tx, caller, S(t.wo_id), pageId);
    }, TX);
    return maintService.getBreakdown(caller, pageId, id);
  },

  async resolve(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: {
      failureMode: string;
      failureCause: string;
      failureMechanism?: string | undefined;
      rootCause?: string | undefined;
      repairedAt?: string | undefined;
    },
  ): Promise<Row> {
    for (const [kind, code, field] of [
      ['MODE', b.failureMode, 'failureMode'],
      ['CAUSE', b.failureCause, 'failureCause'],
      ['MECHANISM', b.failureMechanism, 'failureMechanism'],
    ] as const)
      if (
        code &&
        !(await query(prisma, `SELECT 1 FROM failure_codes WHERE kind=$1 AND code=$2`, kind, code))
          .length
      )
        throw Errors.validation({ [field]: 'Unknown failure code.' });
    await prisma.$transaction(async (tx) => {
      const t = await lockBd(tx, caller, id);
      checkVersion(norm<Row>(t), version);
      if (!['ACK', 'IN_REPAIR'].includes(S(t.status)))
        throw Errors.conflict('Only a ticket being repaired can be resolved.');
      const at = b.repairedAt ?? new Date().toISOString();
      if (Date.parse(at) < Date.parse(S(t.reported_at)))
        throw Errors.validation({ repairedAt: 'Repair cannot be before the report time.' });
      await exec(
        tx,
        `UPDATE breakdown_tickets SET status='RESOLVED', repaired_at=$1::timestamptz, failure_mode=$2, failure_cause=$3, failure_mechanism=$4, root_cause=$5,
                repair_started_at=COALESCE(repair_started_at,$1::timestamptz), updated_by_id=$6::uuid, updated_at=now(), version=version+1 WHERE id=$7::uuid`,
        at,
        b.failureMode,
        b.failureCause,
        b.failureMechanism ?? null,
        b.rootCause?.slice(0, 400) ?? null,
        caller.auth.userId,
        id,
      );
      await exec(
        tx,
        `UPDATE downtime_events SET end_at=$1::timestamptz WHERE breakdown_id=$2::uuid AND end_at IS NULL AND $1::timestamptz > start_at`,
        at,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'BREAKDOWN_RESOLVED',
        'breakdown_ticket',
        { id, code: S(t.bd_no) },
        pageId,
        {},
      );
    }, TX);
    return maintService.getBreakdown(caller, pageId, id);
  },

  async closeBreakdown(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const t = await lockBd(tx, caller, id);
      checkVersion(norm<Row>(t), version);
      if (S(t.status) !== 'RESOLVED') throw Errors.conflict('Resolve the ticket first.');
      if (t.wo_id) {
        const w = (
          await query(tx, `SELECT status FROM maint_work_orders WHERE id=$1::uuid`, S(t.wo_id))
        )[0]!;
        if (!['COMPLETED', 'CLOSED'].includes(S(w.status)))
          throw Errors.conflict('Complete the work order before closing the ticket.');
      }
      await exec(
        tx,
        `UPDATE breakdown_tickets SET status='CLOSED', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'BREAKDOWN_CLOSED',
        'breakdown_ticket',
        { id, code: S(t.bd_no) },
        pageId,
        {},
      );
    }, TX);
    return maintService.getBreakdown(caller, pageId, id);
  },

  async cancelBreakdown(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    reason: string,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const t = await lockBd(tx, caller, id);
      checkVersion(norm<Row>(t), version);
      if (!['OPEN', 'ACK'].includes(S(t.status)))
        throw Errors.conflict('Only an open or acknowledged ticket can be cancelled.');
      await exec(
        tx,
        `UPDATE breakdown_tickets SET status='CANCELLED', root_cause=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        reason.slice(0, 400),
        caller.auth.userId,
        id,
      );
      await exec(
        tx,
        `UPDATE downtime_events SET deleted_at=now() WHERE breakdown_id=$1::uuid AND end_at IS NULL`,
        id,
      );
      if (t.wo_id) {
        await exec(
          tx,
          `UPDATE maint_work_orders SET status='CANCELLED', updated_at=now(), version=version+1 WHERE id=$1::uuid AND status IN ('PLANNED','APPROVED')`,
          S(t.wo_id),
        );
        await setAssetStatusAfter(tx, S(t.asset_id));
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'BREAKDOWN_CANCELLED',
        'breakdown_ticket',
        { id, code: S(t.bd_no) },
        pageId,
        { reason },
      );
    }, TX);
    return maintService.getBreakdown(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- work orders
  async listWorkOrders(
    caller: Caller,
    pageId: string,
    q: {
      kinds?: string[] | undefined;
      notKinds?: string[] | undefined;
      type?: string | undefined;
      status?: string | undefined;
      assetId?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    for (const [cond, v] of [
      [`a.asset_kind = ANY(?::text[])`, q.kinds],
      [`NOT (a.asset_kind = ANY(?::text[]))`, q.notKinds],
      [`t.wo_type=?`, q.type],
      [`t.status=?`, q.status],
      [`t.asset_id=?::uuid`, q.assetId],
    ] as const)
      if (v && (!Array.isArray(v) || v.length)) {
        args.push(v);
        where.push(cond.replace('?', `$${args.length}`));
      }
    const w = where.join(' AND ');
    const base = `FROM maint_work_orders t JOIN assets a ON a.id=t.asset_id WHERE ${w}`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n ${base}`, ...args))[0]!.n);
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name, a.asset_kind ${base} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async getWorkOrder(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const w = (
      await query(
        prisma,
        `SELECT t.*, a.asset_no, a.name AS asset_name, a.asset_kind FROM maint_work_orders t JOIN assets a ON a.id=t.asset_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!w) throw Errors.notFound('Work order not found.');
    const [tasks, spares, labour, vendor] = await Promise.all([
      query(prisma, `SELECT * FROM mwo_tasks WHERE wo_id=$1::uuid ORDER BY seq`, id),
      query(
        prisma,
        `SELECT s.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom FROM mwo_spares s JOIN items i ON i.id=s.item_id WHERE s.wo_id=$1::uuid ORDER BY i.code`,
        id,
      ),
      query(
        prisma,
        `SELECT l.*, u.name AS employee_name FROM mwo_labour l LEFT JOIN users u ON u.id=l.employee_id WHERE l.wo_id=$1::uuid ORDER BY l.start_at`,
        id,
      ),
      query(
        prisma,
        `SELECT v.*, s.name AS supplier_name FROM mwo_vendor_charges v LEFT JOIN suppliers s ON s.id=v.supplier_id WHERE v.wo_id=$1::uuid`,
        id,
      ),
    ]);
    const sp = spares.reduce((a, r) => a.plus(S(r.amount)), ZERO);
    const lb = labour.reduce((a, r) => a.plus(S(r.amount)), ZERO);
    const vn = vendor.reduce((a, r) => a.plus(S(r.amount)), ZERO);
    return {
      ...norm<Row>(w),
      tasks: tasks.map((r) => norm<Row>(r)),
      spares: spares.map((r) => norm<Row>(r)),
      labour: labour.map((r) => norm<Row>(r)),
      vendorCharges: vendor.map((r) => norm<Row>(r)),
      cost: {
        spares: round2(sp).toFixed(2),
        labour: round2(lb).toFixed(2),
        vendor: round2(vn).toFixed(2),
        total: round2(sp.plus(lb).plus(vn)).toFixed(2),
      },
    };
  },

  async createWorkOrder(caller: Caller, pageId: string, b: WoInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      const wid = await createWo(tx, unitId, fy.id, caller.auth.userId, b);
      const w = (
        await query(tx, `SELECT mwo_no FROM maint_work_orders WHERE id=$1::uuid`, wid)
      )[0]!;
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MWO_CREATED',
        'maint_work_order',
        { id: wid, code: S(w.mwo_no) },
        pageId,
        {},
      );
      return wid;
    }, TX);
    return maintService.getWorkOrder(caller, pageId, id);
  },

  async submitWo(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await transitionWo(caller, pageId, id, version, ['PLANNED'], (w) => {
      if (S(w.approval_status) === 'PENDING')
        throw Errors.conflict('It is already waiting for approval.');
      return `approval_status='PENDING'`;
    });
    return maintService.getWorkOrder(caller, pageId, id);
  },

  async approveWo(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    approve: boolean,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const w = await lockWo(tx, caller, id);
      checkVersion(norm<Row>(w), version);
      if (S(w.approval_status) !== 'PENDING')
        throw Errors.conflict('This work order is not waiting for approval.');
      await exec(
        tx,
        approve
          ? `UPDATE maint_work_orders SET approval_status='APPROVED', status='APPROVED', approved_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`
          : `UPDATE maint_work_orders SET approval_status='REJECTED', updated_at=now(), updated_by_id=$1::uuid, version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        approve ? 'MWO_APPROVED' : 'MWO_REJECTED',
        'maint_work_order',
        { id, code: S(w.mwo_no) },
        pageId,
        {},
      );
    }, TX);
    return maintService.getWorkOrder(caller, pageId, id);
  },

  async startWo(caller: Caller, pageId: string, id: string): Promise<Row> {
    await prisma.$transaction((tx) => startWoTx(tx, caller, id, pageId), TX);
    return maintService.getWorkOrder(caller, pageId, id);
  },

  async recordTask(
    caller: Caller,
    pageId: string,
    woId: string,
    taskId: string,
    result: string,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const w = await lockWo(tx, caller, woId);
      if (S(w.status) !== 'IN_PROGRESS')
        throw Errors.conflict('Start the work order before recording checks.');
      const t = (
        await query(
          tx,
          `SELECT * FROM mwo_tasks WHERE id=$1::uuid AND wo_id=$2::uuid`,
          taskId,
          woId,
        )
      )[0];
      if (!t) throw Errors.notFound('Check not found.');
      const r = result.trim();
      if (!r) throw Errors.validation({ result: 'Enter the result.' });
      if (S(t.answer_type) === 'OK_NOTOK' && !['OK', 'NOT OK', 'NOTOK'].includes(r.toUpperCase()))
        throw Errors.validation({ result: 'Answer OK or NOT OK.' });
      if (S(t.answer_type) === 'NUMBER') {
        if (!/^-?\d+(\.\d+)?$/.test(r)) throw Errors.validation({ result: 'Enter a number.' });
        const n = D(r);
        if (
          (t.min_value !== null && n.lt(S(t.min_value))) ||
          (t.max_value !== null && n.gt(S(t.max_value)))
        )
          throw Errors.validation({
            result: `Out of range (${num(t.min_value)} to ${num(t.max_value)}).`,
          });
      }
      await exec(
        tx,
        `UPDATE mwo_tasks SET result=$1, done_by_id=$2::uuid, done_at=now() WHERE id=$3::uuid`,
        r.slice(0, 200),
        caller.auth.userId,
        taskId,
      );
    }, TX);
    return maintService.getWorkOrder(caller, pageId, woId);
  },

  async addSpare(
    caller: Caller,
    pageId: string,
    woId: string,
    b: { itemId: string; qty: string | number; warehouseId?: string | undefined },
  ): Promise<Row> {
    const w = await maintService.getWorkOrder(caller, pageId, woId);
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(S(w.status)))
      throw Errors.conflict('This work order is finished.');
    if (D(String(b.qty)).lte(0))
      throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    const it = (
      await query(prisma, `SELECT 1 FROM items WHERE id=$1::uuid AND deleted_at IS NULL`, b.itemId)
    )[0];
    if (!it) throw Errors.validation({ itemId: 'Item not found.' });
    await insertRow(prisma, 'mwo_spares', {
      woId,
      itemId: b.itemId,
      warehouseId: b.warehouseId ?? null,
      requiredQty: D(String(b.qty)).toFixed(3),
    });
    return maintService.getWorkOrder(caller, pageId, woId);
  },

  /** Issue spares: stock leaves the warehouse and the cost goes to maintenance expense, in one transaction. */
  async issueSpare(
    caller: Caller,
    pageId: string,
    woId: string,
    spareId: string,
    b: { qty: string | number; warehouseId?: string | undefined },
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const w = await lockWo(tx, caller, woId);
      if (S(w.status) !== 'IN_PROGRESS')
        throw Errors.conflict('Start the work order before issuing spares.');
      const sp = (
        await query(
          tx,
          `SELECT * FROM mwo_spares WHERE id=$1::uuid AND wo_id=$2::uuid FOR UPDATE`,
          spareId,
          woId,
        )
      )[0];
      if (!sp) throw Errors.notFound('Spare line not found.');
      const qty = D(String(b.qty));
      if (qty.lte(0)) throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
      const wh = b.warehouseId ?? (sp.warehouse_id ? S(sp.warehouse_id) : '');
      if (!wh) throw Errors.validation({ warehouseId: 'Choose the store to issue from.' });
      const whRow = (
        await query(tx, `SELECT unit_id::text FROM warehouses WHERE id=$1::uuid`, wh)
      )[0];
      if (!whRow || S(whRow.unit_id) !== S(w.unit_id))
        throw Errors.validation({ warehouseId: 'The store belongs to another unit.' });
      const voucherNo = `${S(w.mwo_no)}-I${randomBytes(2).toString('hex').toUpperCase()}`;
      const moveId = randomUUID();
      const date = todayIst();
      const res = await StockService.postMany(tx, [
        {
          warehouseId: wh,
          itemId: S(sp.item_id),
          direction: 'OUT',
          qty: ID(qty.toFixed(3)),
          postingDate: date,
          voucherType: 'MWO_ISSUE',
          voucherId: moveId,
          voucherNo,
          createdById: caller.auth.userId,
          reasonCode: 'MWO_ISSUE',
        },
      ]);
      let value = ZERO;
      const ledgerIds: string[] = [];
      for (const e of res[0]!.entries) {
        ledgerIds.push(e.id);
        value = value.plus(e.value);
      }
      const journal = await StockGl.post(tx, {
        voucherId: moveId,
        voucherNo,
        unitId: S(w.unit_id),
        postingDate: date,
        event: 'MAINT_SPARES_ISSUED',
        voucherType: 'Delivery',
        counter: 'MAINT_EXPENSE',
        ledgerIds,
        narration: `Spares issued to ${S(w.mwo_no)}`,
        actorId: caller.auth.userId,
      });
      const amt = round2(value);
      await exec(
        tx,
        `UPDATE mwo_spares SET warehouse_id=$1::uuid, issued_qty=issued_qty+$2::numeric, amount=amount+$3::numeric,
                rate=CASE WHEN issued_qty+$2::numeric > 0 THEN round((amount+$3::numeric)/(issued_qty+$2::numeric),6) ELSE 0 END,
                stock_voucher_id=$4::uuid, journal_id=$5::uuid WHERE id=$6::uuid`,
        wh,
        qty.toFixed(3),
        amt.toFixed(2),
        moveId,
        journal?.id ?? null,
        spareId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MWO_SPARES_ISSUED',
        'maint_work_order',
        { id: woId, code: S(w.mwo_no) },
        pageId,
        { voucherNo, value: amt.toFixed(2) },
      );
    }, TX);
    return maintService.getWorkOrder(caller, pageId, woId);
  },

  async returnSpare(
    caller: Caller,
    pageId: string,
    woId: string,
    spareId: string,
    qtyIn: string | number,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const w = await lockWo(tx, caller, woId);
      if (['CLOSED', 'CANCELLED'].includes(S(w.status)))
        throw Errors.conflict('This work order is closed.');
      const sp = (
        await query(
          tx,
          `SELECT * FROM mwo_spares WHERE id=$1::uuid AND wo_id=$2::uuid FOR UPDATE`,
          spareId,
          woId,
        )
      )[0];
      if (!sp) throw Errors.notFound('Spare line not found.');
      const qty = D(String(qtyIn));
      const out = D(S(sp.issued_qty)).minus(S(sp.returned_qty));
      if (qty.lte(0) || qty.gt(out))
        throw Errors.validation({ qty: `Only ${out.toFixed(3)} is out on this work order.` });
      // amount is already net of earlier returns, so the average is over what is still out
      const unitValue = D(S(sp.amount)).div(out);
      const value = qty.eq(out) ? D(S(sp.amount)) : r2(unitValue.mul(qty));
      const voucherNo = `${S(w.mwo_no)}-R${randomBytes(2).toString('hex').toUpperCase()}`;
      const moveId = randomUUID();
      const date = todayIst();
      const res = await StockService.postMany(tx, [
        {
          warehouseId: S(sp.warehouse_id),
          itemId: S(sp.item_id),
          direction: 'IN',
          qty: ID(qty.toFixed(3)),
          postingDate: date,
          voucherType: 'MWO_RETURN',
          voucherId: moveId,
          voucherNo,
          createdById: caller.auth.userId,
          reasonCode: 'MWO_RETURN',
          value: ID(r2(value).toFixed(2)),
          stockStatus: 'UNRESTRICTED',
        },
      ]);
      await StockGl.post(tx, {
        voucherId: moveId,
        voucherNo,
        unitId: S(w.unit_id),
        postingDate: date,
        event: 'MAINT_SPARES_RETURNED',
        voucherType: 'Goods Receipt',
        counter: 'MAINT_EXPENSE',
        ledgerIds: res[0]!.entries.map((e) => e.id),
        narration: `Spares returned from ${S(w.mwo_no)}`,
        actorId: caller.auth.userId,
      });
      await exec(
        tx,
        `UPDATE mwo_spares SET returned_qty=returned_qty+$1::numeric, amount=amount-$2::numeric WHERE id=$3::uuid`,
        qty.toFixed(3),
        r2(value).toFixed(2),
        spareId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MWO_SPARES_RETURNED',
        'maint_work_order',
        { id: woId, code: S(w.mwo_no) },
        pageId,
        { voucherNo },
      );
    }, TX);
    return maintService.getWorkOrder(caller, pageId, woId);
  },

  async addLabour(
    caller: Caller,
    pageId: string,
    woId: string,
    b: {
      employeeId?: string | undefined;
      vendorName?: string | undefined;
      startAt: string;
      endAt: string;
      rate: string | number;
    },
  ): Promise<Row> {
    const w = await maintService.getWorkOrder(caller, pageId, woId);
    if (['CLOSED', 'CANCELLED'].includes(S(w.status)))
      throw Errors.conflict('This work order is closed.');
    if (!b.employeeId && !b.vendorName)
      throw Errors.validation({ employeeId: 'Choose the person or name the vendor.' });
    const hours = D((Date.parse(b.endAt) - Date.parse(b.startAt)) / 3_600_000);
    if (hours.lte(0)) throw Errors.validation({ endAt: 'The end must be after the start.' });
    await insertRow(prisma, 'mwo_labour', {
      woId,
      employeeId: b.employeeId ?? null,
      vendorName: b.vendorName ?? null,
      startAt: b.startAt,
      endAt: b.endAt,
      rate: D(String(b.rate)).toFixed(2),
      amount: r2(hours.mul(String(b.rate))).toFixed(2),
    });
    return maintService.getWorkOrder(caller, pageId, woId);
  },

  async addVendorCharge(
    caller: Caller,
    pageId: string,
    woId: string,
    b: {
      supplierId?: string | undefined;
      invoiceRef?: string | undefined;
      amount: string | number;
    },
  ): Promise<Row> {
    const w = await maintService.getWorkOrder(caller, pageId, woId);
    if (['CLOSED', 'CANCELLED'].includes(S(w.status)))
      throw Errors.conflict('This work order is closed.');
    await insertRow(prisma, 'mwo_vendor_charges', {
      woId,
      supplierId: b.supplierId ?? null,
      invoiceRef: b.invoiceRef ?? null,
      amount: D(String(b.amount)).toFixed(2),
    });
    return maintService.getWorkOrder(caller, pageId, woId);
  },

  async completeWo(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const w = await lockWo(tx, caller, id);
      checkVersion(norm<Row>(w), version);
      if (S(w.status) !== 'IN_PROGRESS')
        throw Errors.conflict('Only a work order in progress can be completed.');
      const open = await query(
        tx,
        `SELECT 1 FROM mwo_tasks WHERE wo_id=$1::uuid AND result IS NULL LIMIT 1`,
        id,
      );
      if (open.length)
        throw Errors.validation({ tasks: 'Record the result of every check first.' });
      await exec(
        tx,
        `UPDATE maint_work_orders SET status='COMPLETED', actual_end=now(), updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      // planned downtime of a preventive job ends with the job
      await exec(
        tx,
        `UPDATE downtime_events SET end_at=now() WHERE dt_type='PLANNED' AND reason=$1 AND asset_id=$2::uuid AND end_at IS NULL`,
        `Work order ${S(w.mwo_no)}`,
        S(w.asset_id),
      );
      await setAssetStatusAfter(tx, S(w.asset_id));
      if (S(w.source_type) === 'PM_SCHEDULE' && w.source_id) {
        const sch = (
          await query(
            tx,
            `SELECT plan_id::text FROM pm_schedules WHERE id=$1::uuid`,
            S(w.source_id),
          )
        )[0];
        if (sch) {
          const plan = (
            await query(tx, `SELECT meter_id::text FROM pm_plans WHERE id=$1::uuid`, S(sch.plan_id))
          )[0]!;
          const cur = plan.meter_id
            ? (
                await query(
                  tx,
                  `SELECT value::text FROM meter_readings WHERE meter_id=$1::uuid ORDER BY reading_at DESC, id DESC LIMIT 1`,
                  S(plan.meter_id),
                )
              )[0]
            : null;
          await exec(
            tx,
            `UPDATE pm_plans SET last_done_on=CURRENT_DATE, last_done_meter=COALESCE($1::numeric, last_done_meter), version=version+1 WHERE id=$2::uuid`,
            cur ? S(cur.value) : null,
            S(sch.plan_id),
          );
          await exec(tx, `UPDATE pm_schedules SET status='DONE' WHERE id=$1::uuid`, S(w.source_id));
          await exec(
            tx,
            `UPDATE pm_schedules SET status='SKIPPED' WHERE plan_id=$1::uuid AND status='PLANNED' AND id <> $2::uuid`,
            S(sch.plan_id),
            S(w.source_id),
          );
        }
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MWO_COMPLETED',
        'maint_work_order',
        { id, code: S(w.mwo_no) },
        pageId,
        {},
      );
    }, TX);
    return maintService.getWorkOrder(caller, pageId, id);
  },

  /** Sign-off closes a completed order. Separation of duties is not enforced (a small plant has one person for both): say so if you want it. */
  async signOffWo(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const w = await lockWo(tx, caller, id);
      checkVersion(norm<Row>(w), version);
      if (S(w.status) !== 'COMPLETED')
        throw Errors.conflict('Complete the work order before signing it off.');
      await exec(
        tx,
        `UPDATE maint_work_orders SET status='CLOSED', sign_off_by_id=$1::uuid, sign_off_at=now(), updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MWO_SIGNED_OFF',
        'maint_work_order',
        { id, code: S(w.mwo_no) },
        pageId,
        {},
      );
    }, TX);
    return maintService.getWorkOrder(caller, pageId, id);
  },

  async cancelWo(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    reason: string,
  ): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const w = await lockWo(tx, caller, id);
      checkVersion(norm<Row>(w), version);
      if (!['PLANNED', 'APPROVED'].includes(S(w.status)))
        throw Errors.conflict('Only a work order that has not started can be cancelled.');
      await exec(
        tx,
        `UPDATE maint_work_orders SET status='CANCELLED', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      if (S(w.source_type) === 'PM_SCHEDULE' && w.source_id) {
        await exec(
          tx,
          `UPDATE pm_schedules SET status='SKIPPED' WHERE id=$1::uuid`,
          S(w.source_id),
        );
        await advancePlanPast(tx, S(w.source_id));
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MWO_CANCELLED',
        'maint_work_order',
        { id, code: S(w.mwo_no) },
        pageId,
        { reason },
      );
    }, TX);
    return maintService.getWorkOrder(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- downtime
  async listDowntime(
    caller: Caller,
    pageId: string,
    q: {
      assetId?: string | undefined;
      type?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    for (const [cond, v] of [
      [`t.asset_id=?::uuid`, q.assetId],
      [`t.dt_type=?`, q.type],
      [`t.start_at >= ?::date`, q.from],
      [`t.start_at < (?::date + 1)`, q.to],
    ] as const)
      if (v) {
        args.push(v);
        where.push(cond.replace('?', `$${args.length}`));
      }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM downtime_events t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const sum = (
      await query(
        prisma,
        `SELECT COALESCE(sum(duration_min),0)::text AS m FROM downtime_events t WHERE ${w}`,
        ...args,
      )
    )[0]!;
    const rows = await query(
      prisma,
      `SELECT t.*, a.asset_no, a.name AS asset_name, b.bd_no FROM downtime_events t JOIN assets a ON a.id=t.asset_id LEFT JOIN breakdown_tickets b ON b.id=t.breakdown_id
        WHERE ${w} ORDER BY t.start_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total, totalMinutes: S(sum.m) };
  },

  async logDowntime(
    caller: Caller,
    pageId: string,
    b: {
      assetId: string;
      startAt: string;
      endAt?: string | undefined;
      dtType: 'PLANNED' | 'UNPLANNED';
      reason?: string | undefined;
      productionOrderId?: string | undefined;
      lostQty?: string | number | undefined;
      costImpact?: string | number | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const a = (
      await query(
        prisma,
        `SELECT unit_id::text, work_centre_id::text FROM assets WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.assetId,
      )
    )[0];
    if (!a || S(a.unit_id) !== unitId)
      throw Errors.validation({ assetId: 'Choose an asset of this unit.' });
    if (b.endAt && Date.parse(b.endAt) <= Date.parse(b.startAt))
      throw Errors.validation({ endAt: 'The end must be after the start.' });
    let id = '';
    try {
      id = await prisma.$transaction(async (tx) => {
        const did = await insertRow(tx, 'downtime_events', {
          unitId,
          dtNo: await nextNo(tx, unitId, fy.id, 'DT'),
          assetId: b.assetId,
          workCentreId: a.work_centre_id ? S(a.work_centre_id) : null,
          startAt: b.startAt,
          endAt: b.endAt ?? null,
          dtType: b.dtType,
          reason: b.reason?.slice(0, 200) ?? null,
          productionOrderId: b.productionOrderId ?? null,
          lostQty: b.lostQty === undefined ? null : D(String(b.lostQty)).toFixed(3),
          costImpact: b.costImpact === undefined ? null : D(String(b.costImpact)).toFixed(2),
          createdById: caller.auth.userId,
        });
        await audit(
          tx,
          caller,
          caller.auth.userId,
          'DOWNTIME_LOGGED',
          'downtime_event',
          { id: did, code: did },
          pageId,
          {},
        );
        return did;
      }, TX);
    } catch (e) {
      DT_ERR(e);
    }
    return norm<Row>(
      (await query(prisma, `SELECT * FROM downtime_events WHERE id=$1::uuid`, id))[0]!,
    );
  },

  async endDowntime(caller: Caller, pageId: string, id: string, endAt?: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const d = (
      await query(
        prisma,
        `SELECT t.* FROM downtime_events t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!d) throw Errors.notFound('Downtime event not found.');
    if (d.end_at) throw Errors.conflict('This downtime has already ended.');
    const at = endAt ?? new Date().toISOString();
    if (Date.parse(at) <= Date.parse(S(d.start_at)))
      throw Errors.validation({ endAt: 'The end must be after the start.' });
    try {
      await exec(
        prisma,
        `UPDATE downtime_events SET end_at=$1::timestamptz WHERE id=$2::uuid`,
        at,
        id,
      );
    } catch (e) {
      DT_ERR(e);
    }
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'DOWNTIME_ENDED',
      'downtime_event',
      { id, code: S(d.dt_no) },
      pageId,
      {},
    );
    return norm<Row>(
      (await query(prisma, `SELECT * FROM downtime_events WHERE id=$1::uuid`, id))[0]!,
    );
  },

  // ---------------------------------------------------------------------------------------------- alerts
  async listAlerts(caller: Caller, q: { status?: string | undefined; page: number; size: number }) {
    const unit = caller.ctx.unitId ?? null;
    const args: unknown[] = [unit];
    let st = '';
    if (q.status) {
      args.push(q.status);
      st = `AND a.status=$2`;
    }
    const rows = await query(
      prisma,
      `SELECT a.*, r.alert_type, s.asset_no FROM alerts a JOIN alert_rules r ON r.id=a.rule_id LEFT JOIN assets s ON s.id=a.asset_id
        WHERE ($1::uuid IS NULL OR a.unit_id=$1::uuid) ${st} ORDER BY a.escalation_level DESC, a.due_at NULLS LAST LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM alerts a WHERE ($1::uuid IS NULL OR a.unit_id=$1::uuid) ${st}`,
          ...args,
        )
      )[0]!.n,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async ackAlert(caller: Caller, pageId: string, id: string): Promise<Row> {
    const a = (
      await query(
        prisma,
        `SELECT * FROM alerts WHERE id=$1::uuid AND ($2::uuid IS NULL OR unit_id=$2::uuid)`,
        id,
        caller.ctx.unitId ?? null,
      )
    )[0];
    if (!a) throw Errors.notFound('Alert not found.');
    if (S(a.status) !== 'OPEN') throw Errors.conflict('This alert is already acknowledged.');
    await exec(
      prisma,
      `UPDATE alerts SET status='ACK', acknowledged_by_id=$1::uuid, acknowledged_at=now() WHERE id=$2::uuid`,
      caller.auth.userId,
      id,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'ALERT_ACKNOWLEDGED',
      'alert',
      { id, code: id },
      pageId,
      {},
    );
    return norm<Row>((await query(prisma, `SELECT * FROM alerts WHERE id=$1::uuid`, id))[0]!);
  },

  async listAlertRules(): Promise<Row[]> {
    return (await query(prisma, `SELECT * FROM alert_rules ORDER BY alert_type`)).map((r) =>
      norm<Row>(r),
    );
  },

  async saveAlertRule(
    caller: Caller,
    pageId: string,
    type: string,
    b: {
      leadDays?: number | undefined;
      escalationMinutes?: number[] | undefined;
      active?: boolean | undefined;
    },
  ): Promise<Row[]> {
    const n = await exec(
      prisma,
      `UPDATE alert_rules SET lead_days=COALESCE($1,lead_days), escalation_minutes=COALESCE($2::int[],escalation_minutes), active=COALESCE($3,active) WHERE alert_type=$4`,
      b.leadDays ?? null,
      b.escalationMinutes ?? null,
      b.active ?? null,
      type,
    );
    if (!n) throw Errors.notFound('Alert rule not found.');
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'ALERT_RULE_SAVED',
      'alert_rule',
      { id: type, code: type },
      pageId,
      {},
    );
    return maintService.listAlertRules();
  },

  // ---------------------------------------------------------------------------------------------- reports
  /** MTBF / MTTR / availability per maintainable asset over a date range. */
  async mtbf(caller: Caller, pageId: string, q: { from: string; to: string }) {
    const sc = await scopeSql(caller, pageId);
    const assets = await query(
      prisma,
      `SELECT t.id::text, t.asset_no, t.name, t.criticality FROM assets t WHERE ${sc.sql} AND t.is_maintainable AND t.status <> 'DISPOSED' ORDER BY t.asset_no LIMIT 500`,
      ...sc.args,
    );
    const rows: Row[] = [];
    for (const a of assets)
      rows.push({
        assetId: S(a.id),
        assetNo: S(a.asset_no),
        name: S(a.name),
        criticality: S(a.criticality),
        ...(await assetService.kpis(S(a.id), q.from, q.to)),
      });
    return { from: q.from, to: q.to, rows };
  },

  /** Spare Part items with the stock Phase 8 holds for them (a view, not a second stock). */
  async spares(caller: Caller, q: { q?: string | undefined; page: number; size: number }) {
    const unit = caller.ctx.unitId ?? null;
    const args: unknown[] = [unit];
    let f = '';
    if (q.q) {
      args.push(`%${q.q}%`);
      f = `AND (i.code ILIKE $2 OR i.name ILIKE $2)`;
    }
    const rows = await query(
      prisma,
      `SELECT i.id::text, i.code, i.name, i.base_uom AS uom, COALESCE(s.on_hand,0)::text AS on_hand, COALESCE(s.value,0)::text AS value
         FROM items i
         LEFT JOIN (SELECT b.item_id, sum(b.on_hand) AS on_hand, sum(b.value) AS value FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id
                     WHERE ($1::uuid IS NULL OR w.unit_id=$1::uuid) GROUP BY b.item_id) s ON s.item_id=i.id
        WHERE i.item_type='Spare Part' AND i.deleted_at IS NULL ${f} ORDER BY i.code LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM items i WHERE i.item_type='Spare Part' AND i.deleted_at IS NULL ${f}`,
          ...args.slice(1),
        )
      )[0]!.n,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  /** The alerts of one unit: due PMs, overdue PMs (escalating), unacknowledged breakdowns, warranties, loans. Idempotent. */
  async runAlerts(unitId: string): Promise<number> {
    const rules = new Map(
      (await query(prisma, `SELECT * FROM alert_rules WHERE active`)).map((r) => [
        S(r.alert_type),
        r,
      ]),
    );
    const today = todayIst();
    let n = 0;
    const put = async (
      type: string,
      key: string,
      assetId: string | null,
      refType: string,
      refId: string,
      msg: string,
      dueAt: string | null,
      level: number,
    ) => {
      const rule = rules.get(type);
      if (!rule) return;
      const c = await exec(
        prisma,
        `INSERT INTO alerts (unit_id, rule_id, asset_id, ref_type, ref_id, message, due_at, escalation_level, alert_key) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::timestamptz,$8,$9)
         ON CONFLICT (alert_key) DO UPDATE SET escalation_level=GREATEST(alerts.escalation_level, EXCLUDED.escalation_level), message=EXCLUDED.message
           WHERE alerts.status <> 'CLEARED' AND EXCLUDED.escalation_level > alerts.escalation_level`,
        unitId,
        S(rule.id),
        assetId,
        refType,
        refId,
        msg.slice(0, 300),
        dueAt,
        level,
        key,
      );
      n += c;
    };
    const levelOf = (rule: Row | undefined, minutes: number): number =>
      ((rule?.escalation_minutes as number[] | undefined) ?? []).filter((m) => minutes >= m).length;
    const due = rules.get('PM_DUE');
    if (due)
      for (const s of await query(
        prisma,
        `SELECT s.id::text, s.due_date, p.title, a.id::text AS aid, a.asset_no FROM pm_schedules s JOIN pm_plans p ON p.id=s.plan_id JOIN assets a ON a.id=p.asset_id WHERE s.unit_id=$1::uuid AND s.status IN ('PLANNED','WO_CREATED') AND s.due_date BETWEEN $2::date AND ($2::date + $3::int)`,
        unitId,
        today,
        Number(due.lead_days),
      ))
        await put(
          'PM_DUE',
          `PM_DUE:${S(s.id)}`,
          S(s.aid),
          'pm_schedule',
          S(s.id),
          `${S(s.asset_no)}: ${S(s.title)} due on ${S(s.due_date).slice(0, 10)}`,
          S(s.due_date),
          0,
        );
    const od = rules.get('PM_OVERDUE');
    if (od)
      for (const s of await query(
        prisma,
        `SELECT s.id::text, s.due_date, p.title, a.id::text AS aid, a.asset_no, (CURRENT_DATE - s.due_date) * 1440 AS mins FROM pm_schedules s JOIN pm_plans p ON p.id=s.plan_id JOIN assets a ON a.id=p.asset_id WHERE s.unit_id=$1::uuid AND s.status IN ('PLANNED','WO_CREATED') AND s.due_date < $2::date`,
        unitId,
        today,
      ))
        await put(
          'PM_OVERDUE',
          `PM_OVERDUE:${S(s.id)}`,
          S(s.aid),
          'pm_schedule',
          S(s.id),
          `${S(s.asset_no)}: ${S(s.title)} was due on ${S(s.due_date).slice(0, 10)}`,
          S(s.due_date),
          levelOf(od, Number(s.mins)),
        );
    const bu = rules.get('BREAKDOWN_UNACK');
    if (bu)
      for (const t of await query(
        prisma,
        `SELECT t.id::text, t.bd_no, t.asset_id::text AS aid, t.reported_at, a.asset_no, EXTRACT(EPOCH FROM (now() - t.reported_at))/60 AS mins FROM breakdown_tickets t JOIN assets a ON a.id=t.asset_id WHERE t.unit_id=$1::uuid AND t.status='OPEN' AND t.deleted_at IS NULL`,
        unitId,
      )) {
        const first = (bu.escalation_minutes as number[])[0] ?? 0;
        if (Number(t.mins) >= first)
          await put(
            'BREAKDOWN_UNACK',
            `BD_UNACK:${S(t.id)}`,
            S(t.aid),
            'breakdown_ticket',
            S(t.id),
            `${S(t.bd_no)} on ${S(t.asset_no)} has not been acknowledged`,
            S(t.reported_at),
            levelOf(bu, Number(t.mins)),
          );
      }
    const wr = rules.get('WARRANTY_EXPIRY');
    if (wr)
      for (const a of await query(
        prisma,
        `SELECT id::text, asset_no, name, warranty_end FROM assets WHERE unit_id=$1::uuid AND deleted_at IS NULL AND status <> 'DISPOSED' AND warranty_end BETWEEN $2::date AND ($2::date + $3::int)`,
        unitId,
        today,
        Number(wr.lead_days),
      ))
        await put(
          'WARRANTY_EXPIRY',
          `WARRANTY:${S(a.id)}:${S(a.warranty_end).slice(0, 10)}`,
          S(a.id),
          'asset',
          S(a.id),
          `Warranty of ${S(a.asset_no)} ${S(a.name)} ends on ${S(a.warranty_end).slice(0, 10)}`,
          S(a.warranty_end),
          0,
        );
    const ln = rules.get('LOAN_RETURN_DUE');
    if (ln)
      for (const l of await query(
        prisma,
        `SELECT l.id::text, l.return_due, a.id::text AS aid, a.asset_no FROM asset_allocations l JOIN assets a ON a.id=l.asset_id WHERE l.unit_id=$1::uuid AND l.status='ALLOCATED' AND l.deleted_at IS NULL AND l.return_due IS NOT NULL AND l.return_due <= ($2::date + $3::int)`,
        unitId,
        today,
        Number(ln.lead_days),
      ))
        await put(
          'LOAN_RETURN_DUE',
          `LOAN:${S(l.id)}`,
          S(l.aid),
          'asset_allocation',
          S(l.id),
          `${S(l.asset_no)} is due back on ${S(l.return_due).slice(0, 10)}`,
          S(l.return_due),
          0,
        );
    return n;
  },
};

function checkPlan(b: PlanInput): void {
  const errs: Record<string, string> = {};
  if (b.triggerType !== 'METER' && !(b.intervalDays && b.intervalDays > 0))
    errs.intervalDays = 'Enter the number of days between services.';
  if (b.triggerType !== 'TIME') {
    if (!b.meterId) errs.meterId = 'Choose the meter.';
    if (!b.intervalMeter || D(String(b.intervalMeter)).lte(0))
      errs.intervalMeter = 'Enter the meter interval.';
  }
  if (Object.keys(errs).length) throw Errors.validation(errs);
}

async function lockBd(tx: Db, caller: Caller, id: string): Promise<Row> {
  const t = (
    await query(
      tx,
      `SELECT * FROM breakdown_tickets WHERE id=$1::uuid AND deleted_at IS NULL AND ($2::uuid IS NULL OR unit_id=$2::uuid) FOR UPDATE`,
      id,
      caller.ctx.unitId ?? null,
    )
  )[0];
  if (!t) throw Errors.notFound('Breakdown ticket not found.');
  return t;
}

async function transitionWo(
  caller: Caller,
  pageId: string,
  id: string,
  version: number | undefined,
  from: string[],
  setSql: (w: Row) => string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const w = await lockWo(tx, caller, id);
    checkVersion(norm<Row>(w), version);
    if (!from.includes(S(w.status)))
      throw Errors.conflict('This work order cannot change like that.');
    await exec(
      tx,
      `UPDATE maint_work_orders SET ${setSql(w)}, updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
      caller.auth.userId,
      id,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'MWO_SUBMITTED',
      'maint_work_order',
      { id, code: S(w.mwo_no) },
      pageId,
      {},
    );
  }, TX);
}

async function startWoTx(tx: Db, caller: Caller, id: string, pageId: string): Promise<void> {
  const w = await lockWo(tx, caller, id);
  if (!['PLANNED', 'APPROVED'].includes(S(w.status)))
    throw Errors.conflict('This work order cannot be started.');
  if (['PENDING', 'REJECTED'].includes(S(w.approval_status)))
    throw Errors.conflict('This work order is not approved.');
  await exec(
    tx,
    `UPDATE maint_work_orders SET status='IN_PROGRESS', actual_start=COALESCE(actual_start, now()), updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
    caller.auth.userId,
    id,
  );
  await exec(
    tx,
    `UPDATE assets SET status='UNDER_MAINT', updated_at=now(), version=version+1 WHERE id=$1::uuid AND status IN ('ACTIVE','IDLE')`,
    S(w.asset_id),
  );
  // preventive work stops the machine on purpose: planned downtime, not a failure
  if (S(w.wo_type) !== 'BREAKDOWN' && S(w.source_type) !== 'BREAKDOWN') {
    const wc = (
      await query(tx, `SELECT work_centre_id::text FROM assets WHERE id=$1::uuid`, S(w.asset_id))
    )[0];
    const fy = await fyOfCaller(caller);
    try {
      await exec(
        tx,
        `INSERT INTO downtime_events (unit_id, dt_no, asset_id, work_centre_id, start_at, dt_type, reason, created_by_id)
         SELECT $1::uuid,$2,$3::uuid,$4::uuid,now(),'PLANNED',$5,$6::uuid
          WHERE NOT EXISTS (SELECT 1 FROM downtime_events WHERE asset_id=$3::uuid AND end_at IS NULL AND deleted_at IS NULL)`,
        S(w.unit_id),
        await nextNo(tx, S(w.unit_id), fy.id, 'DT'),
        S(w.asset_id),
        wc?.work_centre_id ? S(wc.work_centre_id) : null,
        `Work order ${S(w.mwo_no)}`,
        caller.auth.userId,
      );
    } catch (e) {
      DT_ERR(e);
    }
  }
  await audit(
    tx,
    caller,
    caller.auth.userId,
    'MWO_STARTED',
    'maint_work_order',
    { id, code: S(w.mwo_no) },
    pageId,
    {},
  );
}

/** A skipped or cancelled service moves the plan on, so the next one is counted from it and the same key is not met again. */
async function advancePlanPast(db: Db, scheduleId: string): Promise<void> {
  const r = (
    await query(
      db,
      `SELECT plan_id::text, due_date, due_meter::text FROM pm_schedules WHERE id=$1::uuid`,
      scheduleId,
    )
  )[0];
  if (!r) return;
  if (r.due_date)
    await exec(
      db,
      `UPDATE pm_plans SET last_done_on=GREATEST(COALESCE(last_done_on,$1::date),$1::date), version=version+1 WHERE id=$2::uuid`,
      S(r.due_date).slice(0, 10),
      S(r.plan_id),
    );
  if (r.due_meter)
    await exec(
      db,
      `UPDATE pm_plans SET last_done_meter=GREATEST(COALESCE(last_done_meter,0),$1::numeric), version=version+1 WHERE id=$2::uuid`,
      S(r.due_meter),
      S(r.plan_id),
    );
}
