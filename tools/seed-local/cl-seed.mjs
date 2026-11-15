// Contract Labour demo data via the local API only: contractors, work orders, workers + onboarding checks, deployment,
// muster from device punches, wage sheets, invoices, compliance documents, incidents.
// Re-runnable: contractors by code, work orders by contractor + scope, workers by contractor + name, invoices by invoice no.
// Maker-checker steps (approve contractor / activate work order / verify document / approve payment) are done as other demo users.
// Run: node tools/seed-local/cl-seed.mjs   (SEED_API defaults to http://localhost:4100/api/v1)
import * as L from './seedlib.mjs';
const { api, ensure, act, d, rnd, digits, pan } = L;

await L.login();
const units = (await api('GET', '/units')).data; const U = Object.fromEntries(units.map((u) => [u.code, u.id]));
await L.setUnit('TAL');
const CHECKERS = ['head.hr', 'mgr.hr', 'gm.shinde', 'cfo.deshpande'];
/** Run fn as the first checker who is allowed to; restores the owner session. */
async function asChecker(fn) {
  for (const u of CHECKERS) {
    try { await L.actAs(u); const r = await fn(); if (r && (r.status === 403)) { continue; } L.actAsOwner(); return r; } catch { /* try the next one */ } finally { L.actAsOwner(); }
  }
  return null;
}

// ------------------------------------------------------------------ contractors
const CON = [
  ['CON-001', 'Shree Ganesh Manpower Services', 'Ganesh Manpower Services LLP', 'AABFG', 'HR/PUN/2024/18821', '2027-06-30', '2027-03-31', '2027-02-28', 'Medium', 'Rajendra Bhosale', '9822011144', 'TAL'],
  ['CON-002', 'Maruti Enterprises', 'Maruti Enterprises', 'ABCPM', 'HR/PUN/2023/17402', '2027-09-30', '2027-08-31', '2027-05-15', 'Low', 'Maruti Tanaji Kadam', '9890155120', 'TAL'],
  ['CON-003', 'Sai Samarth Industrial Services', 'Sai Samarth Industrial Services Pvt Ltd', 'AAFCS', 'HR/PUN/2024/19950', '2027-01-31', '2027-01-31', '2026-12-20', 'High', 'Sandeep Gaikwad', '9423377810', 'SAW'],
  ['CON-004', 'Bhairavnath Labour Contractors', 'Bhairavnath Labour Contractors', 'AHJPB', 'HR/PUN/2022/15330', '2027-04-30', '2027-04-30', '2027-04-30', 'Low', 'Dnyaneshwar Bhairu Shelke', '9960331200', 'TAL'],
  ['CON-005', 'Om Sai Housekeeping and Security', 'Om Sai Facility Services', 'ACOPO', 'HR/PUN/2024/20114', '2027-10-31', '2027-09-30', '2027-07-31', 'Medium', 'Vinod Mohite', '9370882200', 'SAW'],
  ['CON-006', 'National Skill Workforce Pvt Ltd', 'National Skill Workforce Private Limited', 'AAFCN', 'HR/PUN/2021/12904', '2026-10-31', '2026-09-30', '2026-06-30', 'High', 'Pradeep Naik', '9822990011', 'TAL'],
];
const cons = (await api('GET', '/cl/contractors')).data ?? [];
for (const [code, name, legalEntity, panStem, lic, licTo, agrEnd, insEnd, risk, contact, mobile] of CON) {
  const panNo = `${panStem}${digits('pan' + code, 4)}${'ABCDEFGH'[rnd(code, 8)]}`.replace(/^(.{3})./, '$1' + (legalEntity.includes('Pvt') || legalEntity.includes('LLP') ? 'C' : 'P'));
  const body = { code, name, legalEntity, pan: panNo, labourLicenceNo: lic, licenceValidUntil: licTo, pfCode: `PUPUN${digits('pf' + code, 7)}000`, esicCode: `3300${digits('es' + code, 11)}`, insurancePolicy: `WC-${digits('ins' + code, 8)}`, insuranceExpiry: insEnd, agreementNo: `AGR/${code}/2026`, agreementStart: '2026-04-01', agreementEnd: agrEnd, contactPerson: contact, mobile, email: `${contact.split(' ')[0].toLowerCase()}@${name.split(' ')[0].toLowerCase()}.example`, bankAccountLast4: digits('bank' + code, 4), ifsc: 'HDFC0001234', riskRating: risk };
  await ensure(`contractor ${code}`, cons.find((c) => c.code === code), 'POST', '/cl/contractors', body);
}
let C = Object.fromEntries(((await api('GET', '/cl/contractors')).data ?? []).map((c) => [c.code, c]));
for (const code of ['CON-001', 'CON-002', 'CON-003', 'CON-004', 'CON-005']) {
  if (C[code] && C[code].approval_status !== 'Approved') {
    const r = await asChecker(() => api('POST', `/cl/contractors/${C[code].id}/approve`, {}));
    console.log(`  approve ${code}: ${r?.ok ? 'ok' : r?.err ?? 'no checker could approve'}`);
  }
}
C = Object.fromEntries(((await api('GET', '/cl/contractors')).data ?? []).map((c) => [c.code, c]));

