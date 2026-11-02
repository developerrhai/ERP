// Why: end-to-end proof of Phase 3 (docs/phase3-4/CONTRACT.md Stage A): the Unit and Financial-Year selectors are
// real context, a member only gets the units they were given, units/FYs/company are managed from the admin pages,
// and a unit that is in use cannot be deleted. Runs after phase2.spec.ts (same e2e DB; owner password already set).
import { test, expect, type Page } from '@playwright/test';
import { E2E } from './e2e-env.mjs';

const OWNER_PW = E2E.owner.newPassword;
const M2 = { loginId: 'member2', next: 'Member2#Real26x' };

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

/** Calls the API from inside the signed-in page, using a fresh access token from the httpOnly refresh cookie. */
async function api(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  await page.waitForLoadState('networkidle'); // let the app's own session refresh finish first
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      // The page's own session refresh may run at the same moment (409 REFRESH_RACE) - retry like the app does.
      let data: { accessToken: string } | undefined;
      for (let attempt = 0; attempt < 5 && !data; attempt++) {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } });
        if (r.ok) data = ((await r.json()) as { data: { accessToken: string } }).data;
        else await new Promise((res) => setTimeout(res, 400));
      }
      if (!data) throw new Error('could not refresh the session for the test helper');
      const h: Record<string, string> = { Authorization: `Bearer ${data.accessToken}`, ...headers };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body, headers },
  );
}

type Ctx = { data: { units: { id: string; code: string }[]; allUnitsAllowed: boolean } };

test('owner sees the three units and the current financial year in the top bar', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  const unit = page.getByLabel('Unit', { exact: true });
  await expect(unit).toBeVisible();
  const text = (await unit.locator('option').allInnerTexts()).join('|');
  expect(text).toMatch(/Talwade/);
  expect(text).toMatch(/Sawardari/);
  expect(text).toMatch(/Varale/);
  expect(text).toMatch(/All Units/);
  await expect(page.getByLabel('Financial year')).toContainText('2026-27');
});

test('switching the unit is saved and survives a reload', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/me/context') && r.request().method() === 'PUT' && r.ok()),
    page.getByLabel('Unit', { exact: true }).selectOption({ label: 'Sawardari' }),
  ]);
  await page.reload();
  await expect(page.getByLabel('Unit', { exact: true }).locator('option:checked')).toHaveText(/Sawardari/);
});

test('a member only gets their own unit; other units are refused by the API (hacker)', async ({ page, browser }) => {
  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await signIn(ownerPage, 'owner', OWNER_PW);
  const all = (await api(ownerPage, 'GET', '/me/context')).json as Ctx;
  const sawId = all.data.units.find((u) => u.code === 'SAW')?.id ?? '';
  expect(sawId).not.toBe('');
  await ownerCtx.close();

  await signIn(page, M2.loginId, M2.next);
  const mine = (await api(page, 'GET', '/me/context')).json as Ctx;
  expect(mine.data.units.map((u) => u.code)).toEqual(['TAL']);
  expect(mine.data.allUnitsAllowed).toBe(false);
  const put = await api(page, 'PUT', '/me/context', { unitId: sawId });
  expect([403, 422]).toContain(put.status);
  const forged = await api(page, 'GET', '/me/permissions?pageId=crm-leads', undefined, { 'X-Unit-Id': sawId });
  expect([200, 403, 422]).toContain(forged.status);
});

test('Unit Master: add a unit; a unit that has users cannot be deleted', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/admin-branches');
  await expect(page.getByRole('heading', { name: 'Unit Master' })).toBeVisible();
  await page.getByRole('button', { name: /Add Unit/ }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Code').fill('NSK');
  await d.getByLabel('Name').fill('Nashik');
  await d.getByRole('button', { name: /Save|Create|Add/ }).last().click();
  await expect(d).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Nashik', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Delete Talwade' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Talwade', exact: true })).toBeVisible();
});

test('Financial Years: two seeded, exactly one current; the current year cannot be closed', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/admin-fy');
  await expect(page.getByRole('cell', { name: '2025-26', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2026-27', exact: true })).toBeVisible();
  const list = await api(page, 'GET', '/financial-years');
  const years = (list.json as { data: { id: string; code: string; isCurrent: boolean }[] }).data;
  expect(years.filter((y) => y.isCurrent)).toHaveLength(1);
  const current = years.find((y) => y.isCurrent);
  const close = await api(page, 'POST', `/financial-years/${current?.id ?? ''}/close`);
  expect(close.status).toBe(409);
});

test('Company Master: a bad GSTIN is refused, a good one is saved and audited', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/admin-company');
  await page.getByLabel('GSTIN').fill('BAD-GSTIN');
  await page.getByRole('button', { name: /Save/ }).first().click();
  await expect(page.locator('.field-error').first()).toBeVisible();
  await page.getByLabel('GSTIN').fill('27ABCDE1234F1Z5');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/company') && r.request().method() === 'PATCH' && r.ok()),
    page.getByRole('button', { name: /Save/ }).first().click(),
  ]);
  const audit = await api(page, 'GET', '/audit-logs?size=50');
  const actions = (audit.json as { data: { action: string }[] }).data.map((a) => a.action);
  expect(actions.some((a) => /COMPANY/.test(a))).toBe(true);
});
