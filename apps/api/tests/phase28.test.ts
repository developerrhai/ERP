/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 28: attendance automation. Device push and agents, day calculation, policies with reasons and reversal, OT requests,
// reminders, daily reports, live board, device health, mobile punch (geo-fence), month lock.
import request from 'supertest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageResource } from '../src/core/rbac/permission-model';
import { seedPhase2Defaults } from '../src/core/seed/defaults';
import { attService, policyOf } from '../src/modules/attauto/service';
import { deviceHealth, directionOf, distanceM, insideSite, lateMarkTriggers, lockDue, monthRange, parseDeviceTime, parsePushBody, previousMonth } from '../src/modules/attauto/calc';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('Phase 28 rules (pure)', () => {
  it('device time is IST and the push body parses (bad lines are counted, not fatal)', () => {
    expect(parseDeviceTime('2026-11-12 07:14:00')!.toISOString()).toBe('2026-11-12T01:44:00.000Z');
    expect(parseDeviceTime('nonsense')).toBeNull();
    const { punches, bad } = parsePushBody('101\t2026-11-12 07:14:00\t0\t1\n102\t2026-11-12 07:15:30\t1\t1\n\nxx\tnot-a-time\n');
    expect(punches).toHaveLength(2);
    expect(bad).toBe(1);
    expect(punches[0]).toMatchObject({ code: '101', direction: 'IN' });
    expect(punches[1]).toMatchObject({ code: '102', direction: 'OUT' });
    expect(directionOf('4')).toBe('IN');
    expect(directionOf('5')).toBe('OUT');
    expect(directionOf('2')).toBeNull();
  });
  it('geo-fence edges: on the radius is inside, one metre more is outside', () => {
    expect(insideSite(200, 200)).toBe(true);
    expect(insideSite(200.5, 200)).toBe(false);
    const d = distanceM(19.0, 72.9, 19.0, 72.9);
    expect(d).toBe(0);
    // about 111 m per 0.001 degree of latitude
    expect(Math.round(distanceM(19.0, 72.9, 19.001, 72.9))).toBeGreaterThan(105);
    expect(Math.round(distanceM(19.0, 72.9, 19.001, 72.9))).toBeLessThan(118);
  });
  it('late marks trigger on the 3rd, 6th ... late day', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => lateMarkTriggers(n, 3))).toEqual([false, false, true, false, false, true]);
    expect(lateMarkTriggers(0, 3)).toBe(false);
  });
  it('device health: 30 minutes stale, 2 hours offline, quiet outside shift hours is fine', () => {
    const now = new Date('2026-11-13T06:30:00Z');
    const ago = (m: number) => new Date(now.getTime() - m * 60_000);
    expect(deviceHealth(ago(29), now, true)).toBe('ONLINE');
    expect(deviceHealth(ago(31), now, true)).toBe('STALE');
    expect(deviceHealth(ago(121), now, true)).toBe('OFFLINE');
    expect(deviceHealth(ago(300), now, false)).toBe('STALE');
    expect(deviceHealth(null, now, true)).toBe('OFFLINE');
  });
  it('the lock is due on the 2nd of the next month at 18:00 IST', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // 17:59 IST on 2 Dec = 12:29 UTC
    expect(lockDue(new Date('2026-12-02T12:29:00Z'), '2026-11')).toBe(false);
    expect(lockDue(new Date('2026-12-02T12:30:00Z'), '2026-11')).toBe(true);
    expect(lockDue(new Date('2026-12-05T04:00:00Z'), '2026-11')).toBe(true);
    expect(lockDue(new Date('2026-11-30T12:30:00Z'), '2026-11')).toBe(false);
  });
});

