// Phase 12 registers and monitors: rejection / rework register with its monthly summary, the monthly production figures,
// the PPM monitor (internal and customer PPM against a target) and the quality-cost monitor. All figures are server
// numbers (R-15). Targets are the owner's data in qms_settings; with no target set, no "OK / over" verdict is shown.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
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
import { againstTarget, costPercent, ppm } from './logic';
import { S } from './inspection-service';

export const DISPOSITIONS = ['HOLD', 'REWORK', 'SCRAP', 'USE_AS_IS', 'RETURN_TO_VENDOR'] as const;
export const COST_CATEGORIES = [
  'PREVENTION',
  'APPRAISAL',
  'INTERNAL_FAILURE',
  'EXTERNAL_FAILURE',
] as const;
export const SETTING_KEYS = [
  'CAL_REMINDER_DAYS',
  'INTERNAL_PPM_TARGET',
  'CUSTOMER_PPM_TARGET',
  'QUALITY_COST_PCT_TARGET',
] as const;

const monthStart = (m: string): string => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))
    throw Errors.validation({ month: 'Use the month as YYYY-MM.' });
  return `${m}-01`;
};
const nextMonth = (m: string): string => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
};
const oneUnit = (caller: Caller): string => {
  if (!caller.ctx.unitId)
    throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
  return caller.ctx.unitId;
};

/** unit target first, else the all-units row, else null */
export async function settingValue(unitId: string | null, key: string): Promise<string | null> {
  const r = (
    await query(
      prisma,
      `SELECT value::text AS v FROM qms_settings WHERE key=$2 AND (unit_id=$1::uuid OR unit_id IS NULL) ORDER BY (unit_id IS NULL) LIMIT 1`,
      unitId,
      key,
    )
  )[0];
  return r ? S(r.v) : null;
}

export interface RejectionInput {
  rejectDate?: string | undefined;
  process: string;
  operator?: string | undefined;
  itemId?: string | undefined;
  part: string;
  holdQty: string | number;
  defect: string;
  defectType: string;
  disposition?: (typeof DISPOSITIONS)[number] | undefined;
  dispositionNote?: string | undefined;
}

