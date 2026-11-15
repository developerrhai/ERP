// HRMS demo data via the local API only. Re-runnable: each record is skipped when its natural key already exists.
// Run: node tools/seed-local/hr-seed.mjs   (SEED_API defaults to http://localhost:4100/api/v1)
import * as L from './seedlib.mjs';
const { api, ensure, act, d, listAll, aadhaar, pan, digits } = L;

await L.login();
const units = (await api('GET', '/units')).data; const U = Object.fromEntries(units.map((u) => [u.code, u.id]));
await L.setUnit('TAL');
const desig = Object.fromEntries((await listAll('/designations')).map((x) => [x.name, x.id]));
const desigName = (n) => Object.entries(desig).find(([k]) => k.toLowerCase().includes(n.toLowerCase()))?.[1] ?? null;
console.log('designations:', Object.keys(desig).join(', '));

// ---------------------------------------------------------------- employees
const PEOPLE = [
  ['Rajesh', 'Kumar', 'Yadav', 'MALE', '1991-04-12', 'TAL', 'Production', 'WORKER', '2022-06-01', 'B+'],
  ['Sunita', 'Dattatray', 'Patil', 'FEMALE', '1993-09-23', 'TAL', 'Quality', 'STAFF', '2021-02-15', 'O+'],
  ['Amit', 'Shankar', 'Deshmukh', 'MALE', '1989-01-30', 'TAL', 'Maintenance', 'STAFF', '2019-08-05', 'A+'],
  ['Pooja', 'Ramesh', 'Gaikwad', 'FEMALE', '1995-06-18', 'TAL', 'HR', 'STAFF', '2023-01-09', 'B-'],
  ['Santosh', 'Baban', 'Jadhav', 'MALE', '1987-11-02', 'TAL', 'Warehouse', 'WORKER', '2018-04-16', 'O+'],
  ['Mohammed', 'Irfan', 'Shaikh', 'MALE', '1994-03-27', 'TAL', 'Production', 'WORKER', '2024-07-01', 'AB+'],
  ['Kavita', 'Vilas', 'Kulkarni', 'FEMALE', '1990-12-08', 'TAL', 'Finance', 'STAFF', '2020-10-12', 'A-'],
  ['Vijay', 'Anant', 'Shinde', 'MALE', '1988-07-14', 'SAW', 'Production', 'WORKER', '2017-03-20', 'O-'],
  ['Prakash', 'Dnyaneshwar', 'More', 'MALE', '1992-05-05', 'SAW', 'Warehouse', 'WORKER', '2022-11-21', 'B+'],
  ['Neha', 'Suresh', 'Bhosale', 'FEMALE', '1996-02-19', 'SAW', 'Sales', 'STAFF', '2024-02-05', 'A+'],
  ['Ganesh', 'Tukaram', 'Pawar', 'MALE', '1985-08-09', 'TAL', 'Engineering', 'STAFF', '2016-06-27', 'O+'],
  ['Shweta', 'Mahesh', 'Joshi', 'FEMALE', '1997-10-25', 'TAL', 'Purchase', 'STAFF', '2025-05-12', 'B+'],
];
const empRows = await L.list('/hr/employees');
const byMobile = new Map(empRows.map((e) => [e.mobile, e]));
const seededEmps = [];
for (let i = 0; i < PEOPLE.length; i++) {
  const [fn, mn, ln, gender, dob, unit, dept, cat, join, bg] = PEOPLE[i];
  const mobile = `98${digits('mob' + fn + ln, 8)}`.replace(/^98(\d)/, (m, g) => '98' + (Number(g) < 2 ? '2' : g));
  let e = byMobile.get(mobile);
  const body = {
    firstName: fn, middleName: mn, lastName: ln, gender, dob, maritalStatus: i % 3 === 0 ? 'SINGLE' : 'MARRIED', mobile,
    personalEmail: `${fn}.${ln}@gmail.com`.toLowerCase(), officialEmail: `${fn}.${ln}@sawantgroup.example`.toLowerCase(),
    workerCategory: cat, employmentTypeCode: 'PERMANENT', joiningDate: join, probationEnd: null,
    pan: pan(fn + ln, ln[0]), aadhaar: aadhaar(digits('aad' + fn + ln, 11)), uan: '1012' + digits('uan' + fn + ln, 8),
    esicIp: i % 2 === 0 ? '31' + digits('esic' + fn + ln, 15) : null, pfApplicable: true, esicApplicable: i % 2 === 0,
    bloodGroup: bg, presentAddress: { line1: `Plot ${10 + i}, MIDC Industrial Area`, city: unit === 'TAL' ? 'Talwade, Pune' : 'Sawardari, Pune', state: 'Maharashtra', pincode: unit === 'TAL' ? '411062' : '411047' },
    noticeDays: 30, unitId: U[unit], department: dept, designationId: null, grade: cat === 'WORKER' ? 'W2' : 'S3',
  };
  if (!e) {
    await L.setUnit(unit);
    e = await ensure(`employee ${fn} ${ln}`, null, 'POST', '/hr/employees', body);
    await L.setUnit('TAL');
  } else L.stats.skipped++;
  if (e) seededEmps.push({ ...e, unit, bio: String(2000 + i + 1), fn, ln });
}
const emps = seededEmps;
console.log('employees ready:', emps.length);

