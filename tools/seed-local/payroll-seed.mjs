// Payroll demo data via the local API only (structures, salary assignment, periods, processed runs, loans, payslips, bank).
// Re-runnable: structures/periods are keyed by code/month, runs by period+unit, loans by employee+disbursement date.
// Salary assignments have no read API; the script checks them with a read-only SELECT through psql (falls back to "skip when a run exists").
// Run: node tools/seed-local/payroll-seed.mjs   (SEED_API defaults to http://localhost:4100/api/v1)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as L from './seedlib.mjs';
const { api, ensure, act, d, listAll, rnd } = L;

await L.login();
const units = (await api('GET', '/units')).data; const U = Object.fromEntries(units.map((u) => [u.code, u.id]));
await L.setUnit('TAL');

// ---- structures
const comps = Object.fromEntries((await api('GET', '/payroll/components')).data.map((c) => [c.code, c.id]));
const structs = (await api('GET', '/payroll/structures')).data;
const STRUCTS = [
  ['WRK-MFG', 'Shop-floor Worker (Basic 50, HRA 20)', ['BASIC', 'HRA', 'CONV', 'SPECIAL']],
  ['STF-MFG', 'Staff (Basic 50, HRA 20, Special balance)', ['BASIC', 'HRA', 'CONV', 'SPECIAL']],
  ['MGR-MFG', 'Manager and Engineer', ['BASIC', 'HRA', 'CONV', 'SPECIAL']],
];
for (const [code, name, lines] of STRUCTS) {
  if (structs.find((s) => s.code === code)) { L.stats.skipped++; continue; }
  const r = await api('POST', '/payroll/structures', { code, name, description: name, lines: lines.map((c, i) => ({ component_id: comps[c], sequence: (i + 1) * 10 })) });
  if (r.ok) { L.stats.created++; console.log('  + structure ' + code); } else { L.stats.failed++; L.failures.push(`structure ${code}: ${r.err}`); console.log('  ! structure', code, r.err); }
}
const S = Object.fromEntries((await api('GET', '/payroll/structures')).data.map((s) => [s.code, s.id]));

// ---- salary assignment for every active employee of Talwade and Sawardari
const emps = (await L.list('/hr/employees')).filter((e) => e.status === 'ACTIVE' && ['Talwade', 'Sawardari'].includes(e.unitName));
function assignedIds() {
  try {
    const envUrl = readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8').match(/^DATABASE_URL=.*$/m)[0];
    const user = envUrl.replace(/.*:\/\/([^:]+):.*/, '$1'), pw = envUrl.replace(/.*:\/\/[^:]+:([^@]+)@.*/, '$1');
    const out = execFileSync('psql', ['-U', user, '-h', 'localhost', '-d', 'rhai_erp_ui', '-At', '-c', "select employee_id from employee_salary_assignments where status = 'ACTIVE'"], { env: { ...process.env, PGPASSWORD: pw } }).toString();
    return new Set(out.split(/\r?\n/).filter(Boolean));
  } catch { return null; }
}
const have = assignedIds();
const runsNow = (await api('GET', '/payroll/runs')).data ?? [];
let assigned = 0;
for (const e of emps) {
  if (have ? have.has(e.id) : runsNow.length > 0) { L.stats.skipped++; continue; }
  const worker = e.workerCategory === 'WORKER';
  const grade = e.department;
  const ctc = worker ? 17000 + rnd('ctc' + e.empCode, 9) * 1000 : (['Finance', 'Engineering', 'Quality'].includes(grade) ? 36000 : 28000) + rnd('ctc' + e.empCode, 12) * 2500;
  const basic = Math.round(ctc * 0.5), hra = Math.round(ctc * 0.2), conv = 1600, special = ctc - basic - hra - conv;
  const structure = worker ? S['WRK-MFG'] : ctc >= 50000 ? S['MGR-MFG'] : S['STF-MFG'];
  const r = await api('POST', '/payroll/assignments', { employee_id: e.id, structure_id: structure, monthly_ctc: ctc, effective_from: '2026-04-01', lines: [{ component_id: comps.BASIC, monthly_amount: basic }, { component_id: comps.HRA, monthly_amount: hra }, { component_id: comps.CONV, monthly_amount: conv }, { component_id: comps.SPECIAL, monthly_amount: special }] });
  if (r.ok) { L.stats.created++; assigned++; } else { L.stats.failed++; L.failures.push(`assign ${e.empCode}: ${r.err}`); }
}
console.log(`  salary assignments created: ${assigned} (of ${emps.length} active employees)`);

