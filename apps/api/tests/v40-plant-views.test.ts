/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Page-by-page V40 build, plant families (Manufacturing, Quality, Maintenance): every V40 tab of every page answers with the
// columns V40 shows, and the values come from the real tables (production order -> material -> job card -> WIP).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { mkItem, setApproval, tag } from './phase08-helpers';
import { body, ifm, setup } from './phase09-helpers';
import { MFG_V40_PAGES } from '../src/modules/mfg/v40-views';

const app = newApp();
let owner: Signed;
let ctx: Awaited<ReturnType<typeof setup>>;
let restoreStock: Awaited<ReturnType<typeof setApproval>>;
const TODAY = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const FAMILIES: { base: string; pages: Record<string, unknown> }[] = [
  { base: '/mfg', pages: MFG_V40_PAGES },
];
const tabsMap = JSON.parse(
  readFileSync(resolve(__dirname, '../../web/src/pages/frame/tabs-map.json'), 'utf8'),
) as Record<string, string[]>;

beforeAll(async () => {
  owner = await signInOwner(app);
  restoreStock = await setApproval(false);
  invalidateAccessCache();
  ctx = await setup(app, owner);
});
afterAll(async () => {
  for (const r of restoreStock)
    await prisma.moduleControl.update({
      where: { pageId: r.pageId },
      data: { approvalRequired: r.approvalRequired },
    });
  await prisma.$disconnect();
});

const call = (method: 'get' | 'post', path: string, b?: unknown, h: Record<string, string> = {}) =>
  ctx.v.call(method, path, b, h);
const view = (base: string, page: string, tab: string, first = false) =>
  call('get', `${base}/v40/${page}?tab=${encodeURIComponent(tab)}&first=${first ? 1 : 0}&size=50`);
const labels = (res: any): string[] => res.body.meta.columns.map((c: any) => c.label);
const cell = (res: any, row: any, label: string): string =>
  row[res.body.meta.columns.find((c: any) => c.label === label).key];

describe('every V40 tab of every plant page answers', () => {
  it('has a tab list for each page', () => {
    for (const f of FAMILIES)
      for (const p of Object.keys(f.pages)) expect(tabsMap[p]?.length ?? 0, p).toBeGreaterThan(0);
  });
  it(
    'returns 200 with the page columns on each tab (empty or filled database)',
    { timeout: 240_000 },
    async () => {
      const bad: string[] = [];
      for (const f of FAMILIES)
        for (const p of Object.keys(f.pages)) {
          const tabs = tabsMap[p] ?? [];
          for (let i = 0; i < tabs.length; i += 1) {
            const r = await view(f.base, p, tabs[i] ?? '', i === 0);
            if (
              r.status !== 200 ||
              !Array.isArray(r.body.data) ||
              (r.body.meta?.columns?.length ?? 0) < 3
            )
              bad.push(`${p} / ${tabs[i]}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
          }
        }
      expect(bad).toEqual([]);
    },
  );
  it('refuses a page that has no V40 views', async () => {
    expect((await call('get', '/mfg/v40/sales-orders?tab=x')).status).toBe(404);
  });
});

describe('manufacturing tabs show the real chain', () => {
  it(
    'order -> material -> job card -> WIP fills the columns of each tab',
    { timeout: 120_000 },
    async () => {
      const { fx, v } = ctx;
      const fg = await mkItem({ itemType: 'Finished Good', baseUom: 'Nos' });
      const rm = await mkItem();
      await v.post('opening', {
        warehouseId: fx.warehouseId,
        lines: [{ itemId: rm.id, qty: 100, unitCost: 10 }],
      });
      const cc = await prisma.costCenter.findFirstOrThrow({ where: { unitId: fx.unitId } });
      const wc = body(
        await call('post', '/mfg/work-centers', {
          costCentreId: cc.id,
          code: `WC${tag()}`,
          name: 'Cell',
          labourRatePerHr: 60,
          overheadRatePerHr: 30,
        }),
      );
      const bom = body(
        await call('post', '/mfg/boms', {
          itemId: fg.id,
          lines: [{ itemId: rm.id, qtyPer: 1, issueMethod: 'MANUAL' }],
        }),
      );
      const sub = await call('post', `/mfg/boms/${bom.id}/submit`, {}, ifm(bom.version));
      expect(
        (await call('post', `/mfg/boms/${bom.id}/release`, {}, ifm(body(sub).version))).status,
      ).toBe(200);
      const rt = body(
        await call('post', '/mfg/routings', {
          itemId: fg.id,
          ops: [{ seq: 10, name: 'Make', workCentreId: wc.id, runMinutes: 1, qcRequired: false }],
        }),
      );
      expect(
        (await call('post', `/mfg/routings/${rt.id}/release`, {}, ifm(rt.version))).status,
      ).toBe(200);
      const o = await call('post', '/mfg/production-orders', {
        itemId: fg.id,
        qty: 10,
        dueDate: TODAY,
        warehouseId: fx.warehouse2Id,
        rmWarehouseId: fx.warehouseId,
      });
      let order = body(o);
      const rel = await call(
        'post',
        `/mfg/production-orders/${order.id}/release`,
        {},
        { ...ifm(order.version), 'Idempotency-Key': `rel-${tag()}-aaaa` },
      );
      expect(rel.status, JSON.stringify(rel.body)).toBe(200);
      order = body(await call('get', `/mfg/production-orders/${order.id}`));

      const q = encodeURIComponent(order.number);
      const find = async (page: string, tab: string, first = false) => {
        const r = await call(
          'get',
          `/mfg/v40/${page}?tab=${encodeURIComponent(tab)}&first=${first ? 1 : 0}&q=${q}&size=50`,
        );
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        return r;
      };
      const o1 = await find('mfg-orders', 'Production Orders', true);
      expect(labels(o1)).toEqual([
        'Production Order Number',
        'Production Plan',
        'Start Date',
        'Material Status',
        'Quality Status',
        'Status',
        'Sales Order',
        'Actions',
      ]);
      expect(o1.body.data).toHaveLength(1);
      expect(cell(o1, o1.body.data[0], 'Production Order Number')).toBe(order.number);
      expect(cell(o1, o1.body.data[0], 'Material Status')).toBe('Not issued');
      expect(cell(o1, o1.body.data[0], 'Status')).toBe('Released');
      const o2 = await find('mfg-orders', 'Material Status');
      expect(cell(o2, o2.body.data[0], 'Product ID')).toBe(fg.code);
      const ob = await find('mfg-orders', 'Output Balance');
      expect(ob.body.meta.panel.columns.map((c: any) => c.label)).toEqual([
        'Reference',
        'Due',
        'Amount',
        'Allocated',
        'Balance',
        'Action',
      ]);
      const mi = await find('mfg-material-issue', 'Issue Register', true);
      expect(mi.body.data).toHaveLength(1);
      expect(Number(cell(mi, mi.body.data[0], 'Required Qty'))).toBe(10);
      expect(cell(mi, mi.body.data[0], 'Material Code')).toBe(rm.code);
      expect(cell(mi, mi.body.data[0], 'Status')).toBe('Not issued');
      const wo = await find('mfg-workorders', 'Work Order Queue', true);
      expect(wo.body.data).toHaveLength(1);
      expect(Number(cell(wo, wo.body.data[0], 'Planned Qty'))).toBeGreaterThan(0);
      const wip = await find('mfg-wip', 'WIP Register', true);
      expect(wip.body.data).toHaveLength(1);
      expect(cell(wip, wip.body.data[0], 'WIP Reference')).toBe(`WIP-${order.number}`);
    },
  );
});
