// Why: end-to-end proof of Phase 2 (docs/phase2/CONTRACT.md §5) through the real browser, API and PostgreSQL:
// module controls and role permissions change a member's menu immediately, departments in use cannot be
// deleted, the letterhead persists, and every change lands in the audit trail. Runs after auth.spec.ts
// (same e2e DB; the owner's password was already changed there).
import { test, expect, type Page } from '@playwright/test';
import { E2E } from './e2e-env.mjs';

const OWNER_PW = E2E.owner.newPassword;
const M2 = { loginId: 'member2', name: 'Meera Member', temp: 'Member2#Temp26', next: 'Member2#Real26x' };

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

async function changeFirstPassword(page: Page, current: string, next: string) {
  await expect(page.getByText('Set a new password')).toBeVisible();
  await page.getByRole('textbox', { name: 'Current password', exact: true }).fill(current);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(next);
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill(next);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/change-password') && r.status() === 200),
    page.getByRole('button', { name: 'Save New Password' }).click(),
  ]);
}

/** Calls the API from inside the signed-in page (gets a fresh access token from the httpOnly refresh cookie). */
async function api(page: Page, method: string, path: string, body?: unknown, ifMatch?: string) {
  await page.waitForLoadState('networkidle'); // let the app's own session refresh finish first
  return page.evaluate(
    async ({ method, path, body, ifMatch }) => {
      // The page's own session refresh may run at the same moment (409 REFRESH_RACE) - retry like the app does.
      let data: { accessToken: string } | undefined;
      for (let attempt = 0; attempt < 5 && !data; attempt++) {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' } });
        if (r.ok) data = ((await r.json()) as { data: { accessToken: string } }).data;
        else await new Promise((res) => setTimeout(res, 400));
      }
      if (!data) throw new Error('could not refresh the session for the test helper');
      const headers: Record<string, string> = { Authorization: `Bearer ${data.accessToken}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (ifMatch) headers['If-Match'] = ifMatch;
      const res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body, ifMatch },
  );
}

const menuLink = (page: Page, name: string) => page.locator('#root nav, aside').getByRole('link', { name, exact: true });

test('setup: owner creates a Sales member who signs in once', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signIn(owner, 'owner', OWNER_PW);
  await expect(owner.getByText(/Modules are being enabled/)).toBeVisible();
  const ctx = await api(owner, 'GET', '/me/context');
  const units = (ctx.json as { data: { units: { id: string; code: string }[] } }).data.units;
  const tal = units.find((u) => u.code === 'TAL');
  expect(tal).toBeDefined();
  const r = await api(owner, 'POST', '/users', {
    loginId: M2.loginId,
    name: M2.name,
    role: 'MEMBER',
    department: 'Sales',
    unitIds: [tal?.id],
    defaultUnitId: tal?.id,
    temporaryPassword: M2.temp,
  });
  expect(r.status).toBe(201);
  await ownerCtx.close();

  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  await signIn(member, M2.loginId, M2.temp);
  await changeFirstPassword(member, M2.temp, M2.next);
  await expect(menuLink(member, 'Lead Sources')).toBeVisible();
  await memberCtx.close();
});

test('owner disables a module in System Control Center → it disappears from the member menu; re-enable restores it', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signIn(owner, 'owner', OWNER_PW);
  await owner.goto('/m/admin-settings/controls');
  await expect(owner.getByRole('heading', { name: 'System Control Center' })).toBeVisible();
  await owner.getByLabel('Search modules').fill('Lead Sources');
  await expect(owner.getByText('1 modules')).toBeVisible(); // filtered list loaded
  const enabled = owner.getByLabel('Lead Sources Enabled');
  await expect(enabled).toBeChecked();
  await enabled.uncheck();
  await Promise.all([
    owner.waitForResponse((r) => r.url().includes('/module-controls/crm-sources') && r.request().method() === 'PATCH' && r.ok()),
    owner.getByRole('button', { name: 'Save Lead Sources' }).click(),
  ]);

  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  await signIn(member, M2.loginId, M2.next);
  await expect(menuLink(member, 'Lead Management')).toBeVisible();
  await expect(menuLink(member, 'Lead Sources')).toHaveCount(0);
  await member.goto('/m/crm-sources');
  await expect(member.getByText(/Access denied|does not exist or is not available/)).toBeVisible();

  // Administration modules can never be switched off (lock-out protection).
  const adminToggle = await api(owner, 'PATCH', '/module-controls/admin-users', { enabled: false }, '"0"');
  expect([409, 412, 400]).toContain(adminToggle.status); // PROTECTED (or version error) — never 200
  expect(adminToggle.status).not.toBe(200);

  await owner.reload();
  await owner.getByLabel('Search modules').fill('Lead Sources');
  await expect(owner.getByText('1 modules')).toBeVisible(); // filtered list loaded
  await expect(owner.getByLabel('Lead Sources Enabled')).not.toBeChecked();
  await owner.getByLabel('Lead Sources Enabled').check();
  await Promise.all([
    owner.waitForResponse((r) => r.url().includes('/module-controls/crm-sources') && r.request().method() === 'PATCH' && r.ok()),
    owner.getByRole('button', { name: 'Save Lead Sources' }).click(),
  ]);
  // One navigation, then wait: a second reload while the first page load is still refreshing the session
  // can lose the rotated cookie (known limitation of rotating refresh tokens, see docs/phase3-4/CHANGES.md).
  await member.goto('/');
  await expect(menuLink(member, 'Lead Sources')).toBeVisible();
  await ownerCtx.close();
  await memberCtx.close();
});

test('owner removes View for Member in Permission Master → the member loses the menu and the API refuses', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signIn(owner, 'owner', OWNER_PW);
  await owner.goto('/m/admin-permissions');
  await expect(owner.getByRole('heading', { name: 'Permission Master' })).toBeVisible();
  await owner.getByLabel('Member View', { exact: true }).uncheck();
  await Promise.all([
    owner.waitForResponse((r) => r.url().endsWith('/permissions/MEMBER') && r.request().method() === 'PUT' && r.ok()),
    owner.getByRole('button', { name: 'Save Member' }).click(),
  ]);

  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  await signIn(member, M2.loginId, M2.next);
  await expect(member.locator('.menu-section')).toHaveCount(0);
  const perm = await api(member, 'GET', '/me/permissions?pageId=crm-leads');
  expect((perm.json as { data: { actions: { view: boolean } } }).data.actions.view).toBe(false);

  // restore
  await owner.reload();
  await owner.getByLabel('Member View', { exact: true }).check();
  await Promise.all([
    owner.waitForResponse((r) => r.url().endsWith('/permissions/MEMBER') && r.request().method() === 'PUT' && r.ok()),
    owner.getByRole('button', { name: 'Save Member' }).click(),
  ]);
  await member.reload();
  await expect(menuLink(member, 'Lead Management')).toBeVisible();
  await ownerCtx.close();
  await memberCtx.close();
});

test('a member cannot change permissions even by calling the API directly (hacker)', async ({ page }) => {
  await signIn(page, M2.loginId, M2.next);
  await expect(page.getByText(/Modules are being enabled/)).toBeVisible();
  const r = await api(page, 'PUT', '/permissions/MEMBER', { rows: [{ resource: '*', view: true, add: true, edit: true, delete: true, approve: true, export: true, controls: true, scope: 'ALL' }] }, '"999"');
  expect(r.status).toBe(403);
  const ctl = await api(page, 'PATCH', '/module-controls/crm-leads', { enabled: false }, '"0"');
  expect(ctl.status).toBe(403);
});

test('a department that still has users cannot be deleted', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/admin-departments');
  await expect(page.getByRole('heading', { name: 'Department Master' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Sales' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/This department has \d+ users?/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sales', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Administration' })).toHaveCount(0);
});

test('owner can add a new department, then delete it while unused', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/admin-departments');
  await page.getByRole('button', { name: '＋ Add Department' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Code').fill('LOGI');
  await d.getByLabel('Name').fill('Logistics');
  await d.getByLabel('Head').fill('Logistics Head');
  await d.getByRole('button', { name: /Save|Create|Add/ }).last().click();
  await expect(d).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Logistics', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Logistics' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Logistics', exact: true })).toHaveCount(0);
});

test('letterhead saves, survives a reload, and appears in the live preview', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  await page.goto('/m/admin-settings/letterhead');
  const name = page.getByLabel('Company Name');
  await name.fill('RHAI Industries Pvt. Ltd. (E2E)');
  await page.getByLabel('GSTIN').fill('27ABCDE1234F1Z5');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/settings/letterhead') && r.request().method() === 'PUT' && r.ok()),
    page.getByRole('button', { name: 'Save Letterhead' }).click(),
  ]);
  await page.reload();
  await expect(page.getByLabel('Company Name')).toHaveValue('RHAI Industries Pvt. Ltd. (E2E)');
  await expect(page.getByText('RHAI Industries Pvt. Ltd. (E2E)').last()).toBeVisible();
  // invalid GSTIN is refused with a field error
  await page.getByLabel('GSTIN').fill('BAD-GSTIN');
  await page.getByRole('button', { name: 'Save Letterhead' }).click();
  await expect(page.locator('.field-error').first()).toBeVisible();
});

test('the audit trail records the Phase 2 admin actions', async ({ page }) => {
  await signIn(page, 'owner', OWNER_PW);
  for (const action of ['MODULE_CONTROL_UPDATED', 'PERMISSIONS_UPDATED', 'DEPARTMENT_CREATED', 'DEPARTMENT_DELETED', 'SETTINGS_UPDATED']) {
    const r = await api(page, 'GET', `/audit-logs?action=${action}`);
    expect(r.status, action).toBe(200);
    expect((r.json as { meta: { total: number } }).meta.total, action).toBeGreaterThan(0);
  }
  await page.goto('/m/admin-audit');
  await expect(page.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Details of/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Details of/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
