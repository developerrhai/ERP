/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Blind counts: the counter never sees the system quantity, yet the server still compares the entry with it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { fixture, mkItem, setApproval, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

const app = newApp();
let owner: Signed;
let fx: Fixture;
let v: ReturnType<typeof vclient>;
let saved: Awaited<ReturnType<typeof setApproval>>;

beforeAll(async () => {
  owner = await signInOwner(app);
  saved = await setApproval(false);
  invalidateAccessCache();
  fx = await fixture();
  v = vclient(app, owner, fx.unitId);
});
afterAll(async () => {
  for (const r of saved)
    await prisma.moduleControl.update({ where: { pageId: r.pageId }, data: { approvalRequired: r.approvalRequired } });
  await prisma.$disconnect();
});

const receipt = (itemId: string, qty: number) =>
  v.post('transactions', { warehouseId: fx.warehouseId, txType: 'Receipt', lines: [{ itemId, qty, unitCost: 10 }] });

async function run(countType: 'CYCLE' | 'PHYSICAL', withItems: boolean, blind: boolean) {
  // a physical count freezes its warehouse: every scenario gets its own unit and warehouses
  fx = await fixture();
  v = vclient(app, owner, fx.unitId);
  const a = await mkItem();
  const b = await mkItem({ batchTracked: false });
  await receipt(a.id, 100);
  await receipt(b.id, 40);
  const made = await v.call('post', '/inventory/counts', {
    countType,
    warehouseId: fx.warehouseId,
    blind,
    ...(withItems ? { itemIds: [a.id, b.id] } : {}),
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const c = dataOf<{ id: string; version: number }>(made);
  const st = await v.call('post', `/inventory/counts/${c.id}/start`, undefined, { 'If-Match': `"${c.version}"` });
  expect(st.status, JSON.stringify(st.body)).toBe(200);
  const det = dataOf<{ lines: { id: string; itemId: string; systemQty: number | null }[] }>(
    await v.call('get', `/inventory/counts/${c.id}`),
  );
  return { a, b, c, det };
}

describe('blind counts compare on the server', () => {
  for (const [type, withItems] of [['CYCLE', true], ['PHYSICAL', false], ['PHYSICAL', true]] as const) {
    it(`${type}${withItems ? ' with items' : ' (all stock)'}: matching counts are accepted and nothing leaks`, async () => {
      const { a, b, c, det } = await run(type, withItems, true);
      for (const l of det.lines) expect(l.systemQty).toBeNull();
      const la = det.lines.find((l) => l.itemId === a.id)!;
      const lb = det.lines.find((l) => l.itemId === b.id)!;
      const ra = await v.call('post', `/inventory/counts/${c.id}/lines/${la.id}/count`, { qty: 100 });
      expect(ra.status, JSON.stringify(ra.body)).toBe(200);
      expect(dataOf<any>(ra).status).toBe('Accepted');
      // the counter's answer must not reveal the system quantity or the variance
      expect(dataOf<any>(ra).systemQty ?? null).toBeNull();
      expect(dataOf<any>(ra).variance ?? null).toBeNull();
      const rb = await v.call('post', `/inventory/counts/${c.id}/lines/${lb.id}/count`, { qty: 40 });
      expect(dataOf<any>(rb).status).toBe('Accepted');
    });
  }
});
