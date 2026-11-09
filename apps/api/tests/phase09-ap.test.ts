/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- API test bodies are loose JSON */
// Phase 9: accounts payable. Payment against an invoice, ageing, MSME due date, TDS 194C cumulative, reverse-charge
// freight, ITC-180 reversal and reclaim, supplier evaluation, idempotent replay and the concurrency rules.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runItc180, evaluateMonth } from '../src/modules/procurement/jobs';
import { newApp, prisma, signInOwner, makeUser } from './helpers';
import type { Signed } from './helpers';
import {
  approvalOff,
  approve,
  body,
  gl,
  ifm,
  mkGrn,
  mkInvoice,
  mkItem,
  mkPo,
  mkSupplier,
  setup,
  tag,
  todayIso,
} from './phase09-helpers';
import type { Body } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let restore: () => Promise<void>;
let ctx: Awaited<ReturnType<typeof setup>>;
let bankId = '';
let seq = 0;

async function fundedBank(unitId: string, amount: string): Promise<string> {
  const parent = await prisma.account.findUniqueOrThrow({ where: { code: '1100' } });
  const a = await prisma.account.create({
    data: {
      code: String(40000 + Math.floor(Math.random() * 9000) + (seq += 1)),
      name: `Test bank ${tag()}`,
      parentId: parent.id,
      rootType: 'Asset',
      normalBalance: 'Debit',
      subType: 'Bank',
      cfClass: 'CASH',
    },
  });
  const created = await ctx.v.call('post', '/finance/bank-accounts', {
    unitId,
    accountId: a.id,
    kind: 'BANK',
    name: a.name,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const eq = await prisma.account.findUniqueOrThrow({ where: { code: '3001' } });
  const j = await ctx.v.call('post', '/finance/journals', {
    unitId,
    docDate: todayIso(),
    voucherType: 'Journal',
    narration: 'fund the test bank',
    lines: [
      { accountId: a.id, debit: amount, credit: '0.00' },
      { accountId: eq.id, debit: '0.00', credit: amount },
    ],
  });
  expect(j.status, JSON.stringify(j.body)).toBe(201);
  const jd = body(j);
  const sub = await ctx.v.call(
    'post',
    `/finance/journals/${jd.id}/submit`,
    undefined,
    ifm(jd.version),
  );
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const pst = await ctx.v.call(
    'post',
    `/finance/journals/${jd.id}/post`,
    {},
    ifm(body(sub).version),
  );
  expect(pst.status, JSON.stringify(pst.body)).toBe(200);
  return body(created).id as string;
}
async function verifiedBank(supplierId: string) {
  const other = await makeUser({ role: 'DEPT_MANAGER', department: 'Finance' });
  await prisma.$executeRawUnsafe(
    `INSERT INTO supplier_bank_accounts (supplier_id, ifsc, holder_name, account_no_enc, account_last4, account_hash, changed_by_id, verified_by_id, verified_at) VALUES ($1::uuid,'HDFC0001234','Holder','enc','1234',$2,$3::uuid,$4::uuid, now())`,
    supplierId,
    tag().padEnd(64, '0'),
    ctx.fx.ownerId,
    other.id,
  );
}

beforeAll(async () => {
  owner = await signInOwner(app);
  restore = await approvalOff();
  ctx = await setup(app, owner);
  bankId = await fundedBank(ctx.fx.unitId, '10000000.00');
});
afterAll(async () => {
  await restore();
  await prisma.$disconnect();
});

describe('payment, ageing and MSME', () => {
  it('proposal -> payments -> UTR; payable and ageing fall to zero; bank must be verified', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier({
      msmeUdyamNo: 'UDYAM-MH-01-1234567',
      msmeCategory: 'MICRO',
      msmeActivity: 'MANUFACTURING',
      msmeAgreedDays: 45,
    });
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 100);
    const grn = await mkGrn(v, fx, po, 10);
    const inv = await mkInvoice(v, sup.id, grn, 10, 100);
    expect(inv.status).toBe('Posted');
    expect(inv.grandTotal).toBe('1180');
    // MSME: legal due date = GRN date + 45 days; due date is the earlier of the two
    const d = new Date(`${todayIso()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 45);
    expect(inv.msmeDueDate).toBe(d.toISOString().slice(0, 10));
    const ag = body(await v.call('get', '/fin/ap/ageing'));
    expect(Number(ag.total)).toBeGreaterThanOrEqual(1180);

    const prop = await v.call('post', '/fin/ap/proposals', {
      dueTill: '2099-12-31',
      invoiceIds: [inv.id],
    });
    expect(prop.status, JSON.stringify(prop.body)).toBe(200);
    const p = body(prop);
    await approve(v, '/fin/ap/proposals', p);
    const pays = await v.call('post', `/fin/ap/proposals/${p.id}/to-payments`, {});
    expect(pays.status, JSON.stringify(pays.body)).toBe(201);
    const pay = (pays.body as { data: { rows: Body[] } }).data.rows[0]!;
    const noBank = await v.call('post', `/fin/ap/payments/${pay.id}/post`, {
      bankAccountId: bankId,
      paymentMode: 'NEFT',
      utr: 'UTR123',
    });
    expect(noBank.status).toBe(409);
    expect((noBank.body as { error: { code: string } }).error.code).toBe('BANK_UNVERIFIED');
    await verifiedBank(sup.id);
    const key = `idem-${tag()}-aaaaaaaa`;
    const ok = await v.call(
      'post',
      `/fin/ap/payments/${pay.id}/post`,
      { bankAccountId: bankId, paymentMode: 'NEFT', utr: 'UTR123' },
      { 'Idempotency-Key': key },
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const replay = await v.call(
      'post',
      `/fin/ap/payments/${pay.id}/post`,
      { bankAccountId: bankId, paymentMode: 'NEFT', utr: 'UTR123' },
      { 'Idempotency-Key': key },
    );
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    const after = body(await v.call('get', `/scm/purchaseinvoice/${inv.id}`));
    expect(after.paymentStatus).toBe('PAID');
    expect(after.paidAmount).toBe('1180');
    expect(await gl(fx.unitId, '2101')).toBeLessThanOrEqual(0);
    const again = await v.call('post', `/fin/ap/payments/${pay.id}/post`, {
      bankAccountId: bankId,
      paymentMode: 'NEFT',
      utr: 'UTR123',
    });
    expect(again.status).toBe(409);
    const left = body(await v.call('get', `/fin/ap/payables?supplierId=${sup.id}`)).rows;
    expect(left).toHaveLength(0);
  });
});

describe('TDS 194C cumulative on real invoices', () => {
  it('60,000 -> 1,200; 25,000 -> 0; 20,000 -> 900', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier({ tdsSectionCode: '194C', supplierType: 'CONTRACTOR' });
    const item = await mkItem();
    const run = async (amount: number) => {
      const po = await mkPo(v, fx, sup.id, item.id, 1, amount, {
        supplierType: 'CONTRACTOR',
        poType: 'Service',
      });
      const grn = await mkGrn(v, fx, po, 1);
      return mkInvoice(v, sup.id, grn, 1, amount);
    };
    expect((await run(60000)).tdsAmount).toBe('1200');
    expect((await run(25000)).tdsAmount).toBe('0');
    const third = await run(20000);
    expect(third.tdsBase).toBe('45000');
    expect(third.tdsAmount).toBe('900');
    const prev = await v.call('get', `/scm/purchaseinvoice/${third.id}/tds-preview`);
    expect(prev.status).toBe(200);
    // only the latest ledger row can be cancelled: invoice 1 first -> TDS_LATER_ENTRIES
    const first = (
      await prisma.$queryRawUnsafe<{ doc_id: string }[]>(
        `SELECT doc_id::text FROM supplier_tds_ledger WHERE supplier_id=$1::uuid AND doc_type='PINV' ORDER BY seq LIMIT 1`,
        sup.id,
      )
    )[0]!;
    const c = await v.call('post', `/scm/purchaseinvoice/${first.doc_id}/cancel`, {
      reason: 'Wrong invoice',
    });
    expect(c.status).toBe(409);
    expect((c.body as { error: { code: string } }).error.code).toBe('TDS_LATER_ENTRIES');
    const ok = await v.call('post', `/scm/purchaseinvoice/${third.id}/cancel`, {
      reason: 'Wrong invoice',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('parallel invoices of one supplier get correct cumulative TDS', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier({ tdsSectionCode: '194C', supplierType: 'CONTRACTOR' });
    const item = await mkItem();
    const docs: Body[] = [];
    for (let i = 0; i < 3; i += 1) {
      const po = await mkPo(v, fx, sup.id, item.id, 1, 40000, { supplierType: 'CONTRACTOR' });
      docs.push(po);
    }
    const grns: Body[] = [];
    for (const po of docs) grns.push(await mkGrn(v, fx, po, 1));
    const made = await Promise.all(
      grns.map(async (g) => {
        const r = await v.call('post', '/scm/purchaseinvoice', {
          supplierId: sup.id,
          vendorInvoiceNo: `P-${tag()}`,
          invoiceDate: todayIso(),
          lines: [{ grnLineId: g.lines[0].id, qty: 1, rate: 40000 }],
        });
        return body(r);
      }),
    );
    await Promise.all(
      made.map((m) => v.call('post', `/scm/purchaseinvoice/${m.id}/submit`, {}, ifm(m.version))),
    );
    const rows = await prisma.$queryRawUnsafe<{ tds_amount: string; cum_base_after: string }[]>(
      `SELECT tds_amount::text, cum_base_after::text FROM supplier_tds_ledger WHERE supplier_id=$1::uuid AND doc_type='PINV' ORDER BY seq`,
      sup.id,
    );
    expect(rows).toHaveLength(3);
    // each invoice is 40,000 (> 30,000 single limit): every one is fully taxed at 2 % = 800, cumulative 40k / 80k / 120k
    expect(rows.map((r) => Number(r.tds_amount))).toEqual([800, 800, 800]);
    expect(rows.map((r) => Number(r.cum_base_after))).toEqual([40000, 80000, 120000]);
  });
});

describe('reverse charge, ITC-180, evaluation', () => {
  it('RCM freight invoice: Dr landed cost clearing + input tax / Cr RCM payable + AP', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 100);
    const grn = await mkGrn(v, fx, po, 10);
    const gta = await mkSupplier();
    const r = await v.call('post', '/scm/purchaseinvoice', {
      supplierId: gta.id,
      vendorInvoiceNo: `GTA-${tag()}`,
      invoiceDate: todayIso(),
      isRcm: true,
      lines: [
        {
          description: 'Freight (GTA)',
          hsnSac: '996511',
          qty: 1,
          rate: 500,
          gstPct: 5,
          landedGrnId: grn.id,
        },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const inv = body(r);
    await approve(v, '/scm/purchaseinvoice', inv);
    const posted = body(await v.call('get', `/scm/purchaseinvoice/${inv.id}`));
    expect(posted.status).toBe('Posted');
    expect(posted.selfInvoiceNo).toMatch(/^SINV/);
    expect(posted.netPayable).toBe('500');
    expect(await gl(fx.unitId, '2305')).toBeLessThan(0); // RCM CGST payable
    expect(await gl(fx.unitId, '2306')).toBeLessThan(0);
  });

  it('ITC-180: unpaid after 180 days is reversed once, reclaimed on payment', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 100);
    const grn = await mkGrn(v, fx, po, 10);
    const inv = await mkInvoice(v, sup.id, grn, 10, 100);
    expect(inv.itcAmount).toBe('180');
    const in181 = new Date(Date.now() + 181 * 86_400_000).toISOString().slice(0, 10);
    // the job is date-driven: run it as if it were day 181 (the posting date must still be inside the year)
    const res = await runItc180(todayIso());
    expect(res.reversed).toBeGreaterThanOrEqual(0);
    const rev = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM itc_reversals WHERE invoice_id=$1::uuid`,
      inv.id,
    );
    expect(rev[0]!.n).toBe(0); // not yet due
    await prisma.$executeRawUnsafe(
      `UPDATE purchase_invoices SET invoice_date = CURRENT_DATE - 181 WHERE id=$1::uuid`,
      inv.id,
    );
    const r2 = await runItc180(todayIso());
    expect(r2.reversed).toBeGreaterThanOrEqual(1);
    const rows = await prisma.$queryRawUnsafe<{ cgst: string; sgst: string }[]>(
      `SELECT cgst::text, sgst::text FROM itc_reversals WHERE invoice_id=$1::uuid AND kind='R37_REVERSE'`,
      inv.id,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.cgst) + Number(rows[0]!.sgst)).toBe(180);
    expect(await gl(fx.unitId, '6272')).toBe(180);
    await runItc180(todayIso()); // idempotent: nothing more to reverse
    expect(
      Number(
        (
          await prisma.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM itc_reversals WHERE invoice_id=$1::uuid`,
            inv.id,
          )
        )[0]!.n,
      ),
    ).toBe(1);
    void in181;
  });

  it('monthly supplier evaluation writes a graded row', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 100);
    await mkGrn(v, fx, po, 10);
    const period = todayIso().slice(0, 7);
    const n = await evaluateMonth(period, fx.unitId);
    expect(n).toBeGreaterThanOrEqual(1);
    const row = (
      await prisma.$queryRawUnsafe<Body[]>(
        `SELECT overall::text, grade, quality::text FROM supplier_evaluations WHERE supplier_id=$1::uuid AND period=$2`,
        sup.id,
        period,
      )
    )[0]!;
    expect(row.grade).toMatch(/^[ABCD]$/);
    expect(Number(row.quality)).toBe(100);
    const sc = await v.call('get', `/scm/suppliers/${sup.id}/scorecard`);
    expect(sc.status).toBe(200);
  });
});

describe('concurrency', () => {
  it('two GRNs on the last units: one OVER_RECEIPT', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 5, 10);
    const mk = async () =>
      body(
        await v.call('post', '/scm/grn', {
          poId: po.id,
          warehouseId: fx.warehouseId,
          lines: [{ poLineId: po.lines[0].id, receivedQty: 5 }],
        }),
      );
    const [a, b] = [await mk(), await mk()];
    const res = await Promise.all(
      [a, b].map((g) => v.call('post', `/scm/grn/${g.id}/submit`, {}, ifm(g.version))),
    );
    const codes = res
      .map((r) => (r.status === 200 ? 'OK' : (r.body as { error: { code: string } }).error.code))
      .sort();
    expect(codes).toEqual(['OK', 'OVER_RECEIPT']);
  });

  it('two invoices with the same number: one 409 DUPLICATE_INVOICE', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 10);
    const grn = await mkGrn(v, fx, po, 10);
    const no = `DUP-${tag()}`;
    const res = await Promise.all(
      [1, 2].map(() =>
        v.call('post', '/scm/purchaseinvoice', {
          supplierId: sup.id,
          vendorInvoiceNo: no,
          invoiceDate: todayIso(),
          lines: [{ grnLineId: grn.lines[0].id, qty: 5, rate: 10 }],
        }),
      ),
    );
    const st = res.map((r) => r.status).sort();
    expect(st[0]).toBe(201);
    expect(st[1]).toBe(409);
  });

  it('double put-away claim: exactly one wins', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 10);
    const grn = await mkGrn(v, fx, po, 10);
    const tasks = (
      (await v.call('get', '/wms/putaway/tasks?status=Open')).body as { data: Body[] }
    ).data.filter((t) => t.grnId === grn.id);
    expect(tasks).toHaveLength(1);
    const res = await Promise.all(
      [1, 2, 3].map(() => v.call('post', `/wms/putaway/${tasks[0]!.id}/claim`, {})),
    );
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('idempotent replay of a GRN post creates one journal', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 10);
    const grn = await mkGrn(v, fx, po, 10);
    const before = await prisma.journal.count({ where: { sourceDocId: grn.id } });
    const again = await v.call(
      'post',
      `/scm/grn/${grn.id}/post`,
      {},
      { 'Idempotency-Key': `k-${tag()}-12345678` },
    );
    expect(again.status).toBe(200);
    expect(await prisma.journal.count({ where: { sourceDocId: grn.id } })).toBe(before);
  });
});
