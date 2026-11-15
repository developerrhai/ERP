/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- API test bodies are loose JSON */
// Page-by-page V40 build, Finance & Accounts and Indian Taxation families: every V40 tab of every page answers with the
// columns V40 shows (main table + side panel) and the SQL behind each view runs against the real schema.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, newApp, prisma, signInOwner, unitIds } from './helpers';
import type { Signed } from './helpers';
import { FINANCE_V40_PAGES } from '../src/modules/finance/v40-views';
import { TAX_V40_PAGES } from '../src/modules/tax/v40-views';

const app = newApp();
let owner: Signed;
let unit: string;
const tabsMap = JSON.parse(
  readFileSync(resolve(__dirname, '../../web/src/pages/frame/tabs-map.json'), 'utf8'),
) as Record<string, string[]>;
const auditDir = resolve(__dirname, '../../../docs/ui-audit/pages');

beforeAll(async () => {
  owner = await signInOwner(app);
  unit = (await unitIds())[0] as string;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const get = (base: 'finance' | 'tax', page: string, tab: string, first: boolean, withUnit = true) => {
  let r = request(app)
    .get(`${API}/${base}/v40/${page}?tab=${encodeURIComponent(tab)}&first=${first ? 1 : 0}&size=50`)
    .set(owner.bearer);
  if (withUnit) r = r.set('X-Unit-Id', unit);
  return r;
};
/** V40 labels that are page chrome of the audit capture, not columns of the data tables */
const SKIP = new Set(['Docs']);

const ALL: [string, 'finance' | 'tax', string][] = [
  ...Object.keys(FINANCE_V40_PAGES).map((p) => [p, 'finance', p] as [string, 'finance' | 'tax', string]),
  ...Object.keys(TAX_V40_PAGES).map((p) => [p, 'tax', p] as [string, 'finance' | 'tax', string]),
];

describe('V40 tab views: finance and tax', () => {
  it('answers 404 for a page it does not know', async () => {
    const res = await get('finance', 'fin-nothing', 'x', false);
    expect(res.status).toBe(404);
  });

  for (const [page, base] of ALL) {
    it(`${page}: every tab runs and shows the V40 columns`, async () => {
      const tabs = tabsMap[page] ?? [];
      expect(tabs.length).toBeGreaterThan(0);
      const audit = resolve(auditDir, page, 'data.json');
      const v40 = existsSync(audit)
        ? (JSON.parse(readFileSync(audit, 'utf8')) as { tabs: Record<string, { v40: { columns: string[] } }> }).tabs
        : {};
      const missing: string[] = [];
      for (const [i, tab] of tabs.entries()) {
        const res = await get(base, page, tab, i === 0);
        expect(res.status, `${page} / ${tab}: ${JSON.stringify(res.body).slice(0, 400)}`).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        const have = new Set<string>([
          ...res.body.meta.columns.map((c: any) => c.label),
          ...(res.body.meta.panel?.columns ?? []).map((c: any) => c.label),
        ]);
        for (const label of v40[tab]?.v40.columns ?? [])
          if (!SKIP.has(label) && !have.has(label)) missing.push(`${tab}: ${label}`);
      }
      expect(missing, `columns V40 shows that this tab lacks: ${missing.join('; ')}`).toEqual([]);
    });
  }

  it('Analytics shows the record count and the status distribution', async () => {
    const res = await get('finance', 'fin-ap', 'Analytics & Graphs', false);
    expect(res.status).toBe(200);
    expect(res.body.meta.cards.some((c: any) => c.label === 'Records')).toBe(true);
    expect(Array.isArray(res.body.meta.distribution)).toBe(true);
  });

  it('answers without a unit chosen (all plants) for the owner', async () => {
    const res = await get('finance', 'fin-trial', 'Trial Balance', true, false);
    expect(res.status).toBe(200);
  });
});
