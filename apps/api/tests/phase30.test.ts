/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 30: contract labour. Wage example to the rupee, deployment gates, compliance block, bill reconciliation, command center.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageResource } from '../src/core/rbac/permission-model';
import { seedPhase2Defaults } from '../src/core/seed/defaults';
import { budgetLevel, complianceScore, deployBlock, professionalTax, reconcileDays, tdsPctFor, wageLine } from '../src/modules/contractlabour/calc';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('Phase 30 rules (pure)', () => {
  it('the spec wage example to the rupee: net 14,971; February PT is 300', () => {
    const l = wageLine({ days: 26, dailyRate: 600, otHours: 10, gender: 'M', month: 11 });
    expect(l).toMatchObject({ basic: 15600, otRate: 150, otAmount: 1500, gross: 17100, pf: 1800, esic: 129, pt: 200, totalDeduction: 2129, net: 14971 });
    expect(wageLine({ days: 26, dailyRate: 600, otHours: 10, gender: 'M', month: 2 }).net).toBe(14871);
    // above the ESIC ceiling there is no ESIC; PF is on the wage up to the ceiling only
    const big = wageLine({ days: 26, dailyRate: 1000, otHours: 0, gender: 'M', month: 5 });
    expect(big.esic).toBe(0);
    expect(big.pf).toBe(1800);
  });
  it('Maharashtra professional tax slabs', () => {
    expect(professionalTax(7000, 'M', 5)).toBe(0);
    expect(professionalTax(9000, 'M', 5)).toBe(175);
    expect(professionalTax(12000, 'M', 5)).toBe(200);
    expect(professionalTax(12000, 'M', 2)).toBe(300);
    expect(professionalTax(20000, 'F', 5)).toBe(0);
    expect(professionalTax(26000, 'F', 5)).toBe(200);
  });
  it('compliance score 10 of 11 = 90.91 %, budget 90.83 % is amber, 100 % blocks', () => {
    expect(complianceScore(10, 11)).toBe(90.91);
    expect(complianceScore(11, 11)).toBe(100);
    expect(budgetLevel(1090000, 1200000)).toEqual({ pct: 90.83, level: 'AMBER' });
    expect(budgetLevel(1200000, 1200000).level).toBe('BLOCKED');
    expect(budgetLevel(100, 1200000).level).toBe('OK');
  });
  it('1,040 billed man-days against a muster of 1,028 = 12 days = ₹7,200 disputed; 194C rate by PAN', () => {
    expect(reconcileDays(1040, 1028, 600)).toEqual({ diffDays: 12, disputed: 7200 });
    expect(reconcileDays(1000, 1028, 600)).toEqual({ diffDays: 0, disputed: 0 });
    expect(tdsPctFor('ABCPE1234F')).toBe(1);
    expect(tdsPctFor('ABCCE1234F')).toBe(2);
  });
  it('an expired medical blocks deployment with the date', () => {
    const base = {
      date: '2026-11-12',
      contractor: { licenceValidUntil: '2027-01-01', agreementEnd: '2027-01-01', insuranceExpiry: '2027-01-01', status: 'Active', approval: 'Approved' },
      workOrder: { status: 'Active', headcount: 5, deployed: 1, budgetPct: 10, start: '2026-01-01', end: '2027-01-01' },
      checks: { KYC: { validUntil: null }, MEDICAL: { validUntil: '2026-11-02' }, INDUCTION: { validUntil: '2027-01-01' }, PPE: { validUntil: null } },
      policeRequired: false,
    };
    expect(deployBlock(base)).toBe("Can't deploy: medical fitness expired on 02-11-2026.");
    expect(deployBlock({ ...base, checks: { ...base.checks, MEDICAL: { validUntil: '2026-12-01' } } })).toBeNull();
    expect(deployBlock({ ...base, workOrder: { ...base.workOrder, deployed: 5 } })).toBe('Work order headcount full (5/5).');
    expect(deployBlock({ ...base, policeRequired: true, checks: { ...base.checks, MEDICAL: { validUntil: '2026-12-01' } } })).toBe("Can't deploy: police verification is not done.");
  });
});

