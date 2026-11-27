// Centralized Quality dashboard (all departments): incoming acceptance, in-process defect rate with shift / hour
// drill-down, supplier defects and rating, customer complaints with the 8D gates and priorities, rejections and revokes;
// the "All Data" lookup across every quality record; and the import of NCRs and quality costs. Every figure is counted
// from stored records.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import { norm, query, todayIst } from '../procurement/core';
import type { Caller } from '../records/service';
import { PRIORITIES } from './common';
import type { Priority } from './common';
import { S } from './inspection-service';
import { PAGE_OF_NCR, STAGES, ncrService } from './ncr-service';
import type { NcrType } from './ncr-service';
import { COST_CATEGORIES, registersService } from './registers-service';

export const DASHBOARD_PAGE = 'qms-dashboard';
export const DRILLS = ['day', 'hour', 'shift', 'machine'] as const;
export type Drill = (typeof DRILLS)[number];

export interface DashQuery {
  from?: string | undefined;
  to?: string | undefined;
  department?: string | undefined;
  drill?: Drill | undefined;
  machine?: string | undefined;
}

const day = (iso: string, add: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + add * 86_400_000).toISOString().slice(0, 10);
const pct = (part: number, whole: number): number | null => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const n = (v: unknown): number => Number(v ?? 0);

/** `$n` filter for the chosen plant (or nothing for a caller who may see every plant). */
const plant = (caller: Caller, args: unknown[], alias: string): string => {
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    return ` AND ${alias}.unit_id=$${args.length}::uuid`;
  }
  return caller.ctx.allUnits ? '' : ' AND false';
};

