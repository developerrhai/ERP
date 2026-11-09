/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call -- API test bodies are loose JSON */
// Phase 9: the buying chain PO -> GRN (landed cost, Quality Inspection) -> QC decision -> put-away -> purchase
// invoice (3-way match, TDS, GL) -> debit note (return of the rejected goods). The numbers are the worked
// example of PHASE-09 §5 "GL chain": 100 shafts @ 50, 18 % intra-state, freight 500 capitalised, 98 accepted,
// invoice 98 @ 50.50, a 194Q supplier already above the limit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { fixture, mkItem, tag, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

const app = newApp();
let owner: Signed;
let fx: Fixture;
let v: ReturnType<typeof vclient>;
const PAGES = [
  'scm-pr',
  'scm-rfq',
  'scm-vendorquote',
  'scm-comparison',
  'scm-po',
  'scm-contracts',
  'scm-grn',
  'scm-purchaseinvoice',
  'fin-debitnote',
  'fin-ap',
];
let saved: { pageId: string; approvalRequired: boolean }[] = [];

async function gl(unitId: string, code: string): Promise<number> {
  const a = await prisma.account.findUniqueOrThrow({ where: { code } });
  const r = await prisma.glEntry.aggregate({
    where: { unitId, accountId: a.id },
    _sum: { debit: true, credit: true },
  });
  return Math.round((Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0)) * 100) / 100;
}

