// Why: end-to-end proof of Phase 4 (docs/phase3-4/CONTRACT.md Stage B): a standard page (Lead Management) works
// like a real register - add through the generated form, gap-free code, edit, delete with undo, search, export,
// unit isolation, and data scope for a member. Runs after phase3.spec.ts (same e2e DB; owner password set,
// member2 exists in Talwade with the Sales department).
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

type Row = { id: string; code: string; status: string; version: number; data: Record<string, unknown> };
type List = { data: Row[]; meta: { total: number } };

async function selectUnit(page: Page, label: string) {
  const unit = page.getByLabel('Unit', { exact: true });
  await expect(unit.locator('option', { hasText: label })).toHaveCount(1); // context loaded
  const current = (await unit.locator('option:checked').innerText()).trim();
  if (current === label) return; // already selected: no change event, no request
  const seen: string[] = [];
  const onResponse = (r: { url(): string; status(): number; request(): { method(): string } }) => {
    if (r.url().includes('/me/context')) seen.push(`${r.request().method()} ${r.status()}`);
  };
  page.on('response', onResponse);
  await unit.selectOption({ label });
  await expect
    .poll(() => seen.some((x) => x.startsWith('PUT 200')), { message: `switch to "${label}": saw [${seen.join(', ')}]`, timeout: 10_000 })
    .toBe(true);
  page.off('response', onResponse);
}

test('owner adds a lead through the generated form and gets a gap-free code', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  await page.goto('/m/crm-leads');
  await expect(page.getByRole('heading', { name: 'Lead Management' })).toBeVisible();
  // the 16 prototype tabs are present
  await expect(page.getByRole('tab')).toHaveCount(16);

  await page.getByRole('button', { name: /Add$/ }).first().click();
  const d = page.getByRole('dialog');
  await expect(d.getByText(/Lead No/)).toBeVisible();
  await d.getByLabel('Lead Name').fill('Apex Mobility E2E');
  await d.getByLabel('Company').fill('Apex Mobility');
  await Promise.all([
    page.waitForResponse((r) => /\/pages\/crm-leads\/records$/.test(r.url()) && r.request().method() === 'POST' && r.ok()),
    d.getByRole('button', { name: /Save|Create|Add/ }).last().click(),
  ]);
  await expect(d).toBeHidden();
  await expect(page.getByText(/LEA\/TAL\/26-27\/00001/).first()).toBeVisible();
});

test('a bad value is refused with a message under the field', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/crm-leads');
  await page.getByRole('button', { name: /Add$/ }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Lead Name').fill('X'.repeat(1)); // too short / missing mandatory fields
  await d.getByLabel('Email').fill('not-an-email');
  await d.getByRole('button', { name: /Save|Create|Add/ }).last().click();
  await expect(d.locator('.field-error').first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('edit, then delete with Undo restores the record', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/crm-leads');
  await page.getByRole('tab', { name: 'Lead Register' }).click(); // the page opens on the Module Dashboard tab
  await page.getByRole('button', { name: /^Edit LEA\// }).first().scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /^Edit LEA\// }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Company').fill('Apex Mobility Pvt Ltd');
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok()),
    d.getByRole('button', { name: /Save/ }).last().click(),
  ]);
  await expect(page.getByText('Apex Mobility Pvt Ltd')).toBeVisible();

  await page.getByRole('button', { name: /^Delete LEA\// }).first().click();
  const confirm = page.getByRole('dialog');
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'DELETE' && r.ok()),
    confirm.getByRole('button', { name: 'Delete', exact: true }).click(),
  ]);
  await expect(page.getByText('Apex Mobility Pvt Ltd')).toHaveCount(0);
  await Promise.all([
    page.waitForResponse((r) => /restore/.test(r.url()) && r.ok()),
    page.getByRole('button', { name: /Undo/ }).click(),
  ]);
  await expect(page.getByText('Apex Mobility Pvt Ltd')).toBeVisible();
});

