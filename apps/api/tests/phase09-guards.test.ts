/* eslint-disable @typescript-eslint/no-unsafe-argument -- API test bodies are loose JSON */
// Phase 9 API guards: 401 without a token, 403 without permission, 404 in another unit, 422 on bad input,
// illegal state changes and the audit row of a posting.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, newApp, prisma, signIn, signInOwner, makeUser } from './helpers';
import type { Signed } from './helpers';
import { approvalOff, body, ifm, mkGrn, mkItem, mkPo, mkSupplier, setup } from './phase09-helpers';
import { fixture, vclient } from './phase08-helpers';

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

const GETS = [
  '/scm/pr',
  '/scm/rfq',
  '/scm/vendorquote',
  '/scm/comparison',
  '/scm/po',
  '/scm/contracts',
  '/scm/grn',
  '/scm/purchaseinvoice',
  '/fin/debitnote',
  '/fin/ap/payables',
  '/fin/ap/ageing',
  '/fin/ap/due-schedule',
  '/wms/putaway/tasks',
  '/scm/po-delivery',
  '/scm/reports/grir',
  '/scm/reports/msme-overdue',
  '/scm/reports/itc-180',
  '/scm/reports/itc-at-risk',
  '/scm/reports/po-pending',
  '/scm/reports/supplier-scorecard',
  '/scm/alerts',
  '/scm/evaluation',
];

describe('guards', () => {
  it('401 without a token on every read route', async () => {
    for (const p of GETS) {
      const r = await request(app).get(`${API}${p}`);
      expect(r.status, p).toBe(401);
    }
  });

  it('every read route answers the owner (no 500)', async () => {
    for (const p of GETS) {
      const r = await ctx.v.call('get', p);
      expect(r.status, `${p} ${JSON.stringify(r.body)}`).toBe(200);
    }
  });

  it('403 for a user without access to the pages', async () => {
    const u = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: 'Sales' }));
    const c = vclient(app, u, ctx.fx.unitId);
    for (const p of ['/scm/purchaseinvoice', '/fin/ap/payables', '/scm/grn']) {
      const r = await c.call('get', p);
      expect(r.status, p).toBe(403);
    }
    const w = await c.call('post', '/scm/po', {
      supplierId: '00000000-0000-4000-8000-000000000000',
      lines: [],
    });
    expect(w.status).toBe(403);
  });

  it('404 in another unit, 422 on bad input, illegal transitions', async () => {
    const { v, fx } = ctx;
    const sup = await mkSupplier();
    const item = await mkItem();
    const po = await mkPo(v, fx, sup.id, item.id, 10, 10);
    const other = await fixture();
    const o = vclient(app, owner, other.unitId);
    expect((await o.call('get', `/scm/po/${po.id}`)).status).toBe(404);
    expect((await v.call('post', '/scm/po', { supplierId: sup.id, lines: [] })).status).toBe(422);
    expect(
      (
        await v.call('post', '/scm/po', {
          supplierId: sup.id,
          lines: [{ itemId: item.id, qty: 0, uom: 'Kg', rate: 1, gstPct: 18 }],
        })
      ).status,
    ).toBe(422);
    // an Approved PO is read-only
    const edit = await v.call('put', `/scm/po/${po.id}`, { notes: 'x' }, ifm(po.version));
    expect(edit.status).toBe(409);
    // a stale version
    const draft = body(
      await v.call('post', '/scm/po', {
        supplierId: sup.id,
        lines: [{ itemId: item.id, qty: 1, uom: 'Kg', rate: 1, gstPct: 18 }],
      }),
    );
    expect(
      (await v.call('put', `/scm/po/${draft.id}`, { notes: 'x' }, ifm(draft.version + 5))).status,
    ).toBe(409);
    // delete only a draft
    expect((await v.call('delete', `/scm/po/${po.id}`, undefined, ifm(po.version))).status).toBe(
      409,
    );
    expect(
      (await v.call('delete', `/scm/po/${draft.id}`, undefined, ifm(draft.version))).status,
    ).toBe(204);
    // a GRN cannot be posted twice nor cancelled once put away
    const grn = await mkGrn(v, fx, po, 10);
    const cancel = await v.call('post', `/scm/grn/${grn.id}/cancel`, {
      reason: 'Entered by mistake',
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(
      (await v.call('post', `/scm/grn/${grn.id}/cancel`, { reason: 'Entered by mistake' })).status,
    ).toBe(409);
    // audit rows were written
    const audits = await prisma.auditLog.count({
      where: {
        action: { in: ['SCM_CREATED', 'SCM_POSTED', 'SCM_CANCELLED'] },
        targetId: { in: [po.id, grn.id] },
      },
    });
    expect(audits).toBeGreaterThanOrEqual(3);
    // stock came back to zero after the cancel
    const bal = await prisma.stockBalance.findUnique({
      where: { itemId_warehouseId: { itemId: item.id, warehouseId: fx.warehouseId } },
    });
    expect(Number(bal?.onHand ?? 0)).toBe(0);
  });
});
