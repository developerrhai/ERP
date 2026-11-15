/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// V40 parity: the flat registers of the Procurement / SCM pages (/scm/v40/<kind>) carry the columns V40 shows,
// with the computed ones (pending quantity, invoice matched amount, PO balance) taken from the real chain
// PO -> GRN -> purchase invoice. Plant isolation: another plant's header never shows up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { approvalOff, body, mkGrn, mkInvoice, mkItem, mkPo, mkSupplier, setup } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let restore: () => Promise<void>;
let ctx: Awaited<ReturnType<typeof setup>>;

beforeAll(async () => {
  owner = await signInOwner(app);
  restore = await approvalOff();
  ctx = await setup(app, owner);
});
afterAll(async () => {
  await restore();
  await prisma.$disconnect();
});

async function rows(kind: string, q: string): Promise<any[]> {
  const r = await ctx.v.call('get', `/scm/v40/${kind}?q=${encodeURIComponent(q)}&size=50`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}

describe('V40 procurement registers', () => {
  it('PO / GRN / invoice rows carry pending, received, matched and balance from the real lines', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 100, 50);
    const grn = await mkGrn(v, fx, po, 60);
    const inv = await mkInvoice(v, sup.id, grn, 60, 50, { poId: po.id });

    const [p] = await rows('po', po.number);
    expect(p.number).toBe(po.number);
    expect(p.vendorId).toBe(sup.code);
    expect(p.vendor).toBe(sup.name);
    expect(p.materialCode).toBe(item.code);
    expect(Number(p.orderedQuantity)).toBe(100);
    expect(Number(p.receivedQuantity)).toBe(60);
    expect(Number(p.pendingQuantity)).toBe(40);
    expect(Number(p.rate)).toBe(50);
    expect(Number(p.gstPct)).toBe(18);
    expect(Number(p.totalAmount)).toBeCloseTo(5900, 2);
    expect(Number(p.receivedValue)).toBeCloseTo(3540, 2);
    expect(p.status).toBe('Approved');

    const [g] = await rows('grn', grn.number);
    expect(g.poNumber).toBe(po.number);
    expect(Number(g.orderedQuantity)).toBe(100);
    expect(Number(g.receivedQuantity)).toBe(60);
    expect(Number(g.poBalanceQuantity)).toBe(40);
    expect(g.vendor).toBe(sup.name);
    expect(g.warehouse).toBeTruthy();

    const [i] = await rows('invoice', inv.number);
    expect(i.vendor).toBe(sup.name);
    expect(i.grnNumber).toBe(grn.number);
    expect(Number(i.taxableValue)).toBeCloseTo(3000, 2);
    expect(Number(i.gst)).toBeCloseTo(540, 2);
    expect(Number(i.matchedAmount)).toBeGreaterThan(0);
    expect(['UNPAID', 'PARTIAL', 'PAID']).toContain(i.paymentStatus);
    expect(i.companyCode).toBeTruthy();

    const sRows = await rows('supplier', sup.code);
    expect(sRows[0].vendorId).toBe(sup.code);
    expect(sRows[0].poCount).toBe(1);
  });

  it('PR rows show the open and PO-converted quantity, contracts show committed / consumed / balance', async () => {
    const { v } = ctx;
    const item = await mkItem();
    const cc = await prisma.costCenter.findFirstOrThrow({ where: { unitId: ctx.fx.unitId } });
    const pr = body(
      await v.call('post', '/scm/pr', {
        purpose: 'V40 view',
        lines: [{ itemId: item.id, qty: 10, uom: 'Kg', estRate: 60, costCenterId: cc.id }],
      }),
    );
    const [r] = await rows('pr', pr.number);
    expect(r.materialCode).toBe(item.code);
    expect(Number(r.quantity)).toBe(10);
    expect(Number(r.openQuantity)).toBe(10);
    expect(Number(r.orderedQuantity)).toBe(0);
    expect(r.requester).toBeDefined();

    const sup = await mkSupplier();
    const con = await v.call('post', '/scm/contracts', {
      supplierId: sup.id,
      validFrom: '2026-04-01',
      validTo: '2027-03-31',
      maxValue: 100000,
      lines: [{ itemId: item.id, uom: 'Kg', rate: 55, maxQty: 500 }],
    });
    expect(con.status, JSON.stringify(con.body)).toBe(201);
    const [c] = await rows('contract', body(con).number);
    expect(Number(c.committedValue)).toBe(100000);
    expect(Number(c.consumedValue)).toBe(0);
    expect(Number(c.balanceValue)).toBe(100000);
    expect(c.releaseOrders).toBe(0);
    expect(c.vendor).toBe(sup.name);
  });

  it('refuses an unknown filter and unauthenticated calls', async () => {
    const bad = await ctx.v.call('get', '/scm/v40/po?bogus=1');
    expect(bad.status).toBe(422);
    const anon = await request(app).get('/api/v1/scm/v40/po');
    expect(anon.status).toBe(401);
  });

  it('every kind answers 200 with a list', async () => {
    for (const k of ['po', 'grn', 'pr', 'invoice', 'invoice-exceptions', 'supplier', 'rfq', 'quote', 'comparison', 'evaluation', 'contract']) {
      const r = await ctx.v.call('get', `/scm/v40/${k}?size=5`);
      expect(r.status, `${k}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
    }
  });
});
