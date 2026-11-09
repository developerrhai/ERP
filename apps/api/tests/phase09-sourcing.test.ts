/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- API test bodies are loose JSON */
// Phase 9: PR -> RFQ -> 3 quotes -> comparison -> PO, contract release limits, PO amend / short-close,
// delivery tracking (client requirement 1) and the supplier-type rule (client requirement 5).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import {
  approvalOff,
  approve,
  body,
  ifm,
  mkItem,
  mkSupplier,
  mkPo,
  setup,
} from './phase09-helpers';
import type { Body } from './phase09-helpers';

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

describe('sourcing chain', () => {
  it('PR -> RFQ -> 3 quotes -> comparison -> award -> PO', async () => {
    const { v, fx } = ctx;
    const item = await mkItem();
    const cc = await prisma.costCenter.findFirstOrThrow({ where: { unitId: fx.unitId } });
    const pr = await v.call('post', '/scm/pr', {
      purpose: 'Shafts',
      lines: [{ itemId: item.id, qty: 10, uom: 'Kg', estRate: 60, costCenterId: cc.id }],
    });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    const pr0 = body(pr);
    expect(pr0.estimatedTotal).toBe('600');
    await approve(v, '/scm/pr', pr0);
    expect((await v.call('get', `/scm/pr/${pr0.id}/budget`)).status).toBe(200);

    const rfq = body(await v.call('post', `/scm/pr/${pr0.id}/to-rfq`, {}));
    expect(rfq.lines[0].qty).toBe('10');
    const [s1, s2, s3] = [await mkSupplier(), await mkSupplier(), await mkSupplier()];
    const inv = await v.call('post', `/scm/rfq/${rfq.id}/invite`, {
      supplierIds: [s1.id, s2.id, s3.id],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    await approve(v, '/scm/rfq', body(await v.call('get', `/scm/rfq/${rfq.id}`)));
    const issued = await v.call('post', `/scm/rfq/${rfq.id}/issue`, {});
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect((await v.call('post', `/scm/rfq/${rfq.id}/issue`, {})).status).toBe(409);

    const rfqLine = body(await v.call('get', `/scm/rfq/${rfq.id}`)).lines[0].id;
    const quote = async (sup: { id: string }, rate: number, lead: number) => {
      const r = await v.call('post', '/scm/vendorquote', {
        rfqId: rfq.id,
        supplierId: sup.id,
        freight: 0,
        lines: [
          {
            rfqLineId: rfqLine,
            itemId: item.id,
            qty: 10,
            uom: 'Kg',
            rate,
            leadDays: lead,
            gstPct: 18,
            costBreakup: { rawMaterial: rate * 0.6, process: rate * 0.3, margin: rate * 0.1 },
          },
        ],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const q = body(r);
      await approve(v, '/scm/vendorquote', q);
      return q;
    };
    const q1 = await quote(s1, 55, 10);
    const q2 = await quote(s2, 50, 20);
    const q3 = await quote(s3, 65, 5);
    expect(q2.total).toBe('500');
    expect(q1.lines[0].costBreakup.rawMaterial).toBeCloseTo(33);

    const cmp = await v.call('post', '/scm/comparison', { rfqId: rfq.id });
    expect(cmp.status, JSON.stringify(cmp.body)).toBe(201);
    const c = body(cmp);
    expect(c.lines).toHaveLength(3);
    const ranks = Object.fromEntries(c.lines.map((e: Body) => [e.quoteId, e.rank]));
    expect(Object.values(ranks).sort()).toEqual([1, 2, 3]);
    const sim = await v.call('post', `/scm/comparison/${c.id}/simulate`, {
      wPrice: 10,
      wLead: 80,
      wQuality: 10,
    });
    expect(sim.status).toBe(200);
    expect(body(sim as never)).toBeTruthy();
    await approve(v, '/scm/comparison', c);
    const first = c.lines.find((e: Body) => e.rank === 1).quoteId as string;
    const second = c.lines.find((e: Body) => e.rank === 2).quoteId as string;
    const noReason = await v.call('post', `/scm/comparison/${c.id}/award`, { quoteId: second });
    expect(noReason.status).toBe(422);
    const aw = await v.call('post', `/scm/comparison/${c.id}/award`, { quoteId: first });
    expect(aw.status, JSON.stringify(aw.body)).toBe(200);
    const po = await v.call('post', `/scm/po/from-comparison/${c.id}`, {});
    expect(po.status, JSON.stringify(po.body)).toBe(200);
    expect(body(po).lines[0].qty).toBe('10');
    void [q1, q3];
  });

  it('a quote can be negotiated again (round 2) and only the new round is current', async () => {
    const { v, fx } = ctx;
    const item = await mkItem();
    const s = await mkSupplier();
    const q = body(
      await v.call('post', '/scm/vendorquote', {
        supplierId: s.id,
        lines: [{ itemId: item.id, qty: 5, uom: 'Kg', rate: 10, gstPct: 18 }],
      }),
    );
    const r2 = await v.call('post', `/scm/vendorquote/${q.id}/round`, {});
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(body(r2).roundNo).toBe(2);
    expect(body(await v.call('get', `/scm/vendorquote/${q.id}`)).isCurrent).toBe(false);
    void fx;
  });
});

describe('contracts, amend, short-close, delivery tracking', () => {
  it('a contract line caps the quantity released by POs', async () => {
    const { v, fx } = ctx;
    const item = await mkItem();
    const s = await mkSupplier();
    const con = await v.call('post', '/scm/contracts', {
      supplierId: s.id,
      validFrom: '2020-01-01',
      validTo: '2099-12-31',
      lines: [{ itemId: item.id, uom: 'Kg', rate: 40, maxQty: 100 }],
    });
    expect(con.status, JSON.stringify(con.body)).toBe(201);
    const c = body(con);
    await approve(v, '/scm/contracts', c);
    const cl = body(await v.call('get', `/scm/contracts/${c.id}`)).lines[0].id;
    const ok = await mkPo(v, fx, s.id, item.id, 60, 40, {}, { contractLineId: cl });
    expect(ok.status).toBe('Approved');
    const second = await v.call('post', '/scm/po', {
      supplierId: s.id,
      shipToWarehouseId: fx.warehouseId,
      lines: [{ itemId: item.id, qty: 60, uom: 'Kg', gstPct: 18, contractLineId: cl }],
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const s2 = body(second);
    expect(s2.lines[0].rate).toBe('40'); // taken from the contract
    const sub = await v.call('post', `/scm/po/${s2.id}/submit`, {}, ifm(s2.version));
    expect(sub.status).toBe(409);
    expect((sub.body as { error: { code: string } }).error.code).toBe('CONTRACT_QTY_EXCEEDED');
  });

  it('amend re-opens an approved PO and keeps a revision; short-close closes the balance', async () => {
    const { v, fx } = ctx;
    const item = await mkItem();
    const s = await mkSupplier();
    const po = await mkPo(v, fx, s.id, item.id, 10, 100);
    expect((await v.call('post', `/scm/po/${po.id}/amend`, { reason: 'x' })).status).toBe(422);
    const am = await v.call('post', `/scm/po/${po.id}/amend`, {
      reason: 'Rate revised by supplier',
    });
    expect(am.status, JSON.stringify(am.body)).toBe(200);
    expect(body(am).status).toBe('Draft');
    expect(body(am).revisionNo).toBe(1);
    const revs = body(
      (await v.call('get', `/scm/po/${po.id}/revisions`)) as never,
    ) as unknown as Body[];
    expect(revs).toHaveLength(1);
    // while amending, a receipt is refused
    const grn = await v.call('post', '/scm/grn', {
      poId: po.id,
      warehouseId: fx.warehouseId,
      lines: [{ poLineId: po.lines[0].id, receivedQty: 1 }],
    });
    expect(grn.status).toBe(409);
    expect((grn.body as { error: { code: string } }).error.code).toBe('PO_NOT_RELEASED');
    const cur = body(await v.call('get', `/scm/po/${po.id}`));
    const upd = await v.call(
      'put',
      `/scm/po/${po.id}`,
      {
        lines: [
          { id: cur.lines[0].id, itemId: item.id, qty: 10, uom: 'Kg', rate: 110, gstPct: 18 },
        ],
      },
      ifm(cur.version),
    );
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    await approve(v, '/scm/po', body(upd));
    const sc = await v.call('post', `/scm/po/${po.id}/short-close`, {
      reason: 'Supplier cannot supply',
    });
    expect(sc.status, JSON.stringify(sc.body)).toBe(200);
    expect(body(sc).lines[0].closedQty).toBe('10');
  });

  it('delivery tracking shows Open / Partly received / Delayed', async () => {
    const { v, fx } = ctx;
    const item = await mkItem();
    const s = await mkSupplier();
    const late = await mkPo(v, fx, s.id, item.id, 10, 10, {}, { deliveryDate: '2020-01-01' });
    const fine = await mkPo(v, fx, s.id, item.id, 10, 10, {}, { deliveryDate: '2099-01-01' });
    const rows = (await v.call('get', `/scm/po-delivery?supplierId=${s.id}&size=100`)).body as {
      data: Body[];
    };
    const st = (poId: string) => rows.data.find((r) => r.poId === poId)?.status;
    expect(st(late.id)).toBe('DELAYED');
    expect(st(fine.id)).toBe('OPEN');
    expect(rows.data.find((r) => r.poId === late.id)?.balanceQty).toBe('10');
  });

  it('supplier type: a CONTRACTOR cannot be put on a MATERIAL purchase order', async () => {
    const { v, fx } = ctx;
    const item = await mkItem();
    const s = await mkSupplier({ supplierType: 'CONTRACTOR' });
    const r = await v.call('post', '/scm/po', {
      supplierId: s.id,
      shipToWarehouseId: fx.warehouseId,
      lines: [{ itemId: item.id, qty: 1, uom: 'Kg', rate: 1, gstPct: 18 }],
    });
    expect(r.status).toBe(422);
  });

  it('a supplier on purchase hold or not approved is refused', async () => {
    const { v, fx } = ctx;
    const item = await mkItem();
    const held = await mkSupplier({ purchaseHold: true, holdReason: 'quality' });
    const r = await v.call('post', '/scm/po', {
      supplierId: held.id,
      shipToWarehouseId: fx.warehouseId,
      lines: [{ itemId: item.id, qty: 1, uom: 'Kg', rate: 1, gstPct: 18 }],
    });
    expect(r.status).toBe(422);
    expect((r.body as { error: { code: string } }).error.code).toBe('SUPPLIER_ON_HOLD');
    const pend = await mkSupplier({ approvalStatus: 'PENDING' });
    const r2 = await v.call('post', '/scm/po', {
      supplierId: pend.id,
      shipToWarehouseId: fx.warehouseId,
      lines: [{ itemId: item.id, qty: 1, uom: 'Kg', rate: 1, gstPct: 18 }],
    });
    expect((r2.body as { error: { code: string } }).error.code).toBe('SUPPLIER_NOT_APPROVED');
  });
});
