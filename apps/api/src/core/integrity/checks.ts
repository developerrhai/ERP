// Global integrity checks (Phase 33 section 6): run after a big data load (the full company feed, a restore, a cut-over).
// Each check is one SQL that returns the offending rows; an empty result means the check passes.
import type { PrismaClient } from '@prisma/client';

export interface IntegrityCheck {
  code: string;
  name: string;
  /** a table that must exist, otherwise the check is skipped */
  needs: string[];
  sql: string;
}

export const INTEGRITY_CHECKS: readonly IntegrityCheck[] = [
  {
    code: 'TB_BALANCED',
    name: 'Trial balance: debit equals credit in every plant',
    needs: ['gl_entries'],
    sql: `SELECT unit_id::text AS unit, sum(debit)::text AS debit, sum(credit)::text AS credit FROM gl_entries GROUP BY unit_id HAVING round(sum(debit) - sum(credit), 2) <> 0`,
  },
  {
    code: 'JOURNALS_BALANCED',
    name: 'Every posted journal has equal debit and credit',
    needs: ['journals'],
    sql: `SELECT code, total_debit::text AS debit, total_credit::text AS credit FROM journals WHERE status = 'Posted' AND round(total_debit - total_credit, 2) <> 0 LIMIT 50`,
  },
  {
    code: 'GL_LINES_MATCH_JOURNALS',
    name: 'GL entries of a journal add up to the journal total',
    needs: ['gl_entries', 'journals'],
    sql: `SELECT j.code, j.total_debit::text AS journal_debit, sum(g.debit)::text AS gl_debit FROM journals j JOIN gl_entries g ON g.journal_id = j.id WHERE j.status = 'Posted' GROUP BY j.code, j.total_debit HAVING round(sum(g.debit) - j.total_debit, 2) <> 0 LIMIT 50`,
  },
  {
    code: 'ATTENDANCE_LOCK_SUMMARY',
    name: 'A locked month has a locked summary for every employee with days in it',
    needs: ['attendance_days', 'attendance_period_summary'],
    sql: `SELECT x.employee_id::text AS employee, x.month FROM (SELECT employee_id, to_char(attendance_date, 'YYYY-MM') AS month FROM attendance_days WHERE locked GROUP BY 1, 2) x WHERE NOT EXISTS (SELECT 1 FROM attendance_period_summary s WHERE s.employee_id = x.employee_id AND s.locked AND to_char(s.period_start, 'YYYY-MM') = x.month) LIMIT 50`,
  },
  {
    code: 'CANTEEN_MONTH_TOTALS',
    name: 'A closed canteen month equals the meals served in it',
    needs: ['canteen_months', 'canteen_coupons'],
    sql: `SELECT m.unit_id::text AS unit, m.month, m.employee_total::text AS closed, coalesce(sum(c.employee_share) FILTER (WHERE c.payment_mode = 'PAYROLL'), 0)::text AS served FROM canteen_months m LEFT JOIN canteen_coupons c ON c.unit_id = m.unit_id AND to_char(c.date, 'YYYY-MM') = m.month AND c.status = 'SERVED' WHERE m.status = 'CLOSED' GROUP BY m.unit_id, m.month, m.employee_total HAVING round(coalesce(m.employee_total, 0) - coalesce(sum(c.employee_share) FILTER (WHERE c.payment_mode = 'PAYROLL'), 0), 2) <> 0`,
  },
  {
    code: 'ONE_OPEN_MOVEMENT',
    name: 'A document has at most one open department movement',
    needs: ['work_movements'],
    sql: `SELECT doc_type, doc_id::text AS doc, count(*)::text AS open FROM work_movements WHERE state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK') GROUP BY doc_type, doc_id HAVING count(*) > 1 LIMIT 50`,
  },
  {
    code: 'DEPLOYED_WORKERS_VALID',
    name: 'Every deployed contract worker belongs to an approved contractor',
    needs: ['cl_workers', 'contractors'],
    sql: `SELECT w.worker_no FROM cl_workers w JOIN contractors c ON c.id = w.contractor_id WHERE w.status = 'Deployed' AND (c.approval_status <> 'Approved' OR c.status <> 'Active') LIMIT 50`,
  },
  {
    code: 'NO_12_DIGIT_AADHAAR',
    name: 'No full Aadhaar number is stored in the contract worker register',
    needs: ['cl_workers'],
    sql: `SELECT worker_no FROM cl_workers WHERE coalesce(aadhaar_last4, '') !~ '^[0-9]{0,4}$' OR mobile ~ '^[0-9]{12}$' LIMIT 50`,
  },
  {
    code: 'LOCKED_WAGE_LINES',
    name: 'A locked wage sheet has lines, and its totals equal them',
    needs: ['cl_wage_sheets', 'cl_wage_lines'],
    sql: `SELECT s.id::text AS sheet, s.total_net::text AS sheet_net, coalesce(sum(l.net_pay), 0)::text AS lines_net FROM cl_wage_sheets s LEFT JOIN cl_wage_lines l ON l.sheet_id = s.id WHERE s.status = 'LOCKED' GROUP BY s.id, s.total_net HAVING round(s.total_net - coalesce(sum(l.net_pay), 0), 2) <> 0`,
  },
];

export interface IntegrityResult { code: string; name: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; rows: unknown[] }

/** Runs every check; a check whose tables do not exist yet is skipped, not failed. */
export async function runIntegrityChecks(db: PrismaClient): Promise<IntegrityResult[]> {
  const out: IntegrityResult[] = [];
  for (const c of INTEGRITY_CHECKS) {
    const have = await db.$queryRawUnsafe<{ t: string | null }[]>(`SELECT ${c.needs.map((t) => `to_regclass('public.${t}')::text AS "${t}"`).join(', ')}`);
    const missing = c.needs.some((t) => !(have[0] as Record<string, unknown>)[t]);
    if (missing) {
      out.push({ code: c.code, name: c.name, status: 'SKIPPED', rows: [] });
      continue;
    }
    const rows = await db.$queryRawUnsafe<unknown[]>(c.sql);
    out.push({ code: c.code, name: c.name, status: rows.length === 0 ? 'PASS' : 'FAIL', rows });
  }
  return out;
}

/** The database name must say it is not production. */
export function assertSafeTarget(url: string): void {
  const name = (/\/([^/?]+)(?:\?|$)/.exec(url) ?? [])[1] ?? '';
  if (!/(_staging|_e2e|_test)$/.test(name) && name !== 'rhai_erp') {
    throw new Error(`Refusing to run on "${name}": use a database named *_staging, *_e2e or *_test (or the local rhai_erp).`);
  }
}
