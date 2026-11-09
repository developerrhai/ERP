/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Phase 13: manufacturing. BOM (scrap, loops) and routing are versioned; a production order issues material through the
// stock service (value follows to the GL), logs each operation (good / scrap / rework), is held at an inspection checkpoint,
// and receives finished goods only after a positive Usage Decision. MRP nets demand against stock and open supply and raises
// a Purchase Requisition and Planned orders; the daily board and the job-work registers keep their balances on the server.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import {
  componentQty,
  findCycle,
  fgUnitRate,
  inspectionBlocks,
  jwBalances,
  logErrors,
  lotReceivable,
  lotRoom,
  opClosable,
  bucketStart,
  planMrp,
  scheduleLoad,
  reworkBalance,
} from '../src/modules/mfg/logic';
import { newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { balance, mkItem, setApproval, tag, vclient } from './phase08-helpers';
import { body, ifm, mkSupplier, setup } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
const TODAY = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);
const s: Record<string, any> = {};
const patch = (path: string, b: unknown, extra: Record<string, string> = {}) =>
  request(app)
    .patch('/api/v1' + path)
    .set(owner.bearer)
    .set('X-Unit-Id', ctx.fx.unitId)
    .set(extra)
    .send(b as object);

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

describe('pure rules', () => {
  it('explodes a BOM with the scrap allowance, rounded up', () => {
    expect(componentQty('10', '1', { itemId: 'a', qtyPer: '2', scrapPct: '5' }).toFixed(3)).toBe(
      '21.000',
    );
    expect(componentQty('10', '4', { itemId: 'a', qtyPer: '1', scrapPct: '0' }).toFixed(3)).toBe(
      '2.500',
    );
    expect(componentQty('1', '3', { itemId: 'a', qtyPer: '1', scrapPct: '0' }).toFixed(3)).toBe(
      '0.334',
    );
  });
  it('finds a loop in the bills of materials', () => {
    const line = (itemId: string) => ({ itemId, qtyPer: '1', scrapPct: '0' });
    const ok = new Map([
      ['A', { itemId: 'A', baseQty: '1', lines: [line('B')] }],
      ['B', { itemId: 'B', baseQty: '1', lines: [line('C')] }],
    ]);
    expect(findCycle(ok)).toBeNull();
    ok.set('C', { itemId: 'C', baseQty: '1', lines: [line('A')] });
    expect(findCycle(ok)).toEqual(['A', 'B', 'C', 'A']);
  });
  it('MRP nets demand level by level against stock and open supply', () => {
    const line = (itemId: string, q = '2') => ({ itemId, qtyPer: q, scrapPct: '0' });
    const boms = new Map([
      ['FG', { itemId: 'FG', baseQty: '1', lines: [line('SF'), line('RM1', '1')] }],
      ['SF', { itemId: 'SF', baseQty: '1', lines: [line('RM1'), line('CS', '1')] }],
    ]);
    const r = planMrp({
      demands: [
        { itemId: 'FG', qty: '100', date: '2026-12-10', type: 'SALES_ORDER', ref: 'SO1' },
        { itemId: 'FG', qty: '20', date: '2026-12-05', type: 'FORECAST', ref: 'F' },
      ],
      boms,
      customerSupplied: new Set(['CS']),
      onHand: new Map([
        ['FG', '30'],
        ['SF', '50'],
      ]),
      scheduled: new Map([['RM1', [{ qty: '10', date: null }]]]),
      bucket: 'RANGE',
      rangeStart: '2026-12-01',
    });
    const by = Object.fromEntries(r.map((x) => [x.itemId, x]));
    expect(by.FG).toMatchObject({
      action: 'PRODUCE',
      gross: '120.000',
      net: '90.000',
      level: 0,
      needDate: '2026-12-05',
    });
    // 90 FG need 180 SF; 50 are in stock, so 130 are made
    expect(by.SF).toMatchObject({ action: 'PRODUCE', gross: '180.000', net: '130.000', level: 1 });
    // RM1: 90 (FG) + 260 (SF) = 350, less 10 coming
    expect(by.RM1).toMatchObject({ action: 'BUY', gross: '350.000', net: '340.000', level: 2 });
    // the customer's material is reported, never bought
    expect(by.CS).toMatchObject({ action: 'CUSTOMER', net: '130.000' });
    expect(() =>
      planMrp({
        demands: [{ itemId: 'A', qty: '1', date: '2026-12-01', type: 'SALES_ORDER', ref: 'x' }],
        boms: new Map([['A', { itemId: 'A', baseQty: '1', lines: [line('A')] }]]),
        customerSupplied: new Set(),
        onHand: new Map(),
        scheduled: new Map(),
        bucket: 'RANGE',
        rangeStart: '2026-12-01',
      }),
    ).toThrow(/BOM_CYCLE/);
  });
  it('time-phased MRP: stock carries from week to week and receipts cover the week they arrive in', () => {
    // 2026-12-07 is a Monday
    expect(bucketStart('2026-12-09', 'WEEK', '2026-12-01')).toBe('2026-12-07');
    expect(bucketStart('2026-12-13', 'WEEK', '2026-12-01')).toBe('2026-12-07');
    expect(bucketStart('2026-11-20', 'WEEK', '2026-12-01')).toBe('2026-11-30');
    expect(bucketStart('2026-12-20', 'MONTH', '2026-12-01')).toBe('2026-12-01');
    expect(bucketStart('2026-12-20', 'RANGE', '2026-12-01')).toBe('2026-12-01');
    const boms = new Map([
      ['FG', { itemId: 'FG', baseQty: '1', lines: [{ itemId: 'RM', qtyPer: '2', scrapPct: '0' }] }],
    ]);
    const r = planMrp({
      demands: [
        { itemId: 'FG', qty: '50', date: '2026-12-08', type: 'SALES_ORDER', ref: 'A' },
        { itemId: 'FG', qty: '50', date: '2026-12-15', type: 'SALES_ORDER', ref: 'B' },
      ],
      boms,
      customerSupplied: new Set(),
      onHand: new Map([['FG', '60']]),
      scheduled: new Map([['RM', [{ qty: '30', date: '2026-12-14' }]]]),
      bucket: 'WEEK',
      rangeStart: '2026-12-01',
    });
    const fg = r.filter((x) => x.itemId === 'FG');
    // week 1: 60 cover 50 (10 left over); week 2: the 10 cover 10 of 50, so 40 are missing
    expect(fg.map((x) => [x.bucketStart, x.net])).toEqual([
      ['2026-12-07', '0.000'],
      ['2026-12-14', '40.000'],
    ]);
    // only the second week makes pieces, so only that week needs the component: 80, and 30 arrive that week
    const rm = r.filter((x) => x.itemId === 'RM');
    expect(rm).toHaveLength(1);
    expect(rm[0]).toMatchObject({
      bucketStart: '2026-12-14',
      gross: '80.000',
      scheduled: '30.000',
      net: '50.000',
      action: 'BUY',
    });
  });
  it('finite loading: operations of an order follow each other and fill a work centre day by day', () => {
    const cap = { perDay: new Map([['W1', 480]]), workDays: new Set([1, 2, 3, 4, 5]) };
    // 2026-12-04 is a Friday
    const r = scheduleLoad(
      [
        {
          orderId: 'o1',
          orderNo: 'O1',
          opId: 'a',
          seq: 10,
          workCentreId: 'W1',
          minutes: 600,
          due: '2026-12-08',
          start: '2026-12-04',
        },
        {
          orderId: 'o1',
          orderNo: 'O1',
          opId: 'b',
          seq: 20,
          workCentreId: 'W1',
          minutes: 100,
          due: '2026-12-08',
          start: '2026-12-04',
        },
        {
          orderId: 'o2',
          orderNo: 'O2',
          opId: 'c',
          seq: 10,
          workCentreId: 'W1',
          minutes: 480,
          due: '2026-12-20',
          start: '2026-12-04',
        },
      ],
      cap,
      '2026-12-04',
    );
    const op = Object.fromEntries(r.ops.map((x) => [x.opId, x]));
    // 600 minutes: 480 on Friday, the rest on Monday (the weekend is not worked); the next operation follows on Monday
    expect(op.a).toMatchObject({ start: '2026-12-04', finish: '2026-12-07' });
    expect(op.b).toMatchObject({ start: '2026-12-07', finish: '2026-12-07' });
    // the second order takes the free minutes after the first
    expect(op.c!.start).toBe('2026-12-07');
    expect(r.orders.find((o) => o.orderId === 'o1')!.late).toBe(false);
    expect(r.days.find((d) => d.day === '2026-12-07')!.load).toBe(480);
    // an order that cannot finish before its due date is late
    const late = scheduleLoad(
      [
        {
          orderId: 'x',
          orderNo: 'X',
          opId: 'z',
          seq: 10,
          workCentreId: 'W1',
          minutes: 2000,
          due: '2026-12-06',
          start: '2026-12-04',
        },
      ],
      cap,
      '2026-12-04',
    );
    expect(late.orders[0]!.late).toBe(true);
  });
  it('operation quantities, inspection checkpoint, FG lot and cost rules', () => {
    const st = { input: '10', qtyDone: '6', qtyScrap: '1', qtyRework: '1' };
    expect(logErrors(st, { good: '2', scrap: '0', rework: '0' })).toEqual({});
    expect(logErrors(st, { good: '3', scrap: '0', rework: '0' }).qtyGood).toContain('2.000');
    expect(opClosable(st)).toBe('Finish the rework first.');
    expect(opClosable({ ...st, qtyRework: '0' })).toContain('not accounted for');
    expect(opClosable({ input: '10', qtyDone: '9', qtyScrap: '1', qtyRework: '0' })).toBeNull();
    expect(inspectionBlocks(false, [], '5')).toBeNull();
    expect(inspectionBlocks(true, [], '5')).toContain('needs an inspection');
    expect(inspectionBlocks(true, [{ status: 'Submitted', acceptedQty: null }], '5')).toContain(
      'no Usage Decision',
    );
    expect(inspectionBlocks(true, [{ status: 'Decided', acceptedQty: '4' }], '5')).toContain(
      'accepted 4.000 of 5.000',
    );
    expect(
      inspectionBlocks(
        true,
        [
          { status: 'Decided', acceptedQty: '3' },
          { status: 'Decided', acceptedQty: '2' },
        ],
        '5',
      ),
    ).toBeNull();
    expect(lotRoom('8', '5').toFixed(3)).toBe('3.000');
    expect(lotRoom('8', '9').toFixed(3)).toBe('0.000');
    expect(
      lotReceivable({ status: 'Submitted', acceptedQty: '8', receivedQty: '0' }).toFixed(),
    ).toBe('0');
    expect(lotReceivable({ status: 'Decided', acceptedQty: '8', receivedQty: '3' }).toFixed()).toBe(
      '5',
    );
    expect(fgUnitRate('250.00', '8').toFixed(6)).toBe('31.250000');
    expect(fgUnitRate('250.00', '0').toFixed()).toBe('0');
    expect(jwBalances('100', '60', '40')).toMatchObject({ openQty: '60.000', heldQty: '20.000' });
    expect(reworkBalance('10', '4')).toBe('6.000');
    expect(reworkBalance('10', '12')).toBe('0.000');
  });
});