export const dashboardService = {
  async summary(caller: Caller, q: DashQuery) {
    const to = q.to ?? todayIst();
    const from = q.from ?? day(to, -179);
    if (from > to) throw Errors.validation({ from: 'The start date is after the end date.' });
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    const prevTo = day(from, -1);
    const prevFrom = day(prevTo, -(days - 1));

    // -------------------------------------------------------------- incoming quality
    const incomingOf = async (f: string, t: string) => {
      const args: unknown[] = [f, t];
      const u = plant(caller, args, 't');
      const r = (
        await query(
          prisma,
          `SELECT count(*) FILTER (WHERE t.decision='ACCEPTED')::int AS accepted,
              count(*) FILTER (WHERE t.decision='CONDITIONAL')::int AS conditional,
              count(*) FILTER (WHERE t.decision='PARTIAL')::int AS partial,
              count(*) FILTER (WHERE t.decision='REJECTED')::int AS rejected
            FROM qms_inspections t WHERE t.deleted_at IS NULL AND t.kind='INCOMING' AND t.status='Decided' AND t.doc_date BETWEEN $1::date AND $2::date${u}`,
          ...args,
        )
      )[0]!;
      const c = { accepted: n(r.accepted), conditional: n(r.conditional), partial: n(r.partial), rejected: n(r.rejected) };
      return { ...c, decided: c.accepted + c.conditional + c.partial + c.rejected };
    };
    const inc = await incomingOf(from, to);
    const before = await incomingOf(prevFrom, prevTo);
    const pArgs: unknown[] = [];
    const pUnit = plant(caller, pArgs, 't');
    const pending = n(
      (await query(prisma, `SELECT count(*)::int AS n FROM qms_inspections t WHERE t.deleted_at IS NULL AND t.kind='INCOMING' AND t.status='Submitted'${pUnit}`, ...pArgs))[0]!.n,
    );

    // -------------------------------------------------------------- in-process defect rate
    const drill = q.drill ?? 'day';
    const ipArgs: unknown[] = [from, to];
    let ipWhere = `t.deleted_at IS NULL AND t.kind='IN_PROCESS' AND t.status IN ('Submitted','Decided') AND t.doc_date BETWEEN $1::date AND $2::date${plant(caller, ipArgs, 't')}`;
    if (q.machine) {
      ipArgs.push(q.machine);
      ipWhere += ` AND t.header->>'machine'=$${ipArgs.length}`;
    }
    const local = `(t.submitted_at AT TIME ZONE 'Asia/Kolkata')`;
    const bucket: Record<Drill, string> = {
      day: `to_char(t.doc_date,'YYYY-MM-DD')`,
      hour: `to_char(${local},'HH24":00"')`,
      shift: `COALESCE((SELECT s.name FROM shifts s WHERE CASE WHEN s.start_time <= s.end_time
          THEN ${local}::time >= s.start_time AND ${local}::time < s.end_time
          ELSE ${local}::time >= s.start_time OR ${local}::time < s.end_time END ORDER BY s.start_time, s.code LIMIT 1), 'Outside shift times')`,
      machine: `COALESCE(NULLIF(t.header->>'machine',''), 'No machine')`,
    };
    // unpaginated: one row per day / hour / shift / machine of the range
    const series = (
      await query(
        prisma,
        `SELECT ${bucket[drill]} AS label, count(DISTINCT t.id)::int AS sheets,
            count(r.id) FILTER (WHERE r.row_status IN ('OK','NOT_OK'))::int AS checks,
            count(r.id) FILTER (WHERE r.row_status='NOT_OK')::int AS failed
          FROM qms_inspections t LEFT JOIN qms_inspection_rows r ON r.inspection_id=t.id
         WHERE ${ipWhere} GROUP BY 1 ORDER BY 1`,
        ...ipArgs,
      )
    ).map((r) => ({ label: S(r.label), sheets: n(r.sheets), checks: n(r.checks), failed: n(r.failed), rate: pct(n(r.failed), n(r.checks)) ?? 0 }));
    const mArgs: unknown[] = [from, to];
    const mUnit = plant(caller, mArgs, 't');
    // unpaginated: the machines named on in-process sheets
    const machines = (
      await query(
        prisma,
        `SELECT DISTINCT t.header->>'machine' AS m FROM qms_inspections t WHERE t.deleted_at IS NULL AND t.kind='IN_PROCESS'
           AND t.doc_date BETWEEN $1::date AND $2::date AND COALESCE(t.header->>'machine','') <> ''${mUnit} ORDER BY 1`,
        ...mArgs,
      )
    ).map((r) => S(r.m));
    const checks = series.reduce((a, r) => a + r.checks, 0);
    const failed = series.reduce((a, r) => a + r.failed, 0);

    // -------------------------------------------------------------- suppliers
    const sArgs: unknown[] = [from, to];
    const sUnit = plant(caller, sArgs, 't');
    // unpaginated: one row per supplier inspected in the range, cut to the top ones below
    const sup = (
      await query(
        prisma,
        `SELECT s.name, count(*) FILTER (WHERE t.status='Decided')::int AS lots,
            count(*) FILTER (WHERE t.status='Decided' AND t.rejected_qty > 0)::int AS bad,
            COALESCE(sum((SELECT count(*) FROM qms_inspection_rows r WHERE r.inspection_id=t.id AND r.row_status='NOT_OK')),0)::int AS defects
          FROM qms_inspections t JOIN suppliers s ON s.id=t.supplier_id
         WHERE t.deleted_at IS NULL AND t.kind IN ('INCOMING','ISIR') AND t.status IN ('Submitted','Decided') AND t.doc_date BETWEEN $1::date AND $2::date${sUnit}
         GROUP BY s.id, s.name`,
        ...sArgs,
      )
    ).map((r) => ({
      supplier: S(r.name),
      lots: n(r.lots),
      rejectedLots: n(r.bad),
      defects: n(r.defects) + n(r.bad),
      rating: pct(n(r.lots) - n(r.bad), n(r.lots)),
    }));
    sup.sort((a, b) => b.defects - a.defects || a.supplier.localeCompare(b.supplier));

    // -------------------------------------------------------------- customer complaints
    const cArgs: unknown[] = [from, to];
    let cWhere = `t.deleted_at IS NULL AND t.type='CUSTOMER' AND t.status <> 'Cancelled' AND t.ncr_date BETWEEN $1::date AND $2::date${plant(caller, cArgs, 't')}`;
    if (q.department) {
      cArgs.push(q.department);
      cWhere += ` AND t.department=$${cArgs.length}`;
    }
    const stageCols = STAGES.map(([k]) => `count(*) FILTER (WHERE (t.eight_d->'${k}'->>'done')='true')::int AS ${k}`).join(', ');
    const c = (
      await query(
        prisma,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE t.status='Open')::int AS open,
            count(*) FILTER (WHERE t.status='Pending Acceptance')::int AS pending, count(*) FILTER (WHERE t.status='Closed')::int AS closed,
            count(*) FILTER (WHERE t.priority='MINOR')::int AS minor, count(*) FILTER (WHERE t.priority='MAJOR')::int AS major,
            count(*) FILTER (WHERE t.priority='CRITICAL')::int AS critical, ${stageCols}
          FROM qms_ncrs t WHERE ${cWhere}`,
        ...cArgs,
      )
    )[0]!;

    // -------------------------------------------------------------- rejections and revokes
    const rArgs: unknown[] = [from, to];
    const rUnit = plant(caller, rArgs, 't');
    const rv = (
      await query(
        prisma,
        `SELECT count(*)::int AS rejected, count(*) FILTER (WHERE t.status='Revoked')::int AS revoked,
            count(*) FILTER (WHERE t.status='Open')::int AS open
          FROM qms_rejections t WHERE t.deleted_at IS NULL AND t.status <> 'Cancelled' AND t.reject_date BETWEEN $1::date AND $2::date${rUnit}`,
        ...rArgs,
      )
    )[0]!;
    const wArgs: unknown[] = [];
    const wUnit = plant(caller, wArgs, 'q');
    const waiting = n((await query(prisma, `SELECT count(*)::int AS n FROM qms_revoke_requests q WHERE q.status='Pending'${wUnit}`, ...wArgs))[0]!.n);
    // unpaginated: the department master
    const departments = (await query(prisma, `SELECT name FROM departments ORDER BY name`)).map((r) => S(r.name));

    return {
      from,
      to,
      department: q.department ?? null,
      departments,
      incoming: {
        ...inc,
        pending,
        acceptancePct: pct(inc.accepted, inc.decided),
        conditionalPct: pct(inc.conditional, inc.decided),
        rejectionPct: pct(inc.rejected + inc.partial, inc.decided),
        previousAcceptancePct: pct(before.accepted, before.decided),
      },
      inProcess: { drill, machine: q.machine ?? null, machines, series, checks, failed, rate: pct(failed, checks) },
      suppliers: { totalDefects: sup.reduce((a, r) => a + r.defects, 0), rows: sup.slice(0, 8) },
      complaints: {
        total: n(c.total),
        open: n(c.open),
        pending: n(c.pending),
        closed: n(c.closed),
        priority: { MINOR: n(c.minor), MAJOR: n(c.major), CRITICAL: n(c.critical) },
        stages: STAGES.map(([key, label]) => ({ key, label, done: n(c[key]) })),
      },
      revoke: { rejected: n(rv.rejected), openLots: n(rv.open), revoked: n(rv.revoked), pending: waiting, revokedPct: pct(n(rv.revoked), n(rv.rejected)) },
    };
  },

  /** All Data: one searchable list of every quality record the caller may see. */
  async allData(caller: Caller, q: { q?: string | undefined; type?: string | undefined; department?: string | undefined; page: number; size: number }) {
    const may = async (page: string) => can(accessUserOf(caller.auth.user), page, 'view');
    const args: unknown[] = [];
    const parts: string[] = [];
    const add = async (page: string, build: (unit: string) => string, alias = 't') => {
      if (!(await may(page))) return;
      parts.push(build(plant(caller, args, alias)));
    };
    const row = (type: string, page: string, number: string, date: string, party: string, title: string, status: string, priority: string, department: string, from: string) =>
      `SELECT ${type} AS type, '${page}' AS page, t.id::text AS id, ${number} AS number, to_char(${date},'YYYY-MM-DD') AS date, ${party} AS party,
          ${title} AS title, ${status} AS status, ${priority} AS priority, ${department} AS department FROM ${from}`;
    for (const [kind, page, label] of [
      ['INCOMING', 'qms-incoming', 'Incoming inspection'],
      ['IN_PROCESS', 'qms-process', 'In-process inspection'],
      ['PRE_DISPATCH', 'qms-final', 'Final inspection'],
      ['WELDING', 'qms-final', 'Welding inspection'],
      ['VT', 'qms-final', 'Visual test'],
      ['ISIR', 'qms-supplier', 'Supplier ISIR'],
    ] as const)
      await add(page, (u) =>
        `${row(`'${label}'`, page, 't.number', 't.doc_date', 'COALESCE(s.name, c.name)', 'i.name', 't.status', 't.priority', 'NULL::varchar',
          'qms_inspections t LEFT JOIN suppliers s ON s.id=t.supplier_id LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN items i ON i.id=t.item_id')}
          WHERE t.deleted_at IS NULL AND t.kind='${kind}'${u}`,
      );
    for (const [type, label] of [
      ['CUSTOMER', 'Customer NCR'],
      ['CONFORMANCE', 'Conformance NCR'],
    ] as const)
      await add(PAGE_OF_NCR[type], (u) =>
        `${row(`'${label}'`, PAGE_OF_NCR[type], 't.number', 't.ncr_date', 'c.name', 't.title', 't.status', 't.priority', 't.department',
          'qms_ncrs t LEFT JOIN customers c ON c.id=t.customer_id')} WHERE t.deleted_at IS NULL AND t.type='${type}'${u}`,
      );
    await add('qms-ncr', (u) =>
      `${row(`'Rejection'`, 'qms-ncr', 't.number', 't.reject_date', 't.process', 't.part', 't.status', 'NULL::varchar', 'NULL::varchar', 'qms_rejections t')}
        WHERE t.deleted_at IS NULL${u}`,
    );
    await add('qms-rejection-revoke', (u) =>
      `${row(`'Revoke request'`, 'qms-rejection-revoke', 't.number', 't.requested_at', 'r.number', 't.reason', 't.status', 'NULL::varchar', 'NULL::varchar',
        'qms_revoke_requests t JOIN qms_rejections r ON r.id=t.rejection_id')} WHERE true${u}`,
    );
    for (const [kind, page, label] of [
      ['EIGHT_D', 'qms-capa', '8D report'],
      ['CI', 'qms-capa', 'Improvement'],
      ['MOM', 'qms-mom', 'Minutes of meeting'],
      ['ALERT', 'qms-ncr', 'Quality alert'],
    ] as const)
      await add(page, (u) =>
        `${row(`'${label}'`, page, 't.number', 't.doc_date', 'COALESCE(c.name, s.name)', 't.title', 't.status', 'NULL::varchar', `t.data->>'department'`,
          'qms_forms t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN suppliers s ON s.id=t.supplier_id')}
          WHERE t.deleted_at IS NULL AND t.kind='${kind}'${u}`,
      );
    await add('qms-copq', (u) =>
      `${row(`'Quality cost'`, 'qms-copq', `to_char(t.month,'YYYY-MM')`, 't.month', `t.category || ' · ' || t.amount::text`, 't.description', `'Recorded'`, 'NULL::varchar', 'NULL::varchar', 'qms_cost_entries t')}
        WHERE t.deleted_at IS NULL${u}`,
    );
    if (parts.length === 0) return { rows: [], total: 0, types: [] };
    const base = parts.join(' UNION ALL ');
    const where: string[] = ['true'];
    if (q.type) {
      args.push(q.type);
      where.push(`x.type=$${args.length}`);
    }
    if (q.department) {
      args.push(q.department);
      where.push(`x.department=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(x.number ILIKE $${args.length} OR x.party ILIKE $${args.length} OR x.title ILIKE $${args.length} OR x.status ILIKE $${args.length})`);
    }
    // every argument of `base` must stay referenced, so the type list is counted over the whole union
    const types = (await query(prisma, `SELECT DISTINCT x.type FROM (${base}) x ORDER BY 1`, ...args.slice(0, args.length - (where.length - 1)))).map((r) => S(r.type));
    const w = where.join(' AND ');
    const total = n((await query(prisma, `SELECT count(*)::int AS n FROM (${base}) x WHERE ${w}`, ...args))[0]!.n);
    const rows = await query(
      prisma,
      `SELECT * FROM (${base}) x WHERE ${w} ORDER BY x.date DESC NULLS LAST, x.number DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm(r)), total, types };
  },

  /** Import: every row is checked first; nothing is written when one row is wrong. */
  async importRows(caller: Caller, kind: ImportKind, rows: Record<string, string>[]) {
    const page = IMPORT_PAGE[kind];
    if (!(await can(accessUserOf(caller.auth.user), page, 'import')))
      throw Errors.forbidden('Your role cannot import these records.');
    if (!caller.ctx.unitId) throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
    const errors: { row: number; message: string }[] = [];
    const ready: (() => Promise<unknown>)[] = [];
    const v = (r: Record<string, string>, k: string): string => (r[k] ?? '').trim();
    const lookup = async (sql: string, value: string): Promise<string | null> => {
      const r = (await query(prisma, sql, value))[0];
      return r ? S(r.id) : null;
    };
    const dateOk = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
    const amountOk = (s: string): boolean => /^\d+(\.\d{1,3})?$/.test(s);
    const departments = new Set((await query(prisma, `SELECT name FROM departments`)).map((r) => S(r.name)));
    for (const [i, r] of rows.entries()) {
      const bad: string[] = [];
      if (kind === 'cost') {
        const month = v(r, 'month');
        const category = v(r, 'category').toUpperCase().replace(/[ -]+/g, '_');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad.push('month must be YYYY-MM');
        if (!(COST_CATEGORIES as readonly string[]).includes(category)) bad.push(`category must be one of ${COST_CATEGORIES.join(', ')}`);
        if (v(r, 'description').length < 3) bad.push('description is required');
        if (!amountOk(v(r, 'amount')) || Number(v(r, 'amount')) <= 0) bad.push('amount must be a number above 0');
        if (!bad.length)
          ready.push(() =>
            registersService.addCost(caller, page, {
              month,
              category: category as (typeof COST_CATEGORIES)[number],
              description: v(r, 'description').slice(0, 200),
              amount: v(r, 'amount'),
            }),
          );
      } else {
        const type: NcrType = kind === 'customer-ncr' ? 'CUSTOMER' : 'CONFORMANCE';
        const priority = (v(r, 'priority') || 'MINOR').toUpperCase();
        const department = v(r, 'department') || 'Quality';
        const result = (v(r, 'result') || 'NON_CONFORMANCE').toUpperCase().replace(/[ -]+/g, '_');
        let customerId: string | null = null;
        let itemId: string | null = null;
        if (v(r, 'date') && !dateOk(v(r, 'date'))) bad.push('date must be YYYY-MM-DD');
        if (v(r, 'targetDate') && !dateOk(v(r, 'targetDate'))) bad.push('targetDate must be YYYY-MM-DD');
        if (!(PRIORITIES as readonly string[]).includes(priority)) bad.push('priority must be Minor, Major or Critical');
        if (!departments.has(department)) bad.push(`department "${department}" does not exist`);
        if (v(r, 'title').length < 3) bad.push('title is required');
        if (v(r, 'description').length < 3) bad.push('description is required');
        for (const k of ['qty', 'claimAmount']) if (v(r, k) && !amountOk(v(r, k))) bad.push(`${k} must be a number`);
        if (type === 'CUSTOMER') {
          customerId = await lookup(`SELECT id::text AS id FROM customers WHERE deleted_at IS NULL AND (lower(code)=lower($1) OR lower(name)=lower($1)) LIMIT 1`, v(r, 'customerNo'));
          if (!customerId) bad.push(`customer "${v(r, 'customerNo')}" was not found`);
        } else if (!['CONFORMANCE', 'NON_CONFORMANCE'].includes(result)) bad.push('result must be Conformance or Non conformance');
        if (v(r, 'itemCode')) {
          itemId = await lookup(`SELECT id::text AS id FROM items WHERE lower(code)=lower($1) LIMIT 1`, v(r, 'itemCode'));
          if (!itemId) bad.push(`item "${v(r, 'itemCode')}" was not found`);
        }
        if (v(r, 'targetDate') && (v(r, 'date') || todayIst()) > v(r, 'targetDate')) bad.push('targetDate is before the date');
        if (!bad.length)
          ready.push(() =>
            ncrService.create(caller, {
              type,
              ncrDate: v(r, 'date') || undefined,
              department,
              priority: priority as Priority,
              result: result as 'CONFORMANCE' | 'NON_CONFORMANCE',
              customerId,
              itemId,
              reference: v(r, 'reference').slice(0, 60),
              process: v(r, 'process').slice(0, 120),
              title: v(r, 'title').slice(0, 200),
              description: v(r, 'description').slice(0, 2000),
              qty: v(r, 'qty'),
              claimAmount: v(r, 'claimAmount'),
              rootCause: v(r, 'rootCause').slice(0, 2000),
              correctiveAction: v(r, 'correctiveAction').slice(0, 2000),
              ownerName: v(r, 'owner').slice(0, 120),
              targetDate: v(r, 'targetDate'),
            }),
          );
      }
      if (bad.length) errors.push({ row: i + 2, message: bad.join('; ') });
    }
    if (errors.length) return { imported: 0, errors };
    for (const make of ready) await make();
    return { imported: ready.length, errors: [] };
  },
};

export const IMPORT_KINDS = ['customer-ncr', 'conformance-ncr', 'cost'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
const IMPORT_PAGE: Record<ImportKind, string> = {
  'customer-ncr': PAGE_OF_NCR.CUSTOMER,
  'conformance-ncr': PAGE_OF_NCR.CONFORMANCE,
  cost: 'qms-copq',
};