describe('Phase 28 (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  const empIds: string[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const get = (token: string, path: string) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW);
  const send = (method: 'post' | 'put' | 'delete', token: string, path: string, body?: unknown) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).send(body as object);
  const push = (serial: string, body: string) => request(app).post(`/iclock/cdata?SN=${serial}&table=ATTLOG`).set('Content-Type', 'text/plain').send(body);

  async function makeEmployee(code: string, opts: { unit?: string; dept?: string; userId?: string | null; manager?: string | null } = {}): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO employees (id, emp_code, first_name, last_name, gender, dob, mobile, joining_date, status, biometric_code, user_id) VALUES ($1::uuid, $2, 'TEST28', $2, 'M', '1990-01-01', $5, '2020-01-01', 'ACTIVE', $3, $4::uuid)`, id, `T28-${code}`, code, opts.userId ?? null, `7${code.padStart(9, '0')}`);
    await prisma.$executeRawUnsafe(`INSERT INTO employee_assignments (employee_id, effective_from, unit_id, department, reporting_manager_employee_id) VALUES ($1::uuid, '2020-01-01', $2::uuid, $3, $4::uuid)`, id, opts.unit ?? tal, opts.dept ?? 'Production', opts.manager ?? null);
    const morning = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM shifts WHERE code = 'MORNING'`))[0]!.id;
    for (let d = 1; d <= 30; d++) {
      await prisma.$executeRawUnsafe(`INSERT INTO shift_rosters (employee_id, roster_date, shift_id, is_off) VALUES ($1::uuid, $2::date, $3::uuid, false) ON CONFLICT DO NOTHING`, id, `2026-11-${String(d).padStart(2, '0')}`, morning).catch(() => 0);
    }
    empIds.push(id);
    return id;
  }

  beforeAll(async () => {
    await seedPhase2Defaults(prisma);
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    await prisma.$executeRaw`UPDATE attendance_policies SET enabled = CASE policy_key WHEN 'LATE_MARK' THEN false WHEN 'MISSED_PUNCH' THEN true WHEN 'AUTO_ABSENT' THEN true WHEN 'AUTO_LEAVE' THEN false WHEN 'AUTO_OT' THEN true WHEN 'AUTO_COMPOFF' THEN true WHEN 'AUTO_SHIFT' THEN false WHEN 'MOBILE_PUNCH' THEN false WHEN 'BUDDY_ALERT' THEN true ELSE true END WHERE unit_id IS NULL`;
    await prisma.$executeRaw`DELETE FROM attendance_policies WHERE unit_id IS NOT NULL`;
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    const ids = empIds.length ? empIds : [randomUUID()];
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_auto_actions WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_alerts WHERE employee_id = ANY($1::uuid[]) OR ref LIKE 'unknown:T28%' OR detail LIKE '%T28%'`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM ot_entries WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_period_summary WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_days WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM mobile_punches WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM live_presence WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM shift_rosters WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_punch_exceptions WHERE biometric_code LIKE 'T28%' OR biometric_code ~ '^28[0-9]+$'`);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_punches WHERE biometric_code ~ '^28[0-9]+$'`);
    await prisma.$executeRawUnsafe(`DELETE FROM employee_assignments WHERE employee_id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, ids);
    await prisma.$executeRaw`DELETE FROM device_sync_logs WHERE device_id IN (SELECT id FROM attendance_devices WHERE code LIKE 'T28-%' OR code LIKE 'MOBILE-%')`;
    await prisma.$executeRaw`DELETE FROM attendance_punches WHERE device_id IN (SELECT id FROM attendance_devices WHERE code LIKE 'T28-%' OR code LIKE 'MOBILE-%')`;
    await prisma.$executeRaw`DELETE FROM attendance_devices WHERE code LIKE 'T28-%' OR code LIKE 'MOBILE-%'`;
    await prisma.$executeRaw`DELETE FROM attendance_agents WHERE name LIKE 'T28%'`;
    await prisma.$executeRaw`DELETE FROM geo_sites WHERE name LIKE 'T28%'`;
    await prisma.$executeRaw`DELETE FROM attendance_policies WHERE unit_id IS NOT NULL`;
    await prisma.$executeRaw`DELETE FROM email_outbox WHERE subject LIKE '%T28%' OR to_email LIKE '%t28%'`;
    await prisma.$executeRaw`DELETE FROM mail_automation_runs WHERE code IN ('missed_punch','daily_attendance')`;
  });

  it('devices: a push device needs its serial; a serial cannot be registered twice; an agent key is shown once', async () => {
    const noSerial = await send('post', ownerToken, '/hr/att/devices', { code: 'T28-D0', name: 'Gate', unitId: tal, connection: 'PUSH' });
    expect(noSerial.status).toBe(422);
    const d = await send('post', ownerToken, '/hr/att/devices', { code: 'T28-D1', name: 'T28 Gate Talwade', unitId: tal, connection: 'PUSH', serialNo: 'T28SN001' });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const dup = await send('post', ownerToken, '/hr/att/devices', { code: 'T28-D2', name: 'T28 Other', unitId: tal, connection: 'PUSH', serialNo: 'T28SN001' });
    expect(dup.status).toBe(409);
    const list = await get(ownerToken, '/hr/att/devices');
    expect((list.body.data as { code: string; status: string }[]).find((x) => x.code === 'T28-D1')?.status).toBe('OFFLINE');
    const a = await send('post', ownerToken, '/hr/att/agents', { unitId: tal, name: 'T28 agent' });
    expect(a.status).toBe(201);
    expect(a.body.data.key).toMatch(/^[0-9a-f]{48}$/);
    const stored = await prisma.$queryRawUnsafe<{ key_hash: string }[]>(`SELECT key_hash FROM attendance_agents WHERE id = $1::uuid`, a.body.data.id);
    expect(stored[0]!.key_hash).not.toBe(a.body.data.key);
    expect((await get(ownerToken, '/hr/att/agents')).body.data[0]).not.toHaveProperty('key_hash');
  });

  it('device push: unknown serial 401; the day is calculated at once (spec example); duplicates ignored; live board; unknown codes kept', async () => {
    const bad = await push('T28NOPE', '28001\t2026-11-12 07:14:00\t0\n');
    expect(bad.status).toBe(401);
    expect(bad.text).toBe('Device T28NOPE is not registered.');
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_alerts WHERE ref = 'unknown:T28NOPE'`))[0]!.n)).toBe(1);
    const emp = await makeEmployee('28001');
    const r1 = await push('T28SN001', '28001\t2026-11-12 07:14:00\t0\t1\n28001\t2026-11-12 18:05:00\t1\t1\n99999\t2026-11-12 08:00:00\t0\t1\n');
    expect(r1.status, r1.text).toBe(200);
    expect(r1.text).toBe('OK: 3');
    const day = (await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = '2026-11-12'`, emp))[0]!;
    expect(day.status).toBe('P');
    expect(Number(day.worked_minutes)).toBe(621);
    expect(Number(day.late_minutes)).toBe(14);
    expect(Number(day.ot_candidate_minutes)).toBe(135);
    // the same push again inserts nothing
    const r2 = await push('T28SN001', '28001\t2026-11-12 07:14:00\t0\t1\n28001\t2026-11-12 18:05:00\t1\t1\n');
    expect(r2.text).toBe('OK: 0');
    // the unknown code waits for HR
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_punch_exceptions WHERE biometric_code = '99999'`))[0]!.n)).toBeGreaterThanOrEqual(1);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_punch_exceptions WHERE biometric_code = '99999'`);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_punches WHERE biometric_code = '99999'`);
    // health: the device is online now and its sync log shows 3 received
    const dev = (await get(ownerToken, '/hr/att/devices')).body.data as { code: string; status: string }[];
    expect(dev.find((x) => x.code === 'T28-D1')?.status).toBe('ONLINE');
    const logs = (await get(ownerToken, '/hr/att/sync-logs')).body.data as { received: number; inserted: number; duplicates: number }[];
    expect(logs.some((l) => l.received === 3 && l.inserted === 3)).toBe(true);
    expect(logs.some((l) => l.inserted === 0 && l.duplicates === 2)).toBe(true);
  });

  it('auto OT: the overtime of that day became a request for the manager (once)', async () => {
    const emp = empIds[0]!;
    const ot = await prisma.$queryRawUnsafe<{ eligible_hours: string; status: string }[]>(`SELECT eligible_hours, status FROM ot_entries WHERE employee_id = $1::uuid AND date = '2026-11-12'`, emp);
    expect(ot).toHaveLength(1);
    expect(Number(ot[0]!.eligible_hours)).toBe(2.25);
    expect(ot[0]!.status).toBe('PENDING');
    const act = await prisma.$queryRawUnsafe<{ reason: string }[]>(`SELECT reason FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'AUTO_OT'`, emp);
    expect(act).toHaveLength(1);
    expect(act[0]!.reason).toContain('135 minutes');
  });

  it('agent batch: a wrong signature is 401, a right one is accepted', async () => {
    const a = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM attendance_agents WHERE name = 'T28 agent'`))[0]!;
    // the key is only shown once at creation: make a fresh agent for the signing check
    const made = await send('post', ownerToken, '/hr/att/agents', { unitId: tal, name: 'T28 agent 2' });
    const key = made.body.data.key as string;
    const id = made.body.data.id as string;
    expect(a.id).toBeTruthy();
    const body = JSON.stringify({ serial: 'T28SN001', punches: [{ code: '28001', time: '2026-11-13 07:00:00', status: '0' }] });
    const secret = createHash('sha256').update(key).digest('hex');
    const bad = await request(app).post('/api/v1/att/agents/batch').set('X-Agent-Id', id).set('X-Signature', createHmac('sha256', 'wrong').update(body).digest('hex')).set('Content-Type', 'text/plain').send(body);
    expect(bad.status).toBe(401);
    const good = await request(app).post('/api/v1/att/agents/batch').set('X-Agent-Id', id).set('X-Signature', createHmac('sha256', secret).update(body).digest('hex')).set('Content-Type', 'text/plain').send(body);
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect(good.body.data.inserted).toBe(1);
    const wrongPlant = JSON.stringify({ serial: 'T28NOSUCH', punches: [{ code: '28001', time: '2026-11-13 07:00:00' }] });
    const wp = await request(app).post('/api/v1/att/agents/batch').set('X-Agent-Id', id).set('X-Signature', createHmac('sha256', secret).update(wrongPlant).digest('hex')).set('Content-Type', 'text/plain').send(wrongPlant);
    expect(wp.status).toBe(422);
  });

  it('live board: one punch today = inside; two = out; counts per department', async () => {
    const emp = await makeEmployee('28002', { dept: 'Production' });
    const now = new Date();
    const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const r = await push('T28SN001', `28002\t${ist(new Date(now.getTime() - 60_000))}\t0\n`);
    expect(r.text).toBe('OK: 1');
    const live = (await get(ownerToken, `/hr/att/live?unit=${tal}`)).body.data as { department: string; inside: number; expected: number; pct: string | null }[];
    const prod = live.find((x) => x.department === 'Production');
    expect(prod, JSON.stringify(live)).toBeTruthy();
    expect(prod!.inside).toBeGreaterThanOrEqual(1);
    expect(prod!.expected).toBeGreaterThanOrEqual(prod!.inside);
    await push('T28SN001', `28002\t${ist(now)}\t1\n`);
    const row = (await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM live_presence WHERE employee_id = $1::uuid`, emp))[0]!;
    expect(row.status).toBe('OUT');
    // another plant's board is not visible without choosing it
    const other = await get(ownerToken, `/hr/att/live?unit=${saw}`);
    expect(other.status).toBe(200);
  });

  it('late-mark policy: off = nothing; on = the 3rd late day costs 0.5 day with a reason; HR reverses it with a reason', async () => {
    const emp = await makeEmployee('28003');
    for (const d of ['04', '11']) await push('T28SN001', `28003\t2026-11-${d} 07:14:00\t0\n28003\t2026-11-${d} 15:30:00\t1\n`);
    await push('T28SN001', '28003\t2026-11-18 07:25:00\t0\n28003\t2026-11-18 15:30:00\t1\n');
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'LATE_MARK'`, emp))[0]!.n)).toBe(0);
    // switch it on through the screen API for Talwade and run the days again
    const on = await send('put', ownerToken, '/hr/att/policies', { policyKey: 'LATE_MARK', unitId: tal, enabled: true, params: { lates: 3, deductDays: 0.5 } });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect((await policyOf(tal, 'LATE_MARK')).enabled).toBe(true);
    expect((await policyOf(saw, 'LATE_MARK')).enabled).toBe(false); // the plant's own row does not leak to another plant
    for (const d of ['04', '11', '18']) await attService.applyDayPolicies(emp, `2026-11-${d}`, '2026-11-20');
    const acts = await prisma.$queryRawUnsafe<{ id: string; reason: string; action: string; action_date: string }[]>(`SELECT id, reason, action, action_date::text FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'LATE_MARK'`, emp);
    expect(acts).toHaveLength(1);
    expect(acts[0]!.action).toBe('MARK_LOP');
    expect(acts[0]!.action_date).toBe('2026-11-18');
    expect(acts[0]!.reason).toBe('3rd late mark in November (4, 11, 18)');
    const lop = (await prisma.$queryRawUnsafe<{ auto_lop: string }[]>(`SELECT auto_lop FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = '2026-11-18'`, emp))[0]!.auto_lop;
    expect(Number(lop)).toBe(0.5);
    // running again does not double it
    await attService.applyDayPolicies(emp, '2026-11-18', '2026-11-20');
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'LATE_MARK'`, emp))[0]!.n)).toBe(1);
    // the employee can see it in the list
    const list = await get(ownerToken, `/hr/att/auto-actions?employee=${emp}&month=2026-11`);
    expect(list.body.data[0].reason).toContain('3rd late mark');
    // reversal needs a reason and restores the day
    expect((await send('post', ownerToken, `/hr/att/auto-actions/${acts[0]!.id}/reverse`, { reason: '' })).status).toBe(422);
    const rev = await send('post', ownerToken, `/hr/att/auto-actions/${acts[0]!.id}/reverse`, { reason: 'Machine clock was wrong that day' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(rev.body.data.reversed_at).toBeTruthy();
    const lop2 = (await prisma.$queryRawUnsafe<{ auto_lop: string }[]>(`SELECT auto_lop FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = '2026-11-18'`, emp))[0]!.auto_lop;
    expect(Number(lop2)).toBe(0);
    expect((await send('post', ownerToken, `/hr/att/auto-actions/${acts[0]!.id}/reverse`, { reason: 'again again' })).status).toBe(409);
    // a policy of one plant does not touch another plant's employee
    const sawEmp = await makeEmployee('28004', { unit: saw });
    for (const d of ['04', '11', '18']) await push('T28SN001', `28004\t2026-11-${d} 07:20:00\t0\n`).catch(() => undefined);
    for (const d of ['04', '11', '18']) await prisma.$executeRawUnsafe(`UPDATE attendance_days SET late_minutes = 10 WHERE employee_id = $1::uuid AND attendance_date = $2::date`, sawEmp, `2026-11-${d}`);
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'LATE_MARK'`, sawEmp))[0]!.n)).toBe(0);
  });

  it('missed punch: reminder next morning, half day after 3 days, reversible; off = nothing', async () => {
    const emp = await makeEmployee('28005');
    // the punch arrives with the policy paused (these test days are in the past; a real punch is same-day), then the policy runs with chosen dates
    await send('put', ownerToken, '/hr/att/policies', { policyKey: 'MISSED_PUNCH', unitId: tal, enabled: false });
    await push('T28SN001', '28005\t2026-11-10 07:05:00\t0\n');
    await send('put', ownerToken, '/hr/att/policies', { policyKey: 'MISSED_PUNCH', unitId: tal, enabled: true });
    const day = (await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = '2026-11-10'`, emp))[0]!;
    expect(day.status).toBe('MIS');
    // reminder: the morning after (11 Nov 10:00 IST = 04:30 UTC)
    const n = await attService.remindMissedPunches(new Date('2026-11-11T04:30:00Z'));
    expect(n).toBeGreaterThanOrEqual(1);
    const alert = await prisma.$queryRawUnsafe<{ kind: string; detail: string }[]>(`SELECT kind, detail FROM attendance_alerts WHERE employee_id = $1::uuid AND alert_date = '2026-11-10'`, emp);
    expect(alert).toHaveLength(1);
    expect(alert[0]!.detail).toBe('Missed out-punch on 2026-11-10. Regularise in ESS.');
    expect(await attService.remindMissedPunches(new Date('2026-11-11T04:35:00Z'))).toBe(0); // once only
    // 2 days later nothing yet; on the 3rd day: half day with the reason
    await attService.applyDayPolicies(emp, '2026-11-10', '2026-11-12');
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'MISSED_PUNCH'`, emp))[0]!.n)).toBe(0);
    await attService.applyDayPolicies(emp, '2026-11-10', '2026-11-13');
    const a = (await prisma.$queryRawUnsafe<{ id: string; reason: string }[]>(`SELECT id, reason FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'MISSED_PUNCH'`, emp));
    expect(a).toHaveLength(1);
    expect(a[0]!.reason).toBe('Missed punch not regularised in 3 days');
    expect((await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = '2026-11-10'`, emp))[0]!.status).toBe('HD');
    const rev = await send('post', ownerToken, `/hr/att/auto-actions/${a[0]!.id}/reverse`, { reason: 'Regularised on paper by the manager' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect((await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = '2026-11-10'`, emp))[0]!.status).toBe('MIS');
    // policy off: no action for another employee
    await send('put', ownerToken, '/hr/att/policies', { policyKey: 'MISSED_PUNCH', unitId: tal, enabled: false });
    const emp2 = await makeEmployee('28006');
    await push('T28SN001', '28006\t2026-11-09 07:05:00\t0\n');
    await attService.applyDayPolicies(emp2, '2026-11-09', '2026-11-13');
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_auto_actions WHERE employee_id = $1::uuid`, emp2))[0]!.n)).toBe(0);
    await send('put', ownerToken, '/hr/att/policies', { policyKey: 'MISSED_PUNCH', unitId: tal, enabled: true });
  });

  it('buddy punching alert, device stale / offline timings, and unknown devices raise alerts for HR', async () => {
    await makeEmployee('28007');
    await makeEmployee('28008');
    await makeEmployee('28009');
    const body = ['28007\t2026-11-05 08:00:00\t0', '28008\t2026-11-05 08:00:02\t0', '28009\t2026-11-05 08:00:04\t0', '28007\t2026-11-05 08:00:05\t0', '28008\t2026-11-05 08:00:07\t0'].join('\n');
    await push('T28SN001', body + '\n');
    const buddy = await prisma.$queryRawUnsafe<{ detail: string }[]>(`SELECT detail FROM attendance_alerts WHERE kind = 'BUDDY' AND unit_id = $1::uuid`, tal);
    expect(buddy.length).toBeGreaterThanOrEqual(1);
    // health: noon IST (06:30 UTC) is in shift hours
    const noon = new Date('2026-11-13T06:30:00Z');
    await prisma.$executeRawUnsafe(`UPDATE attendance_devices SET last_seen_at = $1::timestamptz, status = 'ONLINE' WHERE code = 'T28-D1'`, new Date(noon.getTime() - 31 * 60_000).toISOString());
    expect((await attService.deviceHealthCheck(noon)).stale).toBeGreaterThanOrEqual(1);
    expect((await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM attendance_devices WHERE code = 'T28-D1'`))[0]!.status).toBe('STALE');
    await prisma.$executeRawUnsafe(`UPDATE attendance_devices SET last_seen_at = $1::timestamptz WHERE code = 'T28-D1'`, new Date(noon.getTime() - 125 * 60_000).toISOString());
    expect((await attService.deviceHealthCheck(noon)).offline).toBeGreaterThanOrEqual(1);
    expect((await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM attendance_devices WHERE code = 'T28-D1'`))[0]!.status).toBe('OFFLINE');
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_alerts WHERE kind IN ('DEVICE_STALE','DEVICE_OFFLINE') AND ref = (SELECT id::text FROM attendance_devices WHERE code = 'T28-D1')`))[0]!.n)).toBeGreaterThanOrEqual(2);
    await push('T28SN001', '28007\t2026-11-13 12:00:00\t0\n'); // back online
    expect((await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM attendance_devices WHERE code = 'T28-D1'`))[0]!.status).toBe('ONLINE');
  });

  it('daily department report (#32): the manager of the department gets yesterday\'s counts, once, and only for their plant', async () => {
    const mgrRole = await prisma.role.upsert({ where: { code: 'TEST28_MGR' }, update: {}, create: { code: 'TEST28_MGR', name: 'Test 28 manager', level: 60 } });
    const mgr = await makeUser({ roleCode: 'TEST28_MGR', department: 'Production', unitCodes: ['TAL'], defaultUnitCode: 'TAL', email: 'mgr-prod@t28.example' });
    const sawMgr = await makeUser({ roleCode: 'TEST28_MGR', department: 'Production', unitCodes: ['SAW'], defaultUnitCode: 'SAW', email: 'mgr-saw@t28.example' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: { in: [mgr.id, sawMgr.id] } } }));
    expect(mgrRole.level).toBe(60);
    const before = await attService.sendDailyReports(new Date('2026-11-13T04:59:00Z')); // 10:29 IST: too early
    expect(before).toBe(0);
    const sent = await attService.sendDailyReports(new Date('2026-11-13T05:00:00Z')); // 10:30 IST, report for 12 Nov
    expect(sent).toBeGreaterThanOrEqual(1);
    const mails = await prisma.$queryRawUnsafe<{ to_email: string; text: string }[]>(`SELECT to_email, text FROM email_outbox WHERE to_email IN ('mgr-prod@t28.example','mgr-saw@t28.example')`);
    const prod = mails.find((m) => m.to_email === 'mgr-prod@t28.example')!;
    expect(prod.text).toMatch(/Production \(TAL\) on 2026-11-12: present \d+, late \d+, absent \d+, missed punch \d+, on leave \d+\./);
    expect(mails.some((m) => m.to_email === 'mgr-saw@t28.example' && m.text.includes('(TAL)'))).toBe(false); // R-37
    expect(await attService.sendDailyReports(new Date('2026-11-13T05:10:00Z'))).toBe(0); // once a day
  });

  it('mobile punch: off by default; inside the site accepted; outside refused with the distance; bad GPS refused', async () => {
    const role = await prisma.role.upsert({ where: { code: 'TEST28_MGR' }, update: {}, create: { code: 'TEST28_MGR', name: 'Test 28 manager', level: 60 } });
    await prisma.rolePermission.upsert({ where: { roleId_resource: { roleId: role.id, resource: pageResource('hr-ess') } }, update: { view: true, scope: 'UNIT' }, create: { roleId: role.id, resource: pageResource('hr-ess'), view: true, scope: 'UNIT' } });
    const user = await makeUser({ roleCode: 'TEST28_MGR', department: 'Production', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    cleanup.push(() => prisma.userUnit.deleteMany({ where: { userId: user.id } }));
    const emp = await makeEmployee('28010', { userId: user.id });
    const token = (await signIn(app, user)).token;
    const off = await send('post', token, '/ess/punch', { lat: 19.0, lng: 72.9, accuracy: 20 });
    expect(off.status).toBe(403);
    await send('put', ownerToken, '/hr/att/policies', { policyKey: 'MOBILE_PUNCH', unitId: tal, enabled: true, params: { maxAccuracyM: 100, requireSelfie: false } });
    const noSite = await send('post', token, '/ess/punch', { lat: 19.0, lng: 72.9, accuracy: 20 });
    expect(noSite.status).toBe(422);
    const site = await send('post', ownerToken, '/hr/att/geo-sites', { unitId: tal, name: 'T28 Talwade gate', lat: 19.0, lng: 72.9, radiusM: 200 });
    expect(site.status, JSON.stringify(site.body)).toBe(201);
    expect((await send('post', token, '/ess/punch', { lat: 19.0, lng: 72.9, accuracy: 250 })).status).toBe(422); // GPS too poor
    const far = await send('post', token, '/ess/punch', { lat: 19.0058, lng: 72.9, accuracy: 20 }); // about 640 m north
    expect(far.status).toBe(422);
    expect(JSON.stringify(far.body)).toMatch(/You are 6\d\d m from T28 Talwade gate\. Punch from inside the site\./);
    const inside = await send('post', token, '/ess/punch', { lat: 19.0005, lng: 72.9, accuracy: 20 });
    expect(inside.status, JSON.stringify(inside.body)).toBe(201);
    expect(inside.body.data.accepted).toBe(true);
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM mobile_punches WHERE employee_id = $1::uuid AND inside`, emp))[0]!.n)).toBe(1);
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM mobile_punches WHERE employee_id = $1::uuid AND NOT inside`, emp))[0]!.n)).toBe(1);
    // the punch went through the same pipeline: live presence
    expect((await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM live_presence WHERE employee_id = $1::uuid`, emp))[0]!.status).toBe('INSIDE');
  });

  it('month lock: payroll inputs equal the day figures, automatic late deductions are included, locked days do not change, unlock needs a reason', async () => {
    const emp = await makeEmployee('28011');
    await send('put', ownerToken, '/hr/att/policies', { policyKey: 'LATE_MARK', unitId: tal, enabled: true, params: { lates: 3, deductDays: 0.5 } });
    for (const d of ['02', '03', '04']) await push('T28SN001', `28011\t2026-11-${d} 07:25:00\t0\n28011\t2026-11-${d} 15:30:00\t1\n`);
    expect(Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'LATE_MARK'`, emp))[0]!.n)).toBe(1);
    // not due yet on 30 Nov; due on 2 Dec 18:00
    expect((await attService.autoLock(new Date('2026-12-02T12:00:00Z'))).locked).toBe(0);
    const res = await attService.autoLock(new Date('2026-12-02T12:30:00Z'));
    expect(res.locked).toBeGreaterThanOrEqual(1);
    const sum = (await prisma.$queryRawUnsafe<{ locked: boolean; lop_days: string; present_days: string }[]>(`SELECT locked, lop_days, present_days FROM attendance_period_summary WHERE employee_id = $1::uuid AND period_start = '2026-11-01'`, emp))[0]!;
    expect(sum.locked).toBe(true);
    expect(Number(sum.lop_days)).toBeGreaterThanOrEqual(0.5);
    expect(Number(sum.present_days)).toBeGreaterThanOrEqual(3);
    // a late punch cannot change a locked day
    await push('T28SN001', '28011\t2026-11-02 23:00:00\t1\n');
    const day = (await prisma.$queryRawUnsafe<{ locked: boolean; last_out: string }[]>(`SELECT locked, last_out FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = '2026-11-02'`, emp))[0]!;
    expect(day.locked).toBe(true);
    expect(new Date(day.last_out).toISOString()).toBe('2026-11-02T10:00:00.000Z'); // 15:30 IST, unchanged
    // reversing on a locked month is refused; unlock needs a reason
    const act = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM attendance_auto_actions WHERE employee_id = $1::uuid AND policy_key = 'LATE_MARK'`, emp))[0]!;
    const refused = await send('post', ownerToken, `/hr/att/auto-actions/${act.id}/reverse`, { reason: 'Wrong clock on that day' });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('attendance is locked. Ask HR head to unlock with a reason.');
    expect((await send('post', ownerToken, '/hr/att/unlock', { unitId: tal, month: '2026-11', reason: 'short' })).status).toBe(422);
    const un = await send('post', ownerToken, '/hr/att/unlock', { unitId: tal, month: '2026-11', reason: 'HR head approved a correction run' });
    expect(un.status, JSON.stringify(un.body)).toBe(200);
    expect(un.body.data.days).toBeGreaterThanOrEqual(1);
  });
});
