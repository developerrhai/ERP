/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Phase 9 test helpers: approval switched off for the procurement pages, a unit with a Maharashtra state code,
// an approved supplier / item, and "PO -> GRN" shortcuts.
import { expect } from 'vitest';
import type { Express } from 'express';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { prisma } from './helpers';
import { dataOf } from './phase4-helpers';
import { fixture, mkItem, tag, vclient } from './phase08-helpers';
import type { Fixture } from './phase08-helpers';
import type { Signed } from './helpers';

export const P9_PAGES = [
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
export type Body = Record<string, any>;
export const body = (res: { body: unknown }): Body => dataOf<Body>(res as never);
export const ifm = (version: number | string) => ({ 'If-Match': `"${version}"` });

export async function approvalOff() {
  const saved = await prisma.moduleControl.findMany({
    where: { pageId: { in: P9_PAGES } },
    select: { pageId: true, approvalRequired: true },
  });
  await prisma.moduleControl.updateMany({
    where: { pageId: { in: P9_PAGES } },
    data: { approvalRequired: false },
  });
  invalidateAccessCache();
  return async () => {
    for (const r of saved)
      await prisma.moduleControl.update({
        where: { pageId: r.pageId },
        data: { approvalRequired: r.approvalRequired },
      });
  };
}

export async function setup(app: Express, owner: Signed) {
  const fx: Fixture = await fixture();
  await prisma.unit.update({ where: { id: fx.unitId }, data: { stateCode: '27' } });
  const v = vclient(app, owner, fx.unitId);
  return { fx, v };
}

export async function mkSupplier(extra: Record<string, unknown> = {}) {
  const name = `Sup ${tag()}`;
  return prisma.supplier.create({
    data: {
      code: `S${tag()}`.slice(0, 28),
      name,
      nameKey: `${name}-${tag()}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: 'UNREGISTERED',
      approvalStatus: 'APPROVED',
      ...extra,
    },
  });
}
export { mkItem, tag };

type V = ReturnType<typeof vclient>;
export async function approve(v: V, path: string, doc: Body) {
  const r = await v.call('post', `${path}/${doc.id}/submit`, {}, ifm(doc.version));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** A released PO of one item. */
export async function mkPo(
  v: V,
  fx: Fixture,
  supplierId: string,
  itemId: string,
  qty: number,
  rate: number,
  extra: Body = {},
  line: Body = {},
) {
  const r = await v.call('post', '/scm/po', {
    supplierId,
    shipToWarehouseId: fx.warehouseId,
    ...extra,
    lines: [{ itemId, qty, uom: 'Kg', rate, gstPct: 18, ...line }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const po = body(r);
  await approve(v, '/scm/po', po);
  return body(await v.call('get', `/scm/po/${po.id}`));
}
/** A posted GRN of the whole PO line (no QC). */
export async function mkGrn(v: V, fx: Fixture, po: Body, qty: number, extra: Body = {}) {
  const r = await v.call('post', '/scm/grn', {
    poId: po.id,
    warehouseId: fx.warehouseId,
    lines: [{ poLineId: po.lines[0].id, receivedQty: qty }],
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const g = body(r);
  await approve(v, '/scm/grn', g);
  return body(await v.call('get', `/scm/grn/${g.id}`));
}
export const todayIso = () => new Date().toISOString().slice(0, 10);
export async function mkInvoice(
  v: V,
  supplierId: string,
  grn: Body,
  qty: number,
  rate: number,
  extra: Body = {},
) {
  const r = await v.call('post', '/scm/purchaseinvoice', {
    supplierId,
    vendorInvoiceNo: `INV-${tag()}`,
    invoiceDate: todayIso(),
    lines: [{ grnLineId: grn.lines[0].id, qty, rate }],
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const inv = body(r);
  await approve(v, '/scm/purchaseinvoice', inv);
  return body(await v.call('get', `/scm/purchaseinvoice/${inv.id}`));
}

export async function gl(unitId: string, code: string): Promise<number> {
  const a = await prisma.account.findUniqueOrThrow({ where: { code } });
  const r = await prisma.glEntry.aggregate({
    where: { unitId, accountId: a.id },
    _sum: { debit: true, credit: true },
  });
  return Math.round((Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0)) * 100) / 100;
}