// ------------------------------------------------------------------ work orders
const WO = [
  ['CON-001', 'TAL', 'Production', 'Machine shop loading and unloading, casting fettling', 'Unskilled', 6, 'DAILY', 520, 780000, 'activate'],
  ['CON-002', 'TAL', 'Warehouse', 'Inward material handling and kitting, forklift assist', 'Semi-skilled', 4, 'DAILY', 590, 540000, 'activate'],
  ['CON-003', 'SAW', 'Production', 'Press shop helpers and die setters assistance', 'Semi-skilled', 3, 'DAILY', 610, 420000, 'activate'],
  ['CON-004', 'TAL', 'Maintenance', 'Plant maintenance fitters and welders', 'Skilled', 3, 'DAILY', 680, 600000, 'activate'],
  ['CON-005', 'SAW', 'Administration', 'Housekeeping and gate security', 'Unskilled', 4, 'MONTHLY', 16200, 650000, 'activate'],
  ['CON-002', 'TAL', 'Quality', 'Final inspection helpers, second shift', 'Semi-skilled', 2, 'DAILY', 560, 300000, 'draft'],
];
let wos = (await api('GET', '/cl/work-orders')).data ?? [];
const woKey = (w) => `${w.contractor}|${w.skill_category}|${w.department}`;
for (const [code, unit, department, scope, skillCategory, requiredHeadcount, rateType, rate, budget, flow] of WO) {
  const con = C[code]; if (!con) continue;
  await L.setUnit(unit);
  wos = (await api('GET', '/cl/work-orders')).data ?? [];
  const ex = wos.find((w) => w.contractor === con.name && w.department === department && w.skill_category === skillCategory);
  const w = await ensure(`work order ${code} ${department}`, ex, 'POST', '/cl/work-orders', { contractorId: con.id, unitId: U[unit], poNo: `PO/${unit}/26-27/${100 + rnd(code + department, 800)}`, department, scope, skillCategory, requiredHeadcount, rateType, rate, otRate: rateType === 'DAILY' ? Math.round(rate / 8 * 2) : 90, serviceChargePct: 8, startDate: '2026-10-01', endDate: '2027-03-31', budget });
  const cur = ex ?? w;
  if (cur && flow === 'activate' && (!ex || ex.status === 'Draft')) {
    const r = await asChecker(() => api('POST', `/cl/work-orders/${cur.id}/activate`, {}));
    if (r?.ok) console.log(`  activated work order ${code} ${department}`); else if (r && r.status !== 409) console.log('  ! activate', code, r?.err);
  }
  await L.setUnit('TAL');
}
wos = (await api('GET', '/cl/work-orders')).data ?? [];

