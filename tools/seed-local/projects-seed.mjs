// Projects demo data via the local API only: projects, tasks and subtasks, milestones, team, timesheets, expenses, budgets,
// stage gates, specifications, test records, project documents.
// Re-runnable: projects by name, tasks/milestones/subtasks by project + name, timesheets by employee + week, etc.
// Run: node tools/seed-local/projects-seed.mjs   (SEED_API defaults to http://localhost:4100/api/v1)
import * as L from './seedlib.mjs';
const { api, ensure, act, d, rnd } = L;

await L.login();
const units = (await api('GET', '/units')).data; const U = Object.fromEntries(units.map((u) => [u.code, u.id]));
await L.setUnit('TAL');
const CHECKERS = ['head.production', 'mgr.production.saw', 'head.hr', 'gm.shinde'];
async function asChecker(fn) {
  for (const u of CHECKERS) { try { await L.actAs(u); const r = await fn(); L.actAsOwner(); if (r && r.status !== 403) return r; } catch { /* next */ } finally { L.actAsOwner(); } }
  return null;
}

const customers = ((await api('GET', '/customers')).data ?? []);
const emps = (await L.list('/hr/employees')).filter((e) => e.status === 'ACTIVE' && e.unitName === 'Talwade').sort((a, b) => a.empCode.localeCompare(b.empCode));
const empsSaw = (await L.list('/hr/employees')).filter((e) => e.status === 'ACTIVE' && e.unitName === 'Sawardari').sort((a, b) => a.empCode.localeCompare(b.empCode));

// ------------------------------------------------------------------ projects
const PROJ = [
  ['Die-cast pump housing line automation', 'TAL', 0, 0, '2026-10-05', '2027-03-31', 4850000, 'FIXED_MILESTONE', 'activate'],
  ['Robotic welding cell for chassis brackets', 'TAL', 1, 1, '2026-10-19', '2027-04-30', 6200000, 'FIXED_MILESTONE', 'activate'],
  ['CNC retrofit of 6 VMC machines (spindle and controller)', 'TAL', 2, 2, '2026-09-14', '2027-01-29', 3150000, 'TIME_MATERIAL', 'activate'],
  ['Painting booth energy upgrade (VFD and heat recovery)', 'TAL', 3, 3, '2026-11-02', '2027-02-26', 1780000, 'FIXED_MILESTONE', 'draft'],
  ['Press shop 200T hydraulic power pack revamp', 'SAW', 4, 0, '2026-08-03', '2026-11-27', 2640000, 'FIXED_MILESTONE', 'hold'],
  ['Customer tooling: gearbox cover die for Tata Motors', 'SAW', 5, 1, '2026-06-01', '2026-10-30', 3920000, 'FIXED_MILESTONE', 'complete'],
  ['Internal: ERP-linked barcode labelling in stores', 'TAL', null, 4, '2026-11-09', '2027-01-15', 450000, 'NON_BILLABLE', 'activate'],
];
let projects = ((await api('GET', '/projects?size=100')).data?.rows) ?? [];
// the projects list is plant scoped: read both plants
async function allProjects() {
  const out = [];
  for (const u of ['TAL', 'SAW']) { await L.setUnit(u); out.push(...(((await api('GET', '/projects?size=100')).data?.rows) ?? [])); }
  await L.setUnit('TAL');
  return [...new Map(out.map((x) => [x.id, x])).values()];
}
projects = await allProjects();
for (const [name, unit, ci, mi, startDate, endDate, contractValue, billingType] of PROJ) {
  const ex = projects.find((p) => p.name === name);
  const mgrPool = unit === 'SAW' ? empsSaw : emps;
  await L.setUnit(unit);
  await ensure(`project ${name}`, ex, 'POST', '/projects', { name, customerId: ci === null ? undefined : customers[ci]?.id, managerId: mgrPool[mi % mgrPool.length]?.id, unitId: U[unit], startDate, endDate, contractValue, billingType });
  await L.setUnit('TAL');
}
projects = await allProjects();
const P = Object.fromEntries(projects.map((p) => [p.name, p]));
const flowOf = (n) => PROJ.find((x) => x[0] === n)?.[8];
// ------------------------------------------------------------------ budgets (lines, approved by another user) and expenses
for (const [name, unit, , , , , contract] of PROJ) {
  const p = P[name]; if (!p || flowOf(name) === 'draft') continue;
  await L.setUnit(unit);
  const have = (await api('GET', `/projects/${p.id}/budgets`)).data ?? [];
  if (!have.length) {
    const f = contract;
    const r = await api('POST', `/projects/${p.id}/budgets`, { lines: [{ costHead: 'LABOUR', amount: Math.round(f * 0.18) }, { costHead: 'MATERIAL', amount: Math.round(f * 0.45) }, { costHead: 'SUBCONTRACT', amount: Math.round(f * 0.12) }, { costHead: 'TRAVEL', amount: Math.round(f * 0.02) }, { costHead: 'OVERHEAD', amount: Math.round(f * 0.05) }] });
    if (r.ok) { L.stats.created++; console.log(`  + budget ${p.projectNo ?? p.code}`); if (p.status !== 'ON_HOLD') { const a = await asChecker(() => api('POST', `/projects/budgets/${r.data.id}/approve`, {})); console.log(`    approve budget: ${a?.ok ? 'ok' : a?.err}`); } } else { L.stats.failed++; L.failures.push(`budget ${name}: ${r.err}`); console.log('  ! budget', name, r.err); }
  } else L.stats.skipped++;
  await L.setUnit('TAL');
}