// biometric codes
for (const e of emps) {
  if (!(e.biometricCode ?? e.biometric_code)) {
    const r = await api('PUT', `/hr/employees/${e.id}/biometric-code`, { biometricCode: e.bio });
    if (!r.ok) console.log('  ! biometric', e.fn, r.err); else { e.biometricCode = e.bio; }
  } else e.bio = e.biometricCode ?? e.biometric_code;
}

// ---------------------------------------------------------------- shifts roster + biometric devices + punches (attendance days)
const shifts = Object.fromEntries((await api('GET', '/hr/shifts')).data.map((s) => [s.code, s.id]));
const DAYS = []; for (let n = 2; n <= 14; n++) DAYS.push(n);
const isSunday = (n) => new Date(Date.UTC(2026, 10, n)).getUTCDay() === 0;
const rosterItems = [];
emps.forEach((e, i) => {
  const code = i % 4 === 0 ? 'MORNING' : i % 4 === 1 ? 'GEN' : i % 4 === 2 ? 'GEN' : 'MORNING';
  e.shift = code;
  for (const n of DAYS) rosterItems.push({ employeeId: e.id, rosterDate: d(n), shiftId: isSunday(n) ? null : shifts[code], isOff: isSunday(n) });
});
{
  const r = await api('PUT', '/hr/rosters', { items: rosterItems });
  console.log(r.ok ? `  roster saved: ${r.data.saved} entries (idempotent upsert)` : `  ! roster ${r.err}`);
}
const devices = (await api('GET', '/hr/att/devices')).data ?? [];
const DEV = { TAL: ['ZK-TAL-GATE-01', 'Talwade Main Gate Biometric', 'TALWADE-GATE-1'], SAW: ['ZK-SAW-GATE-01', 'Sawardari Gate Biometric', 'SAWARDARI-GATE-1'] };
for (const [u, [serial, name, code]] of Object.entries(DEV)) {
  await L.setUnit(u);
  await ensure(`device ${code}`, devices.find((x) => x.serial_no === serial || x.serialNo === serial), 'POST', '/hr/att/devices', { code, name, unitId: U[u], connection: 'PUSH', serialNo: serial, vendor: 'FILE_ZKTECO' });
  await L.setUnit('TAL');
}
// punches: 12 days, mostly on time, a few late / half days / absent. The device ignores duplicates, so a rerun is harmless.
const lines = { TAL: [], SAW: [] };
const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(L.rnd('s' + m, 60)).padStart(2, '0')}`;
emps.forEach((e, i) => {
  for (const n of DAYS) {
    if (isSunday(n)) continue;
    const roll = L.rnd(`${e.fn}${n}`, 100);
    if (roll < 7) continue; // absent
    const base = e.shift === 'MORNING' ? 7 * 60 : 9 * 60;
    const late = roll < 22 ? 20 + L.rnd(`late${e.fn}${n}`, 40) : L.rnd(`in${e.fn}${n}`, 8) - 4; // late arrival or a few minutes early/on time
    const half = roll >= 22 && roll < 28; // left at lunch
    const outAt = half ? base + 270 : base + (e.shift === 'MORNING' ? 8.6 * 60 : 8.75 * 60) + (roll > 90 ? 120 : L.rnd(`out${e.fn}${n}`, 20)); // a few overtime days
    const dt = `2026-11-${String(n).padStart(2, '0')}`;
    lines[e.unit].push(`${e.bio}\t${dt} ${hh(Math.max(0, base + late))}\t0\t1`, `${e.bio}\t${dt} ${hh(Math.round(outAt))}\t1\t1`);
  }
});
for (const [u, [serial]] of Object.entries(DEV)) {
  const r = await L.rawPost(`/iclock/cdata?SN=${serial}&table=ATTLOG`, lines[u].join('\n'));
  console.log(`  punches ${u}: ${r.status} ${r.text}`);
}
const days = (await api('GET', '/hr/attendance/days?month=2026-11')).data;
console.log('attendance days now:', days.length);

// ---------------------------------------------------------------- recruitment
const desigOp = desigName('Operator'), desigEx = desigName('Executive'), desigSup = desigName('Supervisor');
const REQS = [
  ['TAL', 'Production', desigOp, 4, 'Second shift ramp-up for the pump casting line', 'HIGH'],
  ['TAL', 'Quality', desigEx, 1, 'Incoming inspection backfill', 'MEDIUM'],
  ['TAL', 'Maintenance', desigSup, 1, 'Preventive maintenance supervisor', 'MEDIUM'],
  ['SAW', 'Warehouse', desigOp, 2, 'Dispatch loading team', 'LOW'],
  ['SAW', 'Sales', desigEx, 1, 'Inside sales for the export desk', 'URGENT'],
];
let reqs = (await api('GET', '/hr/requisitions')).data ?? [];
for (const [u, dept, des, pos, reason, prio] of REQS) {
  const ex = reqs.find((r) => r.reason === reason);
  await L.setUnit(u);
  const c = await ensure(`requisition ${dept}`, ex, 'POST', '/hr/requisitions', { unitId: U[u], department: dept, designationId: des, positions: pos, reason, priority: prio });
  if (c && !ex) reqs.push(c);
}
await L.setUnit('TAL');
reqs = (await api('GET', '/hr/requisitions')).data ?? [];
const CANDS = [
  ['Ravindra Sakharam Gawande', 'ravindra.gawande@gmail.com', '9604110233', 'Naukri'], ['Anita Prabhakar Kamble', 'anita.kamble92@gmail.com', '9822044187', 'Referral'],
  ['Sachin Bhaskar Thorat', 'sachin.thorat@outlook.com', '9370561029', 'Walk-in'], ['Deepali Anil Narvekar', 'deepali.narvekar@gmail.com', '9765380412', 'LinkedIn'],
  ['Imran Abdul Pathan', 'imran.pathan88@gmail.com', '9890273314', 'Naukri'], ['Komal Rajendra Salunkhe', 'komal.salunkhe@gmail.com', '9552104870', 'Campus'],
  ['Yogesh Madhukar Landge', 'yogesh.landge@gmail.com', '9028447761', 'Referral'], ['Swati Nandkumar Wagh', 'swati.wagh@gmail.com', '9421866305', 'Job portal'],
];
let cands = (await api('GET', '/hr/candidates')).data ?? [];
for (const [name, email, mobile, source] of CANDS) {
  const ex = cands.find((c) => c.mobile === mobile);
  const c = await ensure(`candidate ${name}`, ex, 'POST', '/hr/candidates', { name, email, mobile, source });
  if (c && !ex) cands.push(c);
}
cands = (await api('GET', '/hr/candidates')).data ?? [];
// applications through the Recruitment screen (stage per candidate)
const apps = await L.list('/screens/hr-recruitment');
console.log('application columns sample:', JSON.stringify(apps[0] ?? {}).slice(0, 200));
const STAGES = ['SCREENING', 'INTERVIEW', 'INTERVIEW', 'OFFER', 'OFFER', 'JOINED', 'REJECTED', 'SCREENING'];
const appRecs = [];
for (let i = 0; i < CANDS.length; i++) {
  const c = cands.find((x) => x.mobile === CANDS[i][2]); const rq = reqs[i % reqs.length];
  if (!c || !rq) continue;
  const have = apps.find((a) => JSON.stringify(a).includes(c.id) || a.candidate === CANDS[i][0] || a.candidate_name === CANDS[i][0]);
  const rec = await ensure(`application ${CANDS[i][0]}`, have, 'POST', '/screens/hr-recruitment', { values: { candidate: c.id, requisition: rq.id, stage: STAGES[i] } });
  appRecs.push({ cand: c, rec });
}

// offers for candidates at OFFER / JOINED stage
{
  const appsNow = await L.list('/screens/hr-recruitment');
  const offers = (await api('GET', '/hr/offers')).data ?? [];
  const OFFER_CTC = { 3: 420000, 4: 360000, 5: 540000 };
  for (const i of [3, 4, 5]) {
    const c = cands.find((x) => x.mobile === CANDS[i][2]); const a = appsNow.find((x) => x.candidate === CANDS[i][0]);
    if (!c || !a) continue;
    const ex = offers.find((o) => o.candidate_id === c.id || o.candidateId === c.id);
    await ensure(`offer ${CANDS[i][0]}`, ex, 'POST', '/hr/offers', { applicationId: a.id, candidateId: c.id, offeredCtc: OFFER_CTC[i], joinDate: d(i === 5 ? 2 : 23), validityDate: d(i === 5 ? 1 : 20) });
  }
}

// ---------------------------------------------------------------- onboarding, training, exit (Add screens / exit service)
{
  const have = await L.list('/screens/hr-onboarding');
  const allE = await L.list('/hr/employees');
  const names = (e) => `${e.firstName} ${e.lastName}`;
  for (const e of emps.slice(7, 12)) {
    const ex = have.find((h) => JSON.stringify(h).includes(e.firstName) && JSON.stringify(h).includes(e.lastName));
    await ensure(`onboarding ${e.fn} ${e.ln}`, ex, 'POST', '/screens/hr-onboarding', { values: { employee: e.id, laptop: e.fn === 'Neha' || e.fn === 'Shweta' } });
  }
  const trn = await L.list('/screens/hr-training');
  const TRAIN = [
    ['TRN-FIRE-01', 'Fire Safety and Evacuation Drill', 'Maharashtra Fire Services Academy', 4, 'Annual mock drill with hands-on extinguisher use for all shop-floor staff.'],
    ['TRN-5S-02', '5S and Visual Management', 'Kaizen Institute India', 8, 'Sort, set in order, shine, standardise, sustain: workplace organisation for the casting and machining lines.'],
    ['TRN-ISO-03', 'ISO 9001:2015 Internal Auditor', 'TUV India', 16, 'Internal auditor certification for the quality team.'],
    ['TRN-FORK-04', 'Forklift and Material Handling Safety', 'Godrej Material Handling', 6, 'Safe operation and load limits for the warehouse team.'],
    ['TRN-CNC-05', 'CNC Programming Basics (Fanuc)', 'Fanuc India Training Centre', 24, 'G-code and offsets for new operators.'],
    ['TRN-POSH-06', 'POSH Awareness', 'Internal Committee, HR', 2, 'Prevention of sexual harassment at the workplace: annual statutory session.'],
  ];
  for (const [code, name, trainer, hours, description] of TRAIN) {
    await ensure(`training ${code}`, trn.find((t) => t.code === code || JSON.stringify(t).includes(code)), 'POST', '/screens/hr-training', { values: { code, name, trainer, hours, description } });
  }
  // exit cases for three long-serving older demo employees (the new demo staff stay active)
  const exits = (await api('GET', '/hr/exits')).data ?? [];
  const EXIT = [['Nikhil', 'Kulkarni31', 'RESIGNATION', d(3), 'Better opportunity in Pune'], ['Swapnil', 'Deshmukh19', 'RESIGNATION', d(9), 'Relocating to home town'], ['Omkar', 'Chavan34', 'RESIGNATION', d(12), 'Higher studies']];
  const madeExit = [];
  for (const [fn, ln, exitType, resignationDate, reason] of EXIT) {
    const e = allE.find((x) => x.firstName === fn && x.lastName === ln);
    if (!e) continue;
    const ex = exits.find((x) => (x.employee_id ?? x.employeeId) === e.id);
    const c = await ensure(`exit ${fn} ${ln}`, ex, 'POST', '/hr/exits', { employeeId: e.id, exitType, resignationDate, reason });
    if (c && !ex) madeExit.push(c);
  }
  const fresh = (await api('GET', '/hr/exits')).data ?? [];
  if (madeExit.length) { const r = await api('POST', `/hr/exits/${madeExit[0].id}/handoff`, {}); console.log('  exit handoff:', r.ok ? 'created' : r.err); }
}

// ---------------------------------------------------------------- leave (Loss of Pay only: no leave accrual API exists, other types need a balance)
{
  const types = Object.fromEntries((await api('GET', '/hr/leave/types')).data.map((t) => [t.code, t.id]));
  const LEAVES = [[0, 4, 4, 'Family function in native village', true], [1, 9, 10, 'Child school admission formalities', true], [2, 12, 13, 'Fever and rest', false],
    [3, 5, 5, 'Bank work', true], [5, 16, 17, 'Cousin wedding at Satara', false], [6, 2, 2, 'Personal work', true], [7, 18, 19, 'Home repair', false], [9, 11, 11, 'Visa appointment', true]];
  for (const [ei, from, to, reason, approve] of LEAVES) {
    const e = emps[ei];
    const r = await api('POST', '/hr/leave/apply', { employeeId: e.id, leaveTypeId: types.LOP, startDate: d(from), endDate: d(to), reason });
    if (r.ok) {
      L.stats.created++; console.log(`  + leave ${e.fn} ${d(from)}`);
      if (approve) await act(`approve leave ${e.fn}`, 'POST', `/hr/leave/applications/${r.data.id}/approve`, {});
    } else if (r.status === 409) L.stats.skipped++; else { L.stats.failed++; L.failures.push(`leave ${e.fn}: ${r.status} ${r.err}`); console.log('  ! leave', e.fn, r.err); }
  }
}
// ---------------------------------------------------------------- expense claims
{
  const cats = Object.fromEntries((await api('GET', '/hr/expenses/categories')).data.map((c) => [c.name, c.id]));
  const claims = (await api('GET', '/hr/expenses/claims')).data ?? [];
  const CL = [
    [0, 'Customer visit to Bhosari die-cast vendor', [['Travel & Conveyance', 2, 1850, 'Round trip by cab, Talwade to Bhosari'], ['Meals & Entertainment', 2, 640, 'Working lunch']], 'approve'],
    [1, 'Quality audit at Chakan supplier', [['Travel & Conveyance', 5, 2400, 'Cab fare'], ['Lodging & Hotel', 5, 3200, 'One night, Chakan']], 'submit'],
    [2, 'Spares sourcing at Mumbai', [['Travel & Conveyance', 7, 1320, 'Train and local travel'], ['Meals & Entertainment', 7, 450, 'Lunch']], 'approve'],
    [3, 'Campus recruitment drive', [['Travel & Conveyance', 9, 1750, 'Bus and auto'], ['Office Supplies', 9, 980, 'Banners and forms'], ['Meals & Entertainment', 9, 520, 'Lunch with panel']], 'draft'],
    [6, 'Mobile bill October 2026', [['Communication / Telephone', 3, 799, 'Postpaid plan, October']], 'approve'],
    [7, 'Dispatch coordination at JNPT', [['Travel & Conveyance', 10, 3900, 'Cab to JNPT and back'], ['Meals & Entertainment', 10, 780, 'Meals']], 'submit'],
    [9, 'Client meeting in Nashik', [['Travel & Conveyance', 12, 2850, 'Cab'], ['Lodging & Hotel', 12, 2900, 'Hotel'], ['Meals & Entertainment', 12, 900, 'Dinner with client']], 'draft'],
  ];
  for (const [ei, title, lines, flow] of CL) {
    const e = emps[ei];
    if (claims.find((c) => c.title === title)) { L.stats.skipped++; continue; }
    await L.setUnit(e.unit);
    const r = await api('POST', '/hr/expenses/claims', { employeeId: e.id, unitId: U[e.unit], claimDate: d(13), title, description: title, lines: lines.map(([cat, day, amount, description]) => ({ categoryId: cats[cat], expenseDate: d(day), amount, gstAmount: 0, description })) });
    if (!r.ok) { L.stats.failed++; L.failures.push(`claim ${title}: ${r.err}`); console.log('  ! claim', title, r.err); await L.setUnit('TAL'); continue; }
    L.stats.created++; console.log('  + claim ' + title);
    if (flow !== 'draft') await act(`submit ${title}`, 'POST', `/hr/expenses/claims/${r.data.id}/submit`, {});
    if (flow === 'approve') { const ap = await api('POST', `/hr/expenses/claims/${r.data.id}/approve`, {}); if (!ap.ok) console.log('  note: claim approval refused:', ap.status, ap.err); }
    await L.setUnit('TAL');
  }
}
// ---------------------------------------------------------------- letters (offer / appointment)
{
  const letters = (await api('GET', '/hr/letters')).data ?? [];
  const mk = (n, des, dep, gross, jd) => ({ name: n, designation: des, department: dep, company: 'Sawant Group', gross, joining_date: jd });
  const LET = [
    ['OFFER', 'Deepali Anil Narvekar', 'deepali.narvekar@gmail.com', mk('Deepali Anil Narvekar', 'Executive', 'Quality', '35000', d(23)), 'issue'],
    ['OFFER', 'Imran Abdul Pathan', 'imran.pathan88@gmail.com', mk('Imran Abdul Pathan', 'Operator', 'Production', '30000', d(23)), 'approve'],
    ['OFFER', 'Komal Rajendra Salunkhe', 'komal.salunkhe@gmail.com', mk('Komal Rajendra Salunkhe', 'Executive', 'Maintenance', '45000', d(2)), 'issue'],
    ['APPOINTMENT', 'Shweta Mahesh Joshi', 'shweta.joshi@gmail.com', mk('Shweta Mahesh Joshi', 'Executive', 'Purchase', '38000', '2025-05-12'), 'issue'],
    ['APPOINTMENT', 'Neha Suresh Bhosale', 'neha.bhosale@gmail.com', mk('Neha Suresh Bhosale', 'Executive', 'Sales', '40000', '2024-02-05'), 'approve'],
    ['APPOINTMENT', 'Mohammed Irfan Shaikh', 'irfan.shaikh@gmail.com', mk('Mohammed Irfan Shaikh', 'Operator', 'Production', '28000', '2024-07-01'), 'draft'],
  ];
  for (const [templateCode, personName, personEmail, data, flow] of LET) {
    const have = letters.find((l) => (l.person_name ?? l.personName) === personName && (l.template_code ?? l.templateCode) === templateCode);
    let r;
    if (have) { L.stats.skipped++; r = { ok: true, data: have }; if (String(have.status) !== 'Draft' && (flow !== 'issue' || have.status === 'Issued')) continue; if (flow === 'draft') continue; }
    else {
      r = await api('POST', '/hr/letters', { templateCode, personName, personEmail, data });
      if (!r.ok) { L.stats.failed++; L.failures.push(`letter ${personName}: ${r.err}`); console.log('  ! letter', personName, r.err); continue; }
      L.stats.created++; console.log(`  + letter ${templateCode} ${personName}`);
    }
    if (have && have.status === 'Approved') { if (flow === 'issue') await act('issue letter', 'POST', `/hr/letters/${r.data.id}/issue`, {}); continue; }
    if (flow !== 'draft') { await L.actAs('head.hr'); await act('approve letter', 'POST', `/hr/letters/${r.data.id}/approve`, {}); L.actAsOwner(); }
    if (flow === 'issue') await act('issue letter', 'POST', `/hr/letters/${r.data.id}/issue`, {});
  }
}
// ---------------------------------------------------------------- workplace: shift handovers, visitors, canteen
{
  const users = Object.fromEntries((await listAll('/users?size=100')).map((u) => [u.loginId, u.id]));
  const hov = (await api('GET', '/ops/handovers')).data ?? [];
  const HO = [
    ['Production', 3, 'MORNING', 'EVENING', 'head.production', 'Die-cast machine 4 hydraulic oil top-up pending; casting rejection 2.1 percent.', 'Helmet and gloves checked; one near-miss at furnace corner logged.', 'accept'],
    ['Production', 5, 'EVENING', 'NIGHT', 'sup.production.tal', 'Machining line 2 running on one spindle; second spindle bearing noise.', 'No incident.', 'submit'],
    ['Quality', 6, 'MORNING', 'EVENING', 'mgr.quality.tal', 'Gauge calibration due on three bore gauges.', 'No incident.', 'accept'],
    ['Maintenance', 10, 'MORNING', 'EVENING', 'sup.maintenance', 'Compressor 2 belt replaced; cooling tower pump on watch.', 'Lock-out tag-out applied during belt change.', 'draft'],
    ['Warehouse', 11, 'GEN', 'EVENING', 'mgr.stores.tal', 'Inward trucks from two vendors still waiting for unloading.', 'Forklift horn repaired.', 'reject'],
  ];
  for (const [department, day, from, to, inc, issues, safetyNote, flow] of HO) {
    if (hov.find((h) => h.department === department && String(h.handover_date ?? h.handoverDate).startsWith(d(day)))) { L.stats.skipped++; continue; }
    const r = await api('POST', '/ops/handovers', { department, handoverDate: d(day), fromShiftId: shifts[from], toShiftId: shifts[to], incomingUserId: users[inc] ?? null, issues, safetyNote, materialsShort: department === 'Warehouse' ? 'Aluminium ingots ADC12: 2 pallets short' : null, lines: [{ item: 'Machine status', note: 'All running' }], pendingJobs: [{ job: 'Job card 4471', qty: 120 }] });
    if (!r.ok) { L.stats.failed++; L.failures.push(`handover ${department}: ${r.err}`); console.log('  ! handover', department, r.err); continue; }
    L.stats.created++; console.log(`  + handover ${department} ${d(day)}`);
    if (['submit', 'accept', 'reject'].includes(flow)) await act('submit handover', 'POST', `/ops/handovers/${r.data.id}/submit`, {});
    if (flow === 'accept') await act('accept handover', 'POST', `/ops/handovers/${r.data.id}/accept`, {});
    if (flow === 'reject') await act('reject handover', 'POST', `/ops/handovers/${r.data.id}/reject`, { reason: 'Quantities not matching the stock sheet' });
  }
  const vis = (await api('GET', '/ops/visitors')).data ?? [];
  const VIS = [
    ['Harshad Ratnakar Mehta', '9820145512', 'Bharat Forge Ltd, Pune', 'head.purchase', 'Purchase', 4, 'Vendor audit and sample approval', 'MH14AB4521', 'Aadhaar', '4471', 'inside'],
    ['Priyanka Sanjay Kelkar', '9422319087', 'TUV India, Mumbai', 'head.quality', 'Quality', 5, 'ISO surveillance audit', null, 'PAN', '908K', 'out'],
    ['Faisal Ahmed Khan', '9823600871', 'Atlas Copco India', 'sup.maintenance', 'Maintenance', 11, 'Compressor AMC visit', 'MH12KL8830', 'Aadhaar', '2216', 'out'],
    ['Dr. Anand Vishwanath Rao', '9881122034', 'Tata Motors, Chikhali', 'head.sales', 'Sales', 16, 'New enquiry: housing castings', 'MH14GH7712', 'Driving licence', '3340', 'pre'],
    ['Manoj Sitaram Dhumal', '9960554433', 'Shree Logistics, Bhosari', 'mgr.stores.tal', 'Warehouse', 12, 'Transport rate discussion', null, 'Aadhaar', '7805', 'approved'],
    ['Rekha Prakash Iyer', '9594033126', 'Bank of Baroda, Talwade branch', 'head.finance', 'Finance', 9, 'Cash credit renewal documents', null, 'PAN', '115Q', 'rejected'],
    ['Nitin Balasaheb Phadtare', '9763210987', 'Fire and Safety Dept, PCMC', 'head.production', 'Production', 13, 'Annual fire NOC inspection', 'MH14FD0023', 'Aadhaar', '6642', 'out'],
    ['Sanjay Gopal Hegde', '9890776655', 'Kirloskar Pneumatic, Hadapsar', 'head.purchase', 'Purchase', 15, 'Compressor spares delivery', 'MH12QR5509', 'Aadhaar', '1893', 'inside'],
    ['Aarti Vinayak Bapat', '9370445566', 'Deloitte India, Pune', 'head.finance', 'Finance', 15, 'Statutory audit fieldwork', null, 'PAN', '774M', 'inside'],
    ['Rafique Nazir Sayyed', '9823998811', 'Om Sai Transport', 'mgr.stores.tal', 'Warehouse', 15, 'Truck pickup coordination', 'MH14JK3377', 'Aadhaar', '5502', 'out'],
    ['Jyoti Ramchandra Phadke', '9764112200', 'Siemens Ltd, Mumbai', 'sup.maintenance', 'Maintenance', 15, 'VFD commissioning', null, 'Aadhaar', '8841', 'pre'],
  ];
  for (const [visitorName, mobile, company, host, department, day, purpose, vehicleNo, idType, idLast4, flow] of VIS) {
    if (vis.find((v) => (v.visitor_name ?? v.visitorName) === visitorName)) { L.stats.skipped++; continue; }
    const r = await api('POST', '/ops/visitors', { visitorName, mobile, company, hostUserId: users[host] ?? null, department, visitDate: d(day), plannedIn: `${d(day)}T10:00:00+05:30`, plannedOut: `${d(day)}T13:00:00+05:30`, purpose, vehicleNo, idType, idLast4, items: vehicleNo ? [{ item: 'Laptop' }] : [] });
    if (!r.ok) { L.stats.failed++; L.failures.push(`visitor ${visitorName}: ${r.err}`); console.log('  ! visitor', visitorName, r.err); continue; }
    L.stats.created++; console.log(`  + visitor ${visitorName}`);
    const id = r.data.id;
    if (['inside', 'out', 'approved'].includes(flow)) await act('approve visitor', 'POST', `/ops/visitors/${id}/approve`, {});
    if (flow === 'rejected') await act('reject visitor', 'POST', `/ops/visitors/${id}/reject`, {});
    if (['inside', 'out'].includes(flow)) await act('visitor check-in', 'POST', '/ops/visitors/check-in', { id, idLast4, vehicleNo });
    if (flow === 'out') await act('visitor check-out', 'POST', `/ops/visitors/${id}/check-out`, {});
  }
  // canteen
  const rates = (await api('GET', '/ops/canteen/rates')).data ?? [];
  for (const [mealType, rate, gstPct, share] of [['BREAKFAST', 30, 5, 50], ['LUNCH', 65, 5, 40], ['DINNER', 65, 5, 40], ['TEA', 8, 5, 0]]) {
    if (rates.find((x) => (x.meal_type ?? x.mealType) === mealType)) { L.stats.skipped++; continue; }
    const r = await act(`canteen rate ${mealType}`, 'PUT', '/ops/canteen/rates', { mealType, rate, gstPct, employeeSharePct: share, effectiveFrom: d(1) });
    if (r.ok) L.stats.created++;
  }
  // meal entitlement per shift, per plant (needed before a coupon can be scanned)
  for (const u of ['TAL', 'SAW']) {
    await L.setUnit(u);
    for (const [sc, metas] of [['GEN', ['LUNCH', 'TEA']], ['MORNING', ['BREAKFAST', 'LUNCH', 'TEA']], ['EVENING', ['DINNER', 'TEA']]]) for (const m of metas) await api('PUT', '/ops/canteen/entitlements', { shiftId: shifts[sc], mealType: m, on: true });
    if (u === 'SAW') for (const [mealType, rate, gstPct, share] of [['BREAKFAST', 28, 5, 50], ['LUNCH', 60, 5, 40], ['TEA', 8, 5, 0]]) await api('PUT', '/ops/canteen/rates', { mealType, rate, gstPct, employeeSharePct: share, effectiveFrom: d(1) });
  }
  await L.setUnit('TAL');
  const reg = (await api('GET', '/ops/canteen/register?date=' + d(15))).data ?? [];
  if (reg.length < 5) {
    for (const [e, meal] of [[emps[0], 'LUNCH'], [emps[1], 'LUNCH'], [emps[2], 'BREAKFAST'], [emps[4], 'LUNCH'], [emps[6], 'TEA']]) {
      const r = await api('POST', '/ops/canteen/scan', { code: e.empCode ?? e.emp_code, mealType: meal });
      console.log('  canteen scan', e.fn, meal, r.ok ? 'ok' : r.err);
    }
  }
}
L.summary('hr-seed');