// ------------------------------------------------------------------ workers, onboarding checks, deployment
const WORKERS = [
  ['CON-001', 'Dattatray Vitthal Mane', 'M', '1992-08-14', 'Unskilled', 'Helper', 'Production'], ['CON-001', 'Shankar Raghunath Kale', 'M', '1989-03-22', 'Unskilled', 'Helper', 'Production'],
  ['CON-001', 'Sangita Bhimrao Jadhav', 'F', '1995-11-05', 'Unskilled', 'Fettler', 'Production'], ['CON-001', 'Ramesh Baban Lokhande', 'M', '1990-01-30', 'Unskilled', 'Loader', 'Production'],
  ['CON-002', 'Imtiyaz Hussain Mulla', 'M', '1991-06-18', 'Semi-skilled', 'Forklift assistant', 'Warehouse'], ['CON-002', 'Balu Maruti Chavan', 'M', '1987-12-02', 'Semi-skilled', 'Kitting operator', 'Warehouse'],
  ['CON-002', 'Archana Sunil Pawar', 'F', '1994-04-09', 'Semi-skilled', 'Kitting operator', 'Warehouse'],
  ['CON-003', 'Nilesh Shivaji Thakur', 'M', '1993-09-27', 'Semi-skilled', 'Press helper', 'Production'], ['CON-003', 'Kailas Dhondiba Sutar', 'M', '1986-05-16', 'Semi-skilled', 'Die setter assistant', 'Production'],
  ['CON-003', 'Pramod Anil Gurav', 'M', '1996-02-11', 'Semi-skilled', 'Press helper', 'Production'],
  ['CON-004', 'Sunil Eknath Waghmare', 'M', '1984-10-03', 'Skilled', 'Welder', 'Maintenance'], ['CON-004', 'Yusuf Gafur Inamdar', 'M', '1988-07-21', 'Skilled', 'Fitter', 'Maintenance'],
  ['CON-004', 'Mangesh Ashok Kamthe', 'M', '1990-12-29', 'Skilled', 'Electrician', 'Maintenance'],
  ['CON-005', 'Savita Mohan Ghadge', 'F', '1992-03-08', 'Unskilled', 'Housekeeper', 'Administration'], ['CON-005', 'Ashok Tukaram Mhatre', 'M', '1980-11-19', 'Unskilled', 'Security guard', 'Administration'],
  ['CON-005', 'Gopal Ramchandra Dhere', 'M', '1985-08-25', 'Unskilled', 'Security guard', 'Administration'],
];
const WAGE = { Unskilled: 520, 'Semi-skilled': 590, Skilled: 680 };
const CODEFOR = { 'CON-001': 'TAL', 'CON-002': 'TAL', 'CON-003': 'SAW', 'CON-004': 'TAL', 'CON-005': 'SAW' };
const workerState = [];
for (let i = 0; i < WORKERS.length; i++) {
  const [code, name, gender, dob, skillCategory, trade, department] = WORKERS[i];
  const con = C[code]; if (!con) continue;
  const unit = CODEFOR[code];
  await L.setUnit(unit);
  const have = ((await api('GET', `/cl/workers?contractor=${con.id}`)).data ?? []).find((w) => w.name === name);
  const bio = `CL${7001 + i}`;
  const w = have ?? await ensure(`worker ${name}`, null, 'POST', '/cl/workers', { name, contractorId: con.id, aadhaarLast4: digits('aad' + name, 4), mobile: `9${digits('wm' + name, 9)}`.replace(/^9[0-5]/, '97'), dob, gender, skillCategory, trade, department, unitId: U[unit], joiningDate: '2026-10-05', contractEnd: '2027-03-31', wageRate: skillCategory === 'Unskilled' && code === 'CON-005' ? 540 : WAGE[skillCategory], pfUan: i % 3 === 0 ? `1012${digits('uan' + name, 8)}` : null, esicIpNo: i % 2 === 0 ? `31${digits('esic' + name, 15)}` : null, policeRequired: trade === 'Security guard', biometricCode: bio });
  if (w) workerState.push({ id: w.id, name, code, unit, i, status: have?.status ?? 'Registered', bio, trade });
  await L.setUnit('TAL');
}
// onboarding checks: everyone gets KYC, medical, induction, PPE (police for security); the last of each group stays partly done
for (const w of workerState) {
  if (w.status !== 'Registered') continue;
  await L.setUnit(w.unit);
  const partial = w.i % 7 === 6; // a few workers are still being onboarded
  const kinds = partial ? ['KYC', 'MEDICAL'] : ['KYC', 'MEDICAL', 'INDUCTION', 'PPE', 'ID_CARD'].concat(w.trade === 'Security guard' ? ['POLICE'] : []);
  for (const kind of kinds) await act(`check ${kind} ${w.name}`, 'POST', `/cl/workers/${w.id}/checks`, { kind, doneAt: d(2 + (w.i % 3)), validUntil: kind === 'MEDICAL' || kind === 'INDUCTION' ? '2027-10-31' : null, note: kind === 'PPE' ? 'Helmet, safety shoes, gloves, ear plugs issued' : kind === 'MEDICAL' ? 'Fit for work (empanelled clinic, Talwade)' : null });
  w.partial = partial;
  await L.setUnit('TAL');
}
// deploy
for (const w of workerState) {
  if (w.status !== 'Registered' || w.partial) continue;
  await L.setUnit(w.unit);
  const wo = (((await api('GET', '/cl/work-orders')).data) ?? []).find((x) => x.contractor === C[w.code].name && x.status === 'Active');
  if (!wo) { await L.setUnit('TAL'); continue; }
  const r = await api('POST', `/cl/workers/${w.id}/deploy`, { workOrderId: wo.id, fromDate: d(2), department: wo.department });
  if (r.ok) { L.stats.created++; w.deployed = true; console.log(`  + deployed ${w.name}`); } else if (r.status !== 409) { L.stats.failed++; L.failures.push(`deploy ${w.name}: ${r.err}`); console.log('  ! deploy', w.name, r.err); } else console.log(`  . deploy ${w.name}: ${r.err}`);
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ attendance: device punches for the CL badges, then the muster
const DEV = { TAL: ['ZK-TAL-GATE-01', 'Talwade Main Gate Biometric', 'TALWADE-GATE-1'], SAW: ['ZK-SAW-GATE-01', 'Sawardari Gate Biometric', 'SAWARDARI-GATE-1'] };
const lines = { TAL: [], SAW: [] };
const sunday = (n) => new Date(Date.UTC(2026, 10, n)).getUTCDay() === 0;
for (const w of workerState) {
  if (w.partial) continue;
  for (let n = 2; n <= 14; n++) {
    if (sunday(n)) continue;
    const roll = rnd(`cl${w.name}${n}`, 100); if (roll < 8) continue;
    const inM = 8 * 60 + 50 + rnd(`in${w.name}${n}`, 15); const out = inM + 9 * 60 + (roll > 85 ? 120 : rnd(`out${w.name}${n}`, 25)) - (roll < 14 ? 270 : 0);
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(rnd(w.name + m, 60)).padStart(2, '0')}`;
    lines[w.unit].push(`${w.bio}\t2026-11-${String(n).padStart(2, '0')} ${hm(inM)}\t0\t1`, `${w.bio}\t2026-11-${String(n).padStart(2, '0')} ${hm(out)}\t1\t1`);
  }
}
for (const [u, [serial, name, code]] of Object.entries(DEV)) {
  await L.setUnit(u);
  await ensure(`device ${code}`, null, 'POST', '/hr/att/devices', { code, name, unitId: U[u], connection: 'PUSH', serialNo: serial, vendor: 'FILE_ZKTECO' });
  if (lines[u].length) { const r = await L.rawPost(`/iclock/cdata?SN=${serial}&table=ATTLOG`, lines[u].join('\n')); console.log(`  punches ${u}: ${r.status} ${r.text}`); }
}
for (const u of ['TAL', 'SAW']) {
  await L.setUnit(u);
  let rows = 0;
  for (let n = 2; n <= 14; n++) { const r = await api('POST', '/cl/attendance/generate', { date: d(n) }); if (r.ok) rows += r.data.rows; }
  console.log(`  muster ${u}: ${rows} worker-days generated/refreshed`);
  const att = (await api('GET', '/cl/attendance?month=2026-11')).data ?? [];
  const pending = att.filter((a) => !a.supervisor_approved).slice(0, 15);
  for (const a of pending) await api('POST', `/cl/attendance/${a.id}/approve`, {});
}
await L.setUnit('TAL');

// ------------------------------------------------------------------ wage sheets
for (const code of ['CON-001', 'CON-002', 'CON-003', 'CON-004', 'CON-005']) {
  const unit = CODEFOR[code]; await L.setUnit(unit);
  const sheets = (await api('GET', '/cl/wages')).data ?? [];
  const ex = sheets.find((s) => s.contractor === C[code].name && s.month === '2026-11');
  if (ex && ex.status === 'LOCKED') { L.stats.skipped++; continue; }
  const r = await api('POST', '/cl/wages/compute', { month: '2026-11', contractorId: C[code].id, unitId: U[unit] });
  if (r.ok) { if (!ex) { L.stats.created++; console.log(`  + wage sheet ${code}`); } else L.stats.skipped++; if (['CON-001', 'CON-004'].includes(code)) { const k = await asChecker(() => api('POST', `/cl/wages/${r.data.id}/lock`, {})); console.log(`    lock ${code}: ${k?.ok ? 'ok' : k?.err}`); } }
  else console.log(`  ! wages ${code}: ${r.err}`);
}
await L.setUnit('TAL');

// ------------------------------------------------------------------ invoices (billed against the work order, reconciled with the muster)
const invs = [];
const INV = [['CON-001', 'SGM/26-27/118', 11, 'TAL', 6, 66, 0, 'approve'], ['CON-002', 'ME/2026/0457', 11, 'TAL', 4, 44, 6000, 'reconcile'], ['CON-004', 'BLC/114/2026', 11, 'TAL', 3, 36, 0, 'approve'], ['CON-003', 'SSIS/11/0032', 11, 'SAW', 3, 33, 0, 'draft'], ['CON-005', 'OSHS/NOV/09', 11, 'SAW', 4, 4, 0, 'reconcile']];
for (const [code, invoiceNo, mon, unit, headcount, billedManDays, otValue, flow] of INV) {
  await L.setUnit(unit);
  const con = C[code]; const wo = (((await api('GET', '/cl/work-orders')).data) ?? []).find((x) => x.contractor === con.name && x.status === 'Active');
  if (!wo) { console.log('  . no active work order for ' + code); continue; }
  let have = (((await api('GET', '/cl/invoices')).data) ?? []).find((x) => x.invoice_no === invoiceNo);
  let inv = have ?? await ensure(`invoice ${invoiceNo}`, null, 'POST', '/cl/invoices', { unitId: U[unit], invoiceNo, invoiceDate: d(14), contractorId: con.id, workOrderId: wo.id, billingMonth: '2026-11', headcount, billedManDays, otValue, gstRatePct: 18 });
  if (!inv) { await L.setUnit('TAL'); continue; }
  if (!have) have = (((await api('GET', '/cl/invoices')).data) ?? []).find((x) => x.invoice_no === invoiceNo);
  let status = have?.status ?? 'DRAFT';
  if (status === 'DRAFT' && flow !== 'draft') { const r = await act(`reconcile ${invoiceNo}`, 'POST', `/cl/invoices/${inv.id}/reconcile`, {}); status = r.ok ? 'RECONCILED' : status; }
  if (flow === 'approve' && ['RECONCILED', 'DISPUTED', 'PAYMENT_BLOCKED'].includes(status)) {
    // payment needs the contractor's compliance for the billing month to be complete: upload and verify the month's documents first
    for (const kind of ['PF_ECR', 'PF_CHALLAN', 'ESIC_CHALLAN', 'MUSTER_ROLL', 'WAGE_REGISTER', 'BANK_PROOF', 'BONUS_REGISTER', 'RETURN_FILED']) {
      const u = await api('POST', '/cl/compliance/docs', { contractorId: con.id, month: '2026-11', kind, reference: `${kind}/${code}/2026-11`, unitId: U[unit] });
      if (u.ok) { await L.actAs('head.hr'); await api('POST', `/cl/compliance/docs/${u.data.id}/verify`, {}); L.actAsOwner(); }
    }
    const r = await asChecker(() => api('POST', `/cl/invoices/${inv.id}/approve-payment`, {})); console.log(`    approve payment ${invoiceNo}: ${r?.ok ? 'ok' : r?.err}`);
  }
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ compliance documents (monthly) and verification
for (const code of ['CON-001', 'CON-002', 'CON-003', 'CON-004', 'CON-005']) {
  const unit = CODEFOR[code]; await L.setUnit(unit);
  const month = '2026-10';
  const kinds = code === 'CON-003' ? ['PF_ECR', 'PF_CHALLAN'] : ['PF_ECR', 'PF_CHALLAN', 'ESIC_CHALLAN', 'MUSTER_ROLL', 'WAGE_REGISTER', 'BANK_PROOF', 'BONUS_REGISTER', 'RETURN_FILED'];
  const cur = (await api('GET', `/cl/compliance?contractor=${C[code].id}&month=${month}`)).data;
  const have = new Set((cur?.docs ?? []).map((x) => x.kind));
  const docs = [];
  for (const kind of kinds) {
    if (have.has(kind)) { L.stats.skipped++; continue; }
    const r = await api('POST', '/cl/compliance/docs', { contractorId: C[code].id, month, kind, reference: `${kind}/${code}/2026-10`, unitId: U[unit] });
    if (r.ok) { L.stats.created++; docs.push(r.data); } else { L.stats.failed++; L.failures.push(`doc ${code} ${kind}: ${r.err}`); }
  }
  if (docs.length && code !== 'CON-005') { await L.actAs('head.hr').catch(() => {}); for (const doc of docs) await api('POST', `/cl/compliance/docs/${doc.id}/verify`, {}); L.actAsOwner(); }
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ incidents / safety
const INC = [
  ['CON-001', 0, 'Near miss', d(4), 'Fettling grinder guard found loose before the shift; fixed by maintenance, no injury.', 0, 'TAL'],
  ['CON-001', 2, 'Minor', d(7), 'Minor cut on left palm while handling casting burrs; first aid given, resumed work.', 0, 'TAL'],
  ['CON-002', 5, 'Minor', d(10), 'Pallet slipped during manual lowering; bruise on foot, wore safety shoes. Dispensary visit.', 2, 'TAL'],
  ['CON-003', 8, 'Major', d(12), 'Finger crush at the 100 T press while clearing a jammed part; hospitalised, press interlock to be reviewed.', 48, 'SAW'],
  ['CON-004', 10, 'Near miss', d(13), 'Welding screen not used by a helper; counselled and toolbox talk given.', 0, 'TAL'],
  ['CON-005', 13, 'Minor', d(9), 'Slip on a wet floor near the canteen entrance; no lost time.', 0, 'SAW'],
];
for (const [code, wi, severity, incidentDate, description, lostTimeHours, unit] of INC) {
  await L.setUnit(unit);
  const have = (((await api('GET', '/cl/incidents')).data) ?? []).find((x) => String(x.description ?? '') === description);
  const wk = workerState[wi];
  await ensure(`incident ${incidentDate} ${severity}`, have, 'POST', '/cl/incidents', { unitId: U[unit], incidentDate, workerId: wk?.id ?? null, contractorId: C[code].id, severity, description, lostTimeHours });
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ exit (release a deployed worker)
{
  const w = workerState.find((x) => x.name === 'Pramod Anil Gurav');
  if (w) { await L.setUnit(w.unit); const cur = (((await api('GET', `/cl/workers?contractor=${C[w.code].id}`)).data) ?? []).find((x) => x.name === w.name); if (cur?.status === 'Deployed') await act('release worker', 'POST', `/cl/workers/${w.id}/release`, { toDate: d(14) }); await L.setUnit('TAL'); }
}
L.summary('cl-seed');
