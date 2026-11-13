/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phases 23-25: plant access, Menu / Home, dashboards (targets, colours, TV) and the department work movement engine.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { achievementPct, alertCrossed, dailyDue, isAdditive, parseDailyCron, ragOf } from '../src/modules/dashboards/calc';
import { addWorkingDays, isOpen, lateLevel, nextState } from '../src/modules/work/calc';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('dashboard rules (pure)', () => {
  it('green at 90 %, amber at 75 %, red below', () => {
    expect(ragOf(90)).toBe('GREEN');
    expect(ragOf(89.99)).toBe('AMBER');
    expect(ragOf(75)).toBe('AMBER');
    expect(ragOf(74.99)).toBe('RED');
    expect(ragOf(null)).toBe('NONE');
  });
  it('achievement: higher-good, lower-good and no target', () => {
    expect(achievementPct(1875000, 2500000, 'HIGHER_GOOD')).toBe(75);
    expect(achievementPct(2, 3, 'LOWER_GOOD')).toBe(150);
    expect(achievementPct(0, 3, 'LOWER_GOOD')).toBe(100);
    expect(achievementPct(5, null, 'HIGHER_GOOD')).toBeNull();
    expect(achievementPct(5, 0, 'HIGHER_GOOD')).toBeNull();
  });
  it('totals only for amounts and counts; alerts cross correctly', () => {
    expect(isAdditive('inr')).toBe(true);
    expect(isAdditive('pct')).toBe(false);
    expect(alertCrossed('GT', 4.2, 3, null)).toBe(true);
    expect(alertCrossed('LT', 4.2, 3, null)).toBe(false);
    expect(alertCrossed('BELOW_TARGET', 80, null, 100)).toBe(true);
    expect(alertCrossed('GT', null, 3, null)).toBe(false);
  });
  it('daily schedule: cron shape and due time', () => {
    expect(parseDailyCron('0 8 * * *')).toEqual({ minute: 0, hour: 8 });
    expect(parseDailyCron('*/5 * * * *')).toBeNull();
    const cron = { minute: 0, hour: 8 };
    // 08:00 IST = 02:30 UTC
    expect(dailyDue(cron, new Date('2026-11-13T02:00:00Z'), null)).toBe(false);
    expect(dailyDue(cron, new Date('2026-11-13T03:00:00Z'), null)).toBe(true);
    expect(dailyDue(cron, new Date('2026-11-13T03:00:00Z'), new Date('2026-11-13T02:40:00Z'))).toBe(false);
  });
});

describe('work movement rules (pure)', () => {
  it('state machine: legal and illegal moves', () => {
    expect(nextState('SENT', 'receive')).toBe('RECEIVED');
    expect(nextState('RECEIVED', 'accept')).toBe('ACCEPTED');
    expect(nextState('ACCEPTED', 'forward')).toBe('FORWARDED');
    expect(nextState('RECEIVED', 'return')).toBe('RETURNED');
    expect(nextState('SENT', 'recall')).toBe('RECALLED');
    expect(nextState('SENT', 'accept')).toBeNull();
    expect(nextState('RECEIVED', 'recall')).toBeNull();
    expect(nextState('COMPLETED', 'forward')).toBeNull();
    expect(isOpen('IN_WORK')).toBe(true);
    expect(isOpen('FORWARDED')).toBe(false);
  });
  it('SLA skips Sunday: Friday 16:00 + 2 days = Monday 16:00', () => {
    // Friday 2026-11-13 16:00 IST = 10:30 UTC
    const due = addWorkingDays(new Date('2026-11-13T10:30:00Z'), 2);
    expect(due.toISOString()).toBe('2026-11-16T10:30:00.000Z');
  });
  it('SLA skips a holiday', () => {
    const due = addWorkingDays(new Date('2026-11-13T10:30:00Z'), 2, new Set(['2026-11-14']));
    expect(due.toISOString()).toBe('2026-11-17T10:30:00.000Z');
  });
  it('late levels: on time, late, twice the SLA', () => {
    const sent = new Date('2026-11-13T10:30:00Z');
    const due = new Date('2026-11-15T10:30:00Z');
    expect(lateLevel(sent, due, new Date('2026-11-14T10:30:00Z'))).toBe(0);
    expect(lateLevel(sent, due, new Date('2026-11-16T10:30:00Z'))).toBe(1);
    expect(lateLevel(sent, due, new Date('2026-11-18T10:30:00Z'))).toBe(2);
  });
});