for (const [name, unit, , , , , , , flow] of PROJ) {
  const p = P[name]; if (!p) continue;
  await L.setUnit(unit);
  const want = { activate: 'ACTIVE', hold: 'ON_HOLD', complete: 'COMPLETED' }[flow];
  if (!want || p.status === want) continue;
  if (p.status === 'DRAFT') { const a = await act(`activate ${name}`, 'POST', `/projects/${p.id}/activate`, {}); if (!a.ok) continue; p.status = 'ACTIVE'; }
  if (flow === 'hold') await act(`hold ${name}`, 'POST', `/projects/${p.id}/hold`, {});
  if (flow === 'complete') { await act(`complete ${name}`, 'POST', `/projects/${p.id}/complete`, {}); }
  await L.setUnit('TAL');
}
projects = await allProjects();
const PP = Object.fromEntries(projects.map((p) => [p.name, p]));
console.log('projects:', projects.map((p) => `${p.projectNo ?? p.code}:${p.status}`).join(' '));

// ------------------------------------------------------------------ team (screen), milestones (screen)
const TEAM_ROLES = ['PM', 'ENGINEER', 'ENGINEER', 'TECHNICIAN', 'QA'];
for (const [name, unit] of PROJ.map((x) => [x[0], x[1]])) {
  const p = PP[name]; if (!p) continue;
  await L.setUnit(unit);
  const pool = unit === 'SAW' ? empsSaw : emps;
  const have = await L.list('/screens/proj-team');
  for (let i = 0; i < Math.min(4, pool.length); i++) {
    const e = pool[(i + rnd(name, 5)) % pool.length];
    const label = `${e.firstName} ${e.lastName}`;
    const ex = have.find((t) => JSON.stringify(t).includes(p.code ?? p.projectNo) && JSON.stringify(t).includes(e.firstName) && JSON.stringify(t).includes(e.lastName));
    await ensure(`team ${p.projectNo ?? p.code} ${label}`, ex, 'POST', '/screens/proj-team', { values: { project: p.id, employee: e.id, role: TEAM_ROLES[i], allocation: [100, 60, 50, 40, 100][i], from: p.startDate?.slice(0, 10) ?? d(2), billable: i < 3, cost: 450 + i * 150 } });
  }
  await L.setUnit('TAL');
}
const MILES = [['Concept and design review', 18, 'Design frozen and customer sign-off on layout drawings', false], ['Material procurement complete', 45, 'All long-lead items received and inspected', false], ['Installation and FAT', 90, 'Factory acceptance test passed with customer witness', true], ['Handover and SAT', 120, 'Site acceptance, training and documentation handed over', true]];
for (const [name, unit] of PROJ.map((x) => [x[0], x[1]])) {
  const p = PP[name]; if (!p) continue;
  await L.setUnit(unit);
  const have = await L.list('/screens/proj-milestones');
  for (const [m, offs, criteria, billing] of MILES) {
    const start = new Date(String(p.startDate).slice(0, 10) + 'T00:00:00Z'); const t = new Date(start.getTime() + offs * 86400000).toISOString().slice(0, 10);
    const ex = have.find((x) => JSON.stringify(x).includes(m) && JSON.stringify(x).includes(p.projectNo ?? p.code));
    await ensure(`milestone ${p.projectNo ?? p.code} ${m}`, ex, 'POST', '/screens/proj-milestones', { values: { project: p.id, name: m, target: t, criteria, billing } });
  }
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ tasks (WBS), progress, dependencies, subtasks
const TASKS = [['1.0', 'Requirements and layout', 0, 14, 60], ['2.0', 'Detailed design and drawings', 12, 30, 120], ['3.0', 'Procurement of bought-out items', 28, 30, 40], ['4.0', 'Fabrication and assembly', 55, 35, 260], ['5.0', 'Trials, FAT and handover', 92, 28, 90]];
const taskIdx = {};
for (const [name, unit] of PROJ.map((x) => [x[0], x[1]])) {
  const p = PP[name]; if (!p) continue;
  await L.setUnit(unit);
  const pool = unit === 'SAW' ? empsSaw : emps;
  const have = (await api('GET', `/projects/${p.id}/tasks`)).data ?? [];
  const created = [];
  for (let i = 0; i < TASKS.length; i++) {
    const [wbs, tname, off, dur, hrs] = TASKS[i];
    const ex = have.find((t) => t.name === tname);
    const s = new Date(new Date(String(p.startDate).slice(0, 10) + 'T00:00:00Z').getTime() + off * 86400000).toISOString().slice(0, 10);
    const e2 = new Date(new Date(s + 'T00:00:00Z').getTime() + dur * 86400000).toISOString().slice(0, 10);
    const t = ex ?? await ensure(`task ${p.projectNo ?? p.code} ${tname}`, null, 'POST', `/projects/${p.id}/tasks`, { name: tname, wbsCode: wbs, assignedToId: pool[i % pool.length]?.id, plannedStart: s, plannedEnd: e2, durationDays: dur, estimatedHours: hrs });
    if (t) created.push({ ...t, fresh: !ex, i });
  }
  taskIdx[p.id] = created;
  // progress for active / completed projects and a chain of dependencies on new tasks
  const done = p.status === 'COMPLETED' ? [100, 100, 100, 100, 100] : p.status === 'ACTIVE' ? [100, 70, 40, 10, 0] : [100, 85, 60, 20, 0];
  for (const t of created) if (t.fresh && p.status !== 'DRAFT') await api('PATCH', `/projects/tasks/${t.id}/progress`, { progressPct: done[t.i] });
  for (let i = 1; i < created.length; i++) if (created[i].fresh) { const r = await api('POST', `/projects/tasks/${created[i - 1].id}/dependencies`, { successorId: created[i].id, type: 'FS', lagDays: 0 }); if (!r.ok && r.status !== 409) console.log('  . dependency', r.err); }
  // subtasks via screen
  const SUB = [[1, 'Review customer URS and part drawings'], [1, 'Prepare 3D layout and takt time study'], [3, 'Raise purchase requisitions for long-lead items'], [4, 'Sub-assembly of hydraulic and pneumatic modules']];
  for (const [ti, sname] of SUB) {
    const parent = created[ti]; if (!parent) continue;
    const ex = have.find((x) => x.name === sname && (x.parentTaskId ?? x.parent_task_id) === parent.id);
    const st = String(parent.planned_start ?? p.startDate).slice(0, 10);
    const en = String(parent.planned_end ?? p.endDate).slice(0, 10);
    await ensure(`subtask ${p.projectNo ?? p.code} ${sname}`, ex, 'POST', '/screens/proj-subtasks', { values: { project: p.id, parent: parent.id, name: sname, owner: pool[(ti + 1) % pool.length]?.id, start: st, due: en, hours: 16 + ti * 8, priority: ['P2', 'P3', 'P3', 'P1'][ti % 4] } });
  }
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ expenses
for (const [name, unit, , , , , contract] of PROJ) {
  const p = PP[name]; if (!p || p.status === 'DRAFT') continue;
  await L.setUnit(unit);
  const exp = (await api('GET', `/projects/${p.id}/expenses`)).data ?? [];
  const EXP = [['MATERIAL', 'Hardened guide pillars and bushes, vendor Pune', 186000, 33480, true, 'approve'], ['TRAVEL', 'Site survey and customer visit, Aurangabad', 14200, 0, false, 'approve'], ['SUBCONTRACT', 'Wire-cut and EDM job work', 78000, 14040, true, 'draft'], ['LABOUR', 'Contract fitters for installation', 52500, 0, true, 'approve']];
  for (const [category, description, amount, taxAmount, billable, flow] of EXP) {
    if (exp.find((x) => x.description === description)) { L.stats.skipped++; continue; }
    const r = await api('POST', `/projects/${p.id}/expenses`, { category, amount: Math.round(amount * (0.6 + rnd(name + description, 40) / 100)), taxAmount, billable, description, employeeId: emps[rnd(description, emps.length)]?.id });
    if (!r.ok) { L.stats.failed++; L.failures.push(`expense ${description}: ${r.err}`); console.log('  ! expense', r.err); continue; }
    L.stats.created++;
    if (flow === 'approve') { const a = await asChecker(() => api('POST', `/projects/expenses/${r.data.id}/approve`, {})); if (!a?.ok) console.log('    approve expense:', a?.err); }
  }
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ timesheets (weeks of 2 and 9 November)
{
  const ts = (await api('GET', '/projects/timesheets?size=200')).data ?? [];
  const mine = Object.values(PP).filter((p) => p.status === 'ACTIVE' && p.unitId === U.TAL);
  const people = emps.slice(0, 6);
  for (const e of people) {
    for (const wk of [2, 9]) {
      const ex = ts.find((t) => (t.employeeId === e.id) && String(t.weekStart ?? '').startsWith(d(wk)));
      if (ex) { L.stats.skipped++; if (wk === 2 && ex.status === 'DRAFT') await api('POST', `/projects/timesheets/${ex.id}/submit`, {}); continue; }
      const lines = [];
      for (let k = 0; k < 5; k++) { const p = mine[(k + e.firstName.length) % mine.length]; lines.push({ workDate: d(wk + k), projectId: p.id, hours: 8, billableHours: p.billingMethod === 'NON_BILLABLE' ? 0 : 7.5, description: ['Drawing review', 'Vendor follow-up', 'Assembly supervision', 'Trial run support', 'Documentation'][k] }); }
      // only team members may book on a project; add the person to the team first when needed
      for (const p of new Set(lines.map((l) => l.projectId))) {
        const team = await L.list('/screens/proj-team');
        if (!team.find((t) => JSON.stringify(t).includes(e.firstName) && JSON.stringify(t).includes(e.lastName) && JSON.stringify(t).includes(mine.find((m) => m.id === p).code))) {
          await api('POST', '/screens/proj-team', { values: { project: p, employee: e.id, role: 'ENGINEER', allocation: 50, from: d(1), billable: true, cost: 500 } });
        }
      }
      const r = await api('POST', '/projects/timesheets', { employeeId: e.id, weekStartDate: d(wk), lines });
      if (!r.ok) { L.stats.failed++; L.failures.push(`timesheet ${e.firstName} ${d(wk)}: ${r.err}`); console.log('  ! timesheet', e.firstName, d(wk), r.err); continue; }
      L.stats.created++; console.log(`  + timesheet ${e.firstName} week ${d(wk)}`);
      // submit / approve currently answer 500 on the local server (see the report); tried silently so a fixed server moves them on
      if (wk === 2) { const s = await api('POST', `/projects/timesheets/${r.data.id}/submit`, {}); if (s.ok) await asChecker(() => api('POST', `/projects/timesheets/${r.data.id}/approve`, {})); }
    }
  }
}

// ------------------------------------------------------------------ stage gates, specifications, test records, documents (project spine)
const SPEC = [['Spindle runout', 0.005, 0, 0.003, 'mm'], ['Hydraulic pressure at clamp', 180, -5, 5, 'bar'], ['Cycle time per casting', 62, -4, 4, 's'], ['Weld penetration depth', 2.4, -0.2, 0.3, 'mm'], ['Surface roughness Ra', 1.6, -0.2, 0.2, 'um']];
const DOCS = [['URS', 'User requirement specification, rev A'], ['CHARTER', 'Project charter and scope statement'], ['SPEC', 'Technical specification, rev B'], ['DRR', 'Design readiness review minutes'], ['BOM', 'Released bill of material'], ['FAT', 'FAT protocol and checklist']];
for (const [name, unit] of PROJ.map((x) => [x[0], x[1]])) {
  const p = PP[name]; if (!p || p.status === 'DRAFT') continue;
  await L.setUnit(unit);
  let gates = (await api('GET', `/projects/${p.id}/gates`)).data ?? [];
  if (!gates.length) {
    const tpl = unit === 'SAW' ? 'SPPM' : (/robotic|CNC|automation/i.test(name) ? 'SPPM' : 'BLDC');
    const r = await api('POST', `/projects/${p.id}/gates`, { template: tpl });
    if (r.ok) { L.stats.created++; console.log(`  + gates ${p.projectNo ?? p.code} (${tpl})`); gates = r.data; } else { L.stats.failed++; L.failures.push(`gates ${name}: ${r.err}`); console.log('  ! gates', r.err); }
  } else L.stats.skipped++;
  gates = (await api('GET', `/projects/${p.id}/gates`)).data ?? [];
  const open = gates.filter((g) => g.state === 'OPEN').slice(0, 1);
  for (const g of open) { await api('POST', `/projects/${p.id}/gates/${g.id}/start`, {}); await api('PUT', `/projects/${p.id}/gates/${g.id}/due`, { dueDate: d(20 + (g.seq % 8)) }); }
  const specs = (await api('GET', `/projects/${p.id}/specs`)).data ?? [];
  const specIds = [];
  for (let i = 0; i < SPEC.length; i++) {
    const [parameter, target, tolMinus, tolPlus, unitS] = SPEC[i];
    const ex = specs.find((s) => s.parameter === parameter);
    if (ex) { L.stats.skipped++; specIds.push(ex.id); continue; }
    const r = await api('POST', `/projects/${p.id}/specs`, { parameter, target, tolMinus, tolPlus, unit: unitS });
    if (r.ok) { L.stats.created++; specIds.push(r.data.id); if (i < 3) await asChecker(() => api('POST', `/projects/${p.id}/specs/${r.data.id}/approve`, {})); } else { L.stats.failed++; L.failures.push(`spec ${parameter}: ${r.err}`); console.log('  ! spec', parameter, r.err); }
  }
  const tests = (await api('GET', `/projects/${p.id}/tests`)).data ?? [];
  const TEST = [['Spindle runout check with dial gauge', 0, 0.004, 'OK'], ['Clamp pressure hold test (30 min)', 1, 183, 'OK'], ['Cycle time study, 20 shots', 2, 66.5, 'NG'], ['Weld macro etch', 3, 2.5, 'OK']];
  for (const [testName, si, value, result] of TEST) {
    if (tests.find((t) => t.test_name === testName)) { L.stats.skipped++; continue; }
    const r = await api('POST', `/projects/${p.id}/tests`, { testName, specId: specIds[si] ?? null, method: 'As per FAT protocol', sample: `S-${si + 1}`, value, result });
    if (r.ok) L.stats.created++; else { L.stats.failed++; L.failures.push(`test ${testName}: ${r.err}`); console.log('  ! test', r.err); }
  }
  const docs = (await api('GET', `/projects/${p.id}/documents`)).data ?? [];
  for (let i = 0; i < DOCS.length; i++) {
    const [docType, title] = DOCS[i];
    if (docs.find((x) => x.title === title)) { L.stats.skipped++; continue; }
    const r = await api('POST', `/projects/${p.id}/documents`, { docType, title });
    if (r.ok) { L.stats.created++; if (i < 3) await asChecker(() => api('POST', `/projects/${p.id}/documents/${r.data.id}/approve`, {})); } else { L.stats.failed++; L.failures.push(`doc ${title}: ${r.err}`); console.log('  ! doc', r.err); }
  }
  await L.setUnit('TAL');
}
L.summary('projects-seed');
