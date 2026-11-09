// Why: browser smoke test of the Phase 12 quality screens (docs/phases/PHASE-12.md and PHASE-12-REPORT.md): each page opens
// for the owner through the real Vite -> API -> PostgreSQL chain. The numbers and rules (readings judged against limits, usage
// decision moving stock, PPM, quality cost, calibration reminders) are proved by apps/api/tests/phase12-qms.test.ts.
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
  ['qms-plans', /Inspection plans and forms/],
  ['qms-incoming', /Incoming Quality/],
  ['qms-process', /In-Process Quality/],
  ['qms-final', /Final Quality/],
  ['qms-supplier', /Supplier Quality/],
  ['qms-inspections', /Quality Inspections/],
  ['qms-ncr', /Rejections, alerts and quality monitors/],
  ['qms-capa', /CAPA, 8D and improvement/],
  ['qms-calibration', /Instruments and calibration/],
];

test('the owner opens the Phase 12 quality pages', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  for (const [id, title] of PAGES) {
    await page.goto(`/m/${id}`);
    await expect(page.getByRole('heading', { name: title }).first(), id).toBeVisible();
  }
});
