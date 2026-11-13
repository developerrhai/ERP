/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// Phase 26: project spine (gates, specs, tests, documents, history), 360 order view, exceptions, enquiries.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gateMessage, gateMissing, gatesToOpen, progressPct, PROGRESS_WEIGHTS, readinessPct, testResult } from '../src/modules/spine/calc';
import { API, XRW, makeUser, newApp, prisma, signIn, signInOwner, unitIds } from './helpers';

describe('Phase 26 rules (pure)', () => {
  it('progress weights add up to 100 and the spec example is 47.5 %', () => {
    expect(Object.values(PROGRESS_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(progressPct({ order: 1, material: 1, production: 0.5 })).toBe(47.5);
    expect(progressPct({})).toBe(0);
    expect(progressPct({ order: 1, material: 1, production: 1, quality: 1, dispatch: 1, billing: 1, collection: 1 })).toBe(100);
    expect(progressPct({ order: 5 })).toBe(5); // clamped to 0..1
  });
  it('gate readiness text and ring', () => {
    const f = { code: 'G03', deliverableDocType: 'SPEC', deliverableApproved: false, testsTotal: 2, testsNotPassed: 2, blockedBy: [] };
    expect(gateMessage('G03', gateMissing(f))).toBe('Gate G03 needs: approved SPEC, 2 tests passed.');
    expect(gateMissing({ ...f, deliverableApproved: true, testsNotPassed: 0 })).toEqual([]);
    expect(gateMissing({ ...f, blockedBy: ['G02'] })[0]).toBe('gates G02 approved');
    expect(readinessPct({ ...f, deliverableApproved: true, testsNotPassed: 0 })).toBe(100);
    expect(readinessPct(f)).toBe(33);
  });
  it('test result against target and tolerance', () => {
    const s = { target: 10, tolMinus: 0.5, tolPlus: 0.5 };
    expect(testResult(10.5, s)).toBe('OK');
    expect(testResult(9.5, s)).toBe('OK');
    expect(testResult(10.51, s)).toBe('NG');
    expect(testResult(9.49, s)).toBe('NG');
    expect(testResult(5, { target: null, tolMinus: null, tolPlus: null })).toBeNull();
  });
  it('approving a gate opens only the gates whose dependencies are all approved', () => {
    const gates = [
      { code: 'G01', state: 'APPROVED', dependsOn: [] },
      { code: 'G02', state: 'OPEN', dependsOn: ['G01'] },
      { code: 'G03', state: 'LOCKED', dependsOn: ['G02'] },
      { code: 'G04', state: 'LOCKED', dependsOn: ['G02', 'G05'] },
    ];
    expect(gatesToOpen(gates, 'G02')).toEqual(['G03']);
  });
});

describe('Phase 26 (API)', () => {
  const app = newApp();
  let ownerToken = '';
  let tal = '';
  let saw = '';
  let customerId = '';
  const projects: string[] = [];
  const soIds: string[] = [];
  const get = (token: string, path: string, h: Record<string, string> = {}) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).set(h);
  const send = (method: 'post' | 'put' | 'delete', token: string, path: string, body?: unknown) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set(XRW).send(body as object);

  beforeAll(async () => {
    ownerToken = (await signInOwner(app)).token;
    [tal = '', saw = ''] = await unitIds(['TAL', 'SAW']);
    const code = `T26${Date.now().toString().slice(-6)}`;
    const c = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO customers (code, name, name_key, state_code, gst_registration_type) VALUES ($1, $2, $2, '27', 'UNREGISTERED') RETURNING id`,
      code,
      `TEST26 ${code}`,
    );
    customerId = c[0]!.id;
    // the gate page approves itself in tests (the approval matrix is the admin's job in production)
    await prisma.$executeRaw`INSERT INTO module_controls (page_id, owner_department, approval_required, updated_at) VALUES ('proj-stage-gates', 'Projects', false, now())
      ON CONFLICT (page_id) DO UPDATE SET approval_required = false`;
  });

  afterAll(async () => {
    for (const id of soIds) await prisma.$executeRawUnsafe(`DELETE FROM sales_orders WHERE id = $1::uuid`, id);
    for (const id of projects) {
      await prisma.$executeRawUnsafe(`DELETE FROM approval_requests WHERE doc_type = 'proj-stage-gates' AND doc_id IN (SELECT id FROM project_gates WHERE project_id = $1::uuid)`, id).catch(() => 0);
      await prisma.$executeRawUnsafe(`DELETE FROM project_events WHERE project_id = $1::uuid`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM sales_enquiries WHERE project_id = $1::uuid`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM projects WHERE id = $1::uuid`, id);
    }
    if (customerId) {
      await prisma.$executeRawUnsafe(`DELETE FROM sales_enquiries WHERE customer_id = $1::uuid`, customerId);
      await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE id = $1::uuid`, customerId);
    }
    await prisma.$executeRaw`DELETE FROM sales_enquiries WHERE prospect_name LIKE 'TEST26%'`;
    await prisma.$executeRaw`DELETE FROM process_exceptions WHERE doc_no LIKE '%T26%'`;
  });

  it('enquiry: needs a party, a lost reason, and is numbered ENQ/<plant>/<year>/0001', async () => {
    const none = await send('post', ownerToken, '/sales/enquiries', { product: 'BLDC motor' });
    expect(none.status).toBe(422);
    const ok = await send('post', ownerToken, '/sales/enquiries', { prospectName: 'TEST26 Prospect', product: '24V BLDC', qty: 10, projectTemplate: 'BLDC', unitId: tal });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.number).toMatch(/^ENQ\/TAL\/.+\/\d{4,}$/);
    const id = ok.body.data.id as string;
    const lostNoReason = await send('post', ownerToken, `/sales/enquiries/${id}/mark-lost`, {});
    expect(lostNoReason.status).toBe(422);
    const lost = await send('post', ownerToken, `/sales/enquiries/${id}/mark-lost`, { lostReason: 'Price too high' });
    expect(lost.status, JSON.stringify(lost.body)).toBe(200);
    expect(lost.body.data.status).toBe('Lost');
    const again = await send('post', ownerToken, `/sales/enquiries/${id}/mark-lost`, { lostReason: 'x' });
    expect(again.status).toBe(409);
    // a prospect has no customer: the quotation asks for one first
    const e2 = await send('post', ownerToken, '/sales/enquiries', { prospectName: 'TEST26 Prospect 2', product: 'SPPM', unitId: tal });
    const q = await send('post', ownerToken, `/sales/enquiries/${e2.body.data.id}/to-quotation`);
    expect(q.status).toBe(422);
    expect(JSON.stringify(q.body)).toMatch(/customer/i);
  });

  it('enquiry -> project with the BLDC template: 15 gates, G01 open, the rest locked; gate rules, approval and opening', async () => {
    const e = await send('post', ownerToken, '/sales/enquiries', { customerId, product: 'TEST26 24V BLDC', unitId: tal, projectTemplate: 'BLDC' });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    const p = await send('post', ownerToken, `/sales/enquiries/${e.body.data.id}/to-project`, {});
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const pid = p.body.data.project.id as string;
    projects.push(pid);
    const gates = await get(ownerToken, `/projects/${pid}/gates`);
    expect(gates.status, JSON.stringify(gates.body)).toBe(200);
    expect(gates.body.data).toHaveLength(15);
    expect(gates.body.data[0].state).toBe('OPEN');
    expect(gates.body.data.slice(1).every((g: { state: string }) => g.state === 'LOCKED')).toBe(true);
    const g1 = gates.body.data[0] as { id: string; code: string };
    const g2 = gates.body.data[1] as { id: string; code: string };
    expect(g1.code).toBe('BLDC-G01');
    // a second template on the same project is refused
    expect((await send('post', ownerToken, `/projects/${pid}/gates`, { template: 'SPPM' })).status).toBe(409);
    // a locked gate cannot be submitted
    const locked = await send('post', ownerToken, `/projects/${pid}/gates/${g2.id}/submit`);
    expect(locked.status).toBe(409);
    // G01 needs an approved URS
    const need = await send('post', ownerToken, `/projects/${pid}/gates/${g1.id}/submit`);
    expect(need.status).toBe(422);
    expect(JSON.stringify(need.body)).toContain('Gate BLDC-G01 needs: approved URS.');
    // add and approve the URS, plus one failing test: still blocked by the test
    const doc = await send('post', ownerToken, `/projects/${pid}/documents`, { docType: 'URS', title: 'URS rev A', gateId: g1.id });
    expect(doc.status, JSON.stringify(doc.body)).toBe(201);
    expect((await send('post', ownerToken, `/projects/${pid}/documents/${doc.body.data.id}/approve`)).status).toBe(200);
    const spec = await send('post', ownerToken, `/projects/${pid}/specs`, { parameter: 'Rated speed', target: 1500, tolMinus: 30, tolPlus: 30, unit: 'rpm' });
    expect(spec.status, JSON.stringify(spec.body)).toBe(201);
    const ng = await send('post', ownerToken, `/projects/${pid}/tests`, { testName: 'Speed', gateId: g1.id, specId: spec.body.data.id, value: 1600 });
    expect(ng.body.data.result).toBe('NG');
    const blocked = await send('post', ownerToken, `/projects/${pid}/gates/${g1.id}/submit`);
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain('1 test passed');
    // a passing test too: one NG still blocks (all tests of the gate must pass)
    await send('post', ownerToken, `/projects/${pid}/tests`, { testName: 'Speed again', gateId: g1.id, specId: spec.body.data.id, value: 1510 });
    expect((await send('post', ownerToken, `/projects/${pid}/gates/${g1.id}/submit`)).status).toBe(422);
    // fix: remove the failing row (a re-test replaces it), then submit
    await prisma.$executeRawUnsafe(`DELETE FROM project_tests WHERE gate_id = $1::uuid AND result = 'NG'`, g1.id);
    const sub = await send('post', ownerToken, `/projects/${pid}/gates/${g1.id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    // approved (auto, module control off): G02 is now OPEN and G03 still LOCKED
    const after = await get(ownerToken, `/projects/${pid}/gates`);
    const byCode = Object.fromEntries((after.body.data as { code: string; state: string }[]).map((g) => [g.code, g.state]));
    expect(byCode['BLDC-G01']).toBe('APPROVED');
    expect(byCode['BLDC-G02']).toBe('OPEN');
    expect(byCode['BLDC-G03']).toBe('LOCKED');
    // history shows both events, newest first
    const hist = await get(ownerToken, `/projects/${pid}/history`);
    expect(hist.status).toBe(200);
    const kinds = (hist.body.data as { kind: string }[]).map((x) => x.kind);
    expect(kinds).toContain('GATE_APPROVED');
    expect(kinds).toContain('GATE_OPENED');
    // dossier PDF and history workbook
    const pdf = await request(app).get(`${API}/projects/${pid}/dossier.pdf`).set('Authorization', `Bearer ${ownerToken}`).set(XRW).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const xlsx = await get(ownerToken, `/projects/${pid}/history/export.xlsx`);
    expect(xlsx.status).toBe(200);
  });

  it('spec revision supersedes the old row; a document revision supersedes the old document', async () => {
    const e = await send('post', ownerToken, '/sales/enquiries', { customerId, product: 'TEST26 SPPM', unitId: tal });
    const p = await send('post', ownerToken, `/sales/enquiries/${e.body.data.id}/to-project`, { template: 'CUSTOM' });
    const pid = p.body.data.project.id as string;
    projects.push(pid);
    expect((await get(ownerToken, `/projects/${pid}/gates`)).body.data).toHaveLength(0); // CUSTOM starts empty
    const s = await send('post', ownerToken, `/projects/${pid}/specs`, { parameter: 'Cycle time', target: 6, tolMinus: 0.2, tolPlus: 0.2, unit: 's' });
    const r = await send('post', ownerToken, `/projects/${pid}/specs/${s.body.data.id}/revise`, { target: 5.8 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.revision).toBe(2);
    const list = await get(ownerToken, `/projects/${pid}/specs`);
    expect((list.body.data as { status: string }[]).filter((x) => x.status === 'Superseded')).toHaveLength(1);
    await send('post', ownerToken, `/projects/${pid}/documents`, { docType: 'CHARTER', title: 'Charter' });
    const d2 = await send('post', ownerToken, `/projects/${pid}/documents`, { docType: 'CHARTER', title: 'Charter' });
    expect(d2.body.data.revision).toBe(2);
    const docs = await get(ownerToken, `/projects/${pid}/documents`);
    expect((docs.body.data as { status: string }[]).filter((x) => x.status === 'Superseded')).toHaveLength(1);
  });

  it('history: an event of another plant is masked for a user who may not see it', async () => {
    const e = await send('post', ownerToken, '/sales/enquiries', { customerId, product: 'TEST26 mask', unitId: tal });
    const p = await send('post', ownerToken, `/sales/enquiries/${e.body.data.id}/to-project`, { template: 'CUSTOM' });
    const pid = p.body.data.project.id as string;
    projects.push(pid);
    await prisma.$executeRawUnsafe(`INSERT INTO project_events (project_id, unit_id, kind, doc_no, text, source_event_id) VALUES ($1::uuid, $2::uuid, 'NOTE', 'T26-X', 'secret saw text', $3)`, pid, saw, `t26:${randomUUID()}`);
    const u = await makeUser({ department: 'Projects', unitCodes: ['TAL'], defaultUnitCode: 'TAL', roleCode: 'SUPER_ADMIN' }).catch(() => makeUser({ department: 'Projects', unitCodes: ['TAL'], defaultUnitCode: 'TAL' }));
    const { token } = await signIn(app, u);
    const hist = await get(token, `/projects/${pid}/history`);
    if (hist.status === 200) {
      const rows = hist.body.data as { text: string; masked: boolean }[];
      expect(JSON.stringify(rows)).not.toContain('secret saw text');
      expect(rows.some((r) => r.masked && r.text === 'Event in another plant.')).toBe(true);
    } else {
      expect([403, 404]).toContain(hist.status); // no page right: nothing leaks either way
    }
    // the owner (all plants) sees the text
    const masked = await get(ownerToken, `/projects/${pid}/history`, { 'X-Units': 'TAL' });
    expect(JSON.stringify(masked.body.data)).not.toContain('secret saw text');
    const full = await get(ownerToken, `/projects/${pid}/history`, { 'X-Units': 'TAL,SAW' });
    expect(JSON.stringify(full.body.data)).toContain('secret saw text');
    await prisma.$executeRawUnsafe(`DELETE FROM user_preferences WHERE user_id = $1::uuid`, u.id);
  });

  it('360: order, progress and stages for a sales order', async () => {
    const fy = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM financial_years ORDER BY start_date DESC LIMIT 1`);
    const so = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO sales_orders (unit_id, fy_id, number, customer_id, status) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 'Approved') RETURNING id`,
      tal, fy[0]!.id, `T26-SO-${Date.now()}`, customerId,
    );
    soIds.push(so[0]!.id);
    const r = await get(ownerToken, `/orders/${so[0]!.id}/360`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.progressPct).toBe(5); // order confirmed only
    expect(r.body.data.stages.map((s: { key: string }) => s.key)).toEqual(['enquiry', 'quotation', 'so', 'project', 'material', 'pr', 'po', 'grn', 'mo', 'quality', 'dc', 'invoice', 'collection']);
    expect(r.body.data.order.customer).toContain('TEST26');
    const missing = await get(ownerToken, `/orders/${randomUUID()}/360`);
    expect(missing.status).toBe(404);
  });

  it('exceptions: a late gate is raised under Projects and clears itself when the cause is fixed', async () => {
    const e = await send('post', ownerToken, '/sales/enquiries', { customerId, product: 'TEST26 late gate', unitId: tal });
    const p = await send('post', ownerToken, `/sales/enquiries/${e.body.data.id}/to-project`, { template: 'BLDC' });
    const pid = p.body.data.project.id as string;
    projects.push(pid);
    const gates = (await get(ownerToken, `/projects/${pid}/gates`)).body.data as { id: string }[];
    const due = await send('put', ownerToken, `/projects/${pid}/gates/${gates[0]!.id}/due`, { dueDate: '2020-01-01' });
    expect(due.status, JSON.stringify(due.body)).toBe(200);
    const run1 = await send('post', ownerToken, '/exceptions/run');
    expect(run1.status, JSON.stringify(run1.body)).toBe(200);
    const list = await get(ownerToken, '/exceptions?state=open');
    const mine = (list.body.data as { rule_code: string; doc_id: string; owner_department: string }[]).filter((x) => x.rule_code === 'GATE_LATE' && x.doc_id === gates[0]!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.owner_department).toBe('Projects');
    // running again does not duplicate it
    await send('post', ownerToken, '/exceptions/run');
    const again = await get(ownerToken, '/exceptions?state=open');
    expect((again.body.data as { rule_code: string; doc_id: string }[]).filter((x) => x.rule_code === 'GATE_LATE' && x.doc_id === gates[0]!.id)).toHaveLength(1);
    // fix the cause (a new due date): the next run resolves it by itself
    await send('put', ownerToken, `/projects/${pid}/gates/${gates[0]!.id}/due`, { dueDate: '2099-01-01' });
    await send('post', ownerToken, '/exceptions/run');
    const fixed = await get(ownerToken, '/exceptions?state=open');
    expect((fixed.body.data as { doc_id: string }[]).some((x) => x.doc_id === gates[0]!.id)).toBe(false);
    const resolved = await get(ownerToken, '/exceptions?state=resolved');
    expect((resolved.body.data as { doc_id: string; auto_resolved: boolean }[]).some((x) => x.doc_id === gates[0]!.id && x.auto_resolved)).toBe(true);
  });
});