describe('401 / 403', () => {
  it('needs a token, and a plain employee cannot create a production order', async () => {
    expect((await request(app).get('/api/v1/mfg/orders')).status).toBe(401);
    const emp = await signInAs(app, 'EMPLOYEE');
    const v = vclient(app, emp, ctx.fx.unitId);
    const r = await v.call('post', '/mfg/orders', {
      itemId: '00000000-0000-0000-0000-000000000000',
      qty: 1,
      dueDate: TODAY,
      warehouseId: '00000000-0000-0000-0000-000000000000',
      rmWarehouseId: '00000000-0000-0000-0000-000000000000',
    });
    expect(r.status).toBe(403);
  });
});

describe('masters: work centres, BOM, routing', () => {
  it('sets up two work centres, a BOM with scrap and a routing with an inspection checkpoint', async () => {
    const { v, fx } = ctx;
    s.fg = await mkItem({ itemType: 'Finished Good', baseUom: 'Nos' });
    s.rm1 = await mkItem();
    s.rm2 = await mkItem();
    // opening stock of the two components
    await v.post('opening', {
      warehouseId: fx.warehouseId,
      lines: [
        { itemId: s.rm1.id, qty: 100, unitCost: 10 },
        { itemId: s.rm2.id, qty: 200, unitCost: 5 },
      ],
    });
    const wc1 = await v.call('post', '/mfg/work-centres', {
      code: `CUT${tag()}`,
      name: 'Cutting',
      costPerHour: 60,
    });
    expect(wc1.status, JSON.stringify(wc1.body)).toBe(201);
    s.wc1 = body(wc1);
    s.wc2 = body(
      await v.call('post', '/mfg/work-centres', {
        code: `ASM${tag()}`,
        name: 'Assembly',
        costPerHour: 60,
      }),
    );
    expect(
      (await v.call('post', '/mfg/work-centres', { code: s.wc1.code, name: 'dup' })).status,
    ).toBe(422);

    // BOM: 2 x RM1 with 5% scrap and 1 x RM2 per piece
    const bom = await v.call('post', '/mfg/boms', {
      itemId: s.fg.id,
      lines: [
        { itemId: s.rm1.id, qtyPer: 2, scrapPct: 5 },
        { itemId: s.rm2.id, qtyPer: 1 },
      ],
    });
    expect(bom.status, JSON.stringify(bom.body)).toBe(201);
    s.bom = body(bom);
    expect(s.bom.status).toBe('DRAFT');
    // a part cannot be its own component
    const self = await v.call('post', '/mfg/boms', {
      itemId: s.fg.id,
      lines: [{ itemId: s.fg.id, qtyPer: 1 }],
    });
    expect(self.status).toBe(422);
    const act = await v.call('post', `/mfg/boms/${s.bom.id}/activate`, {}, ifm(s.bom.version));
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    expect(body(act).status).toBe('ACTIVE');
    // a draft that would make a loop (RM1 made from the finished good) cannot be activated
    const loop = body(
      await v.call('post', '/mfg/boms', {
        itemId: s.rm1.id,
        lines: [{ itemId: s.fg.id, qtyPer: 1 }],
      }),
    );
    const loopAct = await v.call('post', `/mfg/boms/${loop.id}/activate`, {}, ifm(loop.version));
    expect(loopAct.status).toBe(422);
    expect(JSON.stringify(loopAct.body)).toContain('loop');
    // an active BOM is not edited; a new version is made instead
    expect(
      (await patch(`/mfg/boms/${s.bom.id}`, { notes: 'x' }, ifm(body(act).version))).status,
    ).toBe(409);

    const rt = await v.call('post', '/mfg/routings', {
      itemId: s.fg.id,
      ops: [
        { seq: 10, name: 'Cutting', workCentreId: s.wc1.id, runMinutes: 1 },
        {
          seq: 20,
          name: 'Assembly',
          workCentreId: s.wc2.id,
          runMinutes: 2,
          inspectionRequired: true,
        },
      ],
    });
    expect(rt.status, JSON.stringify(rt.body)).toBe(201);
    s.rt = body(rt);
    const rtAct = await v.call('post', `/mfg/routings/${s.rt.id}/activate`, {}, ifm(s.rt.version));
    expect(rtAct.status, JSON.stringify(rtAct.body)).toBe(200);
    // version 2 of the BOM replaces version 1 on activation
    const v2 = body(await v.call('post', `/mfg/boms/${s.bom.id}/new-version`, {}));
    expect(v2.versionNo).toBe(2);
    expect(v2.status).toBe('DRAFT');
  });
});

