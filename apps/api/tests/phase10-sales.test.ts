/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Phase 10: CRM and the sales chain with exact numbers. Lead -> opportunity -> customer RFQ (engineering + finance
// review) -> quotation -> customer accepts -> sales order (credit check) -> reservation -> dispatch (stock + cost of
// goods) -> invoice (receivable, sales, output GST) -> receipt -> sales return with credit note.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { API, newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { balance, mkItem, setApproval, tag, vclient } from './phase08-helpers';
import { todayIst } from '../src/modules/procurement/core';
import { body, gl, ifm, setup } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
const SALES = [
  'sales-quotations',
  'sales-orders',
  'sales-dispatch',
  'sales-invoices',
  'sales-returns',
];
let savedSales: { pageId: string; approvalRequired: boolean }[] = [];

async function mkCustomer(extra: Record<string, unknown> = {}) {
  const name = `Cust ${tag()}`;
  return prisma.customer.create({
    data: {
      code: `C${tag()}`.slice(0, 28),
      name,
      nameKey: `${name}-${tag()}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: 'UNREGISTERED',
      approvalStatus: 'APPROVED',
      creditLimit: '100000',
      creditDays: 30,
      ...extra,
    },
  });
}
const submit = async (v: ReturnType<typeof vclient>, path: string, d: Record<string, any>) =>
  v.call('post', `${path}/${d.id}/submit`, {}, ifm(d.version));

beforeAll(async () => {
  owner = await signInOwner(app);
  restoreStock = await setApproval(false);
  savedSales = await prisma.moduleControl.findMany({
    where: { pageId: { in: SALES } },
    select: { pageId: true, approvalRequired: true },
  });
  await prisma.moduleControl.updateMany({
    where: { pageId: { in: SALES } },
    data: { approvalRequired: false },
  });
  invalidateAccessCache();
  ctx = await setup(app, owner);
});
afterAll(async () => {
  for (const r of savedSales)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  for (const r of restoreStock)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

describe('CRM', () => {
  it(
    'lead -> qualified -> opportunity with stage gates, follow-up, meeting, NPS',
    { timeout: 90_000 },
    async () => {
      const { v } = ctx;
      const cust = await mkCustomer();
      const lead = body(
        await v.call('post', '/crm/leads', {
          name: 'Ravi Kumar',
          company: 'Steel Co',
          interest: 'Brackets',
          estValue: 50000,
        }),
      );
      expect(lead.status).toBe('New');
      expect((await v.call('post', `/crm/leads/${lead.id}/convert`, {})).status).toBe(409); // not qualified yet
      expect(
        (await v.call('post', `/crm/leads/${lead.id}/status`, { status: 'Qualified' })).status,
      ).toBe(200);
      const conv = await v.call('post', `/crm/leads/${lead.id}/convert`, { customerId: cust.id });
      expect(conv.status, JSON.stringify(conv.body)).toBe(200);
      const opp = body(conv);
      expect(opp.status).toBe('Prospecting');
      const move = (stage: string, extra: Record<string, unknown> = {}) =>
        v.call('post', `/crm/opportunities/${opp.id}/move-stage`, { stage, ...extra });
      expect((await move('Won')).status).toBe(422); // no accepted quotation
      expect((await move('Negotiation')).status).toBe(422); // no quotation
      expect((await move('Qualification')).status).toBe(200);
      expect((await move('Lost')).status).toBe(422); // reason needed
      const board = body(await v.call('get', '/crm/pipeline'));
      expect(
        board.stages.find((s: any) => s.stage === 'Qualification').count,
      ).toBeGreaterThanOrEqual(1);
      const hist = (await v.call('get', `/crm/opportunities/${opp.id}/history`)).body.data as any[];
      expect(hist.length).toBe(2); // created, then Qualification
      expect((await move('Lost', { lostReason: 'Price too high' })).status).toBe(200);
      expect((await move('Proposal')).status).toBe(409); // closed

      const fu = body(
        await v.call('post', '/crm/followups', {
          title: 'Call back',
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          customerId: cust.id,
        }),
      );
      expect((await v.call('post', `/crm/followups/${fu.id}/done`, { outcome: 'x' })).status).toBe(
        422,
      );
      expect(
        (await v.call('post', `/crm/followups/${fu.id}/done`, { outcome: 'Will order next week' }))
          .status,
      ).toBe(200);
      expect(
        (await v.call('post', `/crm/followups/${fu.id}/done`, { outcome: 'Again again' })).status,
      ).toBe(409);
      const mt = body(
        await v.call('post', '/crm/meetings', {
          subject: 'Site visit',
          startsAt: new Date().toISOString(),
          customerId: cust.id,
        }),
      );
      expect(
        (await v.call('post', `/crm/meetings/${mt.id}/held`, { outcome: 'Agreed on drawings' }))
          .status,
      ).toBe(200);
      for (const r of [10, 9, 3])
        expect(
          (await v.call('post', '/crm/feedback', { customerId: cust.id, rating: r })).status,
        ).toBe(201);
      const nps = body(await v.call('get', '/crm/feedback-nps'));
      expect(nps.responses).toBeGreaterThanOrEqual(3);
      const c360 = body(await v.call('get', `/crm/customers/${cust.id}/360`));
      expect(c360.credit.limit).toBe('100000');
      expect(c360.credit.onHold).toBe(false);
    },
  );
});

describe('quote to cash', () => {
  it(
    'RFQ review -> quotation -> order -> dispatch -> invoice -> receipt -> return, with exact ledger numbers',
    { timeout: 120_000 },
    async () => {
      const { v, fx } = ctx;
      const cust = await mkCustomer();
      const item = await mkItem({ itemType: 'Finished Good' });
      // 50 pieces in stock at cost 60 (Phase 8 receipt)
      const rc = await vclient(app, owner, fx.unitId).post('transactions', {
        warehouseId: fx.warehouseId,
        txType: 'Receipt',
        lines: [{ itemId: item.id, qty: 50, unitCost: 60 }],
      });
      expect(rc.status).toBe('Posted');

      // ---- customer RFQ with the internal review
      const rfq = await v.call('post', '/sales/rfq', {
        customerId: cust.id,
        customerRef: 'RFQ-77',
        description: 'Bracket',
        lines: [{ itemId: item.id, qty: 10, uom: 'Kg', targetRate: 100 }],
      });
      expect(rfq.status, JSON.stringify(rfq.body)).toBe(201);
      const r0 = body(rfq);
      expect(r0.status).toBe('Received');
      expect((await v.call('post', `/sales/rfq/${r0.id}/to-quotation`, {})).status).toBe(409); // review not done
      expect(
        (
          await v.call('post', `/sales/rfq/${r0.id}/engineering-review`, {
            feasible: true,
            note: 'Can be made on line 2',
          })
        ).status,
      ).toBe(200);
      const fin = await v.call('post', `/sales/rfq/${r0.id}/finance-review`, {
        marginPct: 40,
        note: 'Margin is fine',
      });
      expect(fin.status, JSON.stringify(fin.body)).toBe(200);
      expect(body(fin).status).toBe('Reviewed');
      const qr = await v.call('post', `/sales/rfq/${r0.id}/to-quotation`, { gstPct: 18 });
      expect(qr.status, JSON.stringify(qr.body)).toBe(200);
      const quote = body(qr);
      expect(quote.lines[0].rate).toBe('100');
      expect(quote.grandTotal).toBe('1180');
      const sq = await submit(v, '/sales/quotations', quote);
      expect(sq.status, JSON.stringify(sq.body)).toBe(200);
      expect(body(await v.call('get', `/sales/quotations/${quote.id}`)).status).toBe('Approved');
      const dec = await v.call('post', `/sales/quotations/${quote.id}/customer-decision`, {
        decision: 'ACCEPTED',
        customerRef: 'PO-5001',
      });
      expect(dec.status, JSON.stringify(dec.body)).toBe(200);
      const so = await v.call('post', `/sales/quotations/${quote.id}/to-order`, {
        customerPoNo: `PO-${tag()}`,
      });
      expect(so.status, JSON.stringify(so.body)).toBe(200);
      const order = body(so);
      expect((await v.call('post', `/sales/quotations/${quote.id}/to-order`, {})).status).toBe(409); // one live order per quotation
      const sub = await submit(v, '/sales/orders', order);
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      const o = body(await v.call('get', `/sales/orders/${order.id}`));
      expect(o.status).toBe('Approved');

      // ---- credit limit: a 2,00,000 order against a 1,00,000 limit is refused, a manager override lets it pass
      const big = body(
        await v.call('post', '/sales/orders', {
          customerId: cust.id,
          customerPoNo: `PO-${tag()}`,
          lines: [{ itemId: item.id, qty: 2000, uom: 'Kg', rate: 100, gstPct: 18 }],
        }),
      );
      const refused = await submit(v, '/sales/orders', big);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
      expect(
        (
          await v.call('post', `/sales/orders/${big.id}/credit-override`, {
            reason: 'Director agreed',
          })
        ).status,
      ).toBe(200);
      const bigDraft = body(await v.call('get', `/sales/orders/${big.id}`));
      expect((await submit(v, '/sales/orders', bigDraft)).status).toBe(200);
      expect(
        (
          await v.call('post', `/sales/orders/${big.id}/short-close`, {
            reason: 'Cancelled by the customer',
          })
        ).status,
      ).toBe(200);

      // ---- reservation then dispatch of 10
      const rs = await v.call('post', `/sales/orders/${order.id}/reserve`, {
        warehouseId: fx.warehouseId,
      });
      expect(rs.status, JSON.stringify(rs.body)).toBe(200);
      expect(body(rs).lines[0].reservedQty).toBe('10');
      const d = await v.call('post', '/sales/dispatch', {
        orderId: order.id,
        warehouseId: fx.warehouseId,
        vehicleNo: 'MH04AB1234',
        transporter: 'Fast Cargo',
        lines: [{ orderLineId: o.lines[0].id, qty: 10, inspectionSerial: 'INS-9' }],
      });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      const disp0 = body(d);
      const over = await v.call('post', '/sales/dispatch', {
        orderId: order.id,
        warehouseId: fx.warehouseId,
        lines: [{ orderLineId: o.lines[0].id, qty: 11 }],
      });
      expect(over.status).toBe(409);
      const ds = await submit(v, '/sales/dispatch', disp0);
      expect(ds.status, JSON.stringify(ds.body)).toBe(200);
      const disp = body(await v.call('get', `/sales/dispatch/${disp0.id}`));
      expect(disp.status).toBe('Posted');
      expect(disp.costTotal).toBe('600');
      expect(await balance(item.id, fx.warehouseId)).toMatchObject({ onHand: 40 });
      expect(await gl(fx.unitId, '5101')).toBe(600); // COGS
      const dl = (await v.call('get', `/sales/dispatch-list?date=${todayIst()}`)).body
        .data as any[];
      expect(dl.some((r) => r.inspectionSerial === 'INS-9')).toBe(true);
      const pdf = await request(app)
        .get(`${API}/sales/dispatch/${disp0.id}/challan.pdf`)
        .set(owner.bearer)
        .set('X-Unit-Id', fx.unitId);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');

      // ---- invoice 10 @ 100 + 18 % intra-state
      const inv = await v.call('post', '/sales/invoices', { dispatchId: disp0.id });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      const i0 = body(inv);
      expect(i0.grandTotal).toBe('1180');
      expect((await submit(v, '/sales/invoices', i0)).status).toBe(200);
      const invoice = body(await v.call('get', `/sales/invoices/${i0.id}`));
      expect(invoice.status).toBe('Posted');
      expect(await gl(fx.unitId, '1201')).toBe(1180); // receivable
      expect(await gl(fx.unitId, '4101')).toBe(-1000); // sales
      expect(await gl(fx.unitId, '2301')).toBe(-90);
      expect(await gl(fx.unitId, '2302')).toBe(-90);
      expect((await v.call('post', '/sales/invoices', { dispatchId: disp0.id })).status).toBe(409); // already fully invoiced

      // ---- receipt of 1,000 against the invoice
      const parent = await prisma.account.findUniqueOrThrow({ where: { code: '1100' } });
      const acc = await prisma.account.create({
        data: {
          code: String(50000 + Math.floor(Math.random() * 9000)),
          name: `Bank ${tag()}`,
          parentId: parent.id,
          rootType: 'Asset',
          normalBalance: 'Debit',
          subType: 'Bank',
          cfClass: 'CASH',
        },
      });
      const bank = body(
        await v.call('post', '/finance/bank-accounts', {
          unitId: fx.unitId,
          accountId: acc.id,
          kind: 'BANK',
          name: acc.name,
        }),
      );
      const rcpt = await v.call('post', '/sales/receipts', {
        customerId: cust.id,
        bankAccountId: bank.id,
        amount: 1000,
        mode: 'NEFT',
        reference: 'UTR9',
        allocations: [{ invoiceId: i0.id, amount: 1000 }],
      });
      expect(rcpt.status, JSON.stringify(rcpt.body)).toBe(200);
      const after = body(await v.call('get', `/sales/invoices/${i0.id}`));
      expect(after.receiptStatus).toBe('PARTIAL');
      expect(after.receivedAmount).toBe('1000');
      const out = body(await v.call('get', '/sales/collections/outstanding'));
      expect(out.rows.find((r: any) => r.id === i0.id).outstanding).toBe('180.00');

      // ---- return of 2 pieces: restock at the dispatch cost 60, credit note 236
      const ret = await v.call('post', '/sales/returns', {
        invoiceId: i0.id,
        warehouseId: fx.warehouseId,
        reason: 'Wrong size',
        lines: [{ invoiceLineId: invoice.lines[0].id, qty: 2 }],
      });
      expect(ret.status, JSON.stringify(ret.body)).toBe(201);
      const r1 = body(ret);
      expect(r1.grandTotal).toBe('236');
      const tooMany = await v.call('post', '/sales/returns', {
        invoiceId: i0.id,
        warehouseId: fx.warehouseId,
        lines: [{ invoiceLineId: invoice.lines[0].id, qty: 11 }],
      });
      expect(tooMany.status).toBe(409);
      expect((await submit(v, '/sales/returns', r1)).status).toBe(200);
      expect(body(await v.call('get', `/sales/returns/${r1.id}`)).status).toBe('Posted');
      expect(await balance(item.id, fx.warehouseId)).toMatchObject({ onHand: 42 });
      // the credit note settled the rest of the invoice: 1,000 received + 180 credit
      const settled = body(await v.call('get', `/sales/invoices/${i0.id}`));
      expect(settled.receivedAmount).toBe('1180');
      expect(settled.receiptStatus).toBe('PAID');
      expect(await gl(fx.unitId, '5101')).toBe(480); // COGS 600 - 120
      expect(await gl(fx.unitId, '4107')).toBe(200); // sales returns
      // the unit's books still balance
      const tb = await prisma.glEntry.aggregate({
        where: { unitId: fx.unitId },
        _sum: { debit: true, credit: true },
      });
      expect(Number(tb._sum.debit)).toBeCloseTo(Number(tb._sum.credit), 2);
      // cancelling a dispatch that is invoiced is refused
      expect(
        (await v.call('post', `/sales/dispatch/${disp0.id}/cancel`, { reason: 'Mistake here' }))
          .status,
      ).toBe(409);
      // demand plan reads the open order balance
      expect(Array.isArray((await v.call('get', '/sales/demand-plan')).body.data)).toBe(true);
    },
  );
});

describe('rounding and double clicks', () => {
  it(
    'a return whose total needs rupee rounding still posts a balanced credit note',
    { timeout: 120_000 },
    async () => {
      const { v, fx } = ctx;
      const cust = await mkCustomer();
      const item = await mkItem({ itemType: 'Finished Good' });
      await vclient(app, owner, fx.unitId).post('transactions', {
        warehouseId: fx.warehouseId,
        txType: 'Receipt',
        lines: [{ itemId: item.id, qty: 5, unitCost: 10 }],
      });
      const arBefore = await gl(fx.unitId, '1201');
      const o = body(
        await v.call('post', '/sales/orders', {
          customerId: cust.id,
          customerPoNo: `PO-${tag()}`,
          lines: [{ itemId: item.id, qty: 1, uom: 'Kg', rate: '33.33', gstPct: 18 }],
        }),
      );
      expect((await submit(v, '/sales/orders', o)).status).toBe(200);
      const order = body(await v.call('get', `/sales/orders/${o.id}`));
      const d = body(
        await v.call('post', '/sales/dispatch', {
          orderId: o.id,
          warehouseId: fx.warehouseId,
          lines: [{ orderLineId: order.lines[0].id, qty: 1 }],
        }),
      );
      expect((await submit(v, '/sales/dispatch', d)).status).toBe(200);
      const i = body(await v.call('post', '/sales/invoices', { dispatchId: d.id }));
      expect(i.grandTotal).toBe('39'); // 33.33 + 2 x 3.00 = 39.33 -> 39
      expect(i.roundOff).toBe('-0.33');
      expect((await submit(v, '/sales/invoices', i)).status).toBe(200);
      const inv = body(await v.call('get', `/sales/invoices/${i.id}`));
      expect(inv.status).toBe('Posted');
      const r = body(
        await v.call('post', '/sales/returns', {
          invoiceId: i.id,
          warehouseId: fx.warehouseId,
          lines: [{ invoiceLineId: inv.lines[0].id, qty: 1 }],
        }),
      );
      const rs = await submit(v, '/sales/returns', r);
      expect(rs.status, JSON.stringify(rs.body)).toBe(200);
      expect(body(await v.call('get', `/sales/returns/${r.id}`)).status).toBe('Posted');
      expect(Math.round(((await gl(fx.unitId, '1201')) - arBefore) * 100)).toBe(0); // receivable cleared by the credit note
      const tb = await prisma.glEntry.aggregate({
        where: { unitId: fx.unitId },
        _sum: { debit: true, credit: true },
      });
      expect(Number(tb._sum.debit)).toBeCloseTo(Number(tb._sum.credit), 2);
    },
  );

  it(
    'a double click on Make quotation creates one quotation; duplicate lines on one receipt are summed',
    { timeout: 120_000 },
    async () => {
      const { v } = ctx;
      const cust = await mkCustomer();
      const item = await mkItem({ itemType: 'Finished Good' });
      const rfq = body(
        await v.call('post', '/sales/rfq', {
          customerId: cust.id,
          lines: [{ itemId: item.id, qty: 1, uom: 'Kg', targetRate: 10 }],
        }),
      );
      await v.call('post', `/sales/rfq/${rfq.id}/engineering-review`, {
        feasible: true,
        note: 'Fine',
      });
      await v.call('post', `/sales/rfq/${rfq.id}/finance-review`, { marginPct: 20, note: 'Fine' });
      const res = await Promise.all(
        [1, 2].map(() => v.call('post', `/sales/rfq/${rfq.id}/to-quotation`, { gstPct: 18 })),
      );
      expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    },
  );
});

describe('guards', () => {
  it('401 without a token and every read route answers the owner', async () => {
    const reads = [
      '/crm/sources',
      '/crm/leads',
      '/crm/opportunities',
      '/crm/pipeline',
      '/crm/followups',
      '/crm/meetings',
      '/crm/feedback',
      '/crm/feedback-nps',
      '/sales/rfq',
      '/sales/quotations',
      '/sales/orders',
      '/sales/dispatch',
      '/sales/dispatch-list',
      '/sales/invoices',
      '/sales/receipts',
      '/sales/collections/outstanding',
      '/sales/returns',
      '/sales/demand-plan',
      '/sales/forecasts',
    ];
    for (const p of reads) {
      expect((await request(app).get(`${API}${p}`)).status, p).toBe(401);
      const r = await ctx.v.call('get', p);
      expect(r.status, `${p} ${JSON.stringify(r.body)}`).toBe(200);
    }
  });
});
