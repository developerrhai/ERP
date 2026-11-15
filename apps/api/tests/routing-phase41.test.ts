// Phase 41: plant routes + live routing, BOM & material approval, material transfer note. The router is mounted in a local
// express app (app.ts is shared and wired by the main session). The pending SQL is applied here, idempotently.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/core/http/error-middleware';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { allocateReceipt, bomRequired, movementType, receiptSplit, routeBalance, routeQtyProblem, shortageOf, yieldPct } from '../src/modules/routing/calc';
import { createRoutingRouter } from '../src/modules/routing/routes';
import { API, newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';
import { balance, fixture, mkItem, setApproval, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';

describe('routing calc', () => {
  it('route balance: planned 500, good 470, scrap 10 -> 20', () => {
    expect(routeBalance(500, 470, 10).toFixed()).toBe('20');
    expect(yieldPct(500, 470)).toBe('94.0');
    expect(routeQtyProblem(500, 495, 10)).toMatch(/more than planned/);
    expect(routeQtyProblem(500, 470, 10)).toBeNull();
  });
  it('shortage: required 82.000 kg, available 60.000 -> 22.000', () => {
    expect(shortageOf('82.000', '60.000').toFixed(3)).toBe('22.000');
    expect(shortageOf('10', '12').toFixed(3)).toBe('0.000');
    expect(bomRequired('82', '0', '1', '1').toFixed(3)).toBe('82.000');
    expect(bomRequired('2', '10', '5', '1').toFixed(3)).toBe('11.000');
  });
  it('short receipt: 100 sent, 96 received -> 4 short; allocation is first in first out', () => {
    const s = receiptSplit(100, 96);
    expect(s.received.toFixed()).toBe('96');
    expect(s.short.toFixed()).toBe('4');
    expect(() => receiptSplit(100, 101)).toThrow();
    const a = allocateReceipt([{ qty: '60' }, { qty: '40' }], 96);
    expect(a.map((x) => x.qty.toFixed())).toEqual(['60', '36']);
    expect(movementType('a', 'b')).toBe('Plant Transfer');
    expect(movementType('a', 'a')).toBe('Process Transfer');
    expect(movementType('a', null)).toBe('Final');
  });
});

const main = newApp();
const app = express();
app.use(express.json());
app.use(`${API}/routing`, createRoutingRouter());
app.use(errorHandler);

let owner: Signed;
let A: Fixture;
let B: Fixture;
let saved: Awaited<ReturnType<typeof setApproval>>;
let av: ReturnType<typeof vclient>;

const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, unitId: string, body?: unknown) => {
  const r = request(app)[method](`${API}/routing${path}`).set(owner.bearer).set('X-Unit-Id', unitId);
  return body === undefined ? r : r.send(body as object);
};

async function applyPendingSql(): Promise<void> {
  const file = join(__dirname, '..', 'prisma', 'pending', 'phase41_routing_transfer.sql');
  let sql = readFileSync(file, 'utf8').replace(/^--.*$/gm, '');
  const doBlock = /DO \$\$[\s\S]*?END \$\$;/.exec(sql)?.[0];
  if (doBlock) sql = sql.replace(doBlock, '');
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
  if (doBlock) await prisma.$executeRawUnsafe(doBlock);
}

async function gl(unitId: string, code: string): Promise<number> {
  const a = await prisma.account.findUniqueOrThrow({ where: { code } });
  const r = await prisma.glEntry.aggregate({ where: { unitId, accountId: a.id }, _sum: { debit: true, credit: true } });
  return Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0);
}

beforeAll(async () => {
  owner = await signInOwner(main);
  saved = await setApproval(false);
  invalidateAccessCache();
  await applyPendingSql();
  await applyPendingSql(); // idempotent: the second run must not fail
  A = await fixture();
  B = await fixture();
  av = vclient(main, owner, A.unitId);
});
afterAll(async () => {
  for (const r of saved) await prisma.moduleControl.update({ where: { pageId: r.pageId }, data: { approvalRequired: r.approvalRequired } });
  await prisma.$disconnect();
});

