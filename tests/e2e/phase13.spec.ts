// Why: browser smoke test of the Phase 13 manufacturing screens (docs/phases/PHASE-13.md and PHASE-13-REPORT.md): each page opens
// for the owner through the real Vite -> API -> PostgreSQL chain. The rules and the numbers (BOM scrap, material issue and its
// stock value, operation quantities, the inspection checkpoint, FG receipt after the Usage Decision, MRP netting, job-work
// balances) are proved by apps/api/tests/phase13-mfg.test.ts. Runs after the earlier specs on the same e2e database.
import { test, expect, type Page } from '@playwright/test';
import { E2E } from './e2e-env.mjs';

const OWNER_PW = E2E.owner.newPassword;
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, id: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email / User ID').fill(id);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
    page.getByRole('button', { name: 'Sign In to ERP' }).click(),
  ]);
}

async function selectUnit(page: Page, label: string) {
  const unit = page.getByLabel('Unit', { exact: true });
  await expect(unit.locator('option', { hasText: label })).toHaveCount(1);
  if ((await unit.locator('option:checked').innerText()).trim() === label) return;
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/me/context') && r.request().method() === 'PUT' && r.ok(),
    ),
    unit.selectOption({ label }),
  ]);
}

const PAGES: [string, RegExp][] = [
  ['mfg-workcenters', /Work Centers/],
  ['mfg-bom', /Bill of Materials/],
  ['mfg-routing', /Routing/],
  ['mfg-plan', /Production Planning/],
  ['mfg-orders', /Production Orders/],
  ['mfg-mrp', /Material Requirement Planning/],
  ['mfg-workorders', /Work Orders/],
  ['mfg-shopfloor', /Shop Floor Dashboard/],
  ['mfg-wip', /WIP Tracking/],
  ['mfg-fg', /Finished Goods Receipt/],
  ['mfg-scrap', /Scrap Management/],
  ['mfg-rework', /Rework Management/],
  ['mfg-costing', /Production Costing/],
];

test('the owner opens the Phase 13 manufacturing pages', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  for (const [id, title] of PAGES) {
    await page.goto(`/m/${id}`);
    await expect(page.getByRole('heading', { name: title }).first(), id).toBeVisible();
  }
});
