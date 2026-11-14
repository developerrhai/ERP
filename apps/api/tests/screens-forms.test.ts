/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 22: Add / Edit / Delete through the generic screen engine - Zone -> Rack -> Shelf -> Bin,
// RFID tag, pick wave with lines, 5-Why close rule; plant scope, duplicates, optimistic locking.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, makeUser, newApp, owner, prisma, signIn, signInOwner, unitIds } from './helpers';

const TAG = `F${Date.now().toString(36).toUpperCase()}`;

describe('screen forms', () => {
  const app = newApp();
  let token = '';
  let tal = '';
  let saw = '';
  let whTal = '';
  let whSaw = '';
  let itemId = '';

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, unit = tal) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set('X-Unit-Id', unit).set(XRW);

  beforeAll(async () => {
    token = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    const ownerId = (await owner()).id;
    const mk = async (unit: string, code: string) => {
      const id = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO warehouses (id, code, name, unit_id, status, created_by_id, updated_at)
        VALUES (${id}::uuid, ${code}, ${`${code} store`}, ${unit}::uuid, 'ACTIVE', ${ownerId}::uuid, now())`;
      return id;
    };
    whTal = await mk(tal, `${TAG}-T`);
    whSaw = await mk(saw, `${TAG}-S`);
    const it = await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM items WHERE deleted_at IS NULL LIMIT 1`;
    itemId = it[0]?.id ?? '';
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM wms_rfid_tags WHERE tag_code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM wms_bins WHERE code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM wms_shelves WHERE code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM wms_racks WHERE code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM wms_zones WHERE code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM pick_tasks WHERE wave_id IN (SELECT id FROM pick_waves WHERE warehouse_id = ${whTal}::uuid)`;
    await prisma.$executeRaw`DELETE FROM pick_waves WHERE warehouse_id = ${whTal}::uuid`;
    await prisma.$executeRaw`DELETE FROM five_why_cases WHERE title LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM warehouses WHERE id IN (${whTal}::uuid, ${whSaw}::uuid)`;
  });

  let zoneId = '';
  let rackId = '';
  let shelfId = '';

  it('describes the form', async () => {
    const res = await call('get', '/screens/wms-zones/form');
    expect(res.status).toBe(200);
    expect(res.body.data.fields.map((f: { label: string }) => f.label)).toContain('Zone Code');
    expect(res.body.data.needsPlant).toBe(true);
  });

  it('creates a zone, then a rack in it, then a shelf (Zone -> Rack -> Shelf)', async () => {
    const z = await call('post', '/screens/wms-zones').send({ values: { warehouse: whTal, code: `${TAG}-ZA`, name: 'Zone A' } });
    expect(z.status, JSON.stringify(z.body)).toBe(201);
    zoneId = z.body.data.id;
    const r = await call('post', '/screens/wms-racks').send({ values: { zone: zoneId, code: `${TAG}-R01`, levels: 3 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    rackId = r.body.data.id;
    // warehouse was derived from the zone
    const row = await prisma.$queryRaw<{ warehouse_id: string }[]>`SELECT warehouse_id::text FROM wms_racks WHERE id = ${rackId}::uuid`;
    expect(row[0]?.warehouse_id).toBe(whTal);
    const s = await call('post', '/screens/wms-shelves').send({ values: { rack: rackId, code: `${TAG}-S01`, level: 1 } });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    shelfId = s.body.data.id;
    const list = await call('get', `/screens/wms-shelves?q=${TAG}`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.map((x: { code: string }) => x.code)).toContain(`${TAG}-S01`);
  });

  it('a bin placed on the shelf copies its zone and rack (trigger) and shows in the bin picker', async () => {
    const binId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO wms_bins (id, warehouse_id, code, name, bin_type, status, shelf_id, created_by_id, updated_at)
      VALUES (${binId}::uuid, ${whTal}::uuid, ${`${TAG}-B01`}, 'Bin', 'Storage', 'Active', ${shelfId}::uuid, ${(await owner()).id}::uuid, now())`;
    const b = await prisma.$queryRaw<{ zone_id: string; rack_id: string }[]>`SELECT zone_id::text, rack_id::text FROM wms_bins WHERE id = ${binId}::uuid`;
    expect(b[0]).toEqual({ zone_id: zoneId, rack_id: rackId });
    const pick = await call('get', `/screens/wms-rfid/lookup/bins?parent=${whTal}&q=${TAG}`);
    expect(pick.body.data.map((x: { id: string }) => x.id)).toContain(binId);
    const tag = await call('post', '/screens/wms-rfid').send({ values: { warehouse: whTal, bin: binId, tag: `${TAG}-EPC1` } });
    expect(tag.status, JSON.stringify(tag.body)).toBe(201);
  });

  it('refuses a duplicate code, a missing field and another plant', async () => {
    const dup = await call('post', '/screens/wms-zones').send({ values: { warehouse: whTal, code: `${TAG}-ZA`, name: 'Again' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
    const miss = await call('post', '/screens/wms-zones').send({ values: { warehouse: whTal, name: 'No code' } });
    expect(miss.status).toBe(422);
    expect(miss.body.error.fields.code).toBe('Zone Code is required.');
    // a Sawardari warehouse cannot be used while working in Talwade
    const other = await call('post', '/screens/wms-zones').send({ values: { warehouse: whSaw, code: `${TAG}-ZX`, name: 'X' } });
    expect(other.status).toBe(422);
    expect(other.body.error.fields.warehouse).toMatch(/another plant/);
    // and nothing can be created while "All units" is chosen
    const all = await call('post', '/screens/wms-zones', 'all').send({ values: { warehouse: whTal, code: `${TAG}-ZY`, name: 'Y' } });
    expect([403, 422]).toContain(all.status);
  });

  it('edits with the version (If-Match), refuses a stale one, and does not change the code', async () => {
    const edit = await call('get', `/screens/wms-zones/${zoneId}/edit`);
    expect(edit.status).toBe(200);
    const version = edit.body.data.version as number;
    const ok = await call('patch', `/screens/wms-zones/${zoneId}`).set('If-Match', `"${version}"`).send({ values: { name: 'Zone A (renamed)', code: 'IGNORED' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const stale = await call('patch', `/screens/wms-zones/${zoneId}`).set('If-Match', `"${version}"`).send({ values: { name: 'late' } });
    expect(stale.status).toBe(409);
    const row = await prisma.$queryRaw<{ code: string; name: string }[]>`SELECT code, name FROM wms_zones WHERE id = ${zoneId}::uuid`;
    expect(row[0]).toEqual({ code: `${TAG}-ZA`, name: 'Zone A (renamed)' });
    const noHeader = await call('patch', `/screens/wms-zones/${zoneId}`).send({ values: { name: 'x' } });
    expect(noHeader.status).toBe(400);
  });

  it('blocks deleting a zone that still has racks, then deletes bottom-up (soft delete)', async () => {
    const blocked = await call('delete', `/screens/wms-zones/${zoneId}`);
    expect(blocked.status).toBe(409);
    await prisma.$executeRaw`UPDATE wms_bins SET deleted_at = now() WHERE shelf_id = ${shelfId}::uuid`;
    expect((await call('delete', `/screens/wms-shelves/${shelfId}`)).status).toBe(200);
    expect((await call('delete', `/screens/wms-racks/${rackId}`)).status).toBe(200);
    expect((await call('delete', `/screens/wms-zones/${zoneId}`)).status).toBe(200);
    const gone = await call('get', `/screens/wms-zones?q=${TAG}`);
    expect(gone.body.data).toHaveLength(0);
    const audit = await prisma.auditLog.count({ where: { action: 'screen.deleted', targetId: zoneId } });
    expect(audit).toBe(1);
  });

  it('creates a numbered pick wave with tasks; edits only while Draft', async () => {
    if (!itemId) return;
    const w = await call('post', '/screens/wms-pick').send({
      values: { warehouse: whTal, planned: '2026-11-20', reference: 'SO-1' },
      lines: [{ item: itemId, required: '5' }, { item: itemId, required: '2.5' }],
    });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    expect(w.body.data.number).toMatch(/^PCK|WAV|^[A-Z]{2,5}[-/]/);
    const rows = await prisma.$queryRaw<{ n: number; seq: number }[]>`SELECT count(*)::int AS n, max(route_seq)::int AS seq FROM pick_tasks WHERE wave_id = ${w.body.data.id}::uuid`;
    expect(rows[0]).toEqual({ n: 2, seq: 2 });
    const noLines = await call('post', '/screens/wms-pick').send({ values: { warehouse: whTal, planned: '2026-11-20' }, lines: [] });
    expect(noLines.status).toBe(422);
    const ed = await call('get', `/screens/wms-pick/${w.body.data.id}/edit`);
    const rel = await call('patch', `/screens/wms-pick/${w.body.data.id}`).set('If-Match', `"${ed.body.data.version}"`).send({ values: { status: 'Released' } });
    expect(rel.status).toBe(200);
    const ed2 = await call('get', `/screens/wms-pick/${w.body.data.id}/edit`);
    const late = await call('patch', `/screens/wms-pick/${w.body.data.id}`).set('If-Match', `"${ed2.body.data.version}"`).send({ values: { reference: 'SO-2' } });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ACTION_NOT_ALLOWED');
  });

  it('5-Why: a case cannot be closed without a root cause', async () => {
    const c = await call('post', '/screens/qms-5why').send({
      values: { title: `${TAG} weld porosity`, problem: 'Porosity on 12 brackets' },
      lines: [{ why: 'Why porosity?', answer: 'Moisture in the gas' }, { why: 'Why moisture?', answer: 'Cylinder not purged' }],
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body.data.id as string;
    const ed = await call('get', `/screens/qms-5why/${id}/edit`);
    expect(ed.body.data.lines).toHaveLength(2);
    const bad = await call('patch', `/screens/qms-5why/${id}`).set('If-Match', `"${ed.body.data.version}"`).send({ values: { status: 'Closed' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.root).toMatch(/root cause/);
    const good = await call('patch', `/screens/qms-5why/${id}`).set('If-Match', `"${ed.body.data.version}"`).send({ values: { status: 'Closed', root: 'No purge step in the SOP' } });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    const six = await call('post', '/screens/qms-5why').send({ values: { title: `${TAG} x`, problem: 'p' }, lines: Array.from({ length: 6 }, () => ({ why: 'w', answer: 'a' })) });
    expect(six.status).toBe(422);
  });

  it('pay-loan: Rs 20,000 over 10 EMIs gives a numbered loan with 10 instalments of Rs 2,000; no interest yet', async () => {
    const empId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO employees (id, emp_code, first_name, last_name, gender, dob, mobile, joining_date, status, created_by_id, updated_at)
      VALUES (${empId}::uuid, ${`${TAG}-E1`}, 'Asha', 'Demo', 'FEMALE', '1995-01-01', '9000000000', '2024-01-01', 'ACTIVE', ${(await owner()).id}::uuid, now())`;
    const emp = [{ id: empId }];
    const bad = await call('post', '/screens/pay-loan').send({ values: { employee: emp[0]!.id, principal: '20000', tenure: 10, disbursed: '2026-12-05', interest: '12' } });
    expect(bad.status).toBe(422);
    const ok = await call('post', '/screens/pay-loan').send({ values: { employee: emp[0]!.id, principal: '20000', tenure: 10, disbursed: '2026-12-05' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const rows = await prisma.$queryRaw<{ n: number; total: string; emi: string }[]>`
      SELECT count(*)::int AS n, sum(s.total_amount)::text AS total, max(l.emi_amount)::text AS emi
        FROM loan_schedules s JOIN employee_loans l ON l.id = s.loan_id WHERE s.loan_id = ${ok.body.data.id}::uuid`;
    expect(rows[0]).toEqual({ n: 10, total: '20000.00', emi: '2000.00' });
    const det = await call('get', `/screens/pay-loan/${ok.body.data.id}/details`);
    expect(det.status, JSON.stringify(det.body)).toBe(200);
    expect(det.body.data[0].title).toBe('EMI Schedule');
    expect(det.body.data[0].rows).toHaveLength(10);
    expect(det.body.data[0].rows[0].amount).toBe('2000');
    const edit = await call('patch', `/screens/pay-loan/${ok.body.data.id}`).set('If-Match', '"1"').send({ values: { tenure: 5 } });
    expect(edit.status).toBe(409);
    await prisma.$executeRaw`DELETE FROM loan_schedules WHERE loan_id = ${ok.body.data.id}::uuid`;
    await prisma.$executeRaw`DELETE FROM employee_loans WHERE id = ${ok.body.data.id}::uuid`;
    await prisma.$executeRaw`DELETE FROM employees WHERE id = ${empId}::uuid`;
  });

  it('statutory + pricing masters: HSN, GST rate (CGST/SGST = IGST/2, generated by the DB) and price list', async () => {
    const code = String(Math.floor(1000 + Math.random() * 8999));
    const hsnRate = (await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM gst_rates WHERE deleted_at IS NULL AND status = 'ACTIVE' LIMIT 1`)[0]?.id;
    const withRate = { gstRate: hsnRate, effectiveFrom: '2026-04-01' };
    const h = await call('post', '/screens/tax-hsn').send({ values: { code, description: `${TAG} test goods`, ...withRate } });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    const badHsn = await call('post', '/screens/tax-hsn').send({ values: { code: 'AB12', description: 'x', ...withRate } });
    expect(badHsn.status).toBe(422);
    const dup = await call('post', '/screens/tax-hsn').send({ values: { code, description: 'again', ...withRate } });
    expect(dup.status).toBe(409);
    const g = await call('post', '/screens/tax-gst').send({ values: { code: `${TAG}-G18`, name: 'GST 18%', igst: '18', from: '2026-01-01' } });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const rate = await prisma.$queryRaw<{ c: string; s: string; r: boolean }[]>`
      SELECT cgst_pct::text AS c, sgst_pct::text AS s, needs_review AS r FROM gst_rates WHERE id = ${g.body.data.id}::uuid`;
    expect(Number(rate[0]?.c)).toBe(9);
    expect(Number(rate[0]?.s)).toBe(9);
    expect(rate[0]?.r).toBe(true);
    const pl = await call('post', '/screens/sales-pricelist').send({ values: { code: `${TAG}-PL`, name: 'Standard', from: '2026-04-01', to: '2025-01-01' } });
    expect(pl.status).toBeGreaterThanOrEqual(400);
    const pl2 = await call('post', '/screens/sales-pricelist').send({ values: { code: `${TAG}-PL`, name: 'Standard', from: '2026-04-01', to: '2027-03-31' } });
    expect(pl2.status, JSON.stringify(pl2.body)).toBe(201);
    await prisma.$executeRaw`DELETE FROM price_lists WHERE code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM gst_rates WHERE code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM hsn_sac_codes WHERE code = ${code}`;
  });

  it('create-only registers: training, onboarding, review, application, service request; edit/delete refused', async () => {
    const ownerId = (await owner()).id;
    const empId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO employees (id, emp_code, first_name, last_name, gender, dob, mobile, joining_date, status, created_by_id, updated_at)
      VALUES (${empId}::uuid, ${`${TAG}-E9`}, 'Ravi', 'Demo', 'MALE', '1994-02-02', '9000000001', '2024-01-01', 'ACTIVE', ${ownerId}::uuid, now())`;
    const tr = await call('post', '/screens/hr-training').send({ values: { code: `${TAG}-TR`, name: 'Safety basics', hours: '4' } });
    expect(tr.status, JSON.stringify(tr.body)).toBe(201);
    const dupTr = await call('post', '/screens/hr-training').send({ values: { code: `${TAG}-TR`, name: 'Again' } });
    expect(dupTr.status).toBe(409);
    const edit = await call('patch', `/screens/hr-training/${tr.body.data.id}`).set('If-Match', '"1"').send({ values: { name: 'x' } });
    expect(edit.status).toBeGreaterThanOrEqual(400);
    const del = await call('delete', `/screens/hr-training/${tr.body.data.id}`).set('If-Match', '"1"');
    expect(del.status).toBeGreaterThanOrEqual(400);
    const ob = await call('post', '/screens/hr-onboarding').send({ values: { employee: empId } });
    expect(ob.status, JSON.stringify(ob.body)).toBe(201);
    const cycleId = randomUUID();
    await prisma.$executeRaw`INSERT INTO perf_cycles (id, name, start_date, end_date, status) VALUES (${cycleId}::uuid, ${`${TAG} cycle`}, '2026-04-01', '2027-03-31', 'OPEN')`;
    const pr = await call('post', '/screens/hr-performance').send({ values: { cycle: cycleId, employee: empId, rating: '4.5' } });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    const badPr = await call('post', '/screens/hr-performance').send({ values: { cycle: cycleId, employee: empId, rating: '9' } });
    expect(badPr.status).toBe(422);
    const cust = await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM customers WHERE deleted_at IS NULL LIMIT 1`;
    if (cust[0]) {
      const sr = await call('post', '/screens/service-requests').send({ values: { customer: cust[0].id, type: 'OVERHAUL', estimate: '15000' } });
      expect(sr.status, JSON.stringify(sr.body)).toBe(201);
      expect(sr.body.data.number).toMatch(/SRQ/);
      await prisma.$executeRaw`DELETE FROM service_requests WHERE id = ${sr.body.data.id}::uuid`;
    }
    await prisma.$executeRaw`DELETE FROM perf_reviews WHERE cycle_id = ${cycleId}::uuid`;
    await prisma.$executeRaw`DELETE FROM perf_cycles WHERE id = ${cycleId}::uuid`;
    await prisma.$executeRaw`DELETE FROM onboarding_cases WHERE employee_id = ${empId}::uuid`;
    await prisma.$executeRaw`DELETE FROM training_programs WHERE code LIKE ${`${TAG}%`}`;
    await prisma.$executeRaw`DELETE FROM employees WHERE id = ${empId}::uuid`;
  });

  it('project, exit and spare registers: milestone, team, subtask, budget (versioned), expense, exit case, spare issue', async () => {
    const ownerId = (await owner()).id;
    const empId = randomUUID();
    const projId = randomUUID();
    const taskId = randomUUID();
    const techId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO employees (id, emp_code, first_name, last_name, gender, dob, mobile, joining_date, status, created_by_id, updated_at)
      VALUES (${empId}::uuid, ${`${TAG}-E8`}, 'Meera', 'Demo', 'FEMALE', '1993-03-03', '9000000002', '2024-01-01', 'ACTIVE', ${ownerId}::uuid, now())`;
    await prisma.$executeRaw`
      INSERT INTO employee_assignments (employee_id, unit_id, effective_from, created_by_id)
      VALUES (${empId}::uuid, ${tal}::uuid, '2024-01-01', ${ownerId}::uuid)`.catch(() => undefined);
    await prisma.$executeRaw`
      INSERT INTO projects (id, code, name, unit_id, start_date, end_date, status)
      VALUES (${projId}::uuid, ${`${TAG}-P`}, 'Demo line', ${tal}::uuid, '2026-04-01', '2027-03-31', 'ACTIVE')`;
    await prisma.$executeRaw`
      INSERT INTO project_tasks (id, project_id, number, name, planned_start, planned_end)
      VALUES (${taskId}::uuid, ${projId}::uuid, ${`${TAG}-T1`}, 'Parent', '2026-04-01', '2026-06-30')`;
    await prisma.$executeRaw`INSERT INTO technicians (id, employee_id) VALUES (${techId}::uuid, ${empId}::uuid)`;
    try {
      const ms = await call('post', '/screens/proj-milestones').send({ values: { project: projId, name: 'FAT', target: '2026-09-30' } });
      expect(ms.status, JSON.stringify(ms.body)).toBe(201);
      const tm = await call('post', '/screens/proj-team').send({ values: { project: projId, employee: empId, from: '2026-04-01', allocation: '50' } });
      expect(tm.status, JSON.stringify(tm.body)).toBe(201);
      const tm2 = await call('post', '/screens/proj-team').send({ values: { project: projId, employee: empId, from: '2026-04-01' } });
      expect(tm2.status).toBe(409);
      const st = await call('post', '/screens/proj-subtasks').send({ values: { project: projId, parent: taskId, name: 'Wiring', start: '2026-04-02', due: '2026-04-20' } });
      expect(st.status, JSON.stringify(st.body)).toBe(201);
      expect(st.body.data.number).toMatch(/STK/);
      const badSt = await call('post', '/screens/proj-subtasks').send({ values: { project: projId, parent: taskId, name: 'Bad', start: '2026-05-02', due: '2026-04-20' } });
      expect(badSt.status).toBeGreaterThanOrEqual(400);
      const b1 = await call('post', '/screens/proj-budget').send({ values: { project: projId, total: '500000' } });
      expect(b1.status, JSON.stringify(b1.body)).toBe(201);
      const b2 = await call('post', '/screens/proj-budget').send({ values: { project: projId, total: '650000' } });
      expect(b2.status, JSON.stringify(b2.body)).toBe(201);
      const vers = await prisma.$queryRaw<{ v: number }[]>`SELECT version AS v FROM project_budgets WHERE project_id = ${projId}::uuid ORDER BY version`;
      expect(vers.map((r) => r.v)).toEqual([1, 2]);
      const ex = await call('post', '/screens/proj-expenses').send({ values: { project: projId, date: '2026-05-01', amount: '1200', tax: '216' } });
      expect(ex.status, JSON.stringify(ex.body)).toBe(201);
      expect(ex.body.data.number).toMatch(/PEX/);
      const xt = await call('post', '/screens/hr-exit').send({ values: { employee: empId, resigned: '2026-06-01', lwd: '2026-07-31', reason: 'Relocation' } });
      expect([201, 422]).toContain(xt.status);
      const sp = await call('post', '/screens/service-spares').send({ values: { technician: techId, warehouse: whTal } });
      expect(sp.status, JSON.stringify(sp.body)).toBe(201);
      expect(sp.body.data.number).toMatch(/SPI/);
      const other = await call('post', '/screens/proj-milestones', saw).send({ values: { project: projId, name: 'X', target: '2026-09-30' } });
      expect(other.status).toBe(422);
    } finally {
      await prisma.$executeRaw`DELETE FROM spare_issues WHERE technician_id = ${techId}::uuid`;
      await prisma.$executeRaw`DELETE FROM technicians WHERE id = ${techId}::uuid`;
      await prisma.$executeRaw`DELETE FROM exit_cases WHERE employee_id = ${empId}::uuid`;
      await prisma.$executeRaw`DELETE FROM project_expenses WHERE project_id = ${projId}::uuid`;
      await prisma.$executeRaw`DELETE FROM project_budgets WHERE project_id = ${projId}::uuid`;
      await prisma.$executeRaw`DELETE FROM project_tasks WHERE project_id = ${projId}::uuid AND parent_task_id IS NOT NULL`;
      await prisma.$executeRaw`DELETE FROM project_tasks WHERE project_id = ${projId}::uuid`;
      await prisma.$executeRaw`DELETE FROM project_team WHERE project_id = ${projId}::uuid`;
      await prisma.$executeRaw`DELETE FROM project_milestones WHERE project_id = ${projId}::uuid`;
      await prisma.$executeRaw`DELETE FROM projects WHERE id = ${projId}::uuid`;
      await prisma.$executeRaw`DELETE FROM employee_assignments WHERE employee_id = ${empId}::uuid`;
      await prisma.$executeRaw`DELETE FROM employees WHERE id = ${empId}::uuid`;
    }
  });

  it('permissions: a user without add gets 403', async () => {
    const user = await makeUser({});
    const { token: t } = await signIn(app, user);
    const res = await request(app).post(`${API}/screens/wms-zones`).set('Authorization', `Bearer ${t}`).set(XRW).send({ values: { warehouse: whTal, code: `${TAG}-NO`, name: 'n' } });
    expect([403, 404]).toContain(res.status);
  });
});