describe('route builder + live routing', () => {
  it('creates, duplicates, edits and deletes a route; a job route keeps balance = planned - good - scrap', async () => {
    const created = await call('post', '/routes', A.unitId, {
      name: 'Shaft route',
      itemOrFamily: 'Shafts',
      steps: [
        { unitId: A.unitId, processName: 'Turning', stdHours: 1.5, qcRequired: true },
        { unitId: B.unitId, processName: 'Grinding', approvalRequired: true },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const route = dataOf<{ id: string; code: string; steps: { movementType: string; processName: string; stdHours: string }[] }>(created);
    expect(route.steps.map((s) => s.movementType)).toEqual(['Plant Transfer', 'Final']);
    expect(route.steps[0]!.stdHours).toBe('1.50');

    const dup = await call('post', `/routes/${route.id}/duplicate`, A.unitId);
    expect(dup.status).toBe(201);
    expect(dataOf<{ name: string }>(dup).name).toBe('Shaft route (copy)');

    const bad = await call('put', `/routes/${route.id}`, A.unitId, { name: 'x', steps: [{ unitId: A.unitId, processName: 'Turning', workCentreId: '00000000-0000-4000-8000-000000000001' }] });
    expect(bad.status).toBe(422);

    // a production order on this route: planned 500
    const fin = await mkItem({ itemType: 'Finished Good' });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { status: 'OPEN' } });
    const [bom] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO mfg_boms (unit_id, fy_id, item_id, status) VALUES ($1::uuid, $2::uuid, $3::uuid, 'RELEASED') RETURNING id::text AS id`,
      A.unitId, fy.id, fin.id,
    );
    const [ord] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO mfg_orders (unit_id, fy_id, number, status, item_id, bom_id, qty, due_date, warehouse_id, rm_warehouse_id)
       VALUES ($1::uuid, $2::uuid, $3, 'Released', $4::uuid, $5::uuid, 500, current_date, $6::uuid, $6::uuid) RETURNING id::text AS id`,
      A.unitId, fy.id, `MO-T-${Date.now()}`, fin.id, bom!.id, A.warehouseId,
    );
    const assigned = await call('post', '/job-routes', A.unitId, { orderId: ord!.id, routeId: route.id });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    const jr = dataOf<{ id: string }>(assigned).id;

    const over = await call('post', `/job-routes/${jr}/record`, A.unitId, { good: 495, scrap: 10 });
    expect(over.status).toBe(422);
    const rec = await call('post', `/job-routes/${jr}/record`, A.unitId, { good: 470, scrap: 10 });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(dataOf<{ balance: string }>(rec).balance).toBe('20');

    const live = dataOf<{ planned: string; good: string; balance: string; yield: string }[]>(await call('get', '/live', A.unitId));
    const mine = live.find((r) => r.planned === '500.000');
    expect(mine).toMatchObject({ good: '470.000', balance: '20.000', yield: '94.0' });

    // the route is in use now: delete only switches it off
    const del = await call('delete', `/routes/${route.id}`, A.unitId);
    expect(dataOf<{ deactivated: boolean }>(del).deactivated).toBe(true);
  });

  it('Reset Sketch Template builds the sketch route on our plants', async () => {
    const res = await call('post', '/routes/reset-sketch', A.unitId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dataOf<{ code: string; steps: unknown[] }>(res)).toMatchObject({ code: 'ROUTE-SKETCH' });
    expect(dataOf<{ steps: unknown[] }>(res).steps).toHaveLength(6);
  });
});