describe('plants, menu, home, dashboards and movements (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  let van = '';
  const made: string[] = [];
  const get = (token: string, path: string, h: Record<string, string> = {}) =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h);
  const send = (method: 'post' | 'put' | 'patch' | 'delete', token: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h).send(body as object);

  beforeAll(async () => {
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = '', van = ''] = await unitIds(['TAL', 'SAW', 'VAR']);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM kpi_targets WHERE kpi_code = 'sales_invoiced_mtd'`;
    await prisma.$executeRaw`DELETE FROM dashboard_tv_tokens`;
    await prisma.$executeRaw`DELETE FROM work_movements WHERE doc_type = 'p2325-test'`;
    for (const id of made) {
      await prisma.$executeRaw`DELETE FROM user_preferences WHERE user_id = ${id}::uuid`;
    }
  });

  it('a two-plant user: picker data, own choice, and crafted plants are refused', async () => {
    const u = await makeUser({ department: 'Production', unitCodes: ['TAL', 'SAW'], defaultUnitCode: 'TAL' });
    made.push(u.id);
    const { token } = await signIn(app, u);
    const p = await get(token, '/me/plants');
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.data.allowed).toHaveLength(2);
    expect(p.body.data.needsPicker).toBe(true);
    expect(p.body.data.accessType).toBe('Multi-plant');
    const none = await send('put', token, '/me/plants', { selected: [], remember: false });
    expect(none.status).toBe(422);
    const bad = await send('put', token, '/me/plants', { selected: [van], remember: false });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('UNIT_NOT_ALLOWED');
    const ok = await send('put', token, '/me/plants', { selected: [tal, saw], remember: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.selected.sort()).toEqual([tal, saw].sort());
    expect(ok.body.data.needsPicker).toBe(false);
    // the header: two allowed plants work, a plant outside the user's access is refused
    expect((await get(token, '/me/home', { 'X-Units': 'TAL,SAW' })).status).toBe(200);
    const crafted = await get(token, '/me/home', { 'X-Units': 'TAL,VAR' });
    expect(crafted.status).toBe(403);
    expect(crafted.body.error.code).toBe('UNIT_NOT_ALLOWED');
  });

  it('Admin sets plants: summary, default must be ticked, all plants ticks every box', async () => {
    const u = await makeUser({ department: 'Sales', unitCodes: ['TAL'], defaultUnitCode: 'TAL' });
    made.push(u.id);
    const ok = await send('put', ownerToken, `/users/${u.id}/plants`, { unitIds: [tal, saw], allUnits: false, defaultUnitId: tal });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.summary).toMatch(/can work in .* and /);
    const bad = await send('put', ownerToken, `/users/${u.id}/plants`, { unitIds: [tal], allUnits: false, defaultUnitId: saw });
    expect(bad.status).toBe(422);
    const none = await send('put', ownerToken, `/users/${u.id}/plants`, { unitIds: [], allUnits: false, defaultUnitId: null });
    expect(none.status).toBe(422);
    const all = await send('put', ownerToken, `/users/${u.id}/plants`, { unitIds: [], allUnits: true, defaultUnitId: tal });
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const rows = await prisma.userUnit.count({ where: { userId: u.id } });
    expect(rows).toBeGreaterThanOrEqual(3);
  });

  it('Menu, favourites, search and Home', async () => {
    const u = await makeUser({ department: 'Sales', unitCodes: ['TAL'] });
    made.push(u.id);
    const { token } = await signIn(app, u);
    const menu = await get(token, '/me/menu-v2');
    expect(menu.status, JSON.stringify(menu.body)).toBe(200);
    expect(Array.isArray(menu.body.data.families)).toBe(true);
    const page = menu.body.data.families[0]?.pages[0]?.id as string | undefined;
    if (page) {
      const fav = await send('post', token, `/me/favourites/${page}`);
      expect(fav.status).toBe(201);
      expect(fav.body.data.favourites).toContain(page);
      const del = await send('delete', token, `/me/favourites/${page}`);
      expect(del.body.data.favourites).not.toContain(page);
    }
    expect((await send('post', token, '/me/favourites/not-a-page')).status).toBe(404);
    expect((await get(token, '/me/search?q=a')).body.data.pages).toEqual([]);
    const home = await get(token, '/me/home', { 'X-Unit-Id': tal });
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    expect(typeof home.body.data.work.myApprovals).toBe('number');
    expect(home.body.data.work.myTasks).toBeNull();
  });

  it('dashboards: plant grid, a target sets the colour, TV link is read-only', async () => {
    const grid = await get(ownerToken, '/dashboards/plant', { 'X-Units': 'TAL,SAW' });
    expect(grid.status, JSON.stringify(grid.body)).toBe(200);
    expect(grid.body.data.plants).toHaveLength(2);
    expect(grid.body.data.rows.length).toBeGreaterThan(0);
    const set = await send('post', ownerToken, '/kpi-targets', { kpiCode: 'sales_invoiced_mtd', unitId: tal, periodKind: 'MONTH', target: 100 });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    const redo = await send('post', ownerToken, '/kpi-targets', { kpiCode: 'sales_invoiced_mtd', unitId: tal, periodKind: 'MONTH', target: 200 });
    expect(redo.status).toBe(201);
    const after = await get(ownerToken, '/dashboards/plant', { 'X-Unit-Id': tal });
    const row = after.body.data.rows.find((r: { code: string }) => r.code === 'sales_invoiced_mtd');
    expect(row.cells[0].target).toBe(200);
    expect(['GREEN', 'AMBER', 'RED']).toContain(row.cells[0].rag);
    const badLimit = await send('post', ownerToken, '/kpi-targets', { kpiCode: 'sales_invoiced_mtd', periodKind: 'MONTH', target: 1, amberPct: 50, redPct: 80 });
    expect(badLimit.status).toBe(422);
    const tv = await send('post', ownerToken, '/dashboards/plant/tv-token', { unitId: tal });
    expect(tv.status, JSON.stringify(tv.body)).toBe(201);
    const token = tv.body.data.token as string;
    expect((await request(app).get(`${API}/tv/plant?token=${token}`)).status).toBe(200);
    expect((await request(app).get(`${API}/tv/plant?token=wrong-token-value-123`)).status).toBe(401);
    expect((await request(app).post(`${API}/tv/plant?token=${token}`).set(XRW)).status).toBe(405);
    const newer = await send('post', ownerToken, '/dashboards/plant/tv-token', { unitId: tal });
    expect(newer.status).toBe(201);
    expect((await request(app).get(`${API}/tv/plant?token=${token}`)).status).toBe(401); // rotated: the old link stopped
  });

  it('movement: send, receive, accept, return rules, recall, short receipt, one open per document', async () => {
    const sales = await makeUser({ department: 'Sales', unitCodes: ['TAL', 'SAW'] });
    const prod = await makeUser({ department: 'Production', unitCodes: ['TAL', 'SAW'] });
    made.push(sales.id, prod.id);
    const salesTok = (await signIn(app, sales)).token;
    const prodTok = (await signIn(app, prod)).token;
    const depts = (await get(ownerToken, '/work/departments')).body.data as { id: string; name: string }[];
    const production = depts.find((d) => d.name === 'Production')?.id ?? '';
    const salesDept = depts.find((d) => d.name === 'Sales')?.id ?? '';
    const warehouse = depts.find((d) => d.name === 'Warehouse')?.id ?? '';
    expect(production).not.toBe('');
    const doc = randomUUID();
    const h = { 'X-Unit-Id': tal };

    // no user in the target department for a plant: the Warehouse has nobody in this test database -> refused
    const empty = await send('post', ownerToken, '/work/movements', { docType: 'p2325-test', docId: randomUUID(), fromDepartmentId: salesDept, toDepartmentId: warehouse }, h);
    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty.body)).toMatch(/no active user/);

    const sent = await send('post', ownerToken, '/work/movements', { docType: 'p2325-test', docId: doc, docNo: 'T-1', fromDepartmentId: salesDept, toDepartmentId: production, handoverNote: 'please start' }, h);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.data.state).toBe('SENT');
    expect(sent.body.data.number).toMatch(/^MOV/);
    const id = sent.body.data.id as string;

    // a second Move Forward while it is still SENT: refused, only one open movement
    const again = await send('post', ownerToken, '/work/movements', { docType: 'p2325-test', docId: doc, fromDepartmentId: salesDept, toDepartmentId: production }, h);
    expect(again.status).toBe(409);

    // it shows under Production's "To Receive", not under Sales
    const inbox = await get(prodTok, '/work/inbox?tab=receive', h);
    expect(inbox.body.data.rows.map((r: { id: string }) => r.id)).toContain(id);
    // Sales cannot receive it
    const wrong = await send('post', salesTok, `/work/movements/${id}/receive`, {}, h);
    expect(wrong.status).toBe(403);
    expect(JSON.stringify(wrong.body)).toMatch(/Only Production can mark this Received/);
    // accept before receive is not possible
    expect((await send('post', prodTok, `/work/movements/${id}/accept`, {}, h)).status).toBe(409);

    const rec = await send('post', prodTok, `/work/movements/${id}/receive`, {}, h);
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(rec.body.data.state).toBe('RECEIVED');
    const dup = await send('post', prodTok, `/work/movements/${id}/receive`, {}, h);
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).toMatch(/Already received by/);
    // return needs a real reason
    const shortReason = await send('post', prodTok, `/work/movements/${id}/return`, { reason: 'no' }, h);
    expect(shortReason.status).toBe(422);
    const acc = await send('post', prodTok, `/work/movements/${id}/accept`, {}, h);
    expect(acc.body.data.state).toBe('ACCEPTED');

    // the history carries the times of each step
    const hist = await get(ownerToken, '/work/docs/p2325-test/' + doc + '/movement', h);
    const events = (hist.body.data.events as { event: string }[]).map((e) => e.event);
    expect(events).toEqual(['SENT', 'RECEIVE', 'ACCEPT']);
    expect(hist.body.data.holder.department).toBe('Production');

    // returning creates a new SENT movement back to the sender
    const ret = await send('post', prodTok, `/work/movements/${id}/return`, { reason: 'Drawing is missing the revision' }, h);
    expect(ret.status, JSON.stringify(ret.body)).toBe(200);
    expect(ret.body.data.state).toBe('RETURNED');
    const after = await get(ownerToken, '/work/docs/p2325-test/' + doc + '/movement', h);
    const open = (after.body.data.movements as { state: string; to_department: string }[]).filter((m) => m.state === 'SENT');
    expect(open).toHaveLength(1);
    expect(open[0]?.to_department).toBe('Sales');

    // recall: the sender takes back a SENT movement
    const doc2 = randomUUID();
    const m2 = await send('post', ownerToken, '/work/movements', { docType: 'p2325-test', docId: doc2, fromDepartmentId: salesDept, toDepartmentId: production }, h);
    const recall = await send('post', ownerToken, `/work/movements/${m2.body.data.id}/recall`, {}, h);
    expect(recall.status, JSON.stringify(recall.body)).toBe(200);
    expect(recall.body.data.state).toBe('RECALLED');

    // plant to plant: 100 sent, 96 received -> a reason is needed, then a SHORT_RECEIPT event exists
    const doc3 = randomUUID();
    const phys = await send('post', ownerToken, '/work/movements', {
      docType: 'p2325-test', docId: doc3, fromDepartmentId: salesDept, toDepartmentId: production, toUnitId: saw, isPhysical: true,
      lines: [{ description: 'Shafts', qty: 100, uom: 'Nos' }],
    }, h);
    expect(phys.status, JSON.stringify(phys.body)).toBe(201);
    const noReason = await send('post', prodTok, `/work/movements/${phys.body.data.id}/receive`, { lines: [{ lineNo: 1, receivedQty: 96 }] }, h);
    expect(noReason.status).toBe(422);
    const full = await send('post', prodTok, `/work/movements/${phys.body.data.id}/receive`, { lines: [{ lineNo: 1, receivedQty: 96, shortReason: '4 damaged in transit' }] }, h);
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    const hist3 = await get(ownerToken, '/work/docs/p2325-test/' + doc3 + '/movement', h);
    expect((hist3.body.data.events as { event: string; note: string }[]).some((e) => e.event === 'SHORT_RECEIPT' && /Short receipt 4/.test(e.note))).toBe(true);
  });

  it('Workflow Matrix: a rule controls the suggestion', async () => {
    const depts = (await get(ownerToken, '/work/departments')).body.data as { id: string; name: string }[];
    const projects = depts.find((d) => d.name === 'Projects')?.id ?? '';
    const save = await send('put', ownerToken, '/work/workflow-rules/p2325-matrix', { nextDepartmentId: projects, slaDays: 1.5 });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    const s = await get(ownerToken, '/work/workflow-rules/suggest?docType=p2325-matrix');
    expect(s.body.data).toMatchObject({ department: 'Projects', source: 'RULE' });
    await prisma.$executeRaw`DELETE FROM workflow_rules WHERE module_id = 'p2325-matrix'`;
    const v18 = await get(ownerToken, '/work/workflow-rules/suggest?docType=scm-grn');
    expect(['RULE', 'V18']).toContain(v18.body.data.source);
  });
});
