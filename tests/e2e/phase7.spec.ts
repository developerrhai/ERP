// Why: end-to-end proof of the Phase 7 finance stories as a normal user clicks them (docs/phases/PHASE-07.md):
// see the chart of accounts, add an account, write a journal, post it (it gets a number), see the trial balance
// balance, reverse it, and see that an unbalanced journal is refused in plain English. Runs after the earlier
// specs on the same e2e database (the owner already has the "next" password).
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

const today = new Date().toISOString().slice(0, 10);

test('the chart of accounts shows the seeded accounts and a new account can be added', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/fin-coa');
  await expect(page.getByRole('heading', { name: 'Chart of Accounts' })).toBeVisible();
  await expect(page.getByText('HDFC Bank Current A/c').first()).toBeVisible();
  await page.getByRole('button', { name: /Add Account/ }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Account code *').fill('7777');
  await d.getByLabel('Account name *').fill('E2E Prepaid Insurance');
  await d.getByLabel('Belongs to group *').selectOption({ label: '1500 · Loans and Advances' });
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/finance/accounts') && r.request().method() === 'POST' && r.ok()),
    d.getByRole('button', { name: 'Save' }).click(),
  ]);
  await expect(page.getByText('Account 7777 created.')).toBeVisible();
  await expect(page.getByText('E2E Prepaid Insurance')).toBeVisible();
});

test('a duplicate account code is refused in plain English', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/fin-coa');
  await page.getByRole('button', { name: /Add Account/ }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Account code *').fill('7777');
  await d.getByLabel('Account name *').fill('Same code again');
  await d.getByLabel('Belongs to group *').selectOption({ label: '1500 · Loans and Advances' });
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d.getByRole('alert')).toContainText('already exists');
});

test('write a journal, post it, see it in the trial balance, then reverse it', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/fin-journal');
  await expect(page.getByRole('heading', { name: 'Journal Entries' })).toBeVisible();
  await page.getByRole('button', { name: /New Journal/ }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Narration').fill('E2E capital introduced');
  await d.getByLabel('Line 1 account').selectOption({ label: '1111 · HDFC Bank Current A/c' });
  await d.getByLabel('Line 1 debit').fill('250000');
  await d.getByLabel('Line 2 account').selectOption({ label: '3001 · Equity Share Capital' });
  await d.getByLabel('Line 2 credit').fill('249999');
  // the form tells the user the difference as they type, and the server refuses an unbalanced submit
  await expect(d.getByRole('status')).toContainText('Difference ₹ 1.00');
  await d.getByLabel('Line 2 credit').fill('250000');
  await expect(d.getByRole('status')).toContainText('Balanced');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/finance/journals') && r.request().method() === 'POST' && r.status() === 201),
    d.getByRole('button', { name: 'Save Draft' }).click(),
  ]);
  await expect(page.getByText(/Journal saved as DRAFT-/)).toBeVisible();
  await page.getByRole('button', { name: /^Open DRAFT-/ }).first().click();
  const v = page.getByRole('dialog');
  await Promise.all([
    page.waitForResponse((r) => /\/submit$/.test(r.url()) && r.ok()),
    v.getByRole('button', { name: 'Submit' }).click(),
  ]);
  await expect(page.getByText('Checked. Ready to post.')).toBeVisible();
  await page.getByRole('button', { name: /^Open DRAFT-/ }).first().click();
  await Promise.all([
    page.waitForResponse((r) => /\/post$/.test(r.url()) && r.ok()),
    page.getByRole('dialog').getByRole('button', { name: 'Post' }).click(),
  ]);
  await expect(page.getByText(/Posted as JV\/TAL\//)).toBeVisible();
  await expect(page.getByText('E2E capital introduced')).toBeVisible();

  // the trial balance balances and shows the bank line in Indian format
  await page.goto('/m/fin-trial');
  await expect(page.getByText(/Balanced: ₹ /)).toBeVisible();
  await expect(page.getByText('2,50,000.00').first()).toBeVisible();

  // reverse it from the register
  await page.goto('/m/fin-journal');
  await page.getByRole('button', { name: /^Open JV\/TAL\// }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reverse' }).click();
  const r = page.getByRole('dialog');
  await r.getByLabel('Reason *').fill('E2E: entered by mistake');
  await Promise.all([
    page.waitForResponse((res) => /\/reverse$/.test(res.url()) && res.ok()),
    r.getByRole('button', { name: 'Reverse' }).click(),
  ]);
  await expect(page.getByText(/Reversed with JV\/TAL\//)).toBeVisible();
  await expect(page.locator('.status', { hasText: 'Reversed' }).first()).toBeVisible();
});

test('the finance API needs a signed-in user (401 without a token)', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  const res = await page.evaluate(async (day) => {
    const t = await (await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } })).json();
    const token = (t as { data: { accessToken: string } }).data.accessToken;
    const r = await fetch(`/api/v1/finance/reports/trial-balance?asOf=${day}`, { headers: { Authorization: `Bearer ${token}` } });
    const anon = await fetch(`/api/v1/finance/reports/trial-balance?asOf=${day}`);
    return { signedIn: r.status, anonymous: anon.status };
  }, today);
  expect(res.signedIn).toBe(200);
  expect(res.anonymous).toBe(401);
});

