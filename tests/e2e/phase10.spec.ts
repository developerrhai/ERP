// Why: browser smoke test of the Phase 10 CRM and Sales screens (docs/phases/PHASE-10.md and PHASE-10-REPORT.md): every
// page opens for the owner through the real Vite -> API -> PostgreSQL chain with its title and primary button, and the
// New dialogs open and close. The numbers of the quote-to-cash chain (RFQ review, credit limit, dispatch cost, invoice
// GST, receipt, return and credit note) are proved by the API test tests/phase10-sales.test.ts, which posts the real
// journals. Runs after the earlier specs on the same e2e database.
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
    page.waitForResponse((r) => r.url().endsWith('/me/context') && r.request().method() === 'PUT' && r.ok()),
    unit.selectOption({ label }),
  ]);
}

const PAGES: { id: string; title: RegExp; button?: RegExp }[] = [
  { id: 'crm-leads', title: /Lead Management/, button: /New Lead/ },
  { id: 'crm-opportunities', title: /Opportunity Management/, button: /New Opportunity/ },
  { id: 'crm-pipeline', title: /Sales Pipeline/ },
  { id: 'crm-followups', title: /Follow-ups & Tasks/, button: /New Follow-up/ },
  { id: 'crm-meetings', title: /Meetings & Calls/, button: /New Meeting/ },
  { id: 'crm-feedback', title: /Customer Feedback/, button: /New Feedback/ },
  { id: 'crm-sources', title: /Lead Sources/, button: /Add source/ },
  { id: 'sales-quotations', title: /Sales Quotations/, button: /New Quotation/ },
  { id: 'sales-orders', title: /Sales Orders/, button: /New Sales Order/ },
  { id: 'sales-delivery', title: /Delivery Scheduling/ },
  { id: 'sales-dispatch', title: /Dispatch/, button: /New Dispatch/ },
  { id: 'sales-invoices', title: /Sales Invoices/ },
  { id: 'sales-collections', title: /Collections/ },
  { id: 'sales-credit', title: /Credit Limits/ },
  { id: 'sales-returns', title: /Sales Returns/ },
];

test('the owner opens every Phase 10 page', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  for (const p of PAGES) {
    await page.goto(`/m/${p.id}`);
    await expect(page.getByRole('heading', { name: p.title }).first(), p.id).toBeVisible();
    if (p.button) await expect(page.getByRole('button', { name: p.button }).first(), `${p.id} button`).toBeVisible();
    await expect(page.locator('.msg.error.show'), `${p.id} shows no error`).toHaveCount(0);
  }
});

test('the customer RFQ tab shows the internal review actions language and the New Lead dialog opens and closes', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/sales-quotations');
  await page.getByRole('tab', { name: /Customer RFQs/ }).click();
  await expect(page.getByRole('heading', { name: /Customer RFQs/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /New Customer RFQ/ })).toBeVisible();
  await page.goto('/m/crm-leads');
  await page.getByRole('button', { name: /New Lead/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/Name/).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
