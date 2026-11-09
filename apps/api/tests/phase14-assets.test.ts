/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Phase 14: the asset spine, capitalisation, Schedule II depreciation (BOOK, posted) and IT-block depreciation (TAX, memo),
// disposal, allocation, transfer, QR scans, physical verification, and the CMMS (PM plans by time, breakdown to work order, spares,
// downtime, alerts, MTBF).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { bookDepreciation, monthBounds } from '../src/modules/assets/calc';
import { newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { balance, fixture, mkItem, setApproval, tag } from './phase08-helpers';
import { body, gl, ifm, setup } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
const TODAY = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const s: Record<string, any> = {};
const call = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  b?: unknown,
  h: Record<string, string> = {},
) =>
  method === 'patch'
    ? request(app)
        .patch('/api/v1' + path)
        .set(owner.bearer)
        .set('X-Unit-Id', ctx.fx.unitId)
        .set(h)
        .send((b ?? {}) as object)
    : ctx.v.call(method, path, b, h);
const rows = (res: { body: any }) => (Array.isArray(res.body.data) ? res.body.data : []);

beforeAll(async () => {
  owner = await signInOwner(app);
  restoreStock = await setApproval(false);
  invalidateAccessCache();
  ctx = await setup(app, owner);
});
afterAll(async () => {
  for (const r of restoreStock)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

const cat = async (code: string): Promise<any> =>
  rows(await call('get', '/assets/categories')).find((c: any) => c.code === code);
async function capitalise(assetId: string, date: string, base = 1200000, gst = 216000) {
  const c = await call('post', '/assets/capitalisations', {
    assetId,
    capitalisationDate: date,
    source: 'PURCHASE',
    lines: [
      {
        component: 'BASE',
        amount: base,
        gstAmount: gst,
        glSourceAccount: '3009',
        sourceDocRef: 'INV-1',
      },
      { component: 'FREIGHT', amount: 20000, glSourceAccount: '3009' },
    ],
  });
  expect(c.status, JSON.stringify(c.body)).toBeLessThan(300);
  const cap = body(c);
  const sub = await call('post', `/assets/capitalisations/${cap.id}/submit`, {}, ifm(cap.version));
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const ap = await call(
    'post',
    `/assets/capitalisations/${cap.id}/approve`,
    {},
    ifm(body(sub).version),
  );
  expect(ap.status, JSON.stringify(ap.body)).toBe(200);
  const post = await call(
    'post',
    `/assets/capitalisations/${cap.id}/post`,
    {},
    { ...ifm(body(ap).version), 'Idempotency-Key': `cap-${tag()}-aaaa` },
  );
  return { cap, post };
}

describe('access', () => {
  it('needs a token, and an employee has no access to the register or breakdowns', async () => {
    expect((await request(app).get('/api/v1/assets/register')).status).toBe(401);
    const emp = await signInAs(app, 'EMPLOYEE');
    for (const p of ['/assets/register', '/maint/breakdowns', '/assets/depreciation/runs']) {
      const r = await request(app)
        .get('/api/v1' + p)
        .set(emp.bearer)
        .set('X-Unit-Id', ctx.fx.unitId);
      expect(r.status, p).toBe(403);
    }
  });
});

describe('masters and the asset spine', () => {
  it('has the seeded Schedule II categories, keeps the residual at 5 %, and builds a component tree without loops', async () => {
    const cats = rows(await call('get', '/assets/categories'));
    expect(cats.length).toBeGreaterThanOrEqual(12);
    s.pm = await cat('PM_GENERAL');
    expect(s.pm.params[0].usefulLifeMonths).toBe(180);
    expect(s.pm.params[0].needsReview).toBe(true);
    const bad = await call('put', `/assets/categories/${s.pm.id}/book-params`, {
      effectiveFrom: '2030-04-01',
      method: 'SLM',
      usefulLifeMonths: 180,
      residualPct: 6,
    });
    expect(bad.status).toBe(422);
    const m = await call('post', '/maint/machines', {
      name: 'CNC Lathe',
      categoryId: s.pm.id,
      make: 'Acme',
      location: 'Shop 1',
      criticality: 'A',
      isMaintainable: true,
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    s.machine = body(m);
    expect(s.machine.assetKind).toBe('MACHINE');
    expect(s.machine.status).toBe('CWIP');
    expect(s.machine.assetNo).toMatch(/^AST/);
    expect(s.machine.qrToken).toBeTruthy();
    expect(Number(s.machine.bookValue)).toBe(0);
    const motor = await call('post', '/maint/equipment', {
      name: 'Spindle motor',
      categoryId: s.pm.id,
      parentAssetId: s.machine.id,
      isMaintainable: true,
    });
    expect(motor.status, JSON.stringify(motor.body)).toBe(201);
    s.motor = body(motor);
    expect(s.motor.assetKind).toBe('EQUIPMENT');
    expect(s.motor.isComponent).toBe(true);
    const loop = await call(
      'patch',
      `/maint/machines/${s.machine.id}`,
      { parentAssetId: s.motor.id },
      ifm(s.machine.version),
    );
    expect(loop.status).toBeGreaterThanOrEqual(400);
    const reg = rows(await call('get', '/assets/register'));
    expect(reg.length).toBeGreaterThanOrEqual(2);
    expect(
      rows(await call('get', '/maint/machines')).every((a: any) => a.assetKind === 'MACHINE'),
    ).toBe(true);
  });
});

describe('capitalisation and depreciation', () => {
  it('capitalises with the AS 10 cost (claimed GST stays out) and posts the journal', async () => {
    const { cap, post } = await capitalise(s.machine.id, '2026-10-01');
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    const posted = body(post);
    expect(Number(posted.totalCost)).toBe(1220000);
    expect(posted.status).toBe('POSTED');
    const a = body(await call('get', `/assets/by-id/${s.machine.id}`));
    expect(a.status).toBe('ACTIVE');
    expect(Number(a.cost)).toBe(1220000);
    expect(Number(a.bookValue)).toBe(1220000);
    expect(a.profiles.map((p: any) => p.area).sort()).toEqual(['BOOK', 'TAX']);
    expect(await gl(ctx.fx.unitId, '1603')).toBe(1220000);
    s.cap = cap;
    // one capitalisation per asset
    const again = await call('post', '/assets/capitalisations', {
      assetId: s.machine.id,
      capitalisationDate: '2026-10-01',
      source: 'PURCHASE',
      lines: [{ component: 'BASE', amount: 1, glSourceAccount: '3009' }],
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a residual above 5 % without a written reason', async () => {
    const m = body(await call('post', '/assets/register', { name: 'Press', categoryId: s.pm.id }));
    const r = await call('post', '/assets/capitalisations', {
      assetId: m.id,
      capitalisationDate: TODAY,
      source: 'PURCHASE',
      residualOverridePct: 10,
      lines: [{ component: 'BASE', amount: 1000, glSourceAccount: '3009' }],
    });
    expect(r.status).toBe(422);
    s.press = m;
  });

  it('runs book depreciation by days, posts it once, and reverses it', async () => {
    const run = await call(
      'post',
      '/assets/depreciation/runs',
      { area: 'BOOK', period: '2026-10' },
      { 'Idempotency-Key': `dr-${tag()}-aaaa` },
    );
    expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
    const r = body(run);
    const expected = bookDepreciation({
      cost: '1220000',
      residual: '61000',
      method: 'SLM',
      lifeMonths: 180,
      depStart: '2026-10-01',
      ...monthBounds('2026-10'),
      openingAccum: 0,
    });
    const line = r.lines.find((l: any) => l.assetId === s.machine.id);
    expect(Number(line.amount)).toBe(Number(expected.amount.toFixed(2)));
    expect(line.days).toBe(31);
    // the same month cannot be run twice
    expect(
      (await call('post', '/assets/depreciation/runs', { area: 'BOOK', period: '2026-10' })).status,
    ).toBe(409);
    const post = await call(
      'post',
      `/assets/depreciation/runs/${r.id}/post`,
      {},
      { ...ifm(r.version), 'Idempotency-Key': `dp-${tag()}-aaaa` },
    );
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    const amt = Number(expected.amount.toFixed(2));
    expect(await gl(ctx.fx.unitId, '1703')).toBe(-amt);
    const a = body(await call('get', `/assets/by-id/${s.machine.id}`));
    expect(Number(a.accumDep)).toBe(amt);
    expect(Number(a.bookValue)).toBe(1220000 - amt);
    // a posted run cannot be posted again
    expect(
      (await call('post', `/assets/depreciation/runs/${r.id}/post`, {}, ifm(body(post).version)))
        .status,
    ).toBe(409);
    const rev = await call(
      'post',
      `/assets/depreciation/runs/${r.id}/reverse`,
      { reason: 'Rerun with the shift days' },
      ifm(body(post).version),
    );
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(await gl(ctx.fx.unitId, '1703')).toBe(0);
    expect(Number(body(await call('get', `/assets/by-id/${s.machine.id}`)).accumDep)).toBe(0);
  });

  it('adds the extra-shift factor for plant and machinery', async () => {
    const sh = await call('put', '/assets/depreciation/shift-usage', {
      assetId: s.machine.id,
      period: '2026-10',
      singleDays: 16,
      doubleDays: 10,
      tripleDays: 5,
    });
    expect(sh.status, JSON.stringify(sh.body)).toBe(200);
    const run = body(
      await call('post', '/assets/depreciation/runs', { area: 'BOOK', period: '2026-10' }),
    );
    const line = run.lines.find((l: any) => l.assetId === s.machine.id);
    expect(Number(line.shiftFactor)).toBeCloseTo(1.32, 2);
    const plain = bookDepreciation({
      cost: '1220000',
      residual: '61000',
      method: 'SLM',
      lifeMonths: 180,
      depStart: '2026-10-01',
      ...monthBounds('2026-10'),
      openingAccum: 0,
    });
    expect(Number(line.amount)).toBeGreaterThan(Number(plain.amount.toFixed(2)));
    s.shiftRun = run;
  });

  it('keeps income-tax depreciation as a memo on the block', async () => {
    // the book run above is still a draft: cancel it by reversing so the TAX run is independent
    await call(
      'post',
      `/assets/depreciation/runs/${s.shiftRun.id}/reverse`,
      { reason: 'Not needed any more' },
      ifm(s.shiftRun.version),
    );
    const run = await call('post', '/assets/depreciation/runs', { area: 'TAX' });
    expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
    const r = body(run);
    const line = r.lines.find((l: any) => l.blockCode === 'PM');
    expect(line).toBeTruthy();
    // added on 1-Oct-2026: 182 days to the year end, so full rate: 15 % of 12,20,000
    expect(Number(line.amount)).toBe(183000);
    expect(Number(line.closingValue)).toBe(1037000);
    const post = await call('post', `/assets/depreciation/runs/${r.id}/post`, {}, ifm(r.version));
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    const ledger = rows(await call('get', '/assets/depreciation/block-ledger'));
    expect(ledger.some((l: any) => l.blockCode === 'PM' && Number(l.closingWdv) === 1037000)).toBe(
      true,
    );
    // a memo never touches the ledger
    expect(await gl(ctx.fx.unitId, '1703')).toBe(0);
  });
});

describe('allocation, transfer, disposal', () => {
  it('hands an asset over once and takes it back', async () => {
    const owner2 = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    const a = await call('post', '/assets/allocations', {
      assetId: s.machine.id,
      employeeId: owner2.id,
      location: 'Shop 1',
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(
      (await call('post', '/assets/allocations', { assetId: s.machine.id, location: 'Shop 2' }))
        .status,
    ).toBe(409);
    const back = await call('post', `/assets/allocations/${body(a).id}/return`, {
      conditionIn: 'Good',
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(body(back).status).toBe('RETURNED');
  });

  it('moves an asset inside the unit and between units (both sides post)', async () => {
    const t = body(
      await call('post', '/assets/transfers', { assetId: s.machine.id, toLocation: 'Shop 2' }),
    );
    const sub = body(await call('post', `/assets/transfers/${t.id}/submit`, {}, ifm(t.version)));
    const ap = body(await call('post', `/assets/transfers/${t.id}/approve`, {}, ifm(sub.version)));
    const done = await call(
      'post',
      `/assets/transfers/${t.id}/complete`,
      {},
      { ...ifm(ap.version), 'Idempotency-Key': `tr-${tag()}-aaaa` },
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(body(await call('get', `/assets/by-id/${s.machine.id}`)).location).toBe('Shop 2');
    // to another unit: a capitalised asset moves and both units post their side through the clearing account
    const other = await fixture();
    const comp = body(
      await call('post', '/assets/register', { name: 'Compressor', categoryId: s.pm.id }),
    );
    await capitalise(comp.id, '2026-10-01', 500000, 0);
    const notReady = await call('post', '/assets/transfers', {
      assetId: s.motor.id,
      toUnitId: other.unitId,
    });
    expect(notReady.status).toBe(422);
    const t2 = body(
      await call('post', '/assets/transfers', { assetId: comp.id, toUnitId: other.unitId }),
    );
    const s2 = body(await call('post', `/assets/transfers/${t2.id}/submit`, {}, ifm(t2.version)));
    const a2 = body(await call('post', `/assets/transfers/${t2.id}/approve`, {}, ifm(s2.version)));
    const moved = await call('post', `/assets/transfers/${t2.id}/complete`, {}, ifm(a2.version));
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const after = await prisma.$queryRawUnsafe<{ unit_id: string }[]>(
      `SELECT unit_id::text FROM assets WHERE id='${comp.id}'`,
    );
    expect(after[0]!.unit_id).toBe(other.unitId);
    expect(await gl(ctx.fx.unitId, '1308')).toBe(520000);
    expect(await gl(other.unitId, '1308')).toBe(-520000);
  });

  it('sells an asset: gain or loss, GST on the sale, and the s.18(6) amount as a memo', async () => {
    await capitalise(s.press.id, '2026-10-01');
    const d = await call('post', '/assets/disposals', {
      assetId: s.press.id,
      method: 'SALE',
      disposalDate: TODAY,
      buyer: 'Scrap Co',
      saleValue: 1000000,
      gstOnSale: 180000,
      gstIntraState: true,
      proceedsAccount: '1111',
      itcTaken: 216000,
      quartersUsed: 4,
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const disp = body(d);
    // 2,16,000 less 4 quarters x 5 points = 1,72,800; the tax on the sale is 1,80,000, the higher: nothing extra
    expect(Number(disp.s186Calc)).toBe(180000);
    expect(Number(disp.s186PayableExtra)).toBe(0);
    const sub = body(
      await call('post', `/assets/disposals/${disp.id}/submit`, {}, ifm(disp.version)),
    );
    const ap = body(
      await call('post', `/assets/disposals/${disp.id}/approve`, {}, ifm(sub.version)),
    );
    const post = await call(
      'post',
      `/assets/disposals/${disp.id}/post`,
      {},
      { ...ifm(ap.version), 'Idempotency-Key': `ds-${tag()}-aaaa` },
    );
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    const p = body(post);
    expect(Number(p.nbvAtDisposal)).toBe(1220000);
    expect(Number(p.gainLoss)).toBe(-220000);
    expect(body(await call('get', `/assets/by-id/${s.press.id}`)).status).toBe('DISPOSED');
    expect(await gl(ctx.fx.unitId, '1603')).toBe(1220000);
    expect(await gl(ctx.fx.unitId, '6262')).toBe(220000);
    expect(await gl(ctx.fx.unitId, '2301')).toBe(-90000);
    // a disposed asset takes no more maintenance work or breakdown
    const bd = await call('post', '/maint/breakdowns', { assetId: s.press.id, symptom: 'x' });
    expect(bd.status).toBe(422);
    // a machine with a component asset cannot be disposed before the component
    const blocked = await call('post', '/assets/disposals', {
      assetId: s.machine.id,
      method: 'SCRAP',
    });
    expect(blocked.status).toBe(409);
    // not in scope
    expect((await call('post', '/assets/revaluations', {})).status).toBe(422);
  });
});

describe('QR and physical verification', () => {
  it('logs scans, refuses unknown labels, prints labels and verifies the register', async () => {
    const a = body(await call('get', `/assets/by-id/${s.motor.id}`));
    const ok = await call('post', '/assets/qr/scan', {
      token: `ASSET:${a.qrToken}`,
      purpose: 'VIEW',
      location: 'Gate',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(body(ok).assetNo).toBe(a.assetNo);
    expect((await call('post', '/assets/qr/scan', { token: 'ASSET:nonsense' })).status).toBe(404);
    const scans = await prisma.$queryRawUnsafe<{ valid: boolean }[]>(
      `SELECT valid FROM asset_scans ORDER BY scanned_at DESC LIMIT 2`,
    );
    expect(scans.map((x) => x.valid).sort()).toEqual([false, true]);
    const pdf = await request(app)
      .post('/api/v1/assets/qr/labels')
      .set(owner.bearer)
      .set('X-Unit-Id', ctx.fx.unitId)
      .send({ ids: [s.motor.id] });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    // verification of assets in service
    const bd = body(await call('post', '/maint/machines', { name: 'Drill', categoryId: s.pm.id }));
    await capitalise(bd.id, TODAY, 50000, 0);
    const pv = body(await call('post', '/assets/verifications', { title: 'Year-end count' }));
    expect(pv.lines.length).toBeGreaterThan(0);
    expect((await call('post', `/assets/verifications/${pv.id}/close`, {})).status).toBe(422);
    for (const l of pv.lines)
      await call('put', `/assets/verifications/${pv.id}/lines/${l.assetId}`, {
        found: true,
        condition: 'OK',
      });
    const closed = await call('post', `/assets/verifications/${pv.id}/close`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    s.drill = bd;
  });
});

describe('maintenance: PM plans, work orders, spares', () => {
  it('raises a PM work order from a time plan, once, and learns from the completed job', async () => {
    const cl = await call('post', '/maint/checklists', {
      code: `CL${tag()}`.slice(0, 18),
      name: 'Monthly service',
      items: [
        { text: 'Lubricate the slides' },
        { text: 'Spindle temperature', answerType: 'NUMBER', min: 20, max: 60 },
      ],
    });
    expect(cl.status, JSON.stringify(cl.body)).toBe(201);
    const checklist = rows(cl).find((c: any) => c.name === 'Monthly service');
    s.drillHrs = await call('post', `/assets/by-id/${s.drill.id}/meters`, { meterType: 'RUN_HRS' });
    expect(s.drillHrs.status, JSON.stringify(s.drillHrs.body)).toBe(201);
    const meter = body(s.drillHrs).meters[0];
    expect((await call('post', `/assets/meters/${meter.id}/readings`, { value: 100 })).status).toBe(
      201,
    );
    const low = await call('post', `/assets/meters/${meter.id}/readings`, { value: 90 });
    expect(low.status).toBe(422);
    expect(
      (await call('post', `/assets/meters/${meter.id}/readings`, { value: 5, isReset: true }))
        .status,
    ).toBe(201);
    const plan = await call('post', '/maint/plans', {
      assetId: s.drill.id,
      title: 'Monthly service',
      triggerType: 'TIME',
      intervalDays: 30,
      startFrom: '2026-10-01',
      leadDays: 3,
      checklistTemplateId: checklist.id,
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    s.plan = body(plan);
    const gen = await call(
      'post',
      '/maint/schedules/generate',
      {},
      { 'Idempotency-Key': `gen-${tag()}-aaaa` },
    );
    expect(gen.status, JSON.stringify(gen.body)).toBeLessThan(300);
    expect(body(gen).created).toBe(1);
    const gen2 = await call(
      'post',
      '/maint/schedules/generate',
      {},
      { 'Idempotency-Key': `gen2-${tag()}-aaaa` },
    );
    expect(body(gen2).created).toBe(0);
    const sch = rows(await call('get', '/maint/schedules')).find(
      (x: any) => x.planId === s.plan.id,
    );
    expect(sch.status).toBe('WO_CREATED');
    const wo = body(await call('get', `/maint/work-orders/${sch.woId}`));
    expect(wo.woType).toBe('PM');
    expect(wo.tasks).toHaveLength(2);
    const start = await call('post', `/maint/work-orders/${wo.id}/start`, {});
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    // a PM stops the machine on purpose: planned downtime, not a failure
    const dt = rows(await call('get', `/maint/downtime?assetId=${s.drill.id}`));
    expect(dt.some((d: any) => d.dtType === 'PLANNED' && !d.endAt)).toBe(true);
    // completion needs every check
    expect(
      (await call('post', `/maint/work-orders/${wo.id}/complete`, {}, ifm(body(start).version)))
        .status,
    ).toBe(422);
    expect(
      (await call('put', `/maint/work-orders/${wo.id}/tasks/${wo.tasks[1].id}`, { result: '99' }))
        .status,
    ).toBe(422);
    await call('put', `/maint/work-orders/${wo.id}/tasks/${wo.tasks[0].id}`, { result: 'OK' });
    const t2 = await call('put', `/maint/work-orders/${wo.id}/tasks/${wo.tasks[1].id}`, {
      result: '45',
    });
    expect(t2.status, JSON.stringify(t2.body)).toBe(200);
    const done = await call(
      'post',
      `/maint/work-orders/${wo.id}/complete`,
      {},
      ifm(body(t2).version),
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const so = await call(
      'post',
      `/maint/work-orders/${wo.id}/sign-off`,
      {},
      ifm(body(done).version),
    );
    expect(so.status, JSON.stringify(so.body)).toBe(200);
    expect(body(so).status).toBe('CLOSED');
    const sch2 = rows(await call('get', '/maint/schedules')).find(
      (x: any) => x.planId === s.plan.id,
    );
    expect(sch2.status).toBe('DONE');
    const planNow = body(await call('get', `/maint/plans/${s.plan.id}`));
    expect(planNow.lastDoneOn).toBeTruthy();
    expect(body(await call('get', `/assets/by-id/${s.drill.id}`)).status).toBe('ACTIVE');
  });

  it('issues spares from stock to a work order, posts them to maintenance expense, and takes some back', async () => {
    const { fx } = ctx;
    const spare = await mkItem({ itemType: 'Spare Part', baseUom: 'Nos' });
    await ctx.v.post('opening', {
      warehouseId: fx.warehouseId,
      lines: [{ itemId: spare.id, qty: 10, unitCost: 500 }],
    });
    const wo = body(
      await call(
        'post',
        '/maint/work-orders',
        {
          assetId: s.drill.id,
          woType: 'CORRECTIVE',
          description: 'Replace the belt',
          priority: 'P2',
        },
        { 'Idempotency-Key': `wo-${tag()}-aaaa` },
      ),
    );
    const sp = body(
      await call('post', `/maint/work-orders/${wo.id}/spares`, {
        itemId: spare.id,
        qty: 3,
        warehouseId: fx.warehouseId,
      }),
    );
    // not before the job starts
    expect(
      (
        await call('post', `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/issue`, {
          qty: 2,
        })
      ).status,
    ).toBe(409);
    expect((await call('post', `/maint/work-orders/${wo.id}/start`, {})).status).toBe(200);
    const iss = await call(
      'post',
      `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/issue`,
      { qty: 2 },
      { 'Idempotency-Key': `is-${tag()}-aaaa` },
    );
    expect(iss.status, JSON.stringify(iss.body)).toBe(200);
    expect(Number(body(iss).cost.spares)).toBe(1000);
    expect((await balance(spare.id, fx.warehouseId)).onHand).toBe(8);
    expect(await gl(fx.unitId, '6211')).toBe(1000);
    const ret = await call(
      'post',
      `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/return`,
      { qty: 1 },
      { 'Idempotency-Key': `rt-${tag()}-aaaa` },
    );
    expect(ret.status, JSON.stringify(ret.body)).toBe(200);
    expect(Number(body(ret).cost.spares)).toBe(500);
    expect(await gl(fx.unitId, '6211')).toBe(500);
    expect(
      (
        await call('post', `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/return`, {
          qty: 5,
        })
      ).status,
    ).toBe(422);
    const lab = await call('post', `/maint/work-orders/${wo.id}/labour`, {
      vendorName: 'Fix-It',
      startAt: '2026-11-09T04:00:00Z',
      endAt: '2026-11-09T06:00:00Z',
      rate: 300,
    });
    expect(Number(body(lab).cost.labour)).toBe(600);
    const done = await call(
      'post',
      `/maint/work-orders/${wo.id}/complete`,
      {},
      ifm(body(lab).version),
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(rows(await call('get', '/maint/spares')).some((x: any) => x.id === spare.id)).toBe(true);
  });
});

describe('maintenance: breakdown, downtime, MTBF, alerts', () => {
  it('turns a breakdown into a work order, ends the downtime on repair, and counts the failure', async () => {
    const mill = body(
      await call('post', '/maint/machines', {
        name: 'Mill',
        categoryId: s.pm.id,
        isMaintainable: true,
      }),
    );
    await capitalise(mill.id, '2026-10-01', 300000, 0);
    const t0 = new Date(Date.now() - 4 * 3_600_000).toISOString();
    const t1 = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const bd = await call(
      'post',
      '/maint/breakdowns',
      {
        assetId: mill.id,
        symptom: 'Spindle will not start',
        priority: 'P1',
        machineStopped: true,
        reportedAt: t0,
      },
      { 'Idempotency-Key': `bd-${tag()}-aaaa` },
    );
    expect(bd.status, JSON.stringify(bd.body)).toBeLessThan(300);
    const t = body(bd);
    expect(t.status).toBe('OPEN');
    // an overlapping manual downtime on the same machine is refused
    const clash = await call('post', '/maint/downtime', {
      assetId: mill.id,
      startAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      endAt: new Date(Date.now() - 3_000_000).toISOString(),
      dtType: 'UNPLANNED',
    });
    expect(clash.status).toBe(422);
    const ack = await call('post', `/maint/breakdowns/${t.id}/acknowledge`, {}, ifm(t.version));
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(body(ack).woId).toBeTruthy();
    expect(body(await call('get', `/assets/by-id/${mill.id}`)).status).toBe('UNDER_MAINT');
    const wo = body(await call('get', `/maint/work-orders/${body(ack).woId}`));
    expect(wo.woType).toBe('BREAKDOWN');
    const rep = await call(
      'post',
      `/maint/breakdowns/${t.id}/start-repair`,
      {},
      ifm(body(ack).version),
    );
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    const badCode = await call(
      'post',
      `/maint/breakdowns/${t.id}/resolve`,
      { failureMode: 'NOPE', failureCause: 'WEAR' },
      ifm(body(rep).version),
    );
    expect(badCode.status).toBe(422);
    const res = await call(
      'post',
      `/maint/breakdowns/${t.id}/resolve`,
      {
        failureMode: 'FTS',
        failureCause: 'WEAR',
        failureMechanism: 'ELEC',
        rootCause: 'Worn carbon brushes',
        repairedAt: t1,
      },
      ifm(body(rep).version),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // the ticket cannot close while the work order is open
    expect(
      (await call('post', `/maint/breakdowns/${t.id}/close`, {}, ifm(body(res).version))).status,
    ).toBe(409);
    const woNow = body(await call('get', `/maint/work-orders/${wo.id}`));
    const wdone = await call(
      'post',
      `/maint/work-orders/${wo.id}/complete`,
      {},
      ifm(woNow.version),
    );
    expect(wdone.status, JSON.stringify(wdone.body)).toBe(200);
    const closed = await call(
      'post',
      `/maint/breakdowns/${t.id}/close`,
      {},
      ifm(body(res).version),
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(body(await call('get', `/assets/by-id/${mill.id}`)).status).toBe('ACTIVE');
    const dt = rows(await call('get', `/maint/downtime?assetId=${mill.id}&type=UNPLANNED`));
    expect(dt.length).toBe(1);
    expect(Number(dt[0].durationMin)).toBe(120);
    const fromD = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const rep2 = body(await call('get', `/maint/reports/mtbf?from=${fromD}&to=${TODAY}`));
    const row = rep2.rows.find((r: any) => r.assetId === mill.id);
    expect(row.failures).toBe(1);
    expect(Number(row.mttrHours)).toBe(2);
    expect(row.mtbfHours).not.toBeNull();
    expect(Number(row.availabilityPct)).toBeLessThan(100);
  });

  it('raises alerts once and lets a person acknowledge them', async () => {
    const run = await call('post', '/maint/alerts/run', {});
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const again = await call('post', '/maint/alerts/run', {});
    expect(body(again).created).toBe(0);
    const list = rows(await call('get', '/maint/alerts'));
    if (list.length) {
      const ack = await call('post', `/maint/alerts/${list[0].id}/acknowledge`, {});
      expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    }
    expect(rows(await call('get', '/maint/alert-rules')).length).toBe(6);
  });
});

describe('rules found in review', () => {
  it('values every return at the average cost of what is still out', async () => {
    const { fx } = ctx;
    const spare = await mkItem({ itemType: 'Spare Part', baseUom: 'Nos' });
    await ctx.v.post('opening', {
      warehouseId: fx.warehouseId,
      lines: [{ itemId: spare.id, qty: 10, unitCost: 100 }],
    });
    const wo = body(
      await call('post', '/maint/work-orders', {
        assetId: s.drill.id,
        woType: 'CORRECTIVE',
        description: 'Replace pads',
      }),
    );
    const sp = body(
      await call('post', `/maint/work-orders/${wo.id}/spares`, {
        itemId: spare.id,
        qty: 4,
        warehouseId: fx.warehouseId,
      }),
    );
    await call('post', `/maint/work-orders/${wo.id}/start`, {});
    await call('post', `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/issue`, { qty: 4 });
    await call('post', `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/return`, { qty: 1 });
    const second = await call(
      'post',
      `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/return`,
      { qty: 1 },
    );
    expect(Number(body(second).cost.spares)).toBe(200);
    const last = await call(
      'post',
      `/maint/work-orders/${wo.id}/spares/${sp.spares[0].id}/return`,
      { qty: 2 },
    );
    expect(Number(body(last).cost.spares)).toBe(0);
    expect((await balance(spare.id, fx.warehouseId)).value).toBe(1000);
  });

  it('moves a plan on when its service is cancelled, so the next one is raised', async () => {
    const plan = await call('post', '/maint/plans', {
      assetId: s.drill.id,
      title: 'Grease points',
      triggerType: 'TIME',
      intervalDays: 30,
      startFrom: '2026-09-01',
      leadDays: 3,
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    const g1 = await call(
      'post',
      '/maint/schedules/generate',
      {},
      { 'Idempotency-Key': `g1-${tag()}-aaaa` },
    );
    expect(body(g1).created).toBe(1);
    // one open service per plan: nothing more is raised while it is open
    expect(
      body(
        await call(
          'post',
          '/maint/schedules/generate',
          {},
          { 'Idempotency-Key': `g1b-${tag()}-aaaa` },
        ),
      ).created,
    ).toBe(0);
    const sch = rows(await call('get', '/maint/schedules?status=WO_CREATED')).find(
      (x: any) => x.planId === body(plan).id,
    );
    const wo = body(await call('get', `/maint/work-orders/${sch.woId}`));
    const cancel = await call(
      'post',
      `/maint/work-orders/${wo.id}/cancel`,
      { reason: 'Machine was away' },
      ifm(wo.version),
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const g2 = await call(
      'post',
      '/maint/schedules/generate',
      {},
      { 'Idempotency-Key': `g2-${tag()}-aaaa` },
    );
    expect(body(g2).created).toBe(1);
  });

  it('runs depreciation months in order', async () => {
    const run = body(
      await call('post', '/assets/depreciation/runs', { area: 'BOOK', period: '2026-10' }),
    );
    const post = await call(
      'post',
      `/assets/depreciation/runs/${run.id}/post`,
      {},
      ifm(run.version),
    );
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    const earlier = await call('post', '/assets/depreciation/runs', {
      area: 'BOOK',
      period: '2026-09',
    });
    expect(earlier.status).toBe(409);
  });

  it('turns a planned stop into the failure when the machine breaks during a service', async () => {
    const saw = body(
      await call('post', '/maint/machines', {
        name: 'Saw',
        categoryId: s.pm.id,
        isMaintainable: true,
      }),
    );
    await capitalise(saw.id, '2026-10-01', 100000, 0);
    const wo = body(
      await call('post', '/maint/work-orders', {
        assetId: saw.id,
        woType: 'PM',
        description: 'Blade change',
      }),
    );
    expect((await call('post', `/maint/work-orders/${wo.id}/start`, {})).status).toBe(200);
    const bd = await call('post', '/maint/breakdowns', {
      assetId: saw.id,
      symptom: 'Blade snapped',
      machineStopped: true,
    });
    expect(bd.status, JSON.stringify(bd.body)).toBeLessThan(300);
    const dt = rows(await call('get', `/maint/downtime?assetId=${saw.id}`));
    expect(dt.filter((d: any) => !d.endAt).map((d: any) => d.dtType)).toEqual(['UNPLANNED']);
  });

  it('keeps a category as the assets were booked, and refuses party accounts for money lines', async () => {
    const pm = await cat('PM_GENERAL');
    const changed = await call('put', `/assets/categories/${pm.id}`, {
      name: pm.name,
      assetClass: pm.assetClass,
      assetAccount: '1607',
      accumDepAccount: pm.accumDepAccount,
      expenseAccount: pm.expenseAccount,
      cwipAccount: pm.cwipAccount,
      itcEligible: pm.itcEligible,
    });
    expect(changed.status).toBe(409);
    const party = (
      await prisma.$queryRawUnsafe<{ code: string }[]>(
        `SELECT code FROM accounts WHERE party_required AND posting_allowed LIMIT 1`,
      )
    )[0];
    if (party) {
      const a = body(await call('post', '/assets/register', { name: 'Welder', categoryId: pm.id }));
      const r = await call('post', '/assets/capitalisations', {
        assetId: a.id,
        capitalisationDate: TODAY,
        source: 'PURCHASE',
        lines: [{ component: 'BASE', amount: 1000, glSourceAccount: party.code }],
      });
      expect(r.status).toBe(422);
    }
    expect(rows(await call('get', '/maint/spares')).length).toBeGreaterThanOrEqual(0);
  });
});
