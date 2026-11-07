// Phase 8: customer-supplied material (client requirement 4). The customer's material has no value and lives in its
// own tables: it never enters stock_balances / stock_ledger / the GL, our production cannot use it, and the
// integrity check still passes. Receipt / issue / return are posted at once; cancel reverses, dated the cancel date.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { API, auditRows, errorOf, makeUser, newApp, prisma, signIn, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { fixture, mkItem, setApproval, today, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

const app = newApp();
let owner: Signed;
let fx: Fixture;
let saved: Awaited<ReturnType<typeof setApproval>>;
let custA: string;
let custB: string;
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let seq = 0;

const call = (
  method: 'get' | 'post',
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
  who: Signed = owner,
) => {
  let r = request(app)
    [method](`${API}/inventory/customer-material${path}`)
    .set(who.bearer)
    .set('X-Unit-Id', fx.unitId);
  for (const [k, val] of Object.entries(extra)) r = r.set(k, val);
  return body === undefined ? r : r.send(body as object);
};

async function mkCustomer(name: string): Promise<string> {
  const c = await prisma.customer.create({
    data: {
      code: `C${Date.now().toString(36)}${(seq += 1)}`.toUpperCase().slice(0, 28),
      name,
      nameKey: `${name}-${Date.now()}-${seq}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: 'UNREGISTERED',
      createdById: fx.ownerId,
    },
  });
  return c.id;
}

const receiptBody = (itemId: string, over: Record<string, unknown> = {}, line: object = {}) => ({
  customerId: custA,
  warehouseId: fx.warehouseId,
  docDate: today(),
  challanNo: `CH-${(seq += 1)}-${Date.now().toString(36)}`,
  challanDate: today(),
  lines: [{ itemId, qty: 100, ...line }],
  ...over,
});

async function receive(itemId: string, over: Record<string, unknown> = {}, line: object = {}) {
  const res = await call('post', '/receipts', receiptBody(itemId, over, line));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<{
    id: string;
    code: string;
    version: number;
    lines: { lotId: string; qty: number }[];
  }>(res);
}

beforeAll(async () => {
  owner = await signInOwner(app);
  saved = await setApproval(false);
  invalidateAccessCache();
  fx = await fixture();
  custA = await mkCustomer('Alpha Coaters');
  custB = await mkCustomer('Beta Fabricators');
});
afterAll(async () => {
  for (const r of saved)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

describe('endpoint access', () => {
  const ROUTES: [string, string][] = [
    ['get', '/lots'],
    ['get', '/balances'],
    ['get', '/docs'],
    ['post', '/receipts'],
    ['post', '/issues'],
    ['post', '/returns'],
  ];
  it('401 without a token, 403 without rights', async () => {
    const emp = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: 'Sales' }));
    invalidateAccessCache();
    for (const [m, p] of ROUTES) {
      const bare = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[
        m
      ]!(`${API}/inventory/customer-material${p}`);
      expect(bare.status, `${m} ${p}`).toBe(401);
      const denied = await call(m as 'get' | 'post', p, m === 'post' ? {} : undefined, {}, emp);
      expect(denied.status, `${m} ${p}`).toBe(403);
    }
  });
  it('404 for an unknown document or lot, 422 for a bad id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect((await call('get', `/docs/${id}`)).status).toBe(404);
    expect((await call('get', `/lots/${id}/history`)).status).toBe(404);
    expect((await call('get', '/docs/not-an-id')).status).toBe(422);
  });
});

describe('receipt', () => {
  it('creates a lot per line with no value and leaves our own stock and the GL alone', async () => {
    const item = await mkItem({ batchTracked: true });
    const before = await prisma.stockLedger.count({ where: { itemId: item.id } });
    const doc = await receive(item.id, {}, { batchNo: 'B-77', expiryDate: plusDays(200), qty: 40 });
    expect(doc.code).toMatch(/^CMR\//);
    expect(doc.lines).toHaveLength(1);
    const lots = dataOf<{ balanceQty: number; batchNo: string; customerName: string }[]>(
      await call('get', `/lots?itemId=${item.id}`),
    );
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      balanceQty: 40,
      batchNo: 'B-77',
      customerName: 'Alpha Coaters',
    });
    // Not in our books at all.
    expect(await prisma.stockBalance.count({ where: { itemId: item.id } })).toBe(0);
    expect(await prisma.stockSlice.count({ where: { itemId: item.id } })).toBe(0);
    expect(await prisma.stockLedger.count({ where: { itemId: item.id } })).toBe(before);
    expect((await auditRows('CUSTOMER_MATERIAL_RECEIVED', { targetId: doc.id })).length).toBe(1);
    const integ = dataOf<{ ok: boolean; checks: { id: string; ok: boolean }[] }>(
      await request(app)
        .get(`${API}/inventory/integrity`)
        .set(owner.bearer)
        .set('X-Unit-Id', fx.unitId),
    );
    expect(integ.checks.find((c) => c.id === 'INV-7')?.ok).toBe(true);
  });

  it('plain 422 messages: no challan, future date, expired, batch missing, double entry', async () => {
    const plain = await mkItem();
    const tracked = await mkItem({ batchTracked: true });
    const noChallan = await call('post', '/receipts', receiptBody(plain.id, { challanNo: '' }));
    expect(noChallan.status).toBe(422);
    expect(errorOf(noChallan).fields).toHaveProperty('challanNo');
    const future = await call('post', '/receipts', receiptBody(plain.id, { docDate: plusDays(3) }));
    expect(errorOf(future).fields).toHaveProperty('docDate');
    const expired = await call(
      'post',
      '/receipts',
      receiptBody(plain.id, {}, { expiryDate: plusDays(-2) }),
    );
    expect(errorOf(expired).fields).toHaveProperty('lines.0.expiryDate');
    const nobatch = await call('post', '/receipts', receiptBody(tracked.id));
    expect(errorOf(nobatch).fields).toHaveProperty('lines.0.batchNo');
    const zero = await call('post', '/receipts', receiptBody(plain.id, {}, { qty: 0 }));
    expect(errorOf(zero).fields).toHaveProperty('lines.0.qty');
    const first = receiptBody(plain.id);
    expect((await call('post', '/receipts', first)).status).toBe(201);
    const again = await call('post', '/receipts', first);
    expect(again.status).toBe(409);
  });
});

describe('issue and return', () => {
  it('issue needs a reason, cannot exceed the lot, cannot use another customer or expired material', async () => {
    const item = await mkItem();
    const doc = await receive(item.id, {}, { qty: 50 });
    const lotId = doc.lines[0]!.lotId;
    const head = { customerId: custA, warehouseId: fx.warehouseId, docDate: today() };
    const noWhy = await call('post', '/issues', { ...head, lines: [{ lotId, qty: 5 }] });
    expect(errorOf(noWhy).fields).toHaveProperty('reference');
    const over = await call('post', '/issues', {
      ...head,
      reference: 'JOB-1',
      lines: [{ lotId, qty: 51 }],
    });
    expect(over.status).toBe(409);
    expect(errorOf(over).code).toBe('INSUFFICIENT_STOCK');
    const wrongCust = await call('post', '/issues', {
      ...head,
      customerId: custB,
      reference: 'JOB-1',
      lines: [{ lotId, qty: 5 }],
    });
    expect(errorOf(wrongCust).fields).toHaveProperty('lines.0.lotId');
    const old = await mkItem();
    const oldDoc = await receive(old.id, {}, { qty: 10, expiryDate: plusDays(5) });
    await prisma.customerMaterialLot.update({
      where: { id: oldDoc.lines[0]!.lotId },
      data: { expiryDate: new Date(`${plusDays(-1)}T00:00:00Z`), mfgDate: null },
    });
    const exp = await call('post', '/issues', {
      ...head,
      reference: 'JOB-2',
      lines: [{ lotId: oldDoc.lines[0]!.lotId, qty: 1 }],
    });
    expect(exp.status).toBe(409);
    expect(errorOf(exp).code).toBe('BATCH_EXPIRED');
  });

  it('issue then return reduce the lot; the history shows each step and the books stay untouched', async () => {
    const item = await mkItem();
    const doc = await receive(item.id, {}, { qty: 100 });
    const lotId = doc.lines[0]!.lotId;
    const head = { customerId: custA, warehouseId: fx.warehouseId, docDate: today() };
    const iss = await call('post', '/issues', {
      ...head,
      reference: 'WO-9',
      lines: [{ lotId, qty: 30 }],
    });
    expect(iss.status, JSON.stringify(iss.body)).toBe(201);
    expect(dataOf<{ code: string }>(iss).code).toMatch(/^CMI\//);
    const noChallan = await call('post', '/returns', { ...head, lines: [{ lotId, qty: 20 }] });
    expect(errorOf(noChallan).fields).toHaveProperty('challanNo');
    const ret = await call('post', '/returns', {
      ...head,
      challanNo: 'OUT-1',
      challanDate: today(),
      vehicleNo: 'MH12AB1234',
      lines: [{ lotId, qty: 20 }],
    });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    const lots = dataOf<{ balanceQty: number }[]>(await call('get', `/lots?itemId=${item.id}`));
    expect(lots[0]!.balanceQty).toBe(50);
    const hist = dataOf<{ type: string; qty: number; balanceAfter: number }[]>(
      await call('get', `/lots/${lotId}/history`),
    );
    expect(hist.map((h) => h.type)).toEqual(['RETURN', 'ISSUE', 'RECEIPT']);
    expect(hist.map((h) => h.balanceAfter)).toEqual([50, 70, 100]);
    expect(await prisma.stockLedger.count({ where: { itemId: item.id } })).toBe(0);
    const bal = dataOf<{ itemId: string; balanceQty: number }[]>(await call('get', '/balances'));
    expect(bal.find((b) => b.itemId === item.id)?.balanceQty).toBe(50);
  });

  it('our own issue voucher cannot take customer material: it is not in our stock', async () => {
    const item = await mkItem();
    await receive(item.id, {}, { qty: 100 });
    const v = vclient(app, owner, fx.unitId);
    const c = await v.create('transactions', {
      warehouseId: fx.warehouseId,
      txType: 'Issue',
      lines: [{ itemId: item.id, qty: 1 }],
    });
    await v.submit('transactions', c.id, c.version);
    const res = await v.act('transactions', c.id, 'post');
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('cancel', () => {
  it('reverses an issue and a receipt, dated the cancel date; used material blocks the receipt cancel', async () => {
    const item = await mkItem();
    const doc = await receive(item.id, {}, { qty: 60 });
    const lotId = doc.lines[0]!.lotId;
    const iss = dataOf<{ id: string; version: number }>(
      await call('post', '/issues', {
        customerId: custA,
        warehouseId: fx.warehouseId,
        docDate: today(),
        reference: 'WO-5',
        lines: [{ lotId, qty: 25 }],
      }),
    );
    // Receipt cannot be cancelled while part of it is used.
    const blocked = await call(
      'post',
      `/docs/${doc.id}/cancel`,
      { reason: 'Wrong entry', date: today() },
      {
        'If-Match': `"${doc.version}"`,
      },
    );
    expect(blocked.status).toBe(409);
    // Bad input.
    const short = await call(
      'post',
      `/docs/${iss.id}/cancel`,
      { reason: 'no', date: today() },
      {
        'If-Match': `"${iss.version}"`,
      },
    );
    expect(short.status).toBe(422);
    const cancelDate = today();
    const ok = await call(
      'post',
      `/docs/${iss.id}/cancel`,
      { reason: 'Issued by mistake', date: cancelDate },
      {
        'If-Match': `"${iss.version}"`,
      },
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(dataOf<{ status: string }>(ok).status).toBe('Cancelled');
    const twice = await call(
      'post',
      `/docs/${iss.id}/cancel`,
      { reason: 'Issued by mistake', date: cancelDate },
      {
        'If-Match': `"${iss.version + 1}"`,
      },
    );
    expect(twice.status).toBe(409);
    expect(
      dataOf<{ balanceQty: number }[]>(await call('get', `/lots?itemId=${item.id}`))[0]!.balanceQty,
    ).toBe(60);
    const rcpt = await call(
      'post',
      `/docs/${doc.id}/cancel`,
      { reason: 'Customer sent wrong goods', date: cancelDate },
      {
        'If-Match': `"${doc.version}"`,
      },
    );
    expect(rcpt.status, JSON.stringify(rcpt.body)).toBe(200);
    const hist = dataOf<{ type: string; date: string; balanceAfter: number }[]>(
      await call('get', `/lots/${lotId}/history`),
    );
    expect(hist.filter((h) => h.type === 'REVERSAL')).toHaveLength(2);
    expect(hist.find((h) => h.type === 'REVERSAL')?.date).toBe(cancelDate);
    expect(hist[0]!.balanceAfter).toBe(0);
    // Posted rows are never edited or deleted: the database refuses.
    await expect(prisma.$executeRaw`DELETE FROM customer_material_ledger`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE customer_material_lines SET qty = 1`).rejects.toThrow();
    expect((await auditRows('CUSTOMER_MATERIAL_CANCELLED', { targetId: iss.id })).length).toBe(1);
    const integ = dataOf<{ checks: { id: string; ok: boolean }[] }>(
      await request(app)
        .get(`${API}/inventory/integrity`)
        .set(owner.bearer)
        .set('X-Unit-Id', fx.unitId),
    );
    expect(integ.checks.every((c) => c.ok)).toBe(true);
  });

  it('parallel issues of the same lot: only the quantity that exists is taken', async () => {
    const item = await mkItem();
    const doc = await receive(item.id, {}, { qty: 10 });
    const lotId = doc.lines[0]!.lotId;
    const go = () =>
      call('post', '/issues', {
        customerId: custA,
        warehouseId: fx.warehouseId,
        docDate: today(),
        reference: 'RACE',
        lines: [{ lotId, qty: 6 }],
      });
    const res = await Promise.all([go(), go(), go()]);
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(2);
    const lots = dataOf<{ balanceQty: number }[]>(await call('get', `/lots?itemId=${item.id}`));
    expect(lots[0]!.balanceQty).toBe(4);
  });
});