describe('production order: material, operations, inspection, finished goods', () => {
  it('plans the order and works out the material with the scrap allowance', async () => {
    const { v, fx } = ctx;
    const o = await v.call('post', '/mfg/orders', {
      itemId: s.fg.id,
      qty: 10,
      dueDate: TODAY,
      warehouseId: fx.warehouse2Id,
      rmWarehouseId: fx.warehouseId,
    });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    s.order = body(o);
    expect(s.order.status).toBe('Planned');
    const m = Object.fromEntries(s.order.materials.map((x: any) => [x.itemId, x]));
    expect(Number(m[s.rm1.id].requiredQty)).toBe(21);
    expect(Number(m[s.rm2.id].requiredQty)).toBe(10);
    s.m1 = m[s.rm1.id];
    s.m2 = m[s.rm2.id];
    // no logging before release
    const rel = await v.call('post', `/mfg/orders/${s.order.id}/release`, {}, ifm(s.order.version));
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    s.order = body(rel);
    expect(s.order.status).toBe('Released');
    expect(s.order.ops.map((x: any) => x.name)).toEqual(['Cutting', 'Assembly']);
    expect(Number(s.order.ops[0].costPerHour)).toBe(60);
  });

  it('issues material once, value follows to stock, and refuses more than the order needs', async () => {
    const { v, fx } = ctx;
    // production cannot start before material is issued
    const early = await v.call('post', `/mfg/orders/${s.order.id}/ops/${s.order.ops[0].id}/log`, {
      good: 1,
    });
    expect(early.status).toBe(409);
    const key = { 'Idempotency-Key': `iss-${tag()}` };
    const lines = [
      { materialId: s.m1.id, qty: 21 },
      { materialId: s.m2.id, qty: 10 },
    ];
    const iss = await v.call('post', `/mfg/orders/${s.order.id}/issue`, { lines }, key);
    expect(iss.status, JSON.stringify(iss.body)).toBe(200);
    // the same key answers the first result and issues nothing twice
    const again = await v.call('post', `/mfg/orders/${s.order.id}/issue`, { lines }, key);
    expect(again.status).toBe(200);
    const after = body(iss);
    expect(after.materials.find((x: any) => x.itemId === s.rm1.id).issuedValue).toBe('210');
    expect(after.moves).toHaveLength(1);
    expect((await balance(s.rm1.id, fx.warehouseId)).onHand).toBe(79);
    expect((await balance(s.rm2.id, fx.warehouseId)).onHand).toBe(190);
    // more than the order needs
    const over = await v.call('post', `/mfg/orders/${s.order.id}/issue`, {
      lines: [{ materialId: s.m1.id, qty: 1 }],
    });
    expect(over.status).toBe(422);
    // the same material twice in one request is refused
    const dup = await v.call('post', `/mfg/orders/${s.order.id}/issue`, {
      lines: [
        { materialId: s.m1.id, qty: 1 },
        { materialId: s.m1.id, qty: 1 },
      ],
    });
    expect(dup.status).toBe(422);
    // one piece of RM1 goes back to the store at the issue rate
    const back = await v.call('post', `/mfg/orders/${s.order.id}/return`, {
      lines: [{ materialId: s.m1.id, qty: 1 }],
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(await balance(s.rm1.id, fx.warehouseId)).toMatchObject({ onHand: 80, value: 800 });
    expect(
      (
        await v.call('post', `/mfg/orders/${s.order.id}/return`, {
          lines: [{ materialId: s.m1.id, qty: 50 }],
        })
      ).status,
    ).toBe(422);
    s.order = body(back);
  });

  it('logs the first operation: good, scrap with a reason, and the next operation waits', async () => {
    const { v } = ctx;
    const [op1, op2] = s.order.ops;
    // the next operation cannot start first
    expect(
      (await v.call('post', `/mfg/orders/${s.order.id}/ops/${op2.id}/log`, { good: 1 })).status,
    ).toBe(409);
    // scrap needs a reason
    expect(
      (await v.call('post', `/mfg/orders/${s.order.id}/ops/${op1.id}/log`, { good: 8, scrap: 2 }))
        .status,
    ).toBe(422);
    // more than the order quantity
    expect(
      (await v.call('post', `/mfg/orders/${s.order.id}/ops/${op1.id}/log`, { good: 11 })).status,
    ).toBe(422);
    const log = await v.call('post', `/mfg/orders/${s.order.id}/ops/${op1.id}/log`, {
      good: 8,
      scrap: 2,
      minutes: 120,
      operator: 'Ravi',
      reason: 'Chipped edge',
    });
    expect(log.status, JSON.stringify(log.body)).toBe(200);
    const o = body(log);
    expect(o.status).toBe('In Progress');
    expect(Number(o.qtyScrapped)).toBe(2);
    expect(Number(o.ops[0].qtyDone)).toBe(8);
    // the scrap is in the scrap register and in the quality rejection register
    const scrap = body(await v.call('get', `/mfg/scrap?orderId=${s.order.id}`));
    expect(scrap).toHaveLength(1);
    expect(scrap[0].reason).toBe('Chipped edge');
    const rejs = body(await v.call('get', '/qms/rejections?q=Chipped%20edge'));
    expect(rejs.some((r: any) => r.disposition === 'SCRAP' && Number(r.holdQty) === 2)).toBe(true);
    const done = await v.call('post', `/mfg/orders/${s.order.id}/ops/${op1.id}/complete`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    s.order = body(done);
    expect(s.order.ops[0].status).toBe('Done');
  });

  it('holds the order at the inspection checkpoint until the Usage Decision accepts the pieces', async () => {
    const { v } = ctx;
    const op2 = s.order.ops[1];
    // 6 good, 2 sent for rework
    const log = await v.call('post', `/mfg/orders/${s.order.id}/ops/${op2.id}/log`, {
      good: 6,
      rework: 2,
      minutes: 60,
      reason: 'Burr on the flange',
    });
    expect(log.status, JSON.stringify(log.body)).toBe(200);
    // rework open: the operation cannot close
    const blocked = await v.call('post', `/mfg/orders/${s.order.id}/ops/${op2.id}/complete`, {});
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain('rework');
    const rw = body(await v.call('get', `/mfg/rework?orderId=${s.order.id}&status=Open`));
    expect(rw).toHaveLength(1);
    // finish: both pieces are good again; the counts must add up
    expect(
      (await v.call('post', `/mfg/rework/${rw[0].id}/finish`, { qtyOk: 1, qtyScrap: 0 })).status,
    ).toBe(422);
    const fin = await v.call('post', `/mfg/rework/${rw[0].id}/finish`, { qtyOk: 2, qtyScrap: 0 });
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    // no inspection yet
    const noInsp = await v.call('post', `/mfg/orders/${s.order.id}/ops/${op2.id}/complete`, {});
    expect(noInsp.status).toBe(422);
    expect(noInsp.body.error.code).toBe('MFG_INSPECTION_PENDING');
    // the in-process sheet is created from the order
    const lot = await v.call('post', `/mfg/orders/${s.order.id}/ops/${op2.id}/inspection`, {});
    expect(lot.status, JSON.stringify(lot.body)).toBe(200);
    const lots = body(lot).lots;
    expect(lots).toHaveLength(1);
    expect(lots[0].kind).toBe('OP');
    expect(Number(lots[0].lotQty)).toBe(8);
    const sheetId = lots[0].inspectionId;
    let sheet = body(await v.call('get', `/qms/inspections/${sheetId}`));
    expect(sheet.kind).toBe('IN_PROCESS');
    expect(sheet.sourceType).toBe('MFG_LOT');
    // readings, submit, still no decision -> the operation is still blocked
    const filled = await patch(
      `/qms/inspections/${sheetId}`,
      { rows: [{ label: 'Flange width', rowType: 'NUMERIC', lsl: 9, usl: 11, readings: ['10'] }] },
      ifm(sheet.version),
    );
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    sheet = body(filled);
    const sub = await v.call('post', `/qms/inspections/${sheetId}/submit`, {}, ifm(sheet.version));
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const stillBlocked = await v.call(
      'post',
      `/mfg/orders/${s.order.id}/ops/${op2.id}/complete`,
      {},
    );
    expect(stillBlocked.status).toBe(422);
    expect(JSON.stringify(stillBlocked.body)).toContain('Usage Decision');
    // the decision accepts all 8
    const dec = await v.call('post', `/qms/inspections/${sheetId}/decide`, {
      acceptedQty: 8,
      rejectedQty: 0,
    });
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
    const ok = await v.call('post', `/mfg/orders/${s.order.id}/ops/${op2.id}/complete`, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    s.order = body(ok);
    expect(s.order.status).toBe('Completed');
    expect(Number(s.order.qtyCompleted)).toBe(8);
  });

  it('receives finished goods only after a positive Usage Decision, at the material cost', async () => {
    const { v, fx } = ctx;
    const lot = await v.call('post', `/mfg/orders/${s.order.id}/fg-lots`, {});
    expect(lot.status, JSON.stringify(lot.body)).toBe(200);
    const fgLot = body(lot).lots.find((l: any) => l.kind === 'FG');
    expect(Number(fgLot.lotQty)).toBe(8);
    // nothing more can go into a lot
    expect((await v.call('post', `/mfg/orders/${s.order.id}/fg-lots`, {})).status).toBe(422);
    // received before any decision -> refused
    const early = await v.call('post', `/mfg/orders/${s.order.id}/receive`, {
      lotId: fgLot.id,
      qty: 1,
    });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('MFG_INSPECTION_PENDING');

    const cust = await prisma.customer.create({
      data: {
        code: `C${tag()}`.slice(0, 28),
        name: `Cust ${tag()}`,
        nameKey: `c-${tag()}`.toLowerCase(),
        stateCode: '27',
        gstRegistrationType: 'UNREGISTERED',
        approvalStatus: 'APPROVED',
      },
    });
    s.cust = cust;
    let sheet = body(await v.call('get', `/qms/inspections/${fgLot.inspectionId}`));
    expect(sheet.kind).toBe('PRE_DISPATCH');
    const filled = await patch(
      `/qms/inspections/${fgLot.inspectionId}`,
      {
        header: { ...sheet.header, customer: cust.id, challan_no: 'CH-1', in_charge: 'QA' },
        rows: [
          { label: 'Overall dimension', rowType: 'NUMERIC', lsl: 9, usl: 11, readings: ['10'] },
        ],
      },
      ifm(sheet.version),
    );
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    sheet = body(filled);
    const sub = await v.call(
      'post',
      `/qms/inspections/${fgLot.inspectionId}/submit`,
      {},
      ifm(sheet.version),
    );
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    // 7 accepted, 1 rejected (a reason is required)
    const dec = await v.call('post', `/qms/inspections/${fgLot.inspectionId}/decide`, {
      acceptedQty: 7,
      rejectedQty: 1,
      note: 'Dent on the rim',
    });
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);

    expect(
      (await v.call('post', `/mfg/orders/${s.order.id}/receive`, { lotId: fgLot.id, qty: 8 }))
        .status,
    ).toBe(422);
    const rec = await v.call(
      'post',
      `/mfg/orders/${s.order.id}/receive`,
      { lotId: fgLot.id, qty: 7 },
      { 'Idempotency-Key': `rcv-${tag()}` },
    );
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    // material cost: RM1 20 x 10 + RM2 10 x 5 = 250; spread over the 8 good pieces = 31.25; 7 pieces = 218.75
    expect(await balance(s.fg.id, fx.warehouse2Id)).toMatchObject({ onHand: 7, value: 218.75 });
    const o = body(rec);
    expect(Number(o.qtyReceived)).toBe(7);
    expect(o.moves.map((m: any) => m.kind)).toEqual(['ISSUE', 'RETURN', 'FG_RECEIPT']);
    // the rejected piece sits in the rejection register as well
    const rejs = body(await v.call('get', '/qms/rejections?q=Dent%20on%20the%20rim'));
    expect(rejs.length).toBeGreaterThan(0);
    // stock value equals the GL: the journal of each move balances (posting checks it) and the ledger rows exist
    const led = await prisma.stockLedger.count({
      where: { voucherId: { in: o.moves.map((m: any) => m.id) } },
    });
    expect(led).toBeGreaterThanOrEqual(4);
    s.order = o;
  });

  it('closes the order once every finished piece is in stock or rejected, and shows the cost', async () => {
    const { v } = ctx;
    const closed = await v.call(
      'post',
      `/mfg/orders/${s.order.id}/close`,
      { note: 'done' },
      ifm(s.order.version),
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(body(closed).status).toBe('Closed');
    // costing: material 250 + conversion (120 min + 60 min at 60/h = 180) = 430 over 8 good pieces
    const cost = body(await v.call('get', '/mfg/costing'));
    const row = cost.find((c: any) => c.id === s.order.id);
    expect(row).toMatchObject({
      material: '250.00',
      conversion: '180.00',
      total: '430.00',
      unitCost: '53.7500',
    });
    // WIP: nothing is released, a closed order is not WIP
    const wip = body(await v.call('get', '/mfg/wip'));
    expect(wip.some((w: any) => w.id === s.order.id)).toBe(false);
    const floor = body(await v.call('get', '/mfg/shopfloor'));
    expect(floor.orders).toBeDefined();
    // a closed order accepts no more changes
    expect(
      (
        await v.call('post', `/mfg/orders/${s.order.id}/issue`, {
          lines: [{ materialId: s.m2.id, qty: 1 }],
        })
      ).status,
    ).toBe(409);
  });

  it('cancels a planned order only while no material is with it', async () => {
    const { v, fx } = ctx;
    const o = body(
      await v.call('post', '/mfg/orders', {
        itemId: s.fg.id,
        qty: 1,
        dueDate: TODAY,
        warehouseId: fx.warehouse2Id,
        rmWarehouseId: fx.warehouseId,
      }),
    );
    const c = await v.call(
      'post',
      `/mfg/orders/${o.id}/cancel`,
      { reason: 'Customer withdrew' },
      ifm(o.version),
    );
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(body(c).status).toBe('Cancelled');
  });
});

describe('MRP', () => {
  it('nets demand against stock and open supply, raises a requisition and planned orders once', async () => {
    const { v, fx } = ctx;
    // a second finished good made from the customer's own material
    s.fg2 = await mkItem({ itemType: 'Finished Good', baseUom: 'Nos' });
    s.cs = await mkItem({ isCustomerSupplied: true });
    const b2 = body(
      await v.call('post', '/mfg/boms', {
        itemId: s.fg2.id,
        lines: [{ itemId: s.cs.id, qtyPer: 1 }],
      }),
    );
    expect((await v.call('post', `/mfg/boms/${b2.id}/activate`, {}, ifm(b2.version))).status).toBe(
      200,
    );
    // independent forecasts for this month
    const by = fx.ownerId;
    for (const [item, qty] of [
      [s.fg.id, 100],
      [s.fg2.id, 10],
    ] as const)
      await prisma.$executeRawUnsafe(
        `INSERT INTO demand_forecasts (unit_id, item_id, month, qty, created_by_id) VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5::uuid)`,
        fx.unitId,
        item,
        MONTH,
        qty,
        by,
      );
    const end = new Date(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5, 7)), 0).getDate();
    const run = await v.call('post', '/mfg/mrp', {
      fromDate: `${MONTH}-01`,
      toDate: `${MONTH}-${String(end).padStart(2, '0')}`,
    });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    s.run = body(run);
    const by2 = Object.fromEntries(s.run.lines.map((l: any) => [l.itemId, l]));
    // FG: 100 forecast - 7 in stock = 93 to produce; RM1 93 x 2 x 1.05 = 195.3 less 80 in stock = 115.3 to buy; RM2 covered
    expect(by2[s.fg.id]).toMatchObject({ action: 'PRODUCE', onHandQty: '7', netQty: '93' });
    expect(by2[s.rm1.id]).toMatchObject({ action: 'BUY', netQty: '115.3' });
    expect(by2[s.rm2.id].action).toBe('NONE');
    // the customer's material is shown but never bought
    expect(by2[s.cs.id]).toMatchObject({ action: 'CUSTOMER', netQty: '10' });
    expect(s.run.lines.some((l: any) => l.action === 'BUY' && l.itemId === s.cs.id)).toBe(false);

    // apply needs the warehouses for the new orders
    expect(
      (await v.call('post', `/mfg/mrp/${s.run.id}/apply`, {}, ifm(s.run.version))).status,
    ).toBe(422);
    const ap = await v.call(
      'post',
      `/mfg/mrp/${s.run.id}/apply`,
      { warehouseId: fx.warehouse2Id, rmWarehouseId: fx.warehouseId },
      { ...ifm(s.run.version), 'Idempotency-Key': `mrp-${tag()}` },
    );
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const applied = body(ap);
    expect(applied.status).toBe('Applied');
    expect(applied.prNumber).toBeTruthy();
    const pr = await prisma.$queryRawUnsafe<any[]>(
      `SELECT l.qty::text AS q, p.status FROM purchase_requisition_lines l JOIN purchase_requisitions p ON p.id=l.pr_id WHERE p.id=$1::uuid`,
      applied.prId,
    );
    expect(pr).toHaveLength(1);
    expect(Number(pr[0].q)).toBe(115.3);
    expect(pr[0].status).toBe('Draft');
    const orders = body(await v.call('get', '/mfg/orders?status=Planned'));
    expect(
      orders.filter((o: any) => o.sourceType === 'MRP' && o.sourceId === s.run.id),
    ).toHaveLength(2);
    // applying again is refused
    expect(
      (
        await v.call(
          'post',
          `/mfg/mrp/${s.run.id}/apply`,
          { warehouseId: fx.warehouse2Id, rmWarehouseId: fx.warehouseId },
          ifm(applied.version),
        )
      ).status,
    ).toBe(409);

    // a second run sees the planned orders and the draft requisition as supply: nothing is asked twice
    const run2 = body(
      await v.call('post', '/mfg/mrp', {
        fromDate: `${MONTH}-01`,
        toDate: `${MONTH}-${String(end).padStart(2, '0')}`,
      }),
    );
    expect(
      run2.lines.filter((l: any) => l.action === 'BUY' || l.action === 'PRODUCE'),
    ).toHaveLength(0);
    // a customer-supplied component cannot be issued without the customer's lot
    const planned = orders.find((o: any) => o.itemId === s.fg2.id);
    const full = body(await v.call('get', `/mfg/orders/${planned.id}`));
    const rel = await v.call('post', `/mfg/orders/${planned.id}/release`, {}, ifm(full.version));
    expect(rel.status, JSON.stringify(rel.body)).toBe(422); // no routing for FG2 yet
    const issueCs = await v.call('post', `/mfg/orders/${planned.id}/issue`, {
      lines: [{ materialId: full.materials[0].id, qty: 1 }],
    });
    expect(issueCs.status).toBe(409); // not released
    expect(full.materials[0].customerSupplied).toBe(true);
    // cancel the unused second run
    expect((await v.call('post', `/mfg/mrp/${run2.id}/cancel`, {}, ifm(run2.version))).status).toBe(
      200,
    );
  });
});

describe('daily board and job work', () => {
  it('keeps the daily line plan with its totals', async () => {
    const { v } = ctx;
    const a = await v.call('post', '/mfg/plan', {
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
    await v.call('post', '/mfg/plan', { planDate: TODAY, lineQty: 50 });
    const list = await v.call('get', `/mfg/plan?from=${TODAY}&to=${TODAY}`);
    expect(list.status).toBe(200);
    expect(body(list)).toHaveLength(2);
    expect(Number(list.body.meta.totals.lineQty)).toBe(150);
    const row = body(a);
    const up = await patch(`/mfg/plan/${row.id}`, { dispatchQty: 25 }, ifm(row.version));
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect((await v.call('delete', `/mfg/plan/${row.id}`)).status).toBe(204);
    expect(body(await v.call('get', `/mfg/plan?from=${TODAY}&to=${TODAY}`))).toHaveLength(1);
  });

  it('keeps inward / outward balances per customer PO line and the rework register per challan', async () => {
    const { v } = ctx;
    const line = await v.call('post', '/mfg/jobwork/lines', {
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
        await v.call('post', `/mfg/jobwork/lines/${id}/moves`, {
          direction: 'OUTWARD',
          qty: 5,
          docNo: 'DC-1',
        })
      ).status,
    ).toBe(422);
    const inw = await v.call('post', `/mfg/jobwork/lines/${id}/moves`, {
      direction: 'INWARD',
      qty: 60,
      docNo: 'CC-1',
    });
    expect(inw.status, JSON.stringify(inw.body)).toBe(200);
    const out = await v.call('post', `/mfg/jobwork/lines/${id}/moves`, {
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
        await v.call('post', `/mfg/jobwork/lines/${id}/moves`, {
          direction: 'OUTWARD',
          qty: 21,
          docNo: 'DC-2',
        })
      ).status,
    ).toBe(422);
    // the receipt cannot be cancelled while goods went out against it
    const inId = body(out).moves.find((m: any) => m.direction === 'INWARD').id;
    expect((await v.call('post', `/mfg/jobwork/lines/${id}/moves/${inId}/cancel`, {})).status).toBe(
      409,
    );
    expect(
      (
        await v.call('post', '/mfg/jobwork/lines', {
          customerId: s.cust.id,
          customerPoNo: 'CPO-1',
          part: 'Bracket',
          poQty: 5,
          uom: 'Nos',
        })
      ).status,
    ).toBe(422);

    const rw = await v.call('post', '/mfg/challan-rework', {
      customerId: s.cust.id,
      challanNo: 'CUST-DC-9',
      challanDate: TODAY,
      part: 'Bracket',
      challanQty: 10,
    });
    expect(rw.status, JSON.stringify(rw.body)).toBe(201);
    const rid = body(rw).id;
    expect(body(rw).balanceQty).toBe('10.000');
    const d1 = await v.call('post', `/mfg/challan-rework/${rid}/done`, {
      qty: 4,
      doneChallanNo: 'OUR-DC-3',
    });
    expect(d1.status, JSON.stringify(d1.body)).toBe(200);
    expect(body(d1).balanceQty).toBe('6.000');
    expect(
      (
        await v.call('post', `/mfg/challan-rework/${rid}/done`, {
          qty: 7,
          doneChallanNo: 'OUR-DC-4',
        })
      ).status,
    ).toBe(422);
    const open = body(await v.call('get', '/mfg/challan-rework?open=true'));
    expect(open.some((r: any) => r.id === rid)).toBe(true);
  });
});

describe('rework cost, outside processing, capacity, print and export', () => {
  it('charges rework minutes, runs an outside operation and costs it', async () => {
    const { v, fx } = ctx;
    s.fg3 = await mkItem({ itemType: 'Finished Good', baseUom: 'Nos' });
    const out = await v.call('post', '/mfg/work-centres', {
      code: `PLT${tag()}`,
      name: 'Plating (outside)',
      kind: 'OUTSIDE',
      assetRef: 'EXT-1',
    });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    s.wcOut = body(out);
    expect(s.wcOut.assetRef).toBe('EXT-1');
    const wc1 = body(await v.call('get', '/mfg/work-centres?size=200')).find(
      (w: any) => w.id === s.wc1.id,
    );
    const up = await patch(`/mfg/work-centres/${s.wc1.id}`, { assetRef: 'M-12' }, ifm(wc1.version));
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(body(up).assetRef).toBe('M-12');

    const bom = body(
      await v.call('post', '/mfg/boms', {
        itemId: s.fg3.id,
        lines: [{ itemId: s.rm2.id, qtyPer: 1 }],
      }),
    );
    expect(
      (await v.call('post', `/mfg/boms/${bom.id}/activate`, {}, ifm(bom.version))).status,
    ).toBe(200);
    const rt = body(
      await v.call('post', '/mfg/routings', {
        itemId: s.fg3.id,
        ops: [
          { seq: 10, name: 'Cutting', workCentreId: s.wc1.id, runMinutes: 1 },
          { seq: 20, name: 'Plating', workCentreId: s.wcOut.id },
        ],
      }),
    );
    expect(
      (await v.call('post', `/mfg/routings/${rt.id}/activate`, {}, ifm(rt.version))).status,
    ).toBe(200);
    const o = body(
      await v.call('post', '/mfg/orders', {
        itemId: s.fg3.id,
        qty: 10,
        dueDate: TODAY,
        warehouseId: fx.warehouse2Id,
        rmWarehouseId: fx.warehouseId,
      }),
    );
    const rel = body(await v.call('post', `/mfg/orders/${o.id}/release`, {}, ifm(o.version)));
    const [op1, op2] = rel.ops;
    const iss = await v.call('post', `/mfg/orders/${o.id}/issue`, {
      lines: [{ materialId: rel.materials[0].id, qty: 10 }],
    });
    expect(iss.status, JSON.stringify(iss.body)).toBe(200);

    // the load on the work centres
    const cap = await v.call('get', '/mfg/capacity?workDays=0,1,2,3,4,5,6');
    expect(cap.status, JSON.stringify(cap.body)).toBe(200);
    const capData = body(cap);
    expect(capData.ops.some((x: any) => x.opId === op1.id && x.start)).toBe(true);
    expect(capData.orders.find((x: any) => x.orderId === o.id)).toBeTruthy();

    // 8 good and 2 for rework; the rework takes 30 minutes at 60 an hour
    expect(
      (
        await v.call('post', `/mfg/orders/${o.id}/ops/${op1.id}/log`, {
          good: 8,
          rework: 2,
          reason: 'Burr',
        })
      ).status,
    ).toBe(200);
    const rw = body(await v.call('get', `/mfg/rework?orderId=${o.id}&status=Open`));
    const fin = await v.call('post', `/mfg/rework/${rw[0].id}/finish`, {
      qtyOk: 2,
      qtyScrap: 0,
      minutes: 30,
    });
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect(Number(body(fin).cost)).toBe(30);
    expect((await v.call('post', `/mfg/orders/${o.id}/ops/${op1.id}/complete`, {})).status).toBe(
      200,
    );

    // the outside operation cannot be logged like a shop-floor one
    expect(
      (await v.call('post', `/mfg/orders/${o.id}/ops/${op2.id}/log`, { good: 1 })).status,
    ).toBe(409);
    const sup = await mkSupplier();
    const send = { direction: 'SENT', qty: 10, docNo: 'JW-DC-1', supplierId: sup.id };
    expect((await v.call('post', `/mfg/orders/${o.id}/ops/${op2.id}/outside`, send)).status).toBe(
      200,
    );
    // nothing more is left to send
    expect(
      (
        await v.call('post', `/mfg/orders/${o.id}/ops/${op2.id}/outside`, {
          ...send,
          qty: 1,
          docNo: 'JW-DC-2',
        })
      ).status,
    ).toBe(422);
    // more than is with the supplier
    const recv = { direction: 'RECEIVED', docNo: 'IN-1', supplierId: sup.id, rate: 2.5 };
    expect(
      (await v.call('post', `/mfg/orders/${o.id}/ops/${op2.id}/outside`, { ...recv, qty: 11 }))
        .status,
    ).toBe(422);
    // scrap needs a reason
    expect(
      (
        await v.call('post', `/mfg/orders/${o.id}/ops/${op2.id}/outside`, {
          ...recv,
          qty: 9,
          qtyScrap: 1,
        })
      ).status,
    ).toBe(422);
    const back = await v.call('post', `/mfg/orders/${o.id}/ops/${op2.id}/outside`, {
      ...recv,
      qty: 9,
      qtyScrap: 1,
      reason: 'Plating burn',
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const done = await v.call('post', `/mfg/orders/${o.id}/ops/${op2.id}/complete`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const fo = body(done);
    expect(fo.status).toBe('Completed');
    expect(Number(fo.qtyCompleted)).toBe(9);
    // 10 pieces processed at 2.5
    expect(fo.cost.outside).toBe('25.00');
    const cost = body(await v.call('get', '/mfg/costing')).find((c: any) => c.id === o.id);
    expect(cost).toMatchObject({ outside: '25.00', reworkCost: '30.00' });
    // material 10 x 5 = 50, rework minutes 30 at 60/h = 30, outside 25
    expect(cost.total).toBe('105.00');
    s.order3 = o;
  });

  it('prints PDFs and exports the registers to Excel', async () => {
    const { v } = ctx;
    const pdf = await v
      .call('get', `/mfg/orders/${s.order3.id}/print`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    for (const path of [
      `/mfg/boms/${s.bom.id}/print`,
      `/mfg/routings/${s.rt.id}/print`,
      `/mfg/mrp/${s.run.id}/print`,
    ]) {
      const r = await v.call('get', path);
      expect(r.status, path).toBe(200);
      expect(r.headers['content-type']).toContain('application/pdf');
    }
    for (const rep of [
      'orders',
      'scrap',
      'rework',
      'wip',
      'costing',
      'plan',
      'jobwork',
      'challan-rework',
      'boms',
      'routings',
    ]) {
      const r = await v.call('get', `/mfg/export/${rep}`);
      expect(r.status, rep).toBe(200);
      expect(r.headers['content-type'], rep).toContain('spreadsheetml');
    }
    expect((await v.call('get', `/mfg/mrp/${s.run.id}/export`)).status).toBe(200);
    expect((await v.call('get', '/mfg/export/nothing')).status).toBe(422);
    // a plain employee gets neither
    const emp = await signInAs(app, 'EMPLOYEE');
    const ev = vclient(app, emp, ctx.fx.unitId);
    expect((await ev.call('get', '/mfg/export/orders')).status).toBe(403);
    expect((await ev.call('get', `/mfg/orders/${s.order3.id}/print`)).status).toBe(403);
  });
});