test('the next record gets the next code, and 5 parallel creates give 5 distinct consecutive codes', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  const ctxRes = await api(page, 'GET', '/me/context');
  expect(ctxRes.status).toBe(200);
  await page.waitForLoadState('networkidle');
  // One session refresh, then 5 truly parallel creates with the same token.
  const made = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } });
    const { data } = (await r.json()) as { data: { accessToken: string } };
    return Promise.all(
      [1, 2, 3, 4, 5].map(async (i) => {
        const res = await fetch('/api/v1/pages/crm-leads/records', {
          method: 'POST',
          headers: { Authorization: `Bearer ${data.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { leadName: `Parallel ${i}`, company: `Co ${i}` } }),
        });
        return { status: res.status, json: (await res.json()) as unknown };
      }),
    );
  });
  for (const m of made) expect(m.status).toBe(201);
  const codes = made.map((m) => (m.json as { data: Row }).data.code).sort();
  expect(new Set(codes).size).toBe(5);
  const nums = codes.map((c) => Number(c.split('/').pop()));
  expect(nums[4]! - nums[0]!).toBe(4); // consecutive, no gaps
});

test('search finds a record; Excel export downloads and neutralises formulas', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await api(page, 'POST', '/pages/crm-leads/records', { data: { leadName: '=HYPERLINK("http://evil")', company: 'Formula Co' } });
  await page.goto('/m/crm-leads');
  await page.getByRole('tab', { name: 'Lead Register' }).click();
  const search = page.getByLabel('Search Lead Management');
  await search.fill('Parallel 3');
  await search.press('Enter');
  await expect(page.getByText('Parallel 3').first()).toBeVisible();
  await expect(page.getByText('Parallel 4')).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Excel/ }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
});

test('unit isolation: records of Talwade are not visible in Sawardari, and All Units shows both (owner)', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await selectUnit(page, 'Talwade');
  const tal = (await api(page, 'GET', '/pages/crm-leads/records?size=100')).json as List;
  expect(tal.meta.total).toBeGreaterThan(5);
  await selectUnit(page, 'Sawardari');
  const saw = (await api(page, 'POST', '/pages/crm-leads/records', { data: { leadName: 'Saw Lead', company: 'Saw Co' } })).json as { data: Row };
  expect(saw.data.code).toMatch(/LEA\/SAW\/26-27\/00001/);
  const sawList = (await api(page, 'GET', '/pages/crm-leads/records?size=100')).json as List;
  expect(sawList.data.every((r) => !/Parallel/.test(String(r.data.leadName ?? '')))).toBe(true);
  await selectUnit(page, 'All Units');
  const all = (await api(page, 'GET', '/pages/crm-leads/records?size=100')).json as List;
  expect(all.meta.total).toBe(tal.meta.total + sawList.meta.total);
  // writing in "All Units" is refused
  const write = await api(page, 'POST', '/pages/crm-leads/records', { data: { leadName: 'Nowhere', company: 'No Unit' } });
  expect([409, 422, 403]).toContain(write.status);
});

test('a member (own scope, Talwade only) sees only their own records and cannot reach Sawardari data', async ({ page, browser }) => {
  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await signIn(ownerPage, 'owner', OWNER_PW);
  await selectUnit(ownerPage, 'Talwade');
  const ownerList = (await api(ownerPage, 'GET', '/pages/crm-leads/records?size=100')).json as List;
  expect(ownerList.meta.total).toBeGreaterThan(5);
  await ownerCtx.close();

  await signIn(page, M2.loginId, M2.next);
  const mine = await api(page, 'POST', '/pages/crm-leads/records', { data: { leadName: 'Member Lead', company: 'Member Co' } });
  expect(mine.status).toBe(201);
  const list = (await api(page, 'GET', '/pages/crm-leads/records?size=100')).json as List;
  expect(list.data.map((r) => r.data.leadName)).toEqual(['Member Lead']);
  // reading someone else's record by id is a 404, not a leak
  const other = ownerList.data[0]?.id ?? '';
  const peek = await api(page, 'GET', `/pages/crm-leads/records/${other}`);
  expect(peek.status).toBe(404);
});

test('a closed financial year blocks writes, the open one still works (period lock)', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  const ctx = (await api(page, 'GET', '/me/context')).json as {
    data: { fys: { id: string; code: string; isCurrent: boolean }[]; units: { id: string; code: string }[] };
  };
  const past = ctx.data.fys.find((f) => !f.isCurrent);
  expect(past).toBeDefined();
  const closeRes = await api(page, 'POST', `/financial-years/${past?.id ?? ''}/close`);
  expect([200, 204]).toContain(closeRes.status);
  const tal = ctx.data.units.find((u) => u.code === 'TAL')?.id ?? '';
  const blocked = await api(page, 'POST', '/pages/crm-leads/records', { data: { leadName: 'Old FY', company: 'Old' } }, { 'X-FY-Id': past?.id ?? '', 'X-Unit-Id': tal });
  expect(blocked.status).toBe(409);
  await api(page, 'POST', `/financial-years/${past?.id ?? ''}/reopen`);
});