export const registersService = {
  // ------------------------------------------------------------------ rejection / rework register
  async listRejections(
    caller: Caller,
    pageId: string,
    q: {
      month?: string | undefined;
      status?: string | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.month) {
      args.push(monthStart(q.month), nextMonth(q.month));
      where.push(
        `t.reject_date >= $${args.length - 1}::date AND t.reject_date < $${args.length}::date`,
      );
    }
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.part ILIKE $${args.length} OR t.defect ILIKE $${args.length} OR t.process ILIKE $${args.length} OR t.operator ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM qms_rejections t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.* FROM qms_rejections t WHERE ${w} ORDER BY t.reject_date DESC, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm(r)), total };
  },
  async getRejection(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.* FROM qms_rejections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Register entry not found.');
    return norm(r);
  },
  async createRejection(caller: Caller, pageId: string, b: RejectionInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    if (D(S(b.holdQty)).lte(0))
      throw Errors.validation({ holdQty: 'Enter a quantity greater than 0.' });
    const id = await prisma.$transaction(async (tx) => {
      if (b.itemId && !(await query(tx, `SELECT 1 FROM items WHERE id=$1::uuid`, b.itemId))[0])
        throw Errors.validation({ itemId: 'This item does not exist.' });
      const no = await NumberingService.allocate(tx, {
        pageId: 'qms:REJ',
        unitId,
        fyId: fy.id,
        prefix: 'REJ',
      });
      const disp = b.disposition ?? 'HOLD';
      if (disp !== 'HOLD' && disp !== 'SCRAP' && (b.dispositionNote ?? '').trim().length < 3)
        throw Errors.validation({
          dispositionNote:
            'Say what was done (rework operation, deviation approval, vendor return).',
        });
      const nid = await insertRow(tx, 'qms_rejections', {
        unitId,
        fyId: fy.id,
        number: no,
        rejectDate: b.rejectDate ?? todayIst(),
        process: b.process,
        operator: b.operator ?? null,
        itemId: b.itemId ?? null,
        part: b.part,
        holdQty: D(S(b.holdQty)).toFixed(),
        defect: b.defect,
        defectType: b.defectType,
        disposition: disp,
        dispositionNote: b.dispositionNote ?? null,
        status: disp === 'HOLD' ? 'Open' : 'Closed',
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_REJECTION_RECORDED',
        'qms_rejection',
        { id: nid, code: no },
        pageId,
        { qty: S(b.holdQty) },
      );
      return nid;
    }, TX);
    return this.getRejection(caller, pageId, id);
  },
  /** Deciding what happens to the held quantity closes the entry. */
  async disposeRejection(
    caller: Caller,
    pageId: string,
    id: string,
    ifMatch: number,
    disposition: (typeof DISPOSITIONS)[number],
    note?: string,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM qms_rejections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Register entry not found.');
      checkVersion(cur, ifMatch);
      if (S(cur.status) === 'Cancelled') throw Errors.conflict('This entry is cancelled.');
      if (disposition !== 'HOLD' && (note ?? '').trim().length < 3 && disposition !== 'SCRAP')
        throw Errors.validation({
          dispositionNote:
            'Say what was done (rework operation, who approved the deviation, vendor return note).',
        });
      await exec(
        tx,
        `UPDATE qms_rejections SET disposition=$1, disposition_note=$2, status=$3, updated_by_id=$4::uuid, updated_at=now(), version=version+1 WHERE id=$5::uuid`,
        disposition,
        note ?? null,
        disposition === 'HOLD' ? 'Open' : 'Closed',
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_REJECTION_DISPOSED',
        'qms_rejection',
        { id, code: S(cur.number) },
        pageId,
        { disposition },
      );
    }, TX);
    return this.getRejection(caller, pageId, id);
  },
  async cancelRejection(caller: Caller, pageId: string, id: string, reason: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM qms_rejections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Register entry not found.');
      if (cur.source_inspection_id)
        throw Errors.conflict(
          'This entry came from an inspection decision and cannot be cancelled.',
        );
      if (S(cur.status) === 'Cancelled') throw Errors.conflict('This entry is already cancelled.');
      await exec(
        tx,
        `UPDATE qms_rejections SET status='Cancelled', disposition_note=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        reason,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_REJECTION_CANCELLED',
        'qms_rejection',
        { id, code: S(cur.number) },
        pageId,
        { reason },
      );
    }, TX);
    return this.getRejection(caller, pageId, id);
  },
  /** Monthly summary of the register: by process, by defect type and by disposition (cancelled entries left out). */
  async rejectionSummary(caller: Caller, pageId: string, month: string) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args, monthStart(month), nextMonth(month)];
    const base = `FROM qms_rejections t WHERE ${sc.sql} AND t.status <> 'Cancelled' AND t.reject_date >= $${args.length - 1}::date AND t.reject_date < $${args.length}::date`;
    const by = async (col: string) =>
      (
        await query(
          prisma,
          `SELECT ${col} AS key, count(*)::int AS entries, trim_scale(COALESCE(sum(t.hold_qty),0))::text AS qty ${base} GROUP BY ${col} ORDER BY sum(t.hold_qty) DESC, ${col}`,
          ...args,
        )
      ).map((r) => norm(r));
    const tot = (
      await query(
        prisma,
        `SELECT count(*)::int AS entries, trim_scale(COALESCE(sum(t.hold_qty),0))::text AS qty ${base}`,
        ...args,
      )
    )[0]!;
    return {
      month,
      total: norm(tot),
      byProcess: await by('t.process'),
      byDefectType: await by('t.defect_type'),
      byDisposition: await by('t.disposition'),
    };
  },

  // ------------------------------------------------------------------ monthly figures
  async saveMonthly(
    caller: Caller,
    pageId: string,
    b: {
      month: string;
      producedQty: string | number;
      rejectedQty: string | number;
      customerRejectedQty: string | number;
      salesValue: string | number;
      note?: string | undefined;
    },
  ) {
    const unitId = oneUnit(caller);
    const m = monthStart(b.month);
    const vals = [b.producedQty, b.rejectedQty, b.customerRejectedQty, b.salesValue].map((v) =>
      D(S(v)),
    );
    if (vals.some((v) => v.lt(0)))
      throw Errors.validation({ producedQty: 'Quantities and values cannot be negative.' });
    if (vals[1]!.gt(vals[0]!))
      throw Errors.validation({
        rejectedQty: 'Rejected quantity cannot be more than the produced quantity.',
      });
    await prisma.$transaction(async (tx) => {
      await exec(
        tx,
        `INSERT INTO qms_monthly (unit_id, month, produced_qty, rejected_qty, customer_rejected_qty, sales_value, note, updated_by_id)
         VALUES ($1::uuid,$2::date,$3::numeric,$4::numeric,$5::numeric,$6::numeric,$7,$8::uuid)
         ON CONFLICT (unit_id, month) DO UPDATE SET produced_qty=EXCLUDED.produced_qty, rejected_qty=EXCLUDED.rejected_qty,
           customer_rejected_qty=EXCLUDED.customer_rejected_qty, sales_value=EXCLUDED.sales_value, note=EXCLUDED.note,
           updated_by_id=EXCLUDED.updated_by_id, updated_at=now(), version=qms_monthly.version+1`,
        unitId,
        m,
        vals[0]!.toFixed(),
        vals[1]!.toFixed(),
        vals[2]!.toFixed(),
        vals[3]!.toFixed(2),
        b.note ?? null,
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_MONTHLY_SAVED',
        'qms_monthly',
        { id: unitId, code: b.month },
        pageId,
      );
    }, TX);
    return this.ppmReport(caller, b.month, b.month);
  },
  async addCost(
    caller: Caller,
    pageId: string,
    b: {
      month: string;
      category: (typeof COST_CATEGORIES)[number];
      description: string;
      amount: string | number;
    },
  ) {
    const unitId = oneUnit(caller);
    if (D(S(b.amount)).lte(0))
      throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
    const id = await insertRow(prisma, 'qms_cost_entries', {
      unitId,
      month: monthStart(b.month),
      category: b.category,
      description: b.description,
      amount: D(S(b.amount)).toFixed(2),
      createdById: caller.auth.userId,
    });
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'QMS_COST_ADDED',
      'qms_cost_entry',
      { id, code: b.month },
      pageId,
      { category: b.category, amount: S(b.amount) },
    );
    return { id };
  },
  async deleteCost(caller: Caller, pageId: string, id: string) {
    const unitId = oneUnit(caller);
    const n = await exec(
      prisma,
      `UPDATE qms_cost_entries SET deleted_at=now() WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
      id,
      unitId,
    );
    if (!n) throw Errors.notFound('Cost entry not found.');
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'QMS_COST_DELETED',
      'qms_cost_entry',
      { id, code: '' },
      pageId,
    );
  },
  async listCosts(caller: Caller, month: string) {
    const args: unknown[] = [monthStart(month)];
    let unit = '';
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      unit = ` AND unit_id=$2::uuid`;
    }
    return (
      await query(
        prisma,
        `SELECT * FROM qms_cost_entries WHERE month=$1::date AND deleted_at IS NULL${unit} ORDER BY created_at`,
        ...args,
      )
    ).map((r) => norm(r));
  },

  // ------------------------------------------------------------------ settings
  async listSettings(caller: Caller) {
    const rows = await query(
      prisma,
      `SELECT s.*, u.name AS unit_name FROM qms_settings s LEFT JOIN units u ON u.id=s.unit_id WHERE s.unit_id IS NULL OR s.unit_id=$1::uuid OR $1::uuid IS NULL ORDER BY s.key, (s.unit_id IS NULL) DESC`,
      caller.ctx.unitId,
    );
    return rows.map((r) => norm(r));
  },
  async saveSetting(
    caller: Caller,
    pageId: string,
    b: { key: (typeof SETTING_KEYS)[number]; value: string | number; scope: 'UNIT' | 'ALL' },
  ) {
    const unitId = b.scope === 'UNIT' ? oneUnit(caller) : null;
    const v = D(S(b.value));
    if (v.lt(0)) throw Errors.validation({ value: 'Enter 0 or more.' });
    if (b.key === 'CAL_REMINDER_DAYS' && (!v.isInteger() || v.gt(365)))
      throw Errors.validation({ value: 'Enter a whole number of days, up to 365.' });
    await prisma.$transaction(async (tx) => {
      await exec(
        tx,
        `DELETE FROM qms_settings WHERE key=$1 AND unit_id IS NOT DISTINCT FROM $2::uuid`,
        b.key,
        unitId,
      );
      await exec(
        tx,
        `INSERT INTO qms_settings (unit_id, key, value, needs_review, updated_by_id) VALUES ($1::uuid,$2,$3::numeric,false,$4::uuid)`,
        unitId,
        b.key,
        v.toFixed(),
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_SETTING_SAVED',
        'qms_setting',
        { id: unitId ?? caller.auth.userId, code: b.key },
        pageId,
        { value: v.toFixed() },
      );
    }, TX);
    return this.listSettings(caller);
  },

  // ------------------------------------------------------------------ reports
  async ppmReport(caller: Caller, from: string, to: string) {
    const f = monthStart(from);
    const t = nextMonth(to);
    if (f >= t) throw Errors.validation({ to: 'The end month is before the start month.' });
    const args: unknown[] = [f, t];
    let unit = '';
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      unit = ' AND unit_id=$3::uuid';
    }
    const rows = await query(
      prisma,
      `SELECT to_char(month,'YYYY-MM') AS month, sum(produced_qty)::text AS produced, sum(rejected_qty)::text AS rejected, sum(customer_rejected_qty)::text AS customer_rejected
         FROM qms_monthly WHERE month >= $1::date AND month < $2::date${unit} GROUP BY month ORDER BY month`,
      ...args,
    );
    const it = await settingValue(caller.ctx.unitId, 'INTERNAL_PPM_TARGET');
    const ct = await settingValue(caller.ctx.unitId, 'CUSTOMER_PPM_TARGET');
    const out = rows.map((r) => {
      const internal = ppm(S(r.rejected), S(r.produced));
      const customer = ppm(S(r.customer_rejected), S(r.produced));
      return {
        month: S(r.month),
        produced: S(r.produced),
        rejected: S(r.rejected),
        customerRejected: S(r.customer_rejected),
        internalPpm: internal,
        customerPpm: customer,
        internalVsTarget: againstTarget(internal, it),
        customerVsTarget: againstTarget(customer, ct),
      };
    });
    const sum = (k: 'produced' | 'rejected' | 'customerRejected') =>
      out.reduce((a, r) => a.plus(D(r[k])), D(0)).toFixed();
    const totals = {
      produced: sum('produced'),
      rejected: sum('rejected'),
      customerRejected: sum('customerRejected'),
    };
    return {
      from,
      to,
      internalTarget: it,
      customerTarget: ct,
      months: out,
      totals: {
        ...totals,
        internalPpm: ppm(totals.rejected, totals.produced),
        customerPpm: ppm(totals.customerRejected, totals.produced),
      },
    };
  },
  async costReport(caller: Caller, from: string, to: string) {
    const f = monthStart(from);
    const t = nextMonth(to);
    if (f >= t) throw Errors.validation({ to: 'The end month is before the start month.' });
    const args: unknown[] = [f, t];
    let unit = '';
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      unit = ' AND unit_id=$3::uuid';
    }
    const costs = await query(
      prisma,
      `SELECT to_char(month,'YYYY-MM') AS month, category, sum(amount)::text AS amount FROM qms_cost_entries WHERE deleted_at IS NULL AND month >= $1::date AND month < $2::date${unit} GROUP BY month, category`,
      ...args,
    );
    const sales = await query(
      prisma,
      `SELECT to_char(month,'YYYY-MM') AS month, sum(sales_value)::text AS sales FROM qms_monthly WHERE month >= $1::date AND month < $2::date${unit} GROUP BY month`,
      ...args,
    );
    const target = await settingValue(caller.ctx.unitId, 'QUALITY_COST_PCT_TARGET');
    const months = new Set([...costs.map((c) => S(c.month)), ...sales.map((s) => S(s.month))]);
    const rows = [...months].sort().map((m) => {
      const cat = (c: string) =>
        S(costs.find((x) => S(x.month) === m && S(x.category) === c)?.amount ?? '0');
      const prevention = D(cat('PREVENTION'));
      const appraisal = D(cat('APPRAISAL'));
      const internal = D(cat('INTERNAL_FAILURE'));
      const external = D(cat('EXTERNAL_FAILURE'));
      const total = prevention.plus(appraisal).plus(internal).plus(external);
      const salesValue = S(sales.find((s) => S(s.month) === m)?.sales ?? '0');
      const pct = costPercent(total.toFixed(2), salesValue);
      return {
        month: m,
        prevention: prevention.toFixed(2),
        appraisal: appraisal.toFixed(2),
        internalFailure: internal.toFixed(2),
        externalFailure: external.toFixed(2),
        total: total.toFixed(2),
        salesValue: D(salesValue).toFixed(2),
        costPercent: pct,
        vsTarget: againstTarget(pct, target),
      };
    });
    const tot = rows.reduce((a, r) => a.plus(D(r.total)), D(0));
    const sal = rows.reduce((a, r) => a.plus(D(r.salesValue)), D(0));
    return {
      from,
      to,
      target,
      months: rows,
      totals: {
        total: tot.toFixed(2),
        salesValue: sal.toFixed(2),
        costPercent: costPercent(tot.toFixed(2), sal.toFixed(2)),
      },
    };
  },
};
