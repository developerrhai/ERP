// Why: browser smoke test of the Phase 9 procurement screens (docs/phases/PHASE-09.md §7): every page opens for the owner
// through the real Vite -> API -> PostgreSQL chain, shows its title and primary button, and the "New" dialogs open and
// close. The money / stock / GL numbers of the whole chain (PR -> RFQ -> quotes -> comparison -> PO -> GRN -> QC ->
// put-away -> invoice -> debit note -> payment) are proved by the API tests tests/phase09-*.test.ts, which post the real
// journals and compare them with the PHASE-09 §5 tables. Runs after the earlier specs on the same e2e database.
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
  { id: 'scm-pr', title: /Purchase Requisition/, button: /New Requisition/ },
  { id: 'scm-rfq', title: /RFQ Management/, button: /New RFQ/ },
  { id: 'scm-vendorquote', title: /Vendor Quotations/, button: /New Quotation/ },
  { id: 'scm-comparison', title: /Vendor Comparison/ },
  { id: 'scm-po', title: /Purchase Orders/, button: /New Purchase Order/ },
  { id: 'scm-contracts', title: /Rate \/ Blanket Contracts/, button: /New Contract/ },
  { id: 'scm-grn', title: /Goods Receipt \/ GRN/, button: /Receive against PO/ },
  { id: 'scm-purchaseinvoice', title: /Purchase Invoice/, button: /New Purchase Invoice/ },
  { id: 'scm-evaluation', title: /Supplier Evaluation/, button: /Run evaluation/ },
  { id: 'wms-putaway', title: /Put Away/ },
  { id: 'fin-ap', title: /Accounts Payable/, button: /Proposal for invoices due till/ },
];

test('the owner opens every Phase 9 page', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  for (const p of PAGES) {
    await page.goto(`/m/${p.id}`);
    await expect(page.getByRole('heading', { name: p.title }).first(), p.id).toBeVisible();
    if (p.button) await expect(page.getByRole('button', { name: p.button }).first(), `${p.id} button`).toBeVisible();
    await expect(page.locator('.msg.error.show'), `${p.id} shows no error`).toHaveCount(0);
  }
});

test('the New Purchase Order dialog opens, asks for supplier and lines, and closes', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/scm-po');
  await page.getByRole('button', { name: /New Purchase Order/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/Supplier/).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Add line/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('Receive against PO dialog and the empty put-away list use plain language', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/scm-grn');
  await page.getByRole('button', { name: /Receive against PO/ }).click();
  await expect(page.getByRole('dialog').getByLabel(/Purchase order/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.goto('/m/wms-putaway');
  await expect(page.getByText(/No put-away tasks/)).toBeVisible();
});