async function mkSupplier(tds: string | null) {
  const name = `Sup ${tag()}`;
  return prisma.supplier.create({
    data: {
      code: `S${tag()}`.slice(0, 28),
      name,
      nameKey: `${name}-${tag()}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: 'UNREGISTERED',
      approvalStatus: 'APPROVED',
      tdsSectionCode: tds,
    },
  });
}

beforeAll(async () => {
  owner = await signInOwner(app);
  saved = await prisma.moduleControl.findMany({
    where: { pageId: { in: PAGES } },
    select: { pageId: true, approvalRequired: true },
  });
  await prisma.moduleControl.updateMany({
    where: { pageId: { in: PAGES } },
    data: { approvalRequired: false },
  });
  invalidateAccessCache();
  fx = await fixture();
  await prisma.unit.update({ where: { id: fx.unitId }, data: { stateCode: '27' } });
  v = vclient(app, owner, fx.unitId);
});
afterAll(async () => {
  for (const r of saved)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

const body = (res: { body: unknown }) => dataOf<Record<string, any>>(res as never);

describe('PO -> GRN -> QC -> put-away -> invoice -> debit note', () => {
  it('posts the PHASE-09 GL chain with exact numbers', async () => {
    const sup = await mkSupplier('194Q');
    const item = await mkItem({ qcRequired: true, itemType: 'Raw Material' });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
    // the supplier is already above the 194Q limit this year
    await prisma.$executeRawUnsafe(
      `INSERT INTO supplier_tds_ledger (supplier_id, fy_id, section_code, doc_type, doc_id, doc_date, base, cum_base_after, cum_tds_base_after, tds_amount) VALUES ($1::uuid,$2::uuid,'194Q','PINV',gen_random_uuid(),CURRENT_DATE,6000000,6000000,6000000,0)`,
      sup.id,
      fy.id,
    );
    const bin = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO wms_bins (warehouse_id, code, created_by_id) VALUES ($1::uuid, $2, $3::uuid) RETURNING id::text`,
      fx.warehouseId,
      `BIN${tag()}`.slice(0, 28),
      fx.ownerId,
    );

    // ---- PO
    const poRes = await v.call('post', '/scm/po', {
      supplierId: sup.id,
      shipToWarehouseId: fx.warehouseId,
      lines: [{ itemId: item.id, qty: 100, uom: 'Kg', rate: 50, gstPct: 18 }],
    });
    expect(poRes.status, JSON.stringify(poRes.body)).toBe(201);
    const po = body(poRes);
    expect(po.grandTotal).toBe('5900');
    const sub = await v.call(
      'post',
      `/scm/po/${po.id}/submit`,
      {},
      { 'If-Match': `"${po.version}"` },
    );
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const poGot = body(await v.call('get', `/scm/po/${po.id}`));
    expect(poGot.status).toBe('Approved');
    const poLine = poGot.lines[0];

    // ---- GRN with freight 500 capitalised; QC item -> Quality Inspection
    const grnRes = await v.call('post', '/scm/grn', {
      poId: po.id,
      warehouseId: fx.warehouseId,
      lines: [{ poLineId: poLine.id, receivedQty: 100 }],
      charges: [{ chargeType: 'FREIGHT', amount: 500 }],
    });
    expect(grnRes.status, JSON.stringify(grnRes.body)).toBe(201);
    const grn0 = body(grnRes);
    const gs = await v.call(
      'post',
      `/scm/grn/${grn0.id}/submit`,
      {},
      { 'If-Match': `"${grn0.version}"` },
    );
    expect(gs.status, JSON.stringify(gs.body)).toBe(200);
    const grn = body(await v.call('get', `/scm/grn/${grn0.id}`));
    expect(grn.status).toBe('Posted');
    expect(grn.lines[0].unitCost).toBe('55');
    expect(await gl(fx.unitId, '1301')).toBe(5500);
    expect(await gl(fx.unitId, '2150')).toBe(-5000);
    expect(await gl(fx.unitId, '2151')).toBe(-500);
    const qi = await prisma.stockSlice.findMany({
      where: { itemId: item.id, warehouseId: fx.warehouseId },
    });
    expect(qi.map((s) => [s.stockStatus, Number(s.qty)])).toEqual([['QUALITY_INSPECTION', 100]]);

    // over-receipt: the PO is fully received, 1 more is refused
    const over = await v.call('post', '/scm/grn', {
      poId: po.id,
      warehouseId: fx.warehouseId,
      lines: [{ poLineId: poLine.id, receivedQty: 1 }],
    });
    expect(over.status).toBe(201);
    const overId = body(over);
    const os = await v.call(
      'post',
      `/scm/grn/${overId.id}/submit`,
      {},
      { 'If-Match': `"${overId.version}"` },
    );
    expect(os.status).toBe(409);
    expect((os.body as { error: { code: string } }).error.code).toBe('OVER_RECEIPT');

    // ---- QC: 98 ok / 2 rejected, no GL change
    const qc = await v.call('post', `/scm/grn/lines/${grn.lines[0].id}/qc-decision`, {
      acceptedQty: 98,
      rejectedQty: 2,
      rejectReason: 'Cracked',
    });
    expect(qc.status, JSON.stringify(qc.body)).toBe(200);
    expect(await gl(fx.unitId, '1301')).toBe(5500);
    const after = await prisma.stockSlice.findMany({
      where: { itemId: item.id, warehouseId: fx.warehouseId, qty: { gt: 0 } },
      orderBy: { stockStatus: 'asc' },
    });
    expect(after.map((s) => [s.stockStatus, Number(s.qty)])).toEqual([
      ['BLOCKED', 2],
      ['UNRESTRICTED', 98],
    ]);

    // ---- put-away
    const tasks = body(await v.call('get', '/wms/putaway/tasks?status=Open')) as unknown as Record<
      string,
      any
    >[];
    const task = (tasks as any).find?.((t: any) => t.grnId === grn.id) ?? null;
    expect(task, 'a put-away task exists').toBeTruthy();
    expect(task.suggestedBinId).toBe(bin[0]!.id);
    expect((await v.call('post', `/wms/putaway/${task.id}/claim`, {})).status).toBe(200);
    const done = await v.call('post', `/wms/putaway/${task.id}/complete`, { binId: bin[0]!.id });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const inBin = await prisma.stockSlice.findFirstOrThrow({
      where: { itemId: item.id, binId: bin[0]!.id, stockStatus: 'UNRESTRICTED' },
    });
    expect(Number(inBin.qty)).toBe(98);

    // ---- invoice 100 @ 50.50: red, "Billed 100, received 98"
    const invBody = (qty: number) => ({
      supplierId: sup.id,
      vendorInvoiceNo: `INV-${tag()}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      poId: po.id,
      lines: [{ grnLineId: grn.lines[0].id, qty, rate: 50.5 }],
    });
    const bad = await v.call('post', '/scm/purchaseinvoice', invBody(100));
    expect(bad.status, JSON.stringify(bad.body)).toBe(201);
    const badInv = body(bad);
    expect(badInv.matchState).toBe('ON_HOLD');
    expect(badInv.exceptions[0].code).toBe('QTY_OVER_RECEIPT');
    expect(badInv.exceptions[0].message).toBe('Billed 100, received 98');
    const blocked = await v.call(
      'post',
      `/scm/purchaseinvoice/${badInv.id}/submit`,
      {},
      { 'If-Match': `"${badInv.version}"` },
    );
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('MATCH_BLOCKED');

    // ---- fix to 98 -> posts; GL lines of §5
    const fixed = await v.call(
      'put',
      `/scm/purchaseinvoice/${badInv.id}`,
      { ...invBody(98), vendorInvoiceNo: badInv.vendorInvoiceNo },
      { 'If-Match': `"${badInv.version}"` },
    );
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    const fx2 = body(fixed);
    expect(fx2.matchState).toBe('MATCHED');
    const ps = await v.call(
      'post',
      `/scm/purchaseinvoice/${badInv.id}/submit`,
      {},
      { 'If-Match': `"${fx2.version}"` },
    );
    expect(ps.status, JSON.stringify(ps.body)).toBe(200);
    const inv = body(await v.call('get', `/scm/purchaseinvoice/${badInv.id}`));
    expect(inv.status).toBe('Posted');
    expect(inv.tdsAmount).toBe('5');
    expect(await gl(fx.unitId, '2150')).toBe(-100); // GRIR: 5000 - 4900
    expect(await gl(fx.unitId, '5111')).toBe(49); // PPV
    expect(await gl(fx.unitId, '1401')).toBe(445.41);
    expect(await gl(fx.unitId, '1402')).toBe(445.41);
    expect(await gl(fx.unitId, '6270')).toBe(0.18);
    expect(await gl(fx.unitId, '2311')).toBe(-5);
    expect(await gl(fx.unitId, '2101')).toBe(-5835);

    // ---- return the 2 rejected pieces (not invoiced): Dr GRIR 100, Dr PPV 10 / Cr INVENTORY 110
    const dn = await v.call('post', '/fin/debitnote', {
      kind: 'RETURN',
      supplierId: sup.id,
      grnId: grn.id,
      lines: [{ grnLineId: grn.lines[0].id, qty: 2 }],
    });
    expect(dn.status, JSON.stringify(dn.body)).toBe(201);
    const dn0 = body(dn);
    const dns = await v.call(
      'post',
      `/fin/debitnote/${dn0.id}/submit`,
      {},
      { 'If-Match': `"${dn0.version}"` },
    );
    expect(dns.status, JSON.stringify(dns.body)).toBe(200);
    expect(body(await v.call('get', `/fin/debitnote/${dn0.id}`)).status).toBe('Posted');
    expect(await gl(fx.unitId, '2150')).toBe(0); // GRIR cleared
    expect(await gl(fx.unitId, '5111')).toBe(59);
    expect(await gl(fx.unitId, '1301')).toBe(5500 - 110);
    const blockedLeft = await prisma.stockSlice.aggregate({
      where: { itemId: item.id, warehouseId: fx.warehouseId, stockStatus: 'BLOCKED' },
      _sum: { qty: true },
    });
    expect(Number(blockedLeft._sum.qty ?? 0)).toBe(0);
    // trial balance of the unit still balances
    const tb = await prisma.glEntry.aggregate({
      where: { unitId: fx.unitId },
      _sum: { debit: true, credit: true },
    });
    expect(Number(tb._sum.debit)).toBeCloseTo(Number(tb._sum.credit), 2);
    // duplicate vendor invoice number
    const dup = await v.call('post', '/scm/purchaseinvoice', {
      ...invBody(1),
      vendorInvoiceNo: badInv.vendorInvoiceNo,
    });
    expect(dup.status).toBe(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe('DUPLICATE_INVOICE');
  });
});
