// Phase 8 test helpers: fresh unit + warehouse + items, a small client for /inventory/vouchers, and the
// "get a voucher Approved" shortcut (the module controls of the voucher pages are switched to
// approval_required = false for the maker, so Submit goes straight to Approved).
import request from 'supertest';
import type { Express } from 'express';
import { expect } from 'vitest';
import { API, prisma } from './helpers';
import type { Signed } from './helpers';
import { makeUnit } from './phase3-helpers';
import { dataOf } from './phase4-helpers';

let n = 0;
export const tag = () => `${Date.now().toString(36)}${(n += 1).toString(36)}`.toUpperCase();
export const today = () => new Date().toISOString().slice(0, 10);

export const VOUCHER_PAGES = ['inv-opening', 'inv-transactions', 'inv-adjustment', 'inv-transfer'];

export interface Fixture {
  unitId: string;
  warehouseId: string;
  warehouse2Id: string;
  ownerId: string;
}

export async function ownerId(): Promise<string> {
  return (await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })).id;
}

/** A fresh unit with two warehouses (exact GL numbers per unit). */
export async function fixture(gstin: string | null = null): Promise<Fixture> {
  const unit = await makeUnit();
  if (gstin) await prisma.unit.update({ where: { id: unit.id }, data: { gstin } });
  const by = await ownerId();
  const mk = (suffix: string) =>
    prisma.warehouse.create({
      data: {
        code: `W${tag()}${suffix}`.slice(0, 28),
        name: `Store ${tag()}`,
        unitId: unit.id,
        createdById: by,
      },
    });
  const [a, b] = [await mk('A'), await mk('B')];
  await prisma.costCenter.create({
    data: { code: `S${tag()}`.slice(0, 20), name: 'Stores', unitId: unit.id },
  });
  return { unitId: unit.id, warehouseId: a.id, warehouse2Id: b.id, ownerId: by };
}

export async function mkItem(extra: Record<string, unknown> = {}) {
  const t = tag();
  const hsn = await prisma.hsnSacCode.findFirstOrThrow();
  return prisma.item.create({
    data: {
      code: `IT${t}`.slice(0, 28),
      name: `Item ${t}`,
      itemType: 'Raw Material',
      baseUom: 'Kg',
      hsnId: hsn.id,
      createdById: await ownerId(),
      ...extra,
    },
  });
}

export function vclient(app: Express, s: Signed, unitId: string) {
  const h = (extra: Record<string, string> = {}) => ({ 'X-Unit-Id': unitId, ...extra });
  const call = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    let r = request(app)[method](`${API}${path}`).set(s.bearer);
    for (const [k, v] of Object.entries(h(extra))) r = r.set(k, v);
    return body === undefined ? r : r.send(body as object);
  };
  async function create(kind: string, body: Record<string, unknown>) {
    const res = await call('post', `/inventory/vouchers/${kind}`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dataOf<{ id: string; version: number; number: string; status: string }>(res);
  }
  async function submit(kind: string, id: string, version: number) {
    const res = await call('post', `/inventory/vouchers/${kind}/${id}/submit`, undefined, {
      'If-Match': `"${version}"`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dataOf<{ id: string; version: number; status: string }>(res);
  }
  async function act(
    kind: string,
    id: string,
    verb: string,
    body: Record<string, unknown> = {},
    extra: Record<string, string> = {},
  ) {
    return call('post', `/inventory/vouchers/${kind}/${id}/${verb}`, body, extra);
  }
  /** create -> submit -> post (approval switched off for the test pages). */
  async function post(kind: string, body: Record<string, unknown>, verb = 'post') {
    const c = await create(kind, body);
    const s2 = await submit(kind, c.id, c.version);
    expect(s2.status).toBe('Approved');
    const res = await act(kind, c.id, verb);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dataOf<
      Record<string, unknown> & { id: string; version: number; number: string; status: string }
    >(res);
  }
  return { call, create, submit, act, post };
}

/** Switch approval off (or on) for the voucher pages; returns the previous values for restore. */
export async function setApproval(required: boolean) {
  const rows = await prisma.moduleControl.findMany({ where: { pageId: { in: VOUCHER_PAGES } } });
  await prisma.moduleControl.updateMany({
    where: { pageId: { in: VOUCHER_PAGES } },
    data: { approvalRequired: required },
  });
  return rows;
}

export async function balance(itemId: string, warehouseId: string) {
  const b = await prisma.stockBalance.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  });
  return {
    onHand: Number(b?.onHand ?? 0),
    value: Number(b?.value ?? 0),
    avg: Number(b?.avgRate ?? 0),
    reserved: Number(b?.reservedQty ?? 0),
  };
}
