// Why: browser smoke test of the Phase 11 tax screens (docs/phases/PHASE-11.md and PHASE-11-REPORT.md): each page opens
// for the owner through the real Vite -> API -> PostgreSQL chain. The numbers (GSTR-1 and GSTR-3B figures, settlement
// journal, filing lock, 2B matching, IRN and e-way bill recording, TDS return) are proved by the API test
// apps/api/tests/phase11-tax.test.ts. Runs after the earlier specs on the same e2e database.
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
  ['tax-gstr1', /GSTR-1/],
  ['tax-gstr3b', /GSTR-3B/],
  ['tax-einvoice', /E-Invoice/],
  ['tax-eway', /E-Way Bill/],
  ['tax-tds', /TDS/],
  ['tax-salesreg', /Sales Register/],
];

test('the owner opens the Phase 11 tax pages', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  for (const [id, title] of PAGES) {
    await page.goto(`/m/${id}`);
    await expect(page.getByRole('heading', { name: title }).first(), id).toBeVisible();
  }
});
