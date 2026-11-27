// COPQ, cost of poor quality, month by month. Internal failure = scrap loss + finished rework (from Manufacturing) +
// entered costs; external failure = customer NCR claim amounts + entered costs; appraisal and prevention are entered.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { D } from '../inventory/money';
import { query } from '../procurement/core';
import type { Caller } from '../records/service';
import { S } from './inspection-service';

const monthStart = (m: string): string => `${m}-01`;
const nextMonth = (m: string): string => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
};
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = monthStart(from); d <= monthStart(to) && out.length < 60; d = nextMonth(d.slice(0, 7))) out.push(d.slice(0, 7));
  return out;
}

/** The unit filter every cost source shares: the chosen plant, or every plant of a caller who may see all. */
const unitSql = (caller: Caller, args: unknown[], column: string): string => {
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    return ` AND ${column}=$${args.length}::uuid`;
  }
  return caller.ctx.allUnits ? '' : ' AND false';
};

/** Every cost line of the range: source, month, category, document, description, amount. */
async function lines(caller: Caller, from: string, to: string) {
  const f = monthStart(from);
  const t = nextMonth(to);
  if (f >= t) throw Errors.validation({ to: 'The end month is before the start month.' });
  const args: unknown[] = [f, t];
  const one = (source: string, category: string, id: string, doc: string, description: string, amount: string, date: string, from_: string, where: string, unit: string) =>
    `SELECT '${source}' AS source, ${category} AS category, ${id}::text AS id, ${doc} AS doc, ${description} AS description,
        (${amount})::numeric(18,2)::text AS amount, to_char(${date},'YYYY-MM') AS month
       FROM ${from_} WHERE ${where} AND ${date} >= $1::date AND ${date} < $2::date${unit}`;
  const manualUnit = unitSql(caller, args, 'c.unit_id');
  const sql = [
    one('Entered', 'c.category', 'c.id', 'NULL::varchar', 'c.description', 'c.amount', 'c.month', 'qms_cost_entries c', 'c.deleted_at IS NULL', manualUnit),
    one('Scrap', `'INTERNAL_FAILURE'`, 's.id', 's.number', 's.reason', 's.loss_value', 's.scrap_date', 'mfg_scrap s',
      `s.deleted_at IS NULL AND s.status='Submitted' AND s.loss_value > 0`, unitSql(caller, args, 's.unit_id')),
    one('Rework', `'INTERNAL_FAILURE'`, 'w.id', 'w.number', 'w.reason', 'w.cost + w.material_cost', 'w.rework_date', 'mfg_rework w',
      `w.deleted_at IS NULL AND w.status='Done' AND w.cost + w.material_cost > 0`, unitSql(caller, args, 'w.unit_id')),
    one('Customer claim', `'EXTERNAL_FAILURE'`, 'n.id', 'n.number', 'n.title', 'n.claim_amount', 'n.ncr_date', 'qms_ncrs n',
      `n.deleted_at IS NULL AND n.type='CUSTOMER' AND n.status <> 'Cancelled' AND n.claim_amount > 0`, unitSql(caller, args, 'n.unit_id')),
  ].join(' UNION ALL ');
  // unpaginated: the cost documents of at most five years, summed below
  return (await query(prisma, `${sql} ORDER BY month DESC, source, doc`, ...args)).map((r) => ({
    source: S(r.source),
    category: S(r.category),
    id: S(r.id),
    doc: r.doc === null ? null : S(r.doc),
    description: S(r.description),
    amount: S(r.amount),
    month: S(r.month),
  }));
}

export const copqService = {
  async report(caller: Caller, from: string, to: string) {
    const all = await lines(caller, from, to);
    const args: unknown[] = [monthStart(from), nextMonth(to)];
    const unit = unitSql(caller, args, 'unit_id');
    // unpaginated: one row per month
    const sales = await query(
      prisma,
      `SELECT to_char(month,'YYYY-MM') AS month, sum(sales_value)::text AS v FROM qms_monthly WHERE month >= $1::date AND month < $2::date${unit} GROUP BY month`,
      ...args,
    );
    const sum = (rows: { amount: string }[]) => rows.reduce((a, r) => a.plus(D(r.amount)), D(0));
    const months = monthsBetween(from, to).map((month) => {
      const m = all.filter((r) => r.month === month);
      const of = (category: string, source?: string) =>
        sum(m.filter((r) => r.category === category && (!source || r.source === source))).toFixed(2);
      const total = sum(m);
      const sold = D(S(sales.find((s) => S(s.month) === month)?.v ?? '0'));
      return {
        month,
        scrap: of('INTERNAL_FAILURE', 'Scrap'),
        rework: of('INTERNAL_FAILURE', 'Rework'),
        internalFailure: of('INTERNAL_FAILURE'),
        claims: of('EXTERNAL_FAILURE', 'Customer claim'),
        externalFailure: of('EXTERNAL_FAILURE'),
        appraisal: of('APPRAISAL'),
        prevention: of('PREVENTION'),
        total: total.toFixed(2),
        salesValue: sold.toFixed(2),
        costPercent: sold.gt(0) ? total.mul(100).div(sold).toFixed(2) : null,
      };
    });
    const col = (k: 'scrap' | 'rework' | 'internalFailure' | 'claims' | 'externalFailure' | 'appraisal' | 'prevention' | 'total') =>
      months.reduce((a, r) => a.plus(D(r[k])), D(0)).toFixed(2);
    return {
      from,
      to,
      months,
      totals: {
        scrap: col('scrap'),
        rework: col('rework'),
        internalFailure: col('internalFailure'),
        claims: col('claims'),
        externalFailure: col('externalFailure'),
        appraisal: col('appraisal'),
        prevention: col('prevention'),
        total: col('total'),
      },
      lines: all,
    };
  },
};