test('an employee raises an expense claim; it is saved as a Draft with its own number and the limits are visible', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/fin-expenses');
  await expect(page.getByRole('heading', { name: 'Expense Management' })).toBeVisible();
  await page.getByRole('button', { name: /New Claim/ }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Category *').selectOption('Travel');
  await expect(d.getByText(/Travel: up to ₹ 5,000.00 per claim/)).toBeVisible();
  await d.getByLabel('Amount *').fill('1200');
  await d.getByLabel('What was it for? *').fill('E2E taxi to the client');
  await d.getByLabel('Cost centre').selectOption({ label: 'TAL-PROD · Production' });
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/finance/expenses') && r.request().method() === 'POST' && r.status() === 201),
    d.getByRole('button', { name: 'Save Draft' }).click(),
  ]);
  await expect(page.getByText(/Claim saved as Draft/)).toBeVisible();
  await expect(page.getByText(/EXP\/TAL\//).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Limits' }).click();
  await expect(page.getByText('₹ 25,000.00')).toBeVisible();
});

test('a credit note for a customer is refused until the form is complete, and the empty list says what to do', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/fin-creditnote');
  await expect(page.getByRole('heading', { name: 'Credit Notes' })).toBeVisible();
  await expect(page.getByText(/No notes yet/)).toBeVisible();
  await page.getByRole('button', { name: /New Credit Note/ }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Save Draft' }).click();
  await expect(d.getByText('Choose the customer.')).toBeVisible();
  await expect(d.getByText('Enter an amount greater than 0.')).toBeVisible();
});

test('cash flow, period close and the tax registers open and explain themselves', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/fin-cashflow');
  await expect(page.getByRole('heading', { name: 'Cash Flow' })).toBeVisible();
  await expect(page.getByText('Operating activities')).toBeVisible();
  await page.goto('/m/admin-fy/close');
  await expect(page.getByRole('heading', { name: 'Period Close & Year-End' })).toBeVisible();
  await expect(page.getByText('April 2026').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Close the year/ })).toBeVisible();
  await page.goto('/m/tax-salesreg');
  await expect(page.getByRole('heading', { name: 'Sales Register' })).toBeVisible();
  await expect(page.getByText(/No documents in this period yet/)).toBeVisible();
  await page.goto('/m/tax-tds');
  await expect(page.getByRole('heading', { name: 'TDS' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Record challan/ })).toBeDisabled();
});

test('recurring journals and exchange rates open from the journal screen', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/fin-journal');
  await page.getByRole('button', { name: 'Exchange rates' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Rate (INR)').fill('84.25');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/finance/fx-rates') && r.request().method() === 'PUT' && r.ok()),
    d.getByRole('button', { name: 'Save rate' }).click(),
  ]);
  await expect(d.getByText('84.2500')).toBeVisible();
  await d.getByRole('button', { name: 'Close' }).first().click();
  await page.getByRole('button', { name: 'Recurring' }).click();
  await expect(page.getByRole('dialog').getByText(/No templates yet/)).toBeVisible();
});
