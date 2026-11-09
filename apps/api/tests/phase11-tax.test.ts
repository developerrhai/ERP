/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Phase 11: Indian taxation with exact numbers. Sales and purchase documents feed the tax register; GSTR-1 and GSTR-3B
// are prepared from it; the settlement journal sets ITC off against output tax; a filed return locks its month; GSTR-2B
// is matched; IRN and e-way bill numbers are recorded by hand; the TDS return is built with its interest.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { mkItem, setApproval, tag, vclient } from './phase08-helpers';
import { todayIst } from '../src/modules/procurement/core';
import { planSetOff } from '../src/modules/tax/returns-service';
import { monthsPartCounted, quarterRange } from '../src/modules/tax/tds-service';
import { D } from '../src/modules/finance/money';
import { body, gl, ifm, mkGrn, mkInvoice, mkPo, mkSupplier, setup } from './phase09-helpers';

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
const MONTH = todayIst().slice(0, 7);
let shared: { item: any; b2cCust: any; invC: any; sup: any };

/** a GSTIN with a correct check character */
function mkGstin(state: string, pan: string): string {
  const base = `${state}${pan}1Z`;
  const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = cs.indexOf(base[i] as string) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return base + cs[(36 - (sum % 36)) % 36];
}
const rnd = () =>
  Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join(
    '',
  );
const pan = (_n?: string) => `${rnd()}1234F`;

const submit = async (v: ReturnType<typeof vclient>, path: string, d: Record<string, any>) =>
  v.call('post', `${path}/${d.id}/submit`, {}, ifm(d.version));

