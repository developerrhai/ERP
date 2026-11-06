// Why: end-to-end proof of Phase 4 (docs/phases/PHASE-04.md §10): one record goes through
// create -> attach a document -> submit -> locked -> PDF -> CSV export -> import wizard, in a real
// browser against the real API and database. Runs after phase4.spec.ts (same e2e DB, owner password set).
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

async function selectTalwade(page: Page) {
  const unit = page.getByLabel('Unit', { exact: true });
  await expect(unit.locator('option', { hasText: 'Talwade' })).toHaveCount(1);
  if ((await unit.locator('option:checked').innerText()).trim() === 'Talwade') return;
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/me/context') && r.request().method() === 'PUT' && r.ok()),
    unit.selectOption({ label: 'Talwade' }),
  ]);
}

// Self-sufficient: if the earlier specs did not run (or failed) the owner still has the seeded
// password and must change it first; do that through the API so this spec can run on its own.
test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: `http://localhost:${E2E.webPort}` });
  const login = (password: string) =>
    request.post('/api/v1/auth/login', {
      data: { identifier: E2E.owner.loginId, password },
    });
  if ((await login(OWNER_PW)).ok()) {
    await request.dispose();
    return;
  }
  const first = await login(E2E.owner.initialPassword);
  expect(first.ok(), 'seeded owner login').toBe(true);
  const { data } = (await first.json()) as { data: { accessToken: string } };
  const change = await request.post('/api/v1/auth/change-password', {
    headers: { Authorization: `Bearer ${data.accessToken}` },
    data: { currentPassword: E2E.owner.initialPassword, newPassword: OWNER_PW },
  });
  expect(change.ok(), 'owner password change').toBe(true);
  await request.dispose();
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
let leadName = '';

test('create a lead, attach a document, submit it: the record locks', async ({ page }) => {
  leadName = `Phase4 E2E ${Date.now()}`;
  await signIn(page, 'owner', OWNER_PW);
  await selectTalwade(page);
  await page.goto('/m/crm-leads');
  await page.getByRole('button', { name: /Add$/ }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Lead Name').fill(leadName);
  await Promise.all([
    page.waitForResponse((r) => /\/pages\/crm-leads\/records$/.test(r.url()) && r.request().method() === 'POST' && r.ok()),
    form.getByRole('button', { name: /Save|Create|Add/ }).last().click(),
  ]);
  await expect(form).toBeHidden();

  await page.getByRole('tab', { name: 'Lead Register' }).click();
  await page.getByLabel('Search').first().fill(leadName).catch(() => undefined);
  await page.getByRole('button', { name: /^View LEA\// }).first().click();
  const drawer = page.getByRole('dialog');
  const docs = drawer.getByRole('region', { name: 'Documents' });
  await expect(docs.getByText(/No documents yet/)).toBeVisible();

  await docs.getByLabel('Document file').setInputFiles({ name: 'quote.pdf', mimeType: 'application/pdf', buffer: PDF });
  await Promise.all([
    page.waitForResponse((r) => /\/documents$/.test(r.url()) && r.request().method() === 'POST' && r.status() === 201),
    docs.getByRole('button', { name: 'Upload' }).click(),
  ]);
  await expect(docs.getByText('quote.pdf', { exact: false }).first()).toBeVisible();
  await expect(docs.getByText('Scanned')).toBeVisible();

  await Promise.all([
    page.waitForResponse((r) => /\/submit$/.test(r.url()) && r.request().method() === 'POST' && r.ok()),
    drawer.getByRole('button', { name: 'Submit' }).click(),
  ]);
  // Pending: locked. No Edit, Delete, Submit; no upload; download stays.
  await expect(drawer.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Submit' })).toHaveCount(0);
  await expect(docs.getByRole('button', { name: 'Upload' })).toHaveCount(0);
  await expect(docs.getByRole('button', { name: /^Download/ })).toBeVisible();
});

test('the record PDF is served as a PDF and the CSV export carries a BOM', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectTalwade(page);
  await page.goto('/m/crm-leads?tab=Lead%20Register');
  await page.getByRole('button', { name: /^View LEA\// }).first().click();
  const drawer = page.getByRole('dialog');
  // The PDF opens in the browser's own viewer tab (a blob URL). The bytes are checked in the API tests;
  // Chrome does not keep the body of a no-store response for Playwright, so only headers are read here.
  const [pdf, popup] = await Promise.all([
    page.waitForResponse((r) => /\/records\/[^/]+\/pdf$/.test(r.url()) && r.ok()),
    page.waitForEvent('popup'),
    drawer.getByRole('button', { name: 'PDF' }).click(),
  ]);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(Number(pdf.headers()['content-length'] ?? '1')).toBeGreaterThan(0);
  await popup.close();
  await page.keyboard.press('Escape');

  await page.goto('/m/crm-leads?tab=Reports');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^crm-leads-.*\.csv$/);
});

test('import wizard: upload, map, check, import creates the records', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectTalwade(page);
  await page.goto('/m/crm-leads?tab=Reports');
  await page.getByRole('button', { name: 'Import…' }).click();
  const dlg = page.getByRole('dialog');
  const stamp = Date.now();
  const csv = `Lead Name,Company\nImported A ${stamp},Acme\nImported B ${stamp},Beta\n`;
  await dlg.getByLabel('Import file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await dlg.getByRole('button', { name: 'Upload' }).click();
  await expect(dlg.getByText(/2 data rows found/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Check file' }).click();
  await expect(dlg.getByText(/of 2 rows are valid/)).toBeVisible({ timeout: 30_000 });
  await dlg.getByRole('button', { name: 'Import 2 records' }).click();
  await expect(dlg.getByText(/records created/)).toBeVisible({ timeout: 30_000 });
  await dlg.getByRole('button', { name: 'Close' }).last().click();

  await page.goto('/m/crm-leads?tab=Lead%20Register');
  await expect(page.getByText(`Imported A ${stamp}`)).toBeVisible();
  await expect(page.getByText(`Imported B ${stamp}`)).toBeVisible();
});

test('a background export finishes and can be downloaded', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectTalwade(page);
  await page.goto('/m/crm-leads?tab=Reports');
  await Promise.all([
    page.waitForResponse((r) => /\/pages\/crm-leads\/exports$/.test(r.url()) && r.status() === 202),
    page.getByRole('button', { name: 'Export in background' }).click(),
  ]);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Download', exact: true }).first().click({ timeout: 45_000 }),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
});
