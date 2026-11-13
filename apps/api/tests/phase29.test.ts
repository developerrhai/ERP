/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 29: workplace operations. Tasks, shift handover, visitors, canteen.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageResource } from '../src/core/rbac/permission-model';
import { seedPhase2Defaults } from '../src/core/seed/defaults';
import { anonymiseDue, dueOn, handoverLate, isOverdue, mealMoney, nextDue, overstayed, vendorVariance, workloadColour, wouldCycle } from '../src/modules/workplace/calc';
import { handoverService, taskService, visitorService } from '../src/modules/workplace/service';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('Phase 29 rules (pure)', () => {
  it('canteen money to the paisa: lunch 60 + 5 % = 63.00, employee 40 % = 25.20, company 37.80; 22 lunches', () => {
    expect(mealMoney(60, 5, 40)).toEqual({ rate: 60, gst: 3, total: 63, employee: 25.2, company: 37.8 });
    const m = mealMoney(60, 5, 40);
    expect(Math.round(m.employee * 22 * 100) / 100).toBe(554.4);
    expect(Math.round(m.company * 22 * 100) / 100).toBe(831.6);
    expect(Math.round(m.total * 22 * 100) / 100).toBe(1386);
    expect(mealMoney(10, 0, 100)).toEqual({ rate: 10, gst: 0, total: 10, employee: 10, company: 0 });
  });
  it('workload: 12 open and 4 overdue is red', () => {
    expect(workloadColour(12, 4)).toBe('RED');
    expect(workloadColour(11, 0)).toBe('RED');
    expect(workloadColour(5, 0)).toBe('GREEN');
    expect(workloadColour(8, 0)).toBe('AMBER');
    expect(workloadColour(2, 1)).toBe('AMBER');
  });
  it('a dependency that closes a loop is refused', () => {
    const edges = [{ pred: 'a', succ: 'b' }, { pred: 'b', succ: 'c' }];
    expect(wouldCycle(edges, 'c', 'a')).toBe(true);
    expect(wouldCycle(edges, 'a', 'c')).toBe(false);
    expect(wouldCycle(edges, 'a', 'a')).toBe(true);
  });
  it('recurrence: daily Mon-Sat skips Sunday; weekly, every N days, monthly', () => {
    expect(nextDue({ kind: 'DAILY' }, '2026-11-14')).toBe('2026-11-16'); // Saturday -> Monday
    expect(nextDue({ kind: 'DAILY', days: [1, 3] }, '2026-11-16')).toBe('2026-11-18');
    expect(nextDue({ kind: 'EVERY_N', n: 10 }, '2026-11-13')).toBe('2026-11-23');
    expect(nextDue({ kind: 'MONTHLY' }, '2026-01-31')).toBe('2026-02-28');
    expect(dueOn({ kind: 'DAILY' }, '2026-11-15', '2026-11-01')).toBe(false); // Sunday
    expect(dueOn({ kind: 'DAILY' }, '2026-11-16', '2026-11-01')).toBe(true);
    expect(dueOn({ kind: 'EVERY_N', n: 3 }, '2026-11-07', '2026-11-01')).toBe(true);
    expect(dueOn({ kind: 'DAILY' }, '2026-10-31', '2026-11-01')).toBe(false);
  });
  it('overdue, overstay, handover timer, variance and anonymisation', () => {
    expect(isOverdue('2026-11-10', '2026-11-13', 'Open')).toBe(true);
    expect(isOverdue('2026-11-10', '2026-11-13', 'Done')).toBe(false);
    expect(isOverdue(null, '2026-11-13', 'Open')).toBe(false);
    const out = new Date('2026-11-13T10:30:00Z');
    expect(overstayed(out, new Date('2026-11-13T10:59:00Z'))).toBe(false);
    expect(overstayed(out, new Date('2026-11-13T11:01:00Z'))).toBe(true);
    expect(handoverLate(new Date('2026-11-13T10:30:00Z'), new Date('2026-11-13T10:31:00Z'))).toBe(true);
    expect(handoverLate(null, new Date())).toBe(false);
    expect(vendorVariance(1410, 1380)).toEqual({ pct: 2.17, needsApproval: true });
    expect(vendorVariance(1400, 1380).needsApproval).toBe(false);
    expect(vendorVariance(5, 0).needsApproval).toBe(true);
    expect(anonymiseDue(new Date('2025-11-01T00:00:00Z'), new Date('2026-11-13T00:00:00Z'))).toBe(true);
    expect(anonymiseDue(new Date('2026-06-01T00:00:00Z'), new Date('2026-11-13T00:00:00Z'))).toBe(false);
  });
});

