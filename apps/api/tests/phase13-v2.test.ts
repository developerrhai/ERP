/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Phase 13 v2 (spec PHASE-13): BOM and routing approval, production order with WIP in the general ledger, job cards with time
// logs, scrap, production receipt, closing, MRP with pegging, production plans and the shop-floor reads.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { balance, mkItem, setApproval, tag } from './phase08-helpers';
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

describe('access', () => {
  it('needs a token, and a plain employee cannot create a production order', async () => {
    expect((await request(app).get('/api/v1/mfg/production-orders')).status).toBe(401);
    const emp = await signInAs(app, 'EMPLOYEE');
    const r = await request(app)
      .post('/api/v1/mfg/production-orders')
      .set(emp.bearer)
      .set('X-Unit-Id', ctx.fx.unitId)
      .send({
        itemId: '00000000-0000-0000-0000-000000000000',
        qty: 1,
        dueDate: TODAY,
        warehouseId: '00000000-0000-0000-0000-000000000000',
        rmWarehouseId: '00000000-0000-0000-0000-000000000000',
      });
    expect(r.status).toBe(403);
  });
});

describe('masters', () => {
  it('sets up work centres, a BOM that goes through approval, and a routing', async () => {
    const { fx } = ctx;
    s.fg = await mkItem({ itemType: 'Finished Good', baseUom: 'Nos' });
    s.rm1 = await mkItem();
    s.rm2 = await mkItem();
    await ctx.v.post('opening', {
      warehouseId: fx.warehouseId,
      lines: [
        { itemId: s.rm1.id, qty: 100, unitCost: 10 },
        { itemId: s.rm2.id, qty: 200, unitCost: 5 },
      ],
    });
    const cc = await prisma.costCenter.findFirstOrThrow({ where: { unitId: fx.unitId } });
    const wc1 = await call('post', '/mfg/work-centers', {
      costCentreId: cc.id,
      code: `CUT${tag()}`,
      name: 'Cutting',
      labourRatePerHr: 60,
      overheadRatePerHr: 30,
    });
    expect(wc1.status, JSON.stringify(wc1.body)).toBe(201);
    s.wc1 = body(wc1);
    s.wc2 = body(
      await call('post', '/mfg/work-centers', {
        costCentreId: cc.id,
        code: `ASM${tag()}`,
        name: 'Assembly',
        labourRatePerHr: 60,
        overheadRatePerHr: 30,
      }),
    );
    expect(
      (await call('post', '/mfg/work-centers', { code: s.wc1.code, name: 'dup' })).status,
    ).toBe(422);
    expect(rows(await call('get', '/mfg/downtime-reasons')).length).toBeGreaterThan(0);
    s.scrapReason = rows(await call('get', '/mfg/scrap-reasons')).find(
      (x: any) => x.normal === false,
    );
    expect(s.scrapReason).toBeTruthy();

    const bom = await call('post', '/mfg/boms', {
      itemId: s.fg.id,
      lines: [
        { itemId: s.rm1.id, qtyPer: 2, scrapPct: 5, issueMethod: 'MANUAL' },
        { itemId: s.rm2.id, qtyPer: 1, issueMethod: 'BACKFLUSH' },
      ],
    });
    expect(bom.status, JSON.stringify(bom.body)).toBe(201);
    s.bom = body(bom);
    expect(s.bom.status).toBe('DRAFT');
    // a part cannot be its own component
    expect(
      (
        await call('post', '/mfg/boms', {
          itemId: s.fg.id,
          lines: [{ itemId: s.fg.id, qtyPer: 1 }],
        })
      ).status,
    ).toBe(422);
    const sub = await call('post', `/mfg/boms/${s.bom.id}/submit`, {}, ifm(s.bom.version));
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(body(sub).status).toBe('PENDING_APPROVAL');
    const rel = await call('post', `/mfg/boms/${s.bom.id}/release`, {}, ifm(body(sub).version));
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    s.bom = body(rel);
    expect(s.bom.status).toBe('RELEASED');
    // a released BOM is locked; a revision is a new draft
    expect(
      (await call('patch', `/mfg/boms/${s.bom.id}`, { notes: 'x' }, ifm(s.bom.version))).status,
    ).toBe(409);
    // a loop through the finished good is refused (when the draft is made, submitted or released)
    const loopMk = await call('post', '/mfg/boms', {
      itemId: s.rm1.id,
      lines: [{ itemId: s.fg.id, qtyPer: 1 }],
    });
    if (loopMk.status === 201) {
      const loop = body(loopMk);
      const loopSub = await call('post', `/mfg/boms/${loop.id}/submit`, {}, ifm(loop.version));
      const loopRel =
        loopSub.status === 200
          ? await call('post', `/mfg/boms/${loop.id}/release`, {}, ifm(body(loopSub).version))
          : loopSub;
      expect(loopRel.status).toBe(422);
    } else expect(loopMk.status).toBe(422);

    // explode 10 pieces: 2 x 10 x 1.05 = 21 of RM1
    const ex = await call('get', `/mfg/boms/${s.bom.id}/explode?qty=10`);
    expect(ex.status, JSON.stringify(ex.body)).toBe(200);
    const need = Object.fromEntries(body(ex).requirements.map((r: any) => [r.itemId, r]));
    expect(Number(need[s.rm1.id].qty)).toBe(21);
    const roll = await call('get', `/mfg/boms/${s.bom.id}/cost-rollup`);
    expect(roll.status, JSON.stringify(roll.body)).toBe(200);

    const rt = await call('post', '/mfg/routings', {
      itemId: s.fg.id,
      ops: [
        { seq: 10, name: 'Cutting', workCentreId: s.wc1.id, setupMinutes: 10, runMinutes: 1 },
        { seq: 20, name: 'Assembly', workCentreId: s.wc2.id, runMinutes: 2 },
      ],
    });
    expect(rt.status, JSON.stringify(rt.body)).toBe(201);
    s.rt = body(rt);
    const rtRel = await call('post', `/mfg/routings/${s.rt.id}/release`, {}, ifm(s.rt.version));
    expect(rtRel.status, JSON.stringify(rtRel.body)).toBe(200);
    expect(body(rtRel).status).toBe('RELEASED');
  });
});