describe('material transfer note (StockService)', () => {
  it('100 shafts A -> B, 96 received "4 damaged in transit": B +96, in transit 4, a dispute; reconcile returns the 4', async () => {
    const shaft = await mkItem();
    const rec = await av.post('transactions', { warehouseId: A.warehouseId, txType: 'Receipt', lines: [{ itemId: shaft.id, qty: 100, unitCost: 50 }] });
    expect(rec.status).toBe('Posted');

    const made = await call('post', '/transfers', A.unitId, {
      toUnitId: B.unitId, quantity: 100, itemId: shaft.id, fromWarehouseId: A.warehouseId, toWarehouseId: B.warehouseId, dispatch: true, vehiclePerson: 'Driver 1',
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const note = dataOf<{ id: string; noteNo: string }>(made);
    const transit = await prisma.warehouse.findFirstOrThrow({ where: { unitId: A.unitId, isTransit: true } });
    expect(await balance(shaft.id, A.warehouseId)).toMatchObject({ onHand: 0 });
    expect(await balance(shaft.id, transit.id)).toMatchObject({ onHand: 100, value: 5000 });

    // the sending plant cannot receive its own note
    const wrong = await call('post', `/transfers/${note.id}/receive`, A.unitId, { receivedQty: 96, shortReason: '4 damaged in transit' });
    expect(wrong.status).toBe(403);
    // a short receipt needs a reason
    const noReason = await call('post', `/transfers/${note.id}/receive`, B.unitId, { receivedQty: 96 });
    expect(noReason.status).toBe(422);

    const got = await call('post', `/transfers/${note.id}/receive`, B.unitId, { receivedQty: 96, shortReason: '4 damaged in transit' });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(dataOf<{ receiptStatus: string; shortQty: string; receivedQty: string }>(got)).toMatchObject({ receiptStatus: 'SHORT', shortQty: '4.000', receivedQty: '96.000' });
    expect(await balance(shaft.id, B.warehouseId)).toMatchObject({ onHand: 96, value: 4800 });
    expect(await balance(shaft.id, transit.id)).toMatchObject({ onHand: 4, value: 200 });
    expect(await gl(A.unitId, '1309')).toBe(200);

    const disputes = dataOf<{ disputeNo: string; qty: string; status: string; reason: string }[]>(await call('get', '/transfers/disputes', B.unitId));
    const d = disputes.find((x) => x.disputeNo === `Short receipt 4 - ${note.noteNo}`);
    expect(d, JSON.stringify(disputes)).toMatchObject({ qty: '4.000', status: 'OPEN', reason: '4 damaged in transit' });

    const again = await call('post', `/transfers/${note.id}/receive`, B.unitId, { receivedQty: 100 });
    expect(again.status).toBe(409);

    const rc = await call('post', `/transfers/${note.id}/reconcile`, B.unitId, {});
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    expect(await balance(shaft.id, transit.id)).toMatchObject({ onHand: 0, value: 0 });
    expect(await balance(shaft.id, A.warehouseId)).toMatchObject({ onHand: 4, value: 200 });
    expect(await gl(A.unitId, '1309')).toBe(0);
    const closed = dataOf<{ status: string }[]>(await call('get', '/transfers/disputes', B.unitId)).find((x) => (x as unknown as { noteId: string }).noteId === note.id);
    expect(closed?.status).toBe('RETURNED');
  });

  it('a full receipt moves everything and opens no dispute; sending more than on hand is refused', async () => {
    const it = await mkItem();
    await av.post('transactions', { warehouseId: A.warehouseId, txType: 'Receipt', lines: [{ itemId: it.id, qty: 10, unitCost: 5 }] });
    const over = await call('post', '/transfers', A.unitId, { toUnitId: B.unitId, quantity: 11, itemId: it.id, fromWarehouseId: A.warehouseId, toWarehouseId: B.warehouseId, dispatch: true });
    expect(over.status).toBe(409);
    const ok = await call('post', '/transfers', A.unitId, { toUnitId: B.unitId, quantity: 10, itemId: it.id, fromWarehouseId: A.warehouseId, toWarehouseId: B.warehouseId, dispatch: true });
    const id = dataOf<{ id: string }>(ok).id;
    const got = await call('post', `/transfers/${id}/receive`, B.unitId, {});
    expect(dataOf<{ receiptStatus: string; stockState: string }>(got)).toMatchObject({ receiptStatus: 'RECEIVED', stockState: 'RECEIVED' });
    expect(await balance(it.id, B.warehouseId)).toMatchObject({ onHand: 10 });
    const nothing = await call('post', `/transfers/${id}/reconcile`, B.unitId, {});
    expect(nothing.status).toBe(409);
  });
});

describe('BOM & material approval', () => {
  it('required 82.000 kg copper, available 60.000 -> Raise PR makes a Draft PR line of 22.000; release is refused until stock covers it', async () => {
    const copper = await mkItem({ baseUom: 'Kg' });
    const fin = await mkItem({ itemType: 'Finished Good' });
    await av.post('transactions', { warehouseId: A.warehouseId, txType: 'Receipt', lines: [{ itemId: copper.id, qty: 60, unitCost: 700 }] });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { status: 'OPEN' } });
    const [bom] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO mfg_boms (unit_id, fy_id, item_id, status, base_qty) VALUES ($1::uuid, $2::uuid, $3::uuid, 'RELEASED', 1) RETURNING id::text AS id`,
      A.unitId, fy.id, fin.id,
    );
    await prisma.$executeRawUnsafe(`INSERT INTO mfg_bom_lines (bom_id, line_no, item_id, qty_per) VALUES ($1::uuid, 1, $2::uuid, 82)`, bom!.id, copper.id);

    const made = await call('post', '/bom-flows', A.unitId, { bomId: bom!.id, qty: 1 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const flow = dataOf<{ id: string; lines: { requiredQty: string; availableQty: string; shortageQty: string }[] }>(made);
    expect(flow.lines[0]).toMatchObject({ requiredQty: '82.000', availableQty: '60.000', shortageQty: '22.000' });

    const early = await call('post', `/bom-flows/${flow.id}/release`, A.unitId);
    expect(early.status).toBe(409);
    expect(dataOf<unknown>(await call('post', `/bom-flows/${flow.id}/sales-decision`, A.unitId, { approve: true }))).toBeTruthy();
    const short = await call('post', `/bom-flows/${flow.id}/release`, A.unitId);
    expect(short.status).toBe(409);
    expect(JSON.stringify(short.body)).toContain('22.000');

    const pr = await call('post', `/bom-flows/${flow.id}/raise-pr`, A.unitId);
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    const prRow = dataOf<{ prId: string; purchaseStatus: string }>(pr);
    expect(prRow.purchaseStatus).toBe('PR_DRAFT');
    const lines = await prisma.$queryRawUnsafe<{ qty: string; status: string }[]>(
      `SELECT l.qty::text AS qty, p.status FROM purchase_requisition_lines l JOIN purchase_requisitions p ON p.id = l.pr_id WHERE p.id = $1::uuid`, prRow.prId,
    );
    expect(lines).toEqual([{ qty: '22.000', status: 'Draft' }]);
    expect((await call('post', `/bom-flows/${flow.id}/raise-pr`, A.unitId)).status).toBe(409);

    // stock arrives -> verify, then release works and the trace shows the chain
    await av.post('transactions', { warehouseId: A.warehouseId, txType: 'Receipt', lines: [{ itemId: copper.id, qty: 22, unitCost: 700 }] });
    const rel = await call('post', `/bom-flows/${flow.id}/release`, A.unitId);
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    expect(dataOf<{ manufacturingRelease: boolean; status: string }>(rel)).toMatchObject({ manufacturingRelease: true, status: 'RELEASED' });
    const trace = dataOf<{ events: { action: string }[] }>(await call('get', `/bom-flows/${flow.id}/trace`, A.unitId));
    expect(trace.events.map((e) => e.action)).toEqual(expect.arrayContaining(['bomflow.create', 'bomflow.sales_approve', 'bomflow.raise_pr', 'bomflow.release']));
  });
});