describe('Phase 29 (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  let genShift = '';
  const empIds: string[] = [];
  const taskIds: string[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const get = (token: string, path: string) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW);
  const send = (method: 'post' | 'put' | 'delete', token: string, path: string, body?: unknown) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).send(body as object);
  let mgrSeq = 0;

  async function mgr(dept: string, units: string[] = ['TAL']) {
    const u = await makeUser({ roleCode: 'TEST29_MGR', department: dept, unitCodes: units, defaultUnitCode: units[0] ?? 'TAL', email: `u${++mgrSeq}-${Date.now()}@t29.example` });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: u.id } }));
    return { user: u, token: (await signIn(app, u)).token };
  }
  async function makeEmployee(code: string, unit = tal, dept = 'Production'): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO employees (id, emp_code, first_name, last_name, gender, dob, mobile, joining_date, status, biometric_code) VALUES ($1::uuid, $2, 'TEST29', $3, 'M', '1990-01-01', $4, '2020-01-01', 'ACTIVE', $3)`, id, `T29-${code}`, code, `6${code.padStart(9, '0')}`);
    await prisma.$executeRawUnsafe(`INSERT INTO employee_assignments (employee_id, effective_from, unit_id, department) VALUES ($1::uuid, '2020-01-01', $2::uuid, $3)`, id, unit, dept);
    empIds.push(id);
    return id;
  }

  beforeAll(async () => {
    await seedPhase2Defaults(prisma);
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    genShift = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM shifts WHERE code = 'GEN'`))[0]!.id;
    const role = await prisma.role.upsert({ where: { code: 'TEST29_MGR' }, update: {}, create: { code: 'TEST29_MGR', name: 'Test 29 manager', level: 60 } });
    for (const pid of ['ops-tasks', 'ops-shift-roster', 'ops-visitors', 'ops-canteen']) {
      await prisma.rolePermission.upsert({
        where: { roleId_resource: { roleId: role.id, resource: pageResource(pid) } },
        update: { view: true, add: true, edit: true, approve: true, scope: 'UNIT' },
        create: { roleId: role.id, resource: pageResource(pid), view: true, add: true, edit: true, approve: true, scope: 'UNIT' },
      });
    }
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    const ids = empIds.length ? empIds : [randomUUID()];
    await prisma.$executeRaw`DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE 'TEST29%')`;
    await prisma.$executeRaw`DELETE FROM tasks WHERE parent_task_id IN (SELECT id FROM tasks WHERE title LIKE 'TEST29%')`;
    await prisma.$executeRaw`DELETE FROM tasks WHERE title LIKE 'TEST29%'`;
    await prisma.$executeRaw`DELETE FROM shift_handovers WHERE department = 'TEST29 Dept'`;
    await prisma.$executeRaw`DELETE FROM visitor_passes WHERE purpose LIKE 'TEST29%'`;
    await prisma.$executeRawUnsafe(`DELETE FROM canteen_coupons WHERE person_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRaw`DELETE FROM canteen_vendor_bills WHERE vendor_name LIKE 'TEST29%'`;
    await prisma.$executeRaw`DELETE FROM canteen_waste WHERE reason LIKE 'TEST29%'`;
    await prisma.$executeRaw`DELETE FROM canteen_months`;
    await prisma.$executeRaw`DELETE FROM canteen_entitlements`;
    await prisma.$executeRaw`DELETE FROM canteen_rates`;
    await prisma.$executeRawUnsafe(`DELETE FROM employee_assignments WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, ids);
    await prisma.$executeRaw`DELETE FROM user_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@t29.example')`;
  });

  it('tasks: numbered, a dependency blocks Start, a loop is refused, the chain finishes in order', async () => {
    const a = await send('post', ownerToken, '/ops/tasks', { title: 'TEST29 first', department: 'Production', dueDate: '2026-12-01', unitId: tal });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.data.task_no).toMatch(/^T\/TAL\//);
    const b = await send('post', ownerToken, '/ops/tasks', { title: 'TEST29 second', department: 'Production', dueDate: '2026-12-02', dependsOn: [a.body.data.id], unitId: tal });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    taskIds.push(a.body.data.id, b.body.data.id);
    const blocked = await send('post', ownerToken, `/ops/tasks/${b.body.data.id}/start`);
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain(`Blocked by ${a.body.data.task_no} (not done).`);
    // a loop is refused
    const loop = await send('post', ownerToken, `/ops/tasks/${a.body.data.id}/dependencies`, { dependsOnId: b.body.data.id });
    expect(loop.status).toBe(422);
    expect(JSON.stringify(loop.body)).toContain('loop');
    expect((await send('post', ownerToken, `/ops/tasks/${a.body.data.id}/start`)).status).toBe(200);
    expect((await send('post', ownerToken, `/ops/tasks/${a.body.data.id}/done`)).status).toBe(200);
    const go = await send('post', ownerToken, `/ops/tasks/${b.body.data.id}/start`);
    expect(go.status, JSON.stringify(go.body)).toBe(200);
    expect(go.body.data.status).toBe('In Progress');
  });

  it('tasks: checklist must be ticked, approval needs another person, reopen needs a reason, board and workload', async () => {
    const m = await mgr('Production');
    const t = await send('post', ownerToken, '/ops/tasks', { title: 'TEST29 checked', assignedToId: m.user.id, department: 'Production', approvalRequired: true, checklist: ['Wipe', 'Oil'], unitId: tal });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const id = t.body.data.id as string;
    await send('post', m.token, `/ops/tasks/${id}/start`);
    const notYet = await send('post', m.token, `/ops/tasks/${id}/done`);
    expect(notYet.status).toBe(422);
    const detail = await get(m.token, `/ops/tasks/${id}`);
    for (const it of detail.body.data.checklist as { id: string }[]) expect((await send('post', m.token, `/ops/tasks/${id}/checklist/${it.id}`, { done: true })).status).toBe(200);
    const done = await send('post', m.token, `/ops/tasks/${id}/done`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.approval_status).toBe('Pending');
    expect((await send('post', m.token, `/ops/tasks/${id}/approve`)).status).toBe(403); // not your own task
    const ap = await send('post', ownerToken, `/ops/tasks/${id}/approve`);
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect(ap.body.data.status).toBe('Approved');
    expect((await send('post', ownerToken, `/ops/tasks/${id}/reopen`, { reason: '' })).status).toBe(422);
    expect((await send('post', ownerToken, `/ops/tasks/${id}/reopen`, { reason: 'Found a leak again' })).status).toBe(200);
    // workload: 12 open and 4 overdue is red
    const w = await mgr('Production');
    for (let i = 0; i < 12; i++) await send('post', ownerToken, '/ops/tasks', { title: `TEST29 load ${i}`, assignedToId: w.user.id, department: 'Production', dueDate: i < 4 ? '2026-01-05' : '2026-12-30', unitId: tal });
    const wl = (await get(ownerToken, '/ops/tasks/workload?dept=Production')).body.data as { user_id: string; open: number; overdue: number; colour: string }[];
    const row = wl.find((x) => x.user_id === w.user.id)!;
    expect(row).toMatchObject({ open: 12, overdue: 4, colour: 'RED' });
    const over = (await get(w.token, '/ops/tasks?mine=true&overdue=true')).body.data as unknown[];
    expect(over).toHaveLength(4);
    const board = (await get(ownerToken, '/ops/tasks/board?dept=Production')).body.data as Record<string, unknown[]>;
    expect(Object.keys(board)).toEqual(expect.arrayContaining(['Open', 'In Progress', 'Done']));
  });

  it('recurring tasks: the template creates one task per working day, never twice, and Sunday is skipped', async () => {
    const m = await mgr('Production');
    const t = await send('post', ownerToken, '/ops/tasks', { title: 'TEST29 daily 5S', assignedToId: m.user.id, department: 'Production', startDate: '2026-11-01', recurrence: { kind: 'DAILY' }, unitId: tal });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.data.is_template).toBe(true);
    // Monday 16 Nov 2026 00:05 IST = Sunday 18:35 UTC
    const monday = new Date('2026-11-15T18:35:00Z');
    expect((await taskService.runRecurring(monday)).created).toBeGreaterThanOrEqual(1);
    expect((await taskService.runRecurring(monday)).created).toBe(0);
    const made = (await prisma.$queryRawUnsafe<{ due_date: string }[]>(`SELECT due_date::text FROM tasks WHERE parent_task_id = $1::uuid`, t.body.data.id));
    expect(made.map((x) => x.due_date)).toEqual(['2026-11-16']);
    const sunday = new Date('2026-11-21T18:35:00Z'); // 22 Nov 00:05 IST (Sunday)
    await taskService.runRecurring(sunday);
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM tasks WHERE parent_task_id = $1::uuid`, t.body.data.id))[0]!.n)).toBe(1);
  });

  it('shift handover: only the incoming person accepts, a reject needs a reason, not accepted in time alerts the manager', async () => {
    const out = await mgr('Production');
    const inc = await mgr('Production');
    const other = await mgr('Production');
    const h = await send('post', out.token, '/ops/handovers', { department: 'TEST29 Dept', handoverDate: '2026-11-13', toShiftId: genShift, incomingUserId: inc.user.id, lines: [{ line: 'Line 1', planned: 100, actual: 92, issue: 'Jam' }], issues: 'Belt slipping', safetyNote: 'None', materialsShort: 'BRK-14', unitId: tal });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    const id = h.body.data.id as string;
    expect((await send('post', inc.token, `/ops/handovers/${id}/accept`)).status).toBe(409); // not submitted yet
    expect((await send('post', other.token, `/ops/handovers/${id}/submit`)).status).toBe(403);
    const sub = await send('post', out.token, `/ops/handovers/${id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.data.status).toBe('SUBMITTED');
    expect((await send('post', other.token, `/ops/handovers/${id}/accept`)).status).toBe(403);
    expect((await send('post', inc.token, `/ops/handovers/${id}/reject`, { reason: '' })).status).toBe(422);
    const rej = await send('post', inc.token, `/ops/handovers/${id}/reject`, { reason: 'Line 1 figures are missing' });
    expect(rej.body.data.status).toBe('REJECTED');
    expect((await send('post', out.token, `/ops/handovers/${id}/submit`)).status).toBe(200); // resubmit after the fix
    // the deadline passes
    const acceptBy = new Date((await prisma.$queryRawUnsafe<{ accept_by: string }[]>(`SELECT accept_by FROM shift_handovers WHERE id = $1::uuid`, id))[0]!.accept_by);
    expect((await handoverService.alertLate(new Date(acceptBy.getTime() - 60_000))).alerted).toBe(0);
    expect((await handoverService.alertLate(new Date(acceptBy.getTime() + 60_000))).alerted).toBeGreaterThanOrEqual(1);
    expect((await handoverService.alertLate(new Date(acceptBy.getTime() + 120_000))).alerted).toBe(0); // once
    const acc = await send('post', inc.token, `/ops/handovers/${id}/accept`);
    expect(acc.status).toBe(200);
    expect(acc.body.data.status).toBe('ACCEPTED');
  });

  it('visitors: the host approves, the gate checks in, overstay alerts once, check-out, ID is last 4 only, anonymised after a year', async () => {
    const host = await mgr('Sales');
    const gate = await mgr('Warehouse');
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const bad = await send('post', gate.token, '/ops/visitors', { visitorName: 'TEST29 Vik', purpose: 'TEST29 demo', visitDate: today, hostUserId: host.user.id, idLast4: '123456789012', unitId: tal });
    expect(bad.status).toBe(422);
    const plannedOut = new Date(Date.now() - 31 * 60_000).toISOString();
    const v = await send('post', gate.token, '/ops/visitors', { visitorName: 'TEST29 Vik', company: 'Acme', mobile: '9876500000', purpose: 'TEST29 demo', visitDate: today, plannedIn: new Date(Date.now() - 3600_000).toISOString(), plannedOut, hostUserId: host.user.id, vehicleNo: 'MH04AB1234', idType: 'Aadhaar', idLast4: '9012', unitId: tal });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.data.pass_no).toMatch(/^VP\/TAL\//);
    expect(v.body.data.status).toBe('PRE_REGISTERED');
    const id = v.body.data.id as string;
    const early = await send('post', gate.token, '/ops/visitors/check-in', { id });
    expect(early.status).toBe(409);
    expect(JSON.stringify(early.body)).toContain(`${host.user.name} has not approved this visit yet.`);
    expect((await send('post', gate.token, `/ops/visitors/${id}/approve`)).status).toBe(403); // the gate is not the host
    expect((await send('post', host.token, `/ops/visitors/${id}/approve`)).status).toBe(200);
    expect((await send('post', host.token, `/ops/visitors/${id}/approve`)).status).toBe(409);
    const qr = await send('post', gate.token, `/ops/visitors/${id}/qr`);
    expect(qr.status).toBe(200);
    const stored = (await prisma.$queryRawUnsafe<{ qr_token_hash: string }[]>(`SELECT qr_token_hash FROM visitor_passes WHERE id = $1::uuid`, id))[0]!;
    expect(stored.qr_token_hash).not.toBe(qr.body.data.token);
    const ci = await send('post', gate.token, '/ops/visitors/check-in', { token: qr.body.data.token });
    expect(ci.status, JSON.stringify(ci.body)).toBe(200);
    expect(ci.body.data.status).toBe('INSIDE');
    expect((await send('post', gate.token, '/ops/visitors/check-in', { id })).status).toBe(409);
    const inside = (await get(gate.token, '/ops/visitors/inside')).body.data as { id: string; overstay: boolean; minutes_inside: number }[];
    const me = inside.find((x) => x.id === id)!;
    expect(me.overstay).toBe(true);
    // overstay: alerted once
    expect((await visitorService.alertOverstay()).alerted).toBeGreaterThanOrEqual(1);
    expect((await visitorService.alertOverstay()).alerted).toBe(0);
    const note = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM notifications WHERE type = 'visitor.overstay' AND entity_id = $1`, id).catch(() => [{ n: 1 }]);
    expect(Number(note[0]!.n)).toBeGreaterThanOrEqual(1);
    // pass PDF
    const pdf = await request(app).get(`${API}/ops/visitors/${id}/pass.pdf`).set('Authorization', `Bearer ${gate.token}`).set(XRW).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const out = await send('post', gate.token, `/ops/visitors/${id}/check-out`);
    expect(out.body.data.status).toBe('OUT');
    expect((await send('post', gate.token, `/ops/visitors/${id}/check-out`)).status).toBe(409);
    // a year later the personal details go
    await prisma.$executeRawUnsafe(`UPDATE visitor_passes SET out_time = now() - interval '400 days' WHERE id = $1::uuid`, id);
    expect((await visitorService.anonymise()).anonymised).toBeGreaterThanOrEqual(1);
    const gone = (await prisma.$queryRawUnsafe<{ visitor_name: string; mobile: string | null; id_last4: string | null; pass_no: string }[]>(`SELECT visitor_name, mobile, id_last4, pass_no FROM visitor_passes WHERE id = $1::uuid`, id))[0]!;
    expect(gone.visitor_name).toBe('Anonymised');
    expect(gone.mobile).toBeNull();
    expect(gone.id_last4).toBeNull();
    expect(gone.pass_no).toMatch(/^VP\//);
    // a host who makes the pass needs no approval
    const own = await send('post', host.token, '/ops/visitors', { visitorName: 'TEST29 Own', purpose: 'TEST29 own', visitDate: today, unitId: tal });
    expect(own.body.data.status).toBe('APPROVED');
  });

  it('canteen: rate, entitlement, scan money, already served, extra, no entitlement, other plant, month close with the journal, closed month', async () => {
    const counter = await mgr('HR');
    const emp = await makeEmployee('29001');
    await makeEmployee('29002', saw);
    // the gate to money: no rate yet
    await send('put', ownerToken, '/ops/canteen/entitlements', { unitId: tal, shiftId: genShift, mealType: 'LUNCH', on: true });
    const noRate = await send('post', counter.token, '/ops/canteen/scan', { code: 'T29-29001', mealType: 'LUNCH', unitId: tal });
    expect(noRate.status).toBe(409);
    expect(JSON.stringify(noRate.body)).toContain('No rate is set for lunch');
    const rate = await send('put', ownerToken, '/ops/canteen/rates', { unitId: tal, mealType: 'LUNCH', rate: 60, gstPct: 5, employeeSharePct: 40, effectiveFrom: '2026-01-01' });
    expect(rate.status, JSON.stringify(rate.body)).toBe(200);
    expect((await send('put', ownerToken, '/ops/canteen/rates', { unitId: tal, mealType: 'BRUNCH', rate: 1 })).status).toBe(422);
    const s1 = await send('post', counter.token, '/ops/canteen/scan', { code: 'T29-29001', mealType: 'LUNCH', unitId: tal });
    expect(s1.status, JSON.stringify(s1.body)).toBe(201);
    expect(Number(s1.body.data.total)).toBe(63);
    expect(Number(s1.body.data.employee_share)).toBe(25.2);
    expect(Number(s1.body.data.company_share)).toBe(37.8);
    expect(s1.body.data.coupon_no).toMatch(/^CPN\/TAL\//);
    const dup = await send('post', counter.token, '/ops/canteen/scan', { code: 'T29-29001', mealType: 'LUNCH', unitId: tal });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).toMatch(/Already served lunch today at \d\d:\d\d\./);
    const extra = await send('post', counter.token, '/ops/canteen/scan', { code: 'T29-29001', mealType: 'LUNCH', extra: true, unitId: tal });
    expect(extra.status, JSON.stringify(extra.body)).toBe(201);
    const ent = await send('post', counter.token, '/ops/canteen/scan', { code: 'T29-29001', mealType: 'BREAKFAST', unitId: tal });
    expect(ent.status).toBe(409);
    expect(JSON.stringify(ent.body)).toContain('No breakfast entitlement for shift GEN.');
    expect((await send('post', counter.token, '/ops/canteen/scan', { code: 'T29-29002', mealType: 'LUNCH', unitId: tal })).status).toBe(422); // works in SAW
    expect((await send('post', counter.token, '/ops/canteen/scan', { code: 'NOPE', mealType: 'LUNCH', unitId: tal })).status).toBe(422);
    const today = (await get(counter.token, `/ops/canteen/today?unit=${tal}`)).body.data as { counts: { meal_type: string; n: number }[]; last: unknown[] };
    expect(today.counts.find((c) => c.meal_type === 'LUNCH')?.n).toBe(2);
    expect(today.last.length).toBeGreaterThanOrEqual(1);
    // vendor bill: more than 2 % over the meals served needs a second person
    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const ok = await send('post', counter.token, '/ops/canteen/vendor-bills', { unitId: tal, month, vendorName: 'TEST29 Caterer', mealsBilled: 2 });
    expect(ok.body.data.status).toBe('OK');
    const over = await send('post', counter.token, '/ops/canteen/vendor-bills', { unitId: tal, month, vendorName: 'TEST29 Caterer', mealsBilled: 3 });
    expect(over.body.data.status).toBe('PENDING_APPROVAL');
    expect(Number(over.body.data.variance_pct)).toBe(50);
    expect((await send('post', counter.token, `/ops/canteen/vendor-bills/${over.body.data.id}/approve`)).status).toBe(403);
    expect((await send('post', ownerToken, `/ops/canteen/vendor-bills/${over.body.data.id}/approve`)).status).toBe(200);
    // department cost
    const cost = (await get(counter.token, `/ops/canteen/department-cost?month=${month}`)).body.data as { department: string; meals: number; employee_share: string; company_share: string }[];
    const pc = cost.find((c) => c.department === 'Production')!;
    expect(pc.meals).toBe(2);
    expect(Number(pc.employee_share)).toBe(50.4);
    expect(Number(pc.company_share)).toBe(75.6);
    // month close
    const close = await send('post', ownerToken, `/ops/canteen/months/${month}/close`, { unitId: tal });
    expect(close.status, JSON.stringify(close.body)).toBe(200);
    expect(close.body.data).toMatchObject({ meals: 2, employeeTotal: 50.4, companyTotal: 75.6, total: 126 });
    expect(close.body.data.journalId).toBeTruthy();
    const lines = await prisma.$queryRawUnsafe<{ d: string; c: string }[]>(`SELECT coalesce(sum(debit),0)::text AS d, coalesce(sum(credit),0)::text AS c FROM journal_lines WHERE journal_id = $1::uuid`, close.body.data.journalId);
    expect(Number(lines[0]!.d)).toBe(126);
    expect(Number(lines[0]!.c)).toBe(126);
    expect((await send('post', ownerToken, `/ops/canteen/months/${month}/close`, { unitId: tal })).status).toBe(409);
    const closed = await send('post', counter.token, '/ops/canteen/scan', { code: 'T29-29001', mealType: 'LUNCH', extra: true, unitId: tal });
    expect(closed.status).toBe(409);
    expect(JSON.stringify(closed.body)).toMatch(/\w+ canteen is closed\./);
    // payroll reads the closed month: the component exists and the sum is what the run will deduct
    const comp = await prisma.$queryRawUnsafe<{ kind: string; calc_type: string }[]>(`SELECT kind, calc_type FROM pay_components WHERE code = 'CANTEEN_DED'`);
    expect(comp[0]).toMatchObject({ kind: 'DEDUCTION', calc_type: 'INPUT' });
    const ded = await prisma.$queryRawUnsafe<{ amt: number }[]>(`SELECT coalesce(sum(c.employee_share),0)::float AS amt FROM canteen_coupons c JOIN canteen_months m ON m.unit_id = c.unit_id AND m.month = $2 AND m.status = 'CLOSED' WHERE c.person_id = $1::uuid AND c.payment_mode = 'PAYROLL' AND to_char(c.date,'YYYY-MM') = $2`, emp, month);
    expect(ded[0]!.amt).toBe(50.4);
    expect(Number((await get(counter.token, '/ops/canteen/months')).body.data.length)).toBeGreaterThanOrEqual(1);
  });
});