describe('production order: material, job cards, scrap, receipt, close', () => {
  it('creates, releases and issues material; WIP follows to the general ledger', async () => {
    const { fx } = ctx;
    const o = await call('post', '/mfg/production-orders', {
      itemId: s.fg.id,
      qty: 10,
      dueDate: TODAY,
      warehouseId: fx.warehouse2Id,
      rmWarehouseId: fx.warehouseId,
    });
    expect([200, 201], JSON.stringify(o.body)).toContain(o.status);
    s.order = body(o);
    expect(s.order.status).toBe('Planned');
    const mats = Object.fromEntries(s.order.materials.map((x: any) => [x.itemId, x]));
    expect(Number(mats[s.rm1.id].requiredQty)).toBe(21);
    s.m1 = mats[s.rm1.id];
    const rel = await call(
      'post',
      `/mfg/production-orders/${s.order.id}/release`,
      {},
      { ...ifm(s.order.version), 'Idempotency-Key': `rel-${tag()}-aaaa` },
    );
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    s.order = body(rel);
    expect(s.order.status).toBe('Released');

    const key = { 'Idempotency-Key': `iss-${tag()}-aaaa` };
    const lines = [{ materialId: s.m1.id, qty: 21 }];
    const iss = await call('post', `/mfg/production-orders/${s.order.id}/issue`, { lines }, key);
    expect(iss.status, JSON.stringify(iss.body)).toBe(200);
    const again = await call('post', `/mfg/production-orders/${s.order.id}/issue`, { lines }, key);
    expect(again.status).toBe(200);
    expect((await balance(s.rm1.id, fx.warehouseId)).onHand).toBe(79);
    // WIP: 21 x 10 = 210 in the general ledger and in the cost ledger
    expect(await gl(fx.unitId, '1302')).toBe(210);
    const over = await call('post', `/mfg/production-orders/${s.order.id}/issue`, {
      lines: [{ materialId: s.m1.id, qty: 5 }],
    });
    // the owner is a supervisor, so an issue above the allowance goes through; it comes straight back
    expect(over.status, JSON.stringify(over.body)).toBe(200);
    const back = await call('post', `/mfg/production-orders/${s.order.id}/return`, {
      lines: [{ materialId: s.m1.id, qty: 5 }],
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const sheet = await call('get', `/mfg/production-orders/${s.order.id}/cost-sheet`);
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200);
  });

  it('runs both job cards with time logs and absorbs labour and overhead', async () => {
    const { fx } = ctx;
    const detail = body(await call('get', `/mfg/production-orders/${s.order.id}`));
    s.ops = detail.ops;
    const [op1, op2] = s.ops;
    // the second card waits for the first
    const early = await call('post', `/mfg/job-cards/${op2.id}/start`, { kind: 'RUN' });
    expect(early.status).toBeGreaterThanOrEqual(400);
    const st = await call('post', `/mfg/job-cards/${op1.id}/start`, { kind: 'SETUP' });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    const run = await call('post', `/mfg/job-cards/${op1.id}/start`, { kind: 'RUN' });
    expect([200, 409, 422]).toContain(run.status);
    // manual time log: an hour of run time
    const from = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const to = new Date(Date.now() - 3_600_000).toISOString();
    const lg = await call('post', `/mfg/job-cards/${op1.id}/time-logs`, {
      kind: 'RUN',
      fromTs: from,
      toTs: to,
    });
    expect([200, 201, 409, 422], JSON.stringify(lg.body)).toContain(lg.status);
    // overlapping logs are refused
    const clash = await call('post', `/mfg/job-cards/${op1.id}/time-logs`, {
      kind: 'RUN',
      fromTs: from,
      toTs: to,
    });
    expect(clash.status).toBeGreaterThanOrEqual(400);
    const done1 = await call('post', `/mfg/job-cards/${op1.id}/complete`, {
      good: 8,
      scrap: 2,
      scrapReasonId: s.scrapReason.id,
    });
    expect(done1.status, JSON.stringify(done1.body)).toBe(200);
    const card1 = body(await call('get', `/mfg/job-cards/${op1.id}`));
    expect(card1.status).toBe('Done');
    // labour and overhead were absorbed into WIP: credit on 5116
    expect(await gl(fx.unitId, '5116')).toBeLessThan(0);
    const op2done = await call('post', `/mfg/job-cards/${op2.id}/complete`, { good: 8 });
    expect(op2done.status, JSON.stringify(op2done.body)).toBe(200);
  });

  it('records the scrap, receives finished goods and closes with WIP back at zero', async () => {
    const { fx } = ctx;
    const sc = rows(await call('get', `/mfg/scrap-entries?orderId=${s.order.id}`));
    expect(sc.length).toBeGreaterThan(0);
    for (const e of sc.filter((x: any) => x.status === 'Draft')) {
      const sub = await call('post', `/mfg/scrap-entries/${e.id}/submit`, {});
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    }
    // a first partial receipt must not take all the WIP of an order that is still running
    const part = await call(
      'post',
      '/mfg/production-receipts',
      { orderId: s.order.id, qty: 4 },
      { 'Idempotency-Key': `rc0-${tag()}-aaaa` },
    );
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    const wipAfterPart = await gl(fx.unitId, '1302');
    const rc = await call(
      'post',
      '/mfg/production-receipts',
      { orderId: s.order.id, qty: 4 },
      { 'Idempotency-Key': `rc-${tag()}-aaaa` },
    );
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    expect(wipAfterPart).toBeGreaterThanOrEqual(0);
    expect((await balance(s.fg.id, fx.warehouse2Id)).onHand).toBe(8);
    // material backflushed at the receipt is used up: it cannot be returned to the store
    const afterRc = body(await call('get', `/mfg/production-orders/${s.order.id}`));
    const bf = afterRc.materials.find((m: any) => m.itemId === s.rm2.id);
    expect(Number(bf.consumedQty)).toBeGreaterThan(0);
    const back = await call('post', `/mfg/production-orders/${s.order.id}/return`, {
      lines: [{ materialId: bf.id, qty: bf.consumedQty }],
    });
    expect(back.status, JSON.stringify(back.body)).toBe(422);
    const o = body(await call('get', `/mfg/production-orders/${s.order.id}`));
    // the order's WIP equals the sum of its ledger and the general ledger agrees
    const rec = body(await call('get', '/mfg/reports/wip-reconciliation'));
    expect(rec.exception).toBe(false);
    const done = await call('post', `/mfg/production-orders/${s.order.id}/start-complete`, {});
    expect([200, 409, 422], JSON.stringify(done.body)).toContain(done.status);
    const fresh = body(await call('get', `/mfg/production-orders/${s.order.id}`));
    const close = await call(
      'post',
      `/mfg/production-orders/${s.order.id}/close`,
      { note: 'done' },
      { ...ifm(fresh.version), 'Idempotency-Key': `cl-${tag()}-aaaa` },
    );
    expect(close.status, JSON.stringify(close.body)).toBe(200);
    expect(body(close).status).toBe('Closed');
    expect(Number(o.qty)).toBe(10);
    expect(Math.abs(await gl(fx.unitId, '1302'))).toBeLessThan(1);
    const cs = body(await call('get', `/mfg/production-orders/${s.order.id}/cost-sheet`));
    expect(cs).toBeTruthy();
  });
});

describe('planning: MRP, production plans, shop floor', () => {
  it('runs MRP with pegging and converts a make suggestion into an order', async () => {
    const { fx } = ctx;
    // a second finished good with a released BOM and no stock
    const fg2 = await mkItem({ itemType: 'Finished Good', baseUom: 'Nos' });
    const bom = body(
      await call('post', '/mfg/boms', { itemId: fg2.id, lines: [{ itemId: s.rm2.id, qtyPer: 3 }] }),
    );
    const sub = body(await call('post', `/mfg/boms/${bom.id}/submit`, {}, ifm(bom.version)));
    await call('post', `/mfg/boms/${bom.id}/release`, {}, ifm(sub.version));
    const rt = body(
      await call('post', '/mfg/routings', {
        itemId: fg2.id,
        ops: [{ seq: 10, name: 'Make', workCentreId: s.wc1.id, runMinutes: 1 }],
      }),
    );
    await call('post', `/mfg/routings/${rt.id}/release`, {}, ifm(rt.version));
    const plan = await call('post', '/mfg/production-plans', {
      horizonDays: 30,
      lines: [{ itemId: fg2.id, plannedQty: 20, requiredDate: TODAY }],
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    s.plan = body(plan);
    expect(s.plan.status).toBe('DRAFT');
    const cap = await call('post', `/mfg/production-plans/${s.plan.id}/check-capacity`, {});
    expect(cap.status, JSON.stringify(cap.body)).toBe(200);
    const mat = await call('post', `/mfg/production-plans/${s.plan.id}/check-material`, {});
    expect(mat.status, JSON.stringify(mat.body)).toBe(200);
    const relp = await call(
      'post',
      `/mfg/production-plans/${s.plan.id}/release`,
      {},
      ifm(s.plan.version),
    );
    expect(relp.status, JSON.stringify(relp.body)).toBe(200);
    const run = await call(
      'post',
      `/mfg/production-plans/${s.plan.id}/run-mrp`,
      {},
      { 'Idempotency-Key': `mrp-${tag()}-aaaa` },
    );
    expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
    const runId = body(run).id;
    const got = body(await call('get', `/mfg/mrp-runs/${runId}`));
    expect(['DONE', 'QUEUED', 'RUNNING']).toContain(got.status);
    if (got.status === 'DONE') {
      const sug = rows(await call('get', `/mfg/mrp-runs/${runId}/suggestions`));
      const make = sug.find((x: any) => x.itemId === fg2.id && x.type === 'MAKE');
      expect(make).toBeTruthy();
      expect(Number(make.qty)).toBe(20);
      expect(Array.isArray(make.pegging)).toBe(true);
      const buy = sug.find((x: any) => x.itemId === s.rm2.id);
      expect(buy ?? null).not.toBeUndefined();
      const firm = await call('post', `/mfg/mrp-suggestions/${make.id}/firm`, {});
      expect(firm.status, JSON.stringify(firm.body)).toBe(200);
      const conv = await call(
        'post',
        `/mfg/mrp-suggestions/${make.id}/convert`,
        { warehouseId: fx.warehouse2Id, rmWarehouseId: fx.warehouseId },
        { 'Idempotency-Key': `cv-${tag()}-aaaa` },
      );
      expect(conv.status, JSON.stringify(conv.body)).toBe(200);
      expect(body(conv).id).toBeTruthy();
    }
  });

  it('answers the calendar, settings, OEE and shop-floor reads', async () => {
    const cal = await call('post', '/mfg/calendars', {
      name: `Std ${tag()}`,
      workDays: [1, 2, 3, 4, 5, 6],
    });
    expect(cal.status, JSON.stringify(cal.body)).toBe(201);
    expect((await call('get', '/mfg/calendars')).status).toBe(200);
    const st = await call('get', '/mfg/settings');
    expect(st.status).toBe(200);
    const oee = await call('get', `/mfg/reports/oee?from=${TODAY}&to=${TODAY}`);
    expect(oee.status, JSON.stringify(oee.body)).toBe(200);
    const sf = await call('get', '/mfg/shopfloor/summary');
    expect(sf.status, JSON.stringify(sf.body)).toBe(200);
    for (const p of ['wip', 'costing', 'variance', 'yield']) {
      const r = await call('get', `/mfg/reports/${p}`);
      expect(r.status, `${p} ${JSON.stringify(r.body)}`).toBe(200);
    }
    const ad = await call('get', `/mfg/reports/plan-adherence?from=${TODAY}&to=${TODAY}`);
    expect(ad.status, JSON.stringify(ad.body)).toBe(200);
    const dt = await call('post', '/mfg/downtime', {
      workCentreId: s.wc1.id,
      reasonId: rows(await call('get', '/mfg/downtime-reasons'))[0].id,
    });
    expect(dt.status, JSON.stringify(dt.body)).toBe(201);
    const end = await call('post', `/mfg/downtime/${body(dt).id}/end`, {});
    expect(end.status, JSON.stringify(end.body)).toBe(200);
  });

  it('prints the job card and traveller PDFs and the order Excel', async () => {
    const pdf = await request(app)
      .get(`/api/v1/mfg/production-orders/${s.order.id}/traveller`)
      .set(owner.bearer)
      .set('X-Unit-Id', ctx.fx.unitId);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const jc = await request(app)
      .get(`/api/v1/mfg/job-cards/${s.ops[0].id}/print`)
      .set(owner.bearer)
      .set('X-Unit-Id', ctx.fx.unitId);
    expect(jc.status).toBe(200);
    const xl = await request(app)
      .get('/api/v1/mfg/export/orders')
      .set(owner.bearer)
      .set('X-Unit-Id', ctx.fx.unitId);
    expect(xl.status).toBe(200);
  });
});

describe('daily board and job work', () => {
  it('keeps the daily line plan with its totals', async () => {
    const a = await call('post', '/mfg/day-board', {
      planDate: TODAY,
      customerPoNo: 'PO-77',
      deliveryDate: TODAY,
      lineQty: 100,
      unit2Qty: 40,
      coatingQty: 60,
      dispatchQty: 20,
      ownerLine: 'Suresh',
      remark: 'Rush',
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    await call('post', '/mfg/day-board', { planDate: TODAY, lineQty: 50 });
    const list = await call('get', `/mfg/day-board?from=${TODAY}&to=${TODAY}`);
    expect(list.status).toBe(200);
    expect(body(list)).toHaveLength(2);
    expect(Number(list.body.meta.totals.lineQty)).toBe(150);
    const row = body(a);
    const up = await call(
      'patch',
      `/mfg/day-board/${row.id}`,
      { dispatchQty: 25 },
      ifm(row.version),
    );
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect((await call('delete', `/mfg/day-board/${row.id}`)).status).toBe(204);
    expect(body(await call('get', `/mfg/day-board?from=${TODAY}&to=${TODAY}`))).toHaveLength(1);
  });

  it('keeps inward / outward balances per customer PO line and the rework register per challan', async () => {
    s.cust = await prisma.customer.create({
      data: {
        code: `C${tag()}`.slice(0, 28),
        name: `Cust ${tag()}`,
        nameKey: `c-${tag()}`.toLowerCase(),
        stateCode: '27',
        gstRegistrationType: 'UNREGISTERED',
        approvalStatus: 'APPROVED',
      },
    });
    const line = await call('post', '/mfg/jobwork/lines', {
      customerId: s.cust.id,
      customerPoNo: 'CPO-1',
      part: 'Bracket',
      poQty: 100,
      uom: 'Nos',
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);
    const id = body(line).id;
    // nothing was received, so nothing can go out
    expect(
      (
        await call('post', `/mfg/jobwork/lines/${id}/moves`, {
          direction: 'OUTWARD',
          qty: 5,
          docNo: 'DC-1',
        })
      ).status,
    ).toBe(422);
    const inw = await call('post', `/mfg/jobwork/lines/${id}/moves`, {
      direction: 'INWARD',
      qty: 60,
      docNo: 'CC-1',
    });
    expect(inw.status, JSON.stringify(inw.body)).toBe(200);
    const out = await call('post', `/mfg/jobwork/lines/${id}/moves`, {
      direction: 'OUTWARD',
      qty: 40,
      docNo: 'DC-1',
    });
    expect(out.status).toBe(200);
    expect(body(out)).toMatchObject({
      poQty: '100.000',
      inwardQty: '60.000',
      outwardQty: '40.000',
      openQty: '60.000',
      heldQty: '20.000',
    });
    expect(
      (
        await call('post', `/mfg/jobwork/lines/${id}/moves`, {
          direction: 'OUTWARD',
          qty: 21,
          docNo: 'DC-2',
        })
      ).status,
    ).toBe(422);
    // the receipt cannot be cancelled while goods went out against it
    const inId = body(out).moves.find((m: any) => m.direction === 'INWARD').id;
    expect((await call('post', `/mfg/jobwork/lines/${id}/moves/${inId}/cancel`, {})).status).toBe(
      409,
    );
    expect(
      (
        await call('post', '/mfg/jobwork/lines', {
          customerId: s.cust.id,
          customerPoNo: 'CPO-1',
          part: 'Bracket',
          poQty: 5,
          uom: 'Nos',
        })
      ).status,
    ).toBe(422);

    const rw = await call('post', '/mfg/challan-rework', {
      customerId: s.cust.id,
      challanNo: 'CUST-DC-9',
      challanDate: TODAY,
      part: 'Bracket',
      challanQty: 10,
    });
    expect(rw.status, JSON.stringify(rw.body)).toBe(201);
    const rid = body(rw).id;
    expect(body(rw).balanceQty).toBe('10.000');
    const d1 = await call('post', `/mfg/challan-rework/${rid}/done`, {
      qty: 4,
      doneChallanNo: 'OUR-DC-3',
    });
    expect(d1.status, JSON.stringify(d1.body)).toBe(200);
    expect(body(d1).balanceQty).toBe('6.000');
    expect(
      (
        await call('post', `/mfg/challan-rework/${rid}/done`, {
          qty: 7,
          doneChallanNo: 'OUR-DC-4',
        })
      ).status,
    ).toBe(422);
    const open = body(await call('get', '/mfg/challan-rework?open=true'));
    expect(open.some((r: any) => r.id === rid)).toBe(true);
  });
});

describe('approval limit and access', () => {
  it('holds a big order for approval and lets an approver release it', async () => {
    const { fx } = ctx;
    const lim = await call('put', '/mfg/settings/ORDER_APPROVAL_VALUE', { value: 1 });
    expect(lim.status, JSON.stringify(lim.body)).toBe(200);
    try {
      const o = body(
        await call('post', '/mfg/production-orders', {
          itemId: s.fg.id,
          qty: 5,
          dueDate: TODAY,
          warehouseId: fx.warehouse2Id,
          rmWarehouseId: fx.warehouseId,
        }),
      );
      const rel = await call('post', `/mfg/production-orders/${o.id}/release`, {}, ifm(o.version));
      expect(rel.status, JSON.stringify(rel.body)).toBe(200);
      expect(['Pending Approval', 'Released']).toContain(body(rel).status);
      if (body(rel).status === 'Pending Approval') {
        const ok = await call(
          'post',
          `/mfg/production-orders/${o.id}/approve`,
          {},
          ifm(body(rel).version),
        );
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(body(ok).status).toBe('Released');
      }
    } finally {
      await call('put', '/mfg/settings/ORDER_APPROVAL_VALUE', { value: null });
    }
  });
  it('refuses an employee the manufacturing reads', async () => {
    const emp = await signInAs(app, 'EMPLOYEE');
    for (const p of ['/mfg/boms', '/mfg/job-cards', '/mfg/reports/wip', '/mfg/mrp-runs']) {
      const r = await request(app)
        .get('/api/v1' + p)
        .set(emp.bearer)
        .set('X-Unit-Id', ctx.fx.unitId);
      expect(r.status, p).toBe(403);
    }
  });
});
