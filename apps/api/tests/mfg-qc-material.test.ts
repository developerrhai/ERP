/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Manufacturing x quality: (1) a job card that books pieces needs the MANUAL material issued, (2) the in-process
// Usage Decision lets the order's qty_completed follow the accepted pieces (the hook runs after the sheet is Decided).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { mkItem, setApproval, tag } from './phase08-helpers';
import { body, ifm, setup } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
const TODAY = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, b?: unknown, h: Record<string, string> = {}) =>
  ctx.v.call(method, path, b, h);
const patch = (path: string, b: unknown, h: Record<string, string> = {}) =>
  request(app).patch('/api/v1' + path).set(owner.bearer).set('X-Unit-Id', ctx.fx.unitId).set(h).send(b as object);

beforeAll(async () => {
  owner = await signInOwner(app);
  restoreStock = await setApproval(false);
  invalidateAccessCache();
  ctx = await setup(app, owner);
});
afterAll(async () => {
  for (const r of restoreStock)
    await prisma.moduleControl.update({ where: { pageId: r.pageId }, data: { approvalRequired: r.approvalRequired } });
  await prisma.$disconnect();
});

/** A released single-operation order. `manual`: the BOM has a MANUAL component; otherwise only a BACKFLUSH one. */
async function mkOrder(opts: { manual: boolean; qc: boolean }) {
  const { fx, v } = ctx;
  const fg = await mkItem({ itemType: 'Finished Good', baseUom: 'Nos' });
  const rm = await mkItem();
  await v.post('opening', { warehouseId: fx.warehouseId, lines: [{ itemId: rm.id, qty: 100, unitCost: 10 }] });
  const cc = await prisma.costCenter.findFirstOrThrow({ where: { unitId: fx.unitId } });
  const wc = body(
    await call('post', '/mfg/work-centers', {
      costCentreId: cc.id, code: `WC${tag()}`, name: 'Cell', labourRatePerHr: 60, overheadRatePerHr: 30,
    }),
  );
  const bom = body(
    await call('post', '/mfg/boms', {
      itemId: fg.id,
      lines: [{ itemId: rm.id, qtyPer: 1, issueMethod: opts.manual ? 'MANUAL' : 'BACKFLUSH' }],
    }),
  );
  const sub = await call('post', `/mfg/boms/${bom.id}/submit`, {}, ifm(bom.version));
  expect((await call('post', `/mfg/boms/${bom.id}/release`, {}, ifm(body(sub).version))).status).toBe(200);
  const rt = body(
    await call('post', '/mfg/routings', {
      itemId: fg.id,
      ops: [{ seq: 10, name: 'Make', workCentreId: wc.id, runMinutes: 1, qcRequired: opts.qc }],
    }),
  );
  expect((await call('post', `/mfg/routings/${rt.id}/release`, {}, ifm(rt.version))).status).toBe(200);
  const o = await call('post', '/mfg/production-orders', {
    itemId: fg.id, qty: 10, dueDate: TODAY, warehouseId: fx.warehouse2Id, rmWarehouseId: fx.warehouseId,
  });
  expect([200, 201], JSON.stringify(o.body)).toContain(o.status);
  let order = body(o);
  const rel = await call('post', `/mfg/production-orders/${order.id}/release`, {}, {
    ...ifm(order.version), 'Idempotency-Key': `rel-${tag()}-aaaa`,
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(200);
  order = body(await call('get', `/mfg/production-orders/${order.id}`));
  return { order, rm, op: order.ops[0] };
}

describe('job card completion needs the manual material', () => {
  it('refuses completion with no material issued, allows it once issued', async () => {
    const { order, op } = await mkOrder({ manual: true, qc: false });
    const no = await call('post', `/mfg/job-cards/${op.id}/complete`, { good: 10 });
    expect(no.status, JSON.stringify(no.body)).toBe(409);
    expect(no.body.error.code).toBe('JC_MATERIAL_NOT_ISSUED');
    const mat = order.materials[0];
    const iss = await call(
      'post', `/mfg/production-orders/${order.id}/issue`,
      { lines: [{ materialId: mat.id, qty: 10 }] }, { 'Idempotency-Key': `iss-${tag()}-aaaa` },
    );
    expect(iss.status, JSON.stringify(iss.body)).toBe(200);
    const ok = await call('post', `/mfg/job-cards/${op.id}/complete`, { good: 10 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('a back-flushed component never blocks completion', async () => {
    const { op } = await mkOrder({ manual: false, qc: false });
    const ok = await call('post', `/mfg/job-cards/${op.id}/complete`, { good: 10 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('in-process inspection decision feeds qty_completed', () => {
  it('the order receives the accepted pieces of the last operation', async () => {
    const { order, op } = await mkOrder({ manual: false, qc: true });
    const done = await call('post', `/mfg/job-cards/${op.id}/complete`, { good: 10 });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const lot = (
      await prisma.$queryRaw<{ inspection_id: string }[]>`SELECT inspection_id::text FROM mfg_lots WHERE op_id = ${op.id}::uuid`
    )[0]!;
    expect(lot).toBeTruthy();
    const insId = lot.inspection_id;
    let sheet = body(await call('get', `/qms/inspections/${insId}`));
    const filled = await patch(
      `/qms/inspections/${insId}`,
      { rows: [{ label: 'Surface', rowType: 'ATTRIBUTE', readings: ['OK'] }] },
      ifm(sheet.version),
    );
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    sheet = body(filled);
    const sub = await call('post', `/qms/inspections/${insId}/submit`, {}, ifm(sheet.version));
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const dec = await call('post', `/qms/inspections/${insId}/decide`, { acceptedQty: 9, rejectedQty: 1, note: 'one scratched' });
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
    const r = (
      await prisma.$queryRaw<{ q: string }[]>`SELECT qty_completed::text AS q FROM mfg_orders WHERE id = ${order.id}::uuid`
    )[0]!;
    expect(Number(r.q)).toBe(9);
  });
});