async function mkCustomer(registered: boolean) {
  const name = `Cust ${tag()}`;
  const p = pan();
  const g = registered ? mkGstin('27', p) : null;
  return prisma.customer.create({
    data: {
      code: `C${tag()}`.slice(0, 28),
      name,
      nameKey: `${name}-${tag()}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: registered ? 'REGULAR' : 'UNREGISTERED',
      ...(registered ? { gstin: g as string, pan: p } : {}),
      approvalStatus: 'APPROVED',
      creditLimit: '1000000',
      creditDays: 30,
    },
  });
}

async function sell(custId: string, itemId: string, qty: number, rate: number) {
  const { v, fx } = ctx;
  const o = body(
    await v.call('post', '/sales/orders', {
      customerId: custId,
      customerPoNo: `PO-${tag()}`,
      lines: [{ itemId, qty, uom: 'Kg', rate, gstPct: 18 }],
    }),
  );
  expect((await submit(v, '/sales/orders', o)).status).toBe(200);
  const order = body(await v.call('get', `/sales/orders/${o.id}`));
  const d = body(
    await v.call('post', '/sales/dispatch', {
      orderId: o.id,
      warehouseId: fx.warehouseId,
      lines: [{ orderLineId: order.lines[0].id, qty }],
    }),
  );
  expect((await submit(v, '/sales/dispatch', d)).status).toBe(200);
  const i = body(await v.call('post', '/sales/invoices', { dispatchId: d.id }));
  expect((await submit(v, '/sales/invoices', i)).status).toBe(200);
  return body(await v.call('get', `/sales/invoices/${i.id}`));
}

beforeAll(async () => {
  owner = await signInOwner(app);
  restoreStock = await setApproval(false);
  savedSales = await prisma.moduleControl.findMany({
    where: { pageId: { in: SALES } },
    select: { pageId: true, approvalRequired: true },
  });
  await prisma.moduleControl.updateMany({
    where: { pageId: { in: [...SALES, 'scm-purchaseinvoice', 'scm-po', 'scm-grn'] } },
    data: { approvalRequired: false },
  });
  invalidateAccessCache();
  ctx = await setup(app, owner);
  await prisma.unit.update({
    where: { id: ctx.fx.unitId },
    data: {
      code: `T${rnd().slice(0, 2)}`,
      gstin: mkGstin('27', pan()),
      city: 'Pune',
      pincode: '411001',
    },
  });
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

describe('pure rules', () => {
  it('ITC set-off order: IGST credit first, CGST credit never against SGST', () => {
    const p = planSetOff(
      { igst: D(100), cgst: D(50), sgst: D(50) },
      { igst: D(120), cgst: D(40), sgst: D(0) },
    );
    expect(p.off.igstToIgst.toString()).toBe('100');
    expect(p.off.igstToCgst.toString()).toBe('20');
    expect(p.off.cgstToCgst.toString()).toBe('30');
    expect(p.cash.cgst.toString()).toBe('0');
    expect(p.cash.sgst.toString()).toBe('50'); // CGST credit left (10) cannot pay SGST
    expect(p.credit.cgst.toString()).toBe('10');
  });
  it('quarters and part-month interest months', () => {
    expect(quarterRange(2026, 1)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(quarterRange(2026, 4)).toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(monthsPartCounted('2026-04-10', '2026-04-30')).toBe(1);
    expect(monthsPartCounted('2026-04-10', '2026-06-10')).toBe(2);
    expect(monthsPartCounted('2026-04-10', '2026-06-11')).toBe(3);
    expect(monthsPartCounted('2026-04-10', '2026-04-10')).toBe(0);
  });
});

describe('quote to return, GSTR-1, GSTR-3B, settlement, lock', () => {
  it(
    'feeds the register, prepares both returns with exact numbers, settles and locks',
    { timeout: 240_000 },
    async () => {
      const { v, fx } = ctx;
      const item = await mkItem({ itemType: 'Finished Good' });
      const rc = await vclient(app, owner, fx.unitId).post('transactions', {
        warehouseId: fx.warehouseId,
        txType: 'Receipt',
        lines: [{ itemId: item.id, qty: 100, unitCost: 60 }],
      });
      expect(rc.status).toBe('Posted');
      const b2bCust = await mkCustomer(true);
      const b2cCust = await mkCustomer(false);

      const invB = await sell(b2bCust.id, item.id, 10, 100); // taxable 1000, CGST 90, SGST 90
      const invC = await sell(b2cCust.id, item.id, 5, 100); // taxable 500, CGST 45, SGST 45
      expect(invB.grandTotal).toBe('1180');
      // credit note: 2 of the B2B invoice -> taxable 200, tax 36
      const ret = body(
        await v.call('post', '/sales/returns', {
          invoiceId: invB.id,
          warehouseId: fx.warehouseId,
          reason: 'Wrong size',
          lines: [{ invoiceLineId: invB.lines[0].id, qty: 2 }],
        }),
      );
      expect((await submit(v, '/sales/returns', ret)).status).toBe(200);

      // purchase: 20 x 50 + 18 % -> ITC CGST 90, SGST 90
      const sp = pan('SUPPL');
      const sup = await mkSupplier({
        gstRegistrationType: 'REGULAR',
        gstin: mkGstin('27', sp),
        pan: sp,
      });
      const po = await mkPo(v, fx, sup.id, item.id, 20, 50);
      const grn = await mkGrn(v, fx, po, 20);
      const pinv = await mkInvoice(v, sup.id, grn, 20, 50);
      expect(pinv.status).toBe('Posted');

      // the register has the four documents with the unit's GSTIN on them
      const docs = await prisma.$queryRawUnsafe<any[]>(
        `SELECT doc_kind, direction, taxable::text FROM tax_documents WHERE unit_id=$1::uuid AND status='Active' ORDER BY created_at`,
        fx.unitId,
      );
      expect(docs.map((d) => `${d.direction}:${d.doc_kind}:${Number(d.taxable)}`)).toEqual([
        'OUTWARD:INV:1000',
        'OUTWARD:INV:500',
        'OUTWARD:CRN:200',
        'INWARD:INV:1000',
      ]);

      // ---- GSTR-1
      const g1 = body(await v.call('get', `/tax/gstr1?month=${MONTH}`));
      expect(g1.summary.b2b.taxable).toBe('1000.00');
      expect(g1.summary.b2cs.taxable).toBe('500.00');
      expect(g1.summary.cdnr.taxable).toBe('200.00');
      expect(g1.hsn[0].taxable).toBe('1300.00'); // 1000 + 500 - 200
      expect(
        g1.issues.filter((i: any) => i.level === 'error'),
        JSON.stringify(g1.issues),
      ).toEqual([]);
      expect(g1.canPrepare).toBe(true);
      const file = await v.call('get', `/tax/gstr1/file?month=${MONTH}`);
      expect(file.status).toBe(200);
      const json = JSON.parse(file.text);
      expect(json.gstin).toBe(g1.gstin);
      expect(json.b2b[0].inv[0].itms[0].itm_det).toMatchObject({
        txval: 1000,
        rt: 18,
        camt: 90,
        samt: 90,
        iamt: 0,
      });
      expect(json.cdnr[0].nt[0]).toMatchObject({ ntty: 'C', val: 236 });
      expect(json.b2cs[0]).toMatchObject({ sply_ty: 'INTRA', txval: 500, rt: 18 });

      // ---- GSTR-3B: output 1000+500-200 = 1300 taxable, tax CGST 117 SGST 117; ITC 90 + 90
      const g3 = body(await v.call('get', `/tax/gstr3b?month=${MONTH}`));
      expect(g3.s31.a_taxable).toMatchObject({
        taxable: '1300.00',
        cgst: '117.00',
        sgst: '117.00',
        igst: '0.00',
      });
      expect(g3.s4.a5_other).toMatchObject({ cgst: '90.00', sgst: '90.00' });
      expect(g3.s4.c_net).toMatchObject({ cgst: '90.00', sgst: '90.00' });
      expect(g3.plan.cash).toMatchObject({ cgst: '27.00', sgst: '27.00', igst: '0.00' });
      expect(g3.issues.filter((i: any) => i.message.includes('differs from the return'))).toEqual(
        [],
      );

      // ---- settlement: Dr output 234, Cr input 180, Cr bank 54
      const parent = await prisma.account.findUniqueOrThrow({ where: { code: '1100' } });
      const acc = await prisma.account.create({
        data: {
          code: String(60000 + Math.floor(Math.random() * 9000)),
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
      const out0 = await gl(fx.unitId, '2301');
      const sb = {
        month: MONTH,
        paidOn: todayIst(),
        bankAccountId: bank.id,
        challanNo: `CPIN${tag()}`,
      };
      const st = await v.call('post', '/tax/settlement', sb, { 'Idempotency-Key': `set-${tag()}` });
      expect(st.status, JSON.stringify(st.body)).toBe(200);
      expect(await gl(fx.unitId, '2301')).toBe(out0 + 117); // output CGST cleared (credit balance -117 -> 0)
      expect(await gl(fx.unitId, '1401')).toBe(0);
      expect(
        Number(
          (
            await prisma.$queryRawUnsafe<any[]>(
              `SELECT COALESCE(SUM(g.credit-g.debit),0)::text AS n FROM gl_entries g WHERE g.account_id=$1::uuid AND g.unit_id=$2::uuid`,
              acc.id,
              fx.unitId,
            )
          )[0].n,
        ),
      ).toBe(54);
      expect(
        (await v.call('post', '/tax/settlement', { ...sb, challanNo: `CPIN${tag()}` })).status,
      ).toBe(409); // month already settled

      shared = { item, b2cCust, invC, sup };
      // ---- manual ITC reversal (rule 37A) posts Dr 6272 / Cr input
      const rev = await v.call(
        'post',
        '/tax/itc/reversals',
        { kind: 'R37A', date: todayIst(), cgst: '10', sgst: '10', note: 'Supplier did not file' },
        { 'Idempotency-Key': `rv-${tag()}` },
      );
      expect(rev.status, JSON.stringify(rev.body)).toBe(200);
      expect(await gl(fx.unitId, '6272')).toBe(20);
      const list = body(await v.call('get', `/tax/itc/reversals?month=${MONTH}`));
      expect(list.some((r: any) => r.kind === 'R37A' && r.cgst === '10.00')).toBe(true);

      // books balance
      const tb = await prisma.glEntry.aggregate({
        where: { unitId: fx.unitId },
        _sum: { debit: true, credit: true },
      });
      expect(Number(tb._sum.debit)).toBeCloseTo(Number(tb._sum.credit), 2);
    },
  );
});

describe('GSTR-2B, e-invoice, e-way bill, TDS', () => {
  it(
    'matches 2B, records IRN and EWB by hand, builds the TDS return',
    { timeout: 240_000 },
    async () => {
      const { v, fx } = ctx;
      // a purchase invoice to match
      const item = await mkItem({ itemType: 'Raw Material' });
      const sp = pan('MATCH');
      const sup = await mkSupplier({
        gstRegistrationType: 'REGULAR',
        gstin: mkGstin('27', sp),
        pan: sp,
      });
      const po = await mkPo(v, fx, sup.id, item.id, 10, 100);
      const grn = await mkGrn(v, fx, po, 10);
      const inv = await mkInvoice(v, sup.id, grn, 10, 100);
      const vno = inv.vendorInvoiceNo as string;
      const rows = [
        {
          supplierGstin: sup.gstin,
          docNo: vno,
          docDate: todayIst(),
          taxable: '1000',
          cgst: '90',
          sgst: '90',
          igst: '0',
          cess: '0',
          itcAvailable: true,
        },
        {
          supplierGstin: sup.gstin,
          docNo: 'NOT-IN-BOOKS',
          docDate: todayIst(),
          taxable: '500',
          cgst: '45',
          sgst: '45',
          igst: '0',
          cess: '0',
          itcAvailable: false,
          itcReason: 'Blocked u/s 17(5)',
        },
      ];
      const imp = await v.call(
        'post',
        '/tax/gstr2b/import',
        { month: MONTH, sourceName: 'gstr2b.json', payload: rows },
        { 'Idempotency-Key': `i-${tag()}` },
      );
      expect(imp.status, JSON.stringify(imp.body)).toBe(200);
      expect(body(imp)).toMatchObject({ matched: 1, extra: 1, mismatch: 0 });
      const rep = body(await v.call('get', `/tax/gstr2b?month=${MONTH}`));
      expect(rep.summary).toMatchObject({ matched: 1, extra: 1, notEligible: '90.00' });
      expect(
        (
          await prisma.$queryRawUnsafe<any[]>(
            `SELECT gstr2b_status FROM purchase_invoices WHERE id=$1::uuid`,
            inv.id,
          )
        )[0].gstr2b_status,
      ).toBe('MATCHED');
      // a wrong amount is a mismatch
      const bad = await v.call(
        'post',
        '/tax/gstr2b/import',
        { month: MONTH, payload: [{ ...rows[0], cgst: '50' }] },
        { 'Idempotency-Key': `i2-${tag()}` },
      );
      expect(body(bad)).toMatchObject({ mismatch: 1 });

      // ---- e-invoice by hand
      const cust = await mkCustomer(true);
      const sitem = await mkItem({ itemType: 'Finished Good' });
      await vclient(app, owner, fx.unitId).post('transactions', {
        warehouseId: fx.warehouseId,
        txType: 'Receipt',
        lines: [{ itemId: sitem.id, qty: 100, unitCost: 10 }],
      });
      const si = await sell(cust.id, sitem.id, 3, 50000); // above the e-way value limit
      const pend = body(await v.call('get', '/tax/einvoice/pending'));
      expect(pend.rows.some((r: any) => r.id === si.id)).toBe(true);
      const rj = body(await v.call('get', `/tax/einvoice/request-json?docType=INV&docId=${si.id}`));
      expect(rj.json.DocDtls.No).toBe(si.number);
      expect(rj.json.ValDtls.AssVal).toBe(150000);
      expect(rj.json.ItemList[0].GstRt).toBe(18);
      const irn = 'a'.repeat(64);
      const badIrn = await v.call(
        'post',
        '/tax/einvoice',
        {
          docType: 'INV',
          docId: si.id,
          irn: 'z'.repeat(64),
          ackNo: '112233445566',
          ackDate: new Date().toISOString(),
        },
        { 'Idempotency-Key': `e0-${tag()}` },
      );
      expect(badIrn.status).toBe(422);
      const rec = await v.call(
        'post',
        '/tax/einvoice',
        {
          docType: 'INV',
          docId: si.id,
          irn,
          ackNo: '112233445566',
          ackDate: new Date().toISOString(),
        },
        { 'Idempotency-Key': `e1-${tag()}` },
      );
      expect(rec.status, JSON.stringify(rec.body)).toBe(200);
      expect(
        (
          await prisma.$queryRawUnsafe<any[]>(
            `SELECT irn FROM sales_invoices WHERE id=$1::uuid`,
            si.id,
          )
        )[0].irn,
      ).toBe(irn);
      const dupe = await v.call(
        'post',
        '/tax/einvoice',
        {
          docType: 'INV',
          docId: si.id,
          irn: 'b'.repeat(64),
          ackNo: '112233445577',
          ackDate: new Date().toISOString(),
        },
        { 'Idempotency-Key': `e2-${tag()}` },
      );
      expect(dupe.status).toBe(409);
      const recs = body(await v.call('get', '/tax/einvoice/records')) as any[];
      const er = recs.find((r) => r.docId === si.id);
      const cancel = await v.call(
        'post',
        `/tax/einvoice/${er.id}/cancel`,
        { reason: 'Wrong buyer' },
        { 'Idempotency-Key': `e3-${tag()}` },
      );
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect(
        (
          await prisma.$queryRawUnsafe<any[]>(
            `SELECT irn FROM sales_invoices WHERE id=$1::uuid`,
            si.id,
          )
        )[0].irn,
      ).toBeNull();

      // ---- e-way bill by hand: 450 km -> 3 days
      const ep = body(await v.call('get', '/tax/eway/pending'));
      expect(ep.rows.some((r: any) => r.id === si.id)).toBe(true);
      const when = new Date().toISOString();
      const ew = await v.call(
        'post',
        '/tax/eway',
        {
          invoiceId: si.id,
          ewbNo: '123456789012',
          ewbDate: when,
          distanceKm: 450,
          vehicleNo: 'MH12AB1234',
        },
        { 'Idempotency-Key': `w1-${tag()}` },
      );
      expect(ew.status, JSON.stringify(ew.body)).toBe(200);
      const list = body(await v.call('get', '/tax/eway')) as any[];
      const bill = list.find((b) => b.invoiceId === si.id);
      const days = (Date.parse(bill.validUntil) - Date.parse(when)) / 86_400_000;
      expect(days).toBeGreaterThan(2.9);
      expect(days).toBeLessThan(4);
      expect(
        (
          await v.call(
            'post',
            `/tax/eway/${bill.id}/extend`,
            { remainingKm: 100, reason: 'Vehicle broke down' },
            { 'Idempotency-Key': `w2-${tag()}` },
          )
        ).status,
      ).toBe(409); // not near expiry
      expect(
        (
          await v.call(
            'post',
            '/tax/eway',
            { invoiceId: si.id, ewbNo: '123456789013', ewbDate: when, distanceKm: 10 },
            { 'Idempotency-Key': `w3-${tag()}` },
          )
        ).status,
      ).toBe(409); // already has one

      // ---- TDS return: an entry with a deposit challan and one without
      const fy =
        Number(todayIst().slice(5, 7)) >= 4
          ? Number(todayIst().slice(0, 4))
          : Number(todayIst().slice(0, 4)) - 1;
      const m = Number(todayIst().slice(5, 7));
      const q = m >= 4 && m <= 6 ? 1 : m <= 9 && m >= 7 ? 2 : m >= 10 ? 3 : 4;
      const ret = body(await v.call('get', `/tax/tds/return?kind=TDS&fy=${fy}&quarter=${q}`));
      expect(ret.form).toBe('26Q');
      expect(ret.canFile).toBe(false); // no TAN entered yet
      expect(ret.issues.some((i: any) => i.message.includes('TAN'))).toBe(true);
      const sum = body(
        await v.call('get', `/tax/tds/summary?kind=TDS&from=${ret.from}&to=${ret.to}&by=section`),
      );
      expect(Array.isArray(sum)).toBe(true);
      // lower deduction certificate
      const ldc = await v.call(
        'post',
        '/tax/tds/ldc',
        {
          supplierId: sup.id,
          sectionCode: '194C',
          certNo: `LDC${tag()}`,
          ratePct: '0.5',
          validFrom: '2026-04-01',
          validTo: '2027-03-31',
        },
        { 'Idempotency-Key': `l1-${tag()}` },
      );
      expect(ldc.status, JSON.stringify(ldc.body)).toBe(200);
      expect(
        ((await v.call('get', '/tax/tds/ldc')).body.data as any[]).some(
          (c) => c.supplier === sup.name,
        ),
      ).toBe(true);
      // Excel export of the sales register
      const xl = await v.call(
        'get',
        `/tax/registers/sales/export.xlsx?from=${MONTH}-01&to=${todayIst()}`,
      );
      expect(xl.status).toBe(200);
      expect(xl.headers['content-type']).toContain('spreadsheetml');
    },
  );
});

describe('a filed return locks its month', () => {
  it(
    'refuses cancelling or posting a taxable document of a filed month',
    { timeout: 120_000 },
    async () => {
      const { v, fx } = ctx;
      const { item, b2cCust, invC, sup } = shared;
      // ---- file GSTR-1 -> its month is locked
      const filed = await v.call(
        'post',
        '/tax/returns/file',
        { type: 'GSTR1', month: MONTH, arn: 'AA2711ARN00001', filedOn: todayIst() },
        { 'Idempotency-Key': `f1-${tag()}` },
      );
      expect(filed.status, JSON.stringify(filed.body)).toBe(200);
      const again = await v.call(
        'post',
        '/tax/returns/file',
        { type: 'GSTR1', month: MONTH, arn: 'AA2711ARN00002', filedOn: todayIst() },
        { 'Idempotency-Key': `f1b-${tag()}` },
      );
      expect(again.status).toBe(409);
      // an outward invoice cannot be cancelled, and a new one cannot be posted into the filed month
      const cancelInv = await v.call('post', `/sales/invoices/${invC.id}/cancel`, {
        reason: 'Mistake here',
      });
      expect(cancelInv.status).toBe(409);
      expect(cancelInv.body.error.code).toBe('GST_PERIOD_FILED');
      const o = body(
        await v.call('post', '/sales/orders', {
          customerId: b2cCust.id,
          customerPoNo: `PO-${tag()}`,
          lines: [{ itemId: item.id, qty: 1, uom: 'Kg', rate: 100, gstPct: 18 }],
        }),
      );
      await submit(v, '/sales/orders', o);
      const oo = body(await v.call('get', `/sales/orders/${o.id}`));
      const d2 = body(
        await v.call('post', '/sales/dispatch', {
          orderId: o.id,
          warehouseId: fx.warehouseId,
          lines: [{ orderLineId: oo.lines[0].id, qty: 1 }],
        }),
      );
      await submit(v, '/sales/dispatch', d2);
      const i2 = body(await v.call('post', '/sales/invoices', { dispatchId: d2.id }));
      const blocked = await submit(v, '/sales/invoices', i2);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('GST_PERIOD_FILED');
      // GSTR-3B is not filed: a purchase invoice is still allowed
      const grn2 = await mkGrn(v, fx, await mkPo(v, fx, sup.id, item.id, 5, 50), 5);
      expect((await mkInvoice(v, sup.id, grn2, 5, 50)).status).toBe('Posted');
    },
  );
});

describe('access', () => {
  it('every read route refuses a caller who is not signed in', async () => {
    const { default: request } = await import('supertest');
    for (const p of [
      'gstr1',
      'gstr3b',
      'returns',
      'gstr2b',
      'einvoice/pending',
      'eway',
      'tds/ldc',
      'rules',
      'itc/due-180',
    ]) {
      const r = await request(app).get(`/api/v1/tax/${p}?month=${MONTH}`);
      expect(r.status, p).toBe(401);
    }
  });
});