// ---- periods
const periods = (await api('GET', '/payroll/periods')).data;
for (const [month, start, end, basis] of [['2026-09', '2026-09-01', '2026-09-30', 30], ['2026-10', '2026-10-01', '2026-10-31', 31], ['2026-11', '2026-11-01', '2026-11-30', 30]]) {
  if (periods.find((p) => p.month === month)) { L.stats.skipped++; continue; }
  const r = await api('POST', '/payroll/periods', { month, start_date: start, end_date: end, days_basis: basis });
  if (r.ok) { L.stats.created++; console.log('  + period ' + month); } else { L.stats.failed++; L.failures.push(`period ${month}: ${r.err}`); }
}
const P = Object.fromEntries((await api('GET', '/payroll/periods')).data.map((p) => [p.month, p.id]));

// ---- runs: September and October processed for each plant (calculate, lock, post); November left as a calculated draft for Talwade
const runs = async () => (await api('GET', '/payroll/runs')).data ?? [];
async function runFor(month, unit, steps) {
  let r = (await runs()).find((x) => x.period_month === month && x.unit_id === U[unit] && x.run_type === 'REGULAR' && x.status !== 'CANCELLED');
  if (!r) {
    const c = await api('POST', '/payroll/runs', { period_id: P[month], unit_id: U[unit], run_type: 'REGULAR' });
    if (!c.ok) { L.stats.failed++; L.failures.push(`run ${month} ${unit}: ${c.err}`); console.log('  ! run', month, unit, c.err); return; }
    L.stats.created++; console.log(`  + run ${month} ${unit}`);
    r = { id: c.data.id, status: 'DRAFT' };
  } else L.stats.skipped++;
  const id = r.id ?? r.id;
  let status = r.status;
  const want = ['calculate', 'lock', 'post'].slice(0, steps);
  const next = { DRAFT: 'calculate', CALCULATED: 'lock', LOCKED: 'post', APPROVED: 'lock' };
  for (let guard = 0; guard < 4; guard++) {
    const n = next[status];
    if (!n || !want.includes(n)) break;
    const a = await api('POST', `/payroll/runs/${id}/${n}`, {});
    if (!a.ok) { console.log(`  ! run ${month} ${unit} ${n}: ${a.status} ${a.err}`); L.failures.push(`run ${month} ${unit} ${n}: ${a.err}`); break; }
    status = n === 'calculate' ? 'CALCULATED' : n === 'lock' ? 'LOCKED' : 'POSTED';
    console.log(`    run ${month} ${unit} -> ${status}`);
  }
  return id;
}
const runIds = {};
for (const [month, unit, steps] of [['2026-09', 'TAL', 3], ['2026-09', 'SAW', 3], ['2026-10', 'TAL', 3], ['2026-10', 'SAW', 3], ['2026-11', 'TAL', 1]]) runIds[`${month}-${unit}`] = await runFor(month, unit, steps);

// ---- payslips release, bank batch
const tmpl = (await api('GET', '/payroll/bank-templates')).data[0];
const batches = (await api('GET', '/payroll/bank-batches')).data ?? [];
for (const key of ['2026-09-TAL', '2026-10-TAL', '2026-10-SAW']) {
  const id = runIds[key]; if (!id) continue;
  const rel = await api('POST', `/payroll/runs/${id}/payslips/release`, {});
  console.log(`  payslips ${key}: ${rel.ok ? 'released' : rel.status + ' ' + rel.err}`);
  if (batches.find((b) => b.payroll_run_id === id)) { L.stats.skipped++; continue; }
  const b = await api('POST', '/payroll/bank-batches/generate', { payroll_run_id: id, bank_template_id: tmpl.id });
  if (b.ok) { L.stats.created++; console.log(`  + bank batch ${key}`); } else { L.stats.failed++; L.failures.push(`bank batch ${key}: ${b.err}`); console.log(`  ! bank batch ${key}: ${b.err}`); }
}

// ---- loans (Loan screen; EMI schedule is built by the API)
const loans = await L.list('/screens/pay-loan');
const byEmp = Object.fromEntries(emps.map((e) => [e.empCode, e]));
const LOANS = [[0, 60000, 12, 3], [1, 120000, 24, 5], [3, 30000, 6, 9], [5, 80000, 18, 10], [8, 45000, 10, 12]].map(([i, principal, tenure, day]) => ({ e: emps.filter((x) => /^EMP\/(TAL|SAW)\/26-27\/00(1[3-9]|2)/.test(x.empCode) || true)[i], principal, tenure, day }));
for (const l of LOANS) {
  if (!l.e) continue;
  const name = `${l.e.firstName} ${l.e.lastName}`;
  const ex = loans.find((x) => x.employee === name || JSON.stringify(x).includes(name));
  await L.setUnit(l.e.unitName === 'Sawardari' ? 'SAW' : 'TAL');
  await ensure(`loan ${name}`, ex, 'POST', '/screens/pay-loan', { values: { employee: l.e.id, principal: l.principal, interest: 0, tenure: l.tenure, disbursed: d(l.day) } });
  await L.setUnit('TAL');
}
L.summary('payroll-seed');