describe('Phase 30 (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  let mgrToken = '';
  const cleanup: (() => Promise<unknown>)[] = [];
  const get = (token: string, path: string) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW);
  const send = (method: 'post' | 'put' | 'delete', token: string, path: string, body?: unknown) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).send(body as object);

  beforeAll(async () => {
    await seedPhase2Defaults(prisma);
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    const role = await prisma.role.upsert({ where: { code: 'TEST30_MGR' }, update: {}, create: { code: 'TEST30_MGR', name: 'Test 30 manager', level: 60 } });
    for (const pid of ['cl-command-center', 'cl-contractors', 'cl-workorders', 'cl-workers', 'cl-onboarding', 'cl-deployment', 'cl-attendance', 'cl-wages', 'cl-invoices', 'cl-compliance', 'cl-incidents']) {
      await prisma.rolePermission.upsert({
        where: { roleId_resource: { roleId: role.id, resource: pageResource(pid) } },
        update: { view: true, add: true, edit: true, approve: true, scope: 'UNIT' },
        create: { roleId: role.id, resource: pageResource(pid), view: true, add: true, edit: true, approve: true, scope: 'UNIT' },
      });
    }
    const u = await makeUser({ roleCode: 'TEST30_MGR', department: 'HR', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: u.id } }));
    mgrToken = (await signIn(app, u)).token;
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    await prisma.$executeRaw`DELETE FROM cl_compliance_docs WHERE compliance_id IN (SELECT m.id FROM cl_compliance_months m JOIN contractors c ON c.id = m.contractor_id WHERE c.code LIKE 'T30%')`;
    await prisma.$executeRaw`DELETE FROM cl_compliance_months WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%')`;
    await prisma.$executeRaw`DELETE FROM cl_invoices WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%')`;
    await prisma.$executeRaw`DELETE FROM cl_wage_sheets WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%')`;
    await prisma.$executeRaw`DELETE FROM cl_attendance WHERE worker_id IN (SELECT id FROM cl_workers WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%'))`;
    await prisma.$executeRaw`DELETE FROM cl_deployments WHERE worker_id IN (SELECT id FROM cl_workers WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%'))`;
    await prisma.$executeRaw`DELETE FROM cl_onboarding_checks WHERE worker_id IN (SELECT id FROM cl_workers WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%'))`;
    await prisma.$executeRaw`DELETE FROM cl_workers WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%')`;
    await prisma.$executeRaw`DELETE FROM cl_work_orders WHERE contractor_id IN (SELECT id FROM contractors WHERE code LIKE 'T30%')`;
    await prisma.$executeRaw`DELETE FROM cl_incidents WHERE description LIKE 'TEST30%'`;
    await prisma.$executeRaw`DELETE FROM contractors WHERE code LIKE 'T30%'`;
    await prisma.$executeRaw`DELETE FROM user_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.local' AND name LIKE 'User test30%')`;
  });

  let contractorId = '';
  let woId = '';
  let worker1 = '';
  let worker2 = '';

  it('contractor: PAN is checked, a different person approves; work order below the minimum wage is refused, another person activates it', async () => {
    const bad = await send('post', ownerToken, '/cl/contractors', { code: 'T30-A', name: 'T30 Alpha', pan: 'BAD' });
    expect(bad.status).toBe(422);
    const c = await send('post', ownerToken, '/cl/contractors', { code: 'T30-A', name: 'T30 Alpha Manpower', pan: 'ABCCE1234F', licenceValidUntil: '2027-12-31', agreementStart: '2026-01-01', agreementEnd: '2027-12-31', insuranceExpiry: '2027-12-31', labourLicenceNo: 'LL/2026/77', email: 'alpha@t30.example' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    contractorId = c.body.data.id as string;
    expect((await send('post', ownerToken, '/cl/contractors', { code: 'T30-A', name: 'dup' })).status).toBe(409);
    expect((await send('post', ownerToken, `/cl/contractors/${contractorId}/approve`)).status).toBe(403);
    expect((await send('post', mgrToken, `/cl/contractors/${contractorId}/approve`)).status).toBe(200);
    const low = await send('post', ownerToken, '/cl/work-orders', { contractorId, unitId: tal, skillCategory: 'Skilled', requiredHeadcount: 1, rate: 300, startDate: '2026-11-01', endDate: '2027-03-31', budget: 1200000 });
    expect(low.status).toBe(422);
    expect(JSON.stringify(low.body)).toContain('below the minimum wage ₹560 for Skilled');
    const wo = await send('post', ownerToken, '/cl/work-orders', { contractorId, unitId: tal, department: 'Production', skillCategory: 'Skilled', requiredHeadcount: 1, rate: 600, serviceChargePct: 0, startDate: '2026-11-01', endDate: '2027-03-31', budget: 1200000 });
    expect(wo.status, JSON.stringify(wo.body)).toBe(201);
    expect(wo.body.data.number).toMatch(/^CWO\/TAL\//);
    woId = wo.body.data.id as string;
    expect((await send('post', ownerToken, `/cl/work-orders/${woId}/activate`)).status).toBe(403);
    expect((await send('post', mgrToken, `/cl/work-orders/${woId}/activate`)).status).toBe(200);
    const list = (await get(ownerToken, '/cl/work-orders')).body.data as { id: string; balance: string; budget_level: string }[];
    const mine = list.find((x) => x.id === woId)!;
    expect(Number(mine.balance)).toBe(1200000);
    expect(mine.budget_level).toBe('OK');
  });

  it('workers: Aadhaar is last 4 only, the wage cannot be below the minimum, deployment gates one by one, headcount full', async () => {
    const aad = await send('post', ownerToken, '/cl/workers', { name: 'T30 Ravi', contractorId, aadhaarLast4: '123456789012', wageRate: 600, skillCategory: 'Skilled', gender: 'M' });
    expect(aad.status).toBe(422);
    const lowW = await send('post', ownerToken, '/cl/workers', { name: 'T30 Ravi', contractorId, aadhaarLast4: '9012', wageRate: 400, skillCategory: 'Skilled', gender: 'M' });
    expect(lowW.status).toBe(422);
    expect(JSON.stringify(lowW.body)).toContain('below the minimum wage');
    const w1 = await send('post', ownerToken, '/cl/workers', { name: 'T30 Ravi', contractorId, aadhaarLast4: '9012', wageRate: 600, skillCategory: 'Skilled', gender: 'M', unitId: tal, biometricCode: 'T30B1', joiningDate: '2026-11-01' });
    expect(w1.status, JSON.stringify(w1.body)).toBe(201);
    expect(w1.body.data.worker_no).toMatch(/^CW\/TAL\//);
    worker1 = w1.body.data.id as string;
    const w2 = await send('post', ownerToken, '/cl/workers', { name: 'T30 Sita', contractorId, aadhaarLast4: '3456', wageRate: 600, skillCategory: 'Skilled', gender: 'F', unitId: tal, biometricCode: 'T30B2', joiningDate: '2026-11-01' });
    worker2 = w2.body.data.id as string;
    const dep = (id: string) => send('post', ownerToken, `/cl/workers/${id}/deploy`, { workOrderId: woId, fromDate: '2026-11-12' });
    const m1 = await dep(worker1);
    expect(m1.status).toBe(409);
    expect(JSON.stringify(m1.body)).toContain("Can't deploy: KYC is not verified.");
    await send('post', ownerToken, `/cl/workers/${worker1}/checks`, { kind: 'KYC' });
    expect(JSON.stringify((await dep(worker1)).body)).toContain('medical fitness is not done');
    await send('post', ownerToken, `/cl/workers/${worker1}/checks`, { kind: 'MEDICAL', validUntil: '2026-11-02' });
    expect(JSON.stringify((await dep(worker1)).body)).toContain("Can't deploy: medical fitness expired on 02-11-2026.");
    await send('post', ownerToken, `/cl/workers/${worker1}/checks`, { kind: 'MEDICAL', validUntil: '2027-11-01' });
    expect(JSON.stringify((await dep(worker1)).body)).toContain('safety induction is not done');
    await send('post', ownerToken, `/cl/workers/${worker1}/checks`, { kind: 'INDUCTION', validUntil: '2027-11-01' });
    expect(JSON.stringify((await dep(worker1)).body)).toContain('PPE is not issued');
    await send('post', ownerToken, `/cl/workers/${worker1}/checks`, { kind: 'PPE' });
    const ok = await dep(worker1);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await dep(worker1)).status).toBe(409); // already deployed
    // the second worker: headcount is 1
    for (const k of ['KYC', 'MEDICAL', 'INDUCTION', 'PPE']) await send('post', ownerToken, `/cl/workers/${worker2}/checks`, { kind: k, validUntil: '2027-11-01' });
    const full = await dep(worker2);
    expect(full.status).toBe(409);
    expect(JSON.stringify(full.body)).toContain('Work order headcount full (1/1).');
    // Aadhaar is never in the clear
    const list = (await get(ownerToken, '/cl/workers')).body.data as { worker_no: string; aadhaar_last4: string }[];
    expect(list.find((x) => x.worker_no === w1.body.data.worker_no)?.aadhaar_last4).toBe('9012');
    expect(JSON.stringify(list)).not.toMatch(/\d{12}/);
    // a licence that lapsed stops deployment too
    await prisma.$executeRawUnsafe(`UPDATE contractors SET licence_valid_until = '2026-11-05' WHERE id = $1::uuid`, contractorId);
    expect(JSON.stringify((await dep(worker2)).body)).toContain('contractor licence expired on 05-11-2026');
    await prisma.$executeRawUnsafe(`UPDATE contractors SET licence_valid_until = '2027-12-31' WHERE id = $1::uuid`, contractorId);
  });

  it('muster from the device punches, then the wage sheet: the spec figures, minimum wage re-checked, lock', async () => {
    // punches for one real day: 07:00-16:00 (9 h, 0.5 break = 8.5 h: 8 regular + 0.5 OT)
    const dev = (await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO attendance_devices (code, name, vendor, unit_id, connection) VALUES ('T30-DEV','T30 device','FILE_ZKTECO',$1::uuid,'MANUAL') RETURNING id`, tal))[0]!.id;
    cleanup.push(async () => { await prisma.$executeRawUnsafe(`DELETE FROM attendance_punches WHERE device_id = $1::uuid`, dev); await prisma.$executeRawUnsafe(`DELETE FROM attendance_devices WHERE id = $1::uuid`, dev); });
    await prisma.$executeRawUnsafe(`INSERT INTO attendance_punches (device_id, biometric_code, punch_at, direction, source) VALUES ($1::uuid,'T30B1','2026-11-12T01:30:00Z','IN','DEVICE'),($1::uuid,'T30B1','2026-11-12T10:30:00Z','OUT','DEVICE')`, dev);
    const gen = await send('post', ownerToken, '/cl/attendance/generate', { date: '2026-11-12' });
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    expect(gen.body.data.rows).toBe(1);
    const day = ((await get(ownerToken, '/cl/attendance?month=2026-11')).body.data as { worker_no: string; status: string; regular_hours: string; ot_hours: string; payable_days: string }[])[0]!;
    expect(day.status).toBe('P');
    expect(Number(day.regular_hours)).toBe(8);
    expect(Number(day.ot_hours)).toBe(0.5);
    expect(Number(day.payable_days)).toBe(1);
    // the rest of the month is the spec example: 26 payable days and 10 OT hours in total
    await prisma.$executeRawUnsafe(`DELETE FROM cl_attendance WHERE worker_id = $1::uuid`, worker1);
    for (let d = 1; d <= 26; d++) {
      await prisma.$executeRawUnsafe(`INSERT INTO cl_attendance (worker_id, work_order_id, unit_id, att_date, regular_hours, ot_hours, status, payable_days) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::date,8,$5,'P',1)`, worker1, woId, tal, `2026-11-${String(d).padStart(2, '0')}`, d === 26 ? 10 : 0);
    }
    const sheet = await send('post', ownerToken, '/cl/wages/compute', { unitId: tal, month: '2026-11', contractorId });
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(201);
    expect(Number(sheet.body.data.total_gross)).toBe(17100);
    expect(Number(sheet.body.data.total_net)).toBe(14971);
    const lines = (await get(ownerToken, `/cl/wages/${sheet.body.data.id}/lines`)).body.data as Record<string, string>[];
    expect(lines).toHaveLength(1);
    const L = Object.fromEntries(Object.entries(lines[0]!).map(([k, v]) => [k, Number(v)]));
    expect(L).toMatchObject({ payable_days: 26, basic_wages: 15600, ot_amount: 1500, gross_wages: 17100, pf_employee: 1800, esic_employee: 129, prof_tax: 200, net_pay: 14971 });
    // an unapproved gate mismatch does not count; approving the day makes it payable
    await prisma.$executeRawUnsafe(`UPDATE cl_attendance SET gate_match = false WHERE worker_id = $1::uuid AND att_date = '2026-11-01'`, worker1);
    const again = await send('post', ownerToken, '/cl/wages/compute', { unitId: tal, month: '2026-11', contractorId });
    expect(Number(again.body.data.total_gross)).toBeLessThan(17100);
    const row = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM cl_attendance WHERE worker_id = $1::uuid AND att_date = '2026-11-01'`, worker1))[0]!;
    expect((await send('post', mgrToken, `/cl/attendance/${row.id}/approve`)).status).toBe(200);
    const fixed = await send('post', ownerToken, '/cl/wages/compute', { unitId: tal, month: '2026-11', contractorId });
    expect(Number(fixed.body.data.total_gross)).toBe(17100);
    // bank advice and lock
    const xl = await get(ownerToken, `/cl/wages/${fixed.body.data.id}/bank-advice.xlsx`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xl.status).toBe(200);
    expect((xl.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect((await send('post', mgrToken, `/cl/wages/${fixed.body.data.id}/lock`)).status).toBe(200);
    const locked = await send('post', ownerToken, '/cl/wages/compute', { unitId: tal, month: '2026-11', contractorId });
    expect(locked.status).toBe(409);
    // a wage rate that fell below the minimum is caught at compute time
    await prisma.$executeRawUnsafe(`UPDATE cl_wage_sheets SET status = 'COMPUTED' WHERE id = $1::uuid`, fixed.body.data.id);
    await prisma.$executeRawUnsafe(`UPDATE cl_workers SET wage_rate = 400 WHERE id = $1::uuid`, worker1);
    const lowNow = await send('post', ownerToken, '/cl/wages/compute', { unitId: tal, month: '2026-11', contractorId });
    expect(lowNow.status).toBe(422);
    expect(JSON.stringify(lowNow.body)).toContain('below the minimum wage ₹560 for Skilled');
    await prisma.$executeRawUnsafe(`UPDATE cl_workers SET wage_rate = 600 WHERE id = $1::uuid`, worker1);
    await prisma.$executeRawUnsafe(`UPDATE cl_wage_sheets SET status = 'LOCKED' WHERE id = $1::uuid`, fixed.body.data.id);
  });

  it('bill: reconciled to the muster (2 days disputed), payment blocked until every proof is verified, only the undisputed part is approved', async () => {
    const inv = await send('post', ownerToken, '/cl/invoices', { unitId: tal, invoiceNo: 'T30-INV-1', invoiceDate: '2026-12-01', contractorId, workOrderId: woId, billingMonth: '2026-11', headcount: 1, billedManDays: 28 });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const i = inv.body.data;
    expect(Number(i.basic_labour_value)).toBe(16800);
    expect(Number(i.gst_amount)).toBe(3024);
    expect(Number(i.gross_invoice)).toBe(19824);
    expect(Number(i.tds_pct)).toBe(2); // company PAN
    expect(Number(i.tds_amount)).toBe(336);
    expect(Number(i.net_payable)).toBe(19488);
    expect((await send('post', ownerToken, '/cl/invoices', { unitId: tal, invoiceNo: 'T30-INV-1', invoiceDate: '2026-12-01', contractorId, workOrderId: woId, billingMonth: '2026-11', headcount: 1, billedManDays: 1 })).status).toBe(409);
    // approval before reconciliation is refused
    expect((await send('post', mgrToken, `/cl/invoices/${i.id}/approve-payment`)).status).toBe(409);
    const rec = await send('post', ownerToken, `/cl/invoices/${i.id}/reconcile`);
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(rec.body.data.recon).toMatchObject({ billedManDays: 28, musterManDays: 26, diffDays: 2, disputedValue: 1200, disputedWithGst: 1416, wageSheetLocked: true });
    // proofs: the first gap is the PF ECR
    const blocked = await send('post', mgrToken, `/cl/invoices/${i.id}/approve-payment`);
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain('Payment blocked: PF ECR for 2026-11 not uploaded.');
    // upload everything except ESIC, verified by another person
    const kinds = ['PF_ECR', 'PF_CHALLAN', 'MUSTER_ROLL', 'WAGE_REGISTER', 'BANK_PROOF', 'BONUS_REGISTER', 'RETURN_FILED'];
    const ids: string[] = [];
    for (const kind of kinds) {
      const up = await send('post', ownerToken, '/cl/compliance/docs', { contractorId, month: '2026-11', kind, reference: `REF-${kind}`, unitId: tal });
      expect(up.status, JSON.stringify(up.body)).toBe(201);
      ids.push(up.body.data.id);
    }
    expect((await send('post', ownerToken, `/cl/compliance/docs/${ids[0]}/verify`)).status).toBe(403); // not the uploader
    for (const d of ids) expect((await send('post', mgrToken, `/cl/compliance/docs/${d}/verify`)).status).toBe(200);
    const comp = (await get(ownerToken, `/cl/compliance?contractor=${contractorId}&month=2026-11&unit=${tal}`)).body.data;
    expect(comp.passed).toBe(10);
    expect(comp.required).toBe(11);
    expect(comp.scorePct).toBe(90.91);
    expect(comp.blocked).toBe(true);
    const esic = await send('post', mgrToken, `/cl/invoices/${i.id}/approve-payment`);
    expect(esic.status).toBe(409);
    expect(JSON.stringify(esic.body)).toContain('Payment blocked: ESIC challan for 2026-11 not uploaded.');
    expect((await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM cl_invoices WHERE id = $1::uuid`, i.id))[0]!.status).toBe('PAYMENT_BLOCKED');
    // the command center lists the blocked bill
    const cc = (await get(ownerToken, '/cl/command-center')).body.data;
    expect(cc.tiles.billsBlocked).toBeGreaterThanOrEqual(1);
    expect(cc.blockers.some((b: { invoice_no: string }) => b.invoice_no === 'T30-INV-1')).toBe(true);
    // the missing challan arrives: 100 % and the payment can be approved, but only the undisputed part
    const up = await send('post', ownerToken, '/cl/compliance/docs', { contractorId, month: '2026-11', kind: 'ESIC_CHALLAN', reference: 'ESIC-1', unitId: tal });
    await send('post', mgrToken, `/cl/compliance/docs/${up.body.data.id}/verify`);
    const full = (await get(ownerToken, `/cl/compliance?contractor=${contractorId}&month=2026-11&unit=${tal}`)).body.data;
    expect(full.scorePct).toBe(100);
    expect(full.blocked).toBe(false);
    const over = await send('post', mgrToken, `/cl/invoices/${i.id}/approve-payment`, { amount: 19488 });
    expect(over.status).toBe(422);
    expect(JSON.stringify(over.body)).toContain('Only the undisputed part (₹18072.00)');
    const pay = await send('post', mgrToken, `/cl/invoices/${i.id}/approve-payment`);
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(Number(pay.body.data.approved_amount)).toBe(18072);
    expect(pay.body.data.status).toBe('APPROVED');
    // the work order budget follows the approved bill
    const wo = ((await get(ownerToken, '/cl/work-orders')).body.data as { id: string; utilized: string }[]).find((x) => x.id === woId)!;
    expect(Number(wo.utilized)).toBe(16800);
  });

  it('command center is plant-scoped; incidents are raised with a number', async () => {
    const cc = (await get(ownerToken, '/cl/command-center')).body.data;
    expect(cc.tiles.workersOnSite).toBeGreaterThanOrEqual(1);
    expect(cc.headcount.some((h: { unit_code: string; contractor: string }) => h.unit_code === 'TAL')).toBe(true);
    const sawOnly = await makeUser({ roleCode: 'TEST30_MGR', department: 'HR', unitCodes: ['SAW'], defaultUnitCode: 'SAW' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: sawOnly.id } }));
    const t = (await signIn(app, sawOnly)).token;
    const s = (await get(t, '/cl/command-center')).body.data;
    expect(s.tiles.workersOnSite).toBe(0);
    expect(s.headcount.filter((h: { unit_code: string }) => h.unit_code === 'TAL')).toHaveLength(0);
    expect(((await get(t, '/cl/work-orders')).body.data as unknown[]).filter((w) => (w as { unit_code: string }).unit_code === 'TAL')).toHaveLength(0);
    const inc = await send('post', ownerToken, '/cl/incidents', { unitId: tal, incidentDate: '2026-11-12', workerId: worker1, contractorId, severity: 'Minor', description: 'TEST30 slipped on oil', lostTimeHours: 4 });
    expect(inc.status, JSON.stringify(inc.body)).toBe(201);
    expect(inc.body.data.incident_no).toMatch(/^INC\/TAL\//);
    expect(saw).toBeTruthy();
    expect(randomUUID()).toBeTruthy();
  });
});
