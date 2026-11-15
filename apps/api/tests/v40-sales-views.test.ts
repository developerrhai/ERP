/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Page-by-page V40 build, sales family: every V40 tab of every CRM / Sales page answers with the columns V40 shows,
// and the numbers come from the real chain (order -> dispatch -> invoice -> receipt).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { mkItem, setApproval, tag, vclient } from './phase08-helpers';
import { body, ifm, setup } from './phase09-helpers';
import { SALES_V40_PAGES } from '../src/modules/sales/v40-views';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
let saved: { pageId: string; approvalRequired: boolean }[] = [];
const PAGES = Object.keys(SALES_V40_PAGES);

const tabsMap = JSON.parse(
  readFileSync(resolve(__dirname, '../../web/src/pages/frame/tabs-map.json'), 'utf8'),
) as Record<string, string[]>;

beforeAll(async () => {
  owner = await signInOwner(app);
  restoreStock = await setApproval(false);
  saved = await prisma.moduleControl.findMany({
    where: { pageId: { in: PAGES } },
    select: { pageId: true, approvalRequired: true },
  });
  await prisma.moduleControl.updateMany({
    where: { pageId: { in: PAGES } },
    data: { approvalRequired: false },
  });
  invalidateAccessCache();
  ctx = await setup(app, owner);
});
afterAll(async () => {
  for (const r of saved)
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

const labels = (res: any): string[] => res.body.meta.columns.map((c: any) => c.label);
const get = (path: string) => ctx.v.call('get', path);
const view = (page: string, tab: string, first = false) =>
  get(`/sales/v40/${page}?tab=${encodeURIComponent(tab)}&first=${first ? 1 : 0}&size=50`);
/** value of a V40 column in a row of the response */
const cell = (res: any, row: any, label: string): string =>
  row[res.body.meta.columns.find((c: any) => c.label === label).key];

describe('every V40 tab of every sales page answers', () => {
  it('has a tab list for each page', () => {
    for (const p of PAGES) expect(tabsMap[p]?.length ?? 0, p).toBeGreaterThan(0);
  });
  it(
    'returns 200 with the page columns on each tab (empty database included)',
    { timeout: 180_000 },
    async () => {
      const bad: string[] = [];
      for (const p of PAGES) {
        const tabs = tabsMap[p] ?? [];
        for (let i = 0; i < tabs.length; i += 1) {
          const r = await view(p, tabs[i] ?? '', i === 0);
          if (
            r.status !== 200 ||
            !Array.isArray(r.body.data) ||
            (r.body.meta?.columns?.length ?? 0) < 3
          )
            bad.push(`${p} / ${tabs[i]}: ${r.status}`);
        }
      }
      expect(bad).toEqual([]);
    },
  );
  it('refuses a page that has no V40 views', async () => {
    expect((await get('/sales/v40/scm-po?tab=x')).status).toBe(404);
  });
});

describe('sales order tabs show the real chain', () => {
  it(
    'order -> dispatch -> invoice -> receipt fills the columns of each tab',
    { timeout: 120_000 },
    async () => {
      const { v, fx } = ctx;
      const name = `Cust ${tag()}`;
      const cust = await prisma.customer.create({
        data: {
          code: `C${tag()}`.slice(0, 28),
          name,
          nameKey: `${name}-${tag()}`.toLowerCase(),
          stateCode: '27',
          gstRegistrationType: 'UNREGISTERED',
          approvalStatus: 'APPROVED',
          creditLimit: '500000',
          creditDays: 30,
        },
      });
      const item = await mkItem({ itemType: 'Finished Good' });
      await vclient(app, owner, fx.unitId).post('transactions', {
        warehouseId: fx.warehouseId,
        txType: 'Receipt',
        lines: [{ itemId: item.id, qty: 50, unitCost: 60 }],
      });
      const o0 = body(
        await v.call('post', '/sales/orders', {
          customerId: cust.id,
          customerPoNo: `PO-${tag()}`,
          lines: [{ itemId: item.id, qty: 10, uom: 'Kg', rate: 100, gstPct: 18 }],
        }),
      );
      expect(
        (await v.call('post', `/sales/orders/${o0.id}/submit`, {}, ifm(o0.version))).status,
      ).toBe(200);
      const order = body(await get(`/sales/orders/${o0.id}`));
      const d0 = body(
        await v.call('post', '/sales/dispatch', {
          orderId: o0.id,
          warehouseId: fx.warehouseId,
          vehicleNo: 'MH04AB1234',
          transporter: 'Fast Cargo',
          lines: [{ orderLineId: order.lines[0].id, qty: 4 }],
        }),
      );
      expect(
        (await v.call('post', `/sales/dispatch/${d0.id}/submit`, {}, ifm(d0.version))).status,
      ).toBe(200);

      // Order Register
      const reg = await view('sales-orders', 'Order Register', true);
      const mine = reg.body.data.find((r: any) => r.id === o0.id);
      expect(mine, 'order is listed').toBeTruthy();
      expect(labels(reg)).toEqual(
        expect.arrayContaining([
          'Sales Order ID',
          'SO No',
          'Quotation Number',
          'Customer ID',
          'Order Date',
          'Product ID',
          'Product',
          'Ordered Quantity',
          'Unit',
          'Delivery Date',
          'Rate',
          'Docs',
          'Actions',
          'Total Amount',
        ]),
      );
      expect(cell(reg, mine, 'SO No')).toBe(o0.number);
      expect(cell(reg, mine, 'Customer')).toBe(name);
      expect(cell(reg, mine, 'Product ID')).toBe(item.code);
      expect(Number(cell(reg, mine, 'Ordered Quantity'))).toBe(10);
      expect(Number(cell(reg, mine, 'Rate'))).toBe(100);
      expect(Number(cell(reg, mine, 'Total Amount'))).toBe(1180);

      // Order Items = one row per line
      const items = await view('sales-orders', 'Order Items');
      const line = items.body.data.find((r: any) => r.id === o0.id);
      expect(labels(items)).toEqual(
        expect.arrayContaining(['#', 'Item / Service', 'Qty', 'Rate', 'Disc %', 'Tax %', 'Net']),
      );
      expect(Number(cell(items, line, 'Qty'))).toBe(10);
      expect(Number(cell(items, line, 'Net'))).toBe(1000);

      // Delivery Balance: 10 ordered, 4 dispatched, 6 left
      const del = await view('sales-orders', 'Delivery Balance');
      const dl = del.body.data.find((r: any) => r.id === o0.id);
      expect(Number(cell(del, dl, 'Dispatched Qty'))).toBe(4);
      expect(Number(cell(del, dl, 'Balance Qty'))).toBe(6);

      // invoice the dispatch, then the Billing Balance and the invoice tabs
      const i0 = body(await v.call('post', '/sales/invoices', { dispatchId: d0.id }));
      expect(
        (await v.call('post', `/sales/invoices/${i0.id}/submit`, {}, ifm(i0.version))).status,
      ).toBe(200);
      const bill = await view('sales-orders', 'Billing Balance');
      const bl = bill.body.data.find((r: any) => r.id === o0.id);
      expect(Number(cell(bill, bl, 'Billed Value'))).toBe(472); // 4 x 100 + 18 %
      expect(Number(cell(bill, bl, 'Billing Balance'))).toBe(1180 - 472);
      expect(bill.body.meta.panel.columns.map((c: any) => c.label)).toEqual([
        'Reference',
        'Due',
        'Amount',
        'Allocated',
        'Balance',
        'Action',
      ]);
      const pc = bill.body.meta.panel.columns;
      const prow = bill.body.meta.panel.rows.find((r: any) => r[pc[0].key] === i0.number);
      expect(Number(prow[pc[2].key])).toBe(472);
      expect(Number(prow[pc[4].key])).toBe(472);

      const invs = await view('sales-invoices', 'Invoice Register', true);
      const il = invs.body.data.find((r: any) => r.id === i0.id);
      expect(Number(cell(invs, il, 'Taxable Value'))).toBe(400);
      expect(Number(cell(invs, il, 'CGST'))).toBe(36);
      expect(Number(cell(invs, il, 'Grand Total'))).toBe(472);
      expect(cell(invs, il, 'Sales Order')).toBe(order.number);

      const dispReg = await view('sales-dispatch', 'Dispatch Queue', true);
      const dr = dispReg.body.data.find((r: any) => r.id === d0.id);
      expect(cell(dispReg, dr, 'Vehicle')).toBe('MH04AB1234');
      expect(cell(dispReg, dr, 'Sales Order')).toBe(order.number);
      // columns V40 shows but nothing in the database feeds are flagged for the screen
      expect(dispReg.body.meta.columns.find((c: any) => c.label === 'Pick List').source).toBe(
        false,
      );
      expect(dispReg.body.meta.noSource).toContain('Pick List');

      // a receipt of 100 against the invoice
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
      const rc = await v.call('post', '/sales/receipts', {
        customerId: cust.id,
        bankAccountId: bank.id,
        amount: 100,
        mode: 'NEFT',
        reference: 'UTR-V40',
        allocations: [{ invoiceId: i0.id, amount: 100 }],
      });
      expect(rc.status, JSON.stringify(rc.body)).toBe(200);
      const rcNo = body(rc).number;
      const pay = await view('sales-collections', 'Payment Register', true);
      const pr = pay.body.data.find((r: any) => r.number === rcNo);
      expect(cell(pay, pr, 'Payment Mode')).toBe('NEFT');
      expect(cell(pay, pr, 'Bank / Cash Reference')).toBe('UTR-V40');
      expect(Number(cell(pay, pr, 'Receipt Amount'))).toBe(100);
      const alloc = await view('sales-collections', 'Invoice Allocation');
      const ar = alloc.body.data.find((r: any) => r.number === rcNo);
      expect(cell(alloc, ar, 'Invoice Number')).toBe(i0.number);
      expect(cell(alloc, ar, 'Sales Order')).toBe(order.number);
      expect((await view('sales-collections', 'Overdue')).status).toBe(200);
      const ageing = await view('sales-invoices', 'Invoice Ageing');
      expect(ageing.body.data.some((r: any) => r.id === i0.id)).toBe(true);

      // search and the status filter work on a V40 tab
      const hit = await get(`/sales/v40/sales-orders?first=1&q=${encodeURIComponent(o0.number)}`);
      expect(hit.body.data.length).toBe(1);
      const no = await get(
        `/sales/v40/sales-orders?first=1&status=Cancelled&q=${encodeURIComponent(o0.number)}`,
      );
      expect(no.body.data.length).toBe(0);
    },
  );
});
