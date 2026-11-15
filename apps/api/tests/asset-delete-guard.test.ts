/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Deleting an asset is blocked (409, plain message) while it has an open breakdown, an open work order or a live allocation.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { setApproval, tag } from './phase08-helpers';
import { body, setup } from './phase09-helpers';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
const call = (method: 'get' | 'post' | 'delete', path: string, b?: unknown, h: Record<string, string> = {}) =>
  ctx.v.call(method, path, b, h);

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

async function mkMachine() {
  const cats = (await call('get', '/assets/categories')).body.data as any[];
  const pm = cats.find((c) => c.code === 'PM_GENERAL');
  const m = await call('post', '/maint/machines', { name: `Lathe ${tag()}`, categoryId: pm.id, isMaintainable: true });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  const a = body(m);
  await prisma.$executeRaw`UPDATE assets SET status = 'ACTIVE' WHERE id = ${a.id}::uuid`;
  return a;
}
const del = async (id: string) => {
  const cur = body(await call('get', `/assets/by-id/${id}`));
  return request(app)
    .delete(`/api/v1/maint/machines/${id}`)
    .set(owner.bearer)
    .set('X-Unit-Id', ctx.fx.unitId)
    .set('If-Match', `"${cur.version}"`);
};

describe('asset delete guard', () => {
  it('refuses while a breakdown is open, then deletes once it is closed', async () => {
    const a = await mkMachine();
    const bd = await call(
      'post',
      '/maint/breakdowns',
      { assetId: a.id, symptom: 'Will not start', priority: 'P2', machineStopped: false },
      { 'Idempotency-Key': `bd-${tag()}-aaaa` },
    );
    expect(bd.status, JSON.stringify(bd.body)).toBeLessThan(300);
    const blocked = await del(a.id);
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect(blocked.body.error.message).toMatch(/open breakdown/);
    await prisma.$executeRaw`UPDATE breakdown_tickets SET status = 'CANCELLED' WHERE asset_id = ${a.id}::uuid`;
    await prisma.$executeRaw`UPDATE assets SET status = 'ACTIVE' WHERE id = ${a.id}::uuid`;
    const ok = await del(a.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await call('get', `/assets/by-id/${a.id}`)).status).toBe(404);
  });

  it('refuses while the asset is allocated', async () => {
    const a = await mkMachine();
    const al = await call('post', '/assets/allocations', { assetId: a.id, location: 'Shop 1' });
    expect(al.status, JSON.stringify(al.body)).toBe(201);
    const blocked = await del(a.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/allocated/);
    const back = await call('post', `/assets/allocations/${body(al).id}/return`, { conditionIn: 'Good' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect((await del(a.id)).status).toBe(200);
  });
});
