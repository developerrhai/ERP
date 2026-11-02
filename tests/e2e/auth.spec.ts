// Why: end-to-end proof of Phase 1 through the real browser, Vite proxy, API and PostgreSQL — the login page
// matches the owner's decisions (no company code, no sign-up), the 5-level role hierarchy is enforced, and the
// careless-user / hacker cases from docs/plan/09-user-will-break-it.md behave safely. Tests run in order.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { E2E } from './e2e-env.mjs';

const API = `http://localhost:${E2E.webPort}/api/v1`;
const ADMIN = { loginId: 'admin1', name: 'Asha Admin', temp: 'Admin#Temp2026', next: 'Admin#Real2026x' };
const MEMBER = { loginId: 'member1', name: 'Mohan Member', temp: 'Member#Temp2026', next: 'Member#Real2026x' };

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

async function setNewPassword(page: Page, current: string, next: string) {
  await expect(page.getByText('Set a new password')).toBeVisible();
  await page.getByRole('textbox', { name: 'Current password', exact: true }).fill(current);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(next);
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill(next);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/change-password') && r.status() === 200),
    page.getByRole('button', { name: 'Save New Password' }).click(),
  ]);
  await expect(page.getByText('Set a new password')).toBeHidden();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function createUser(page: Page, u: { loginId: string; name: string; temp: string }, role: string, dept: string) {
  await page.goto('/m/admin-users');
  await page.getByRole('button', { name: '＋ Add User' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full Name').fill(u.name);
  await dialog.getByLabel('Login ID').fill(u.loginId);
  await dialog.getByLabel('Role').selectOption({ label: role });
  await dialog.getByLabel('Department').selectOption({ label: dept });
  if (role !== 'Admin') await dialog.getByLabel('Talwade').check(); // Phase 3: non-admins need at least one unit
  await dialog.getByRole('textbox', { name: 'Temporary Password', exact: true }).fill(u.temp);
  await dialog.getByRole('button', { name: 'Create User' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: u.loginId, exact: true })).toBeVisible();
}

test('login page: owner decisions applied (no company code, no sign-up, no demo login)', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Company Code')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Sign Up' })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByText(/Demo Accounts|Open Demo ERP/)).toHaveCount(0);
  await expect(page.getByLabel('Email / User ID')).toHaveValue('');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByRole('tab', { name: 'Forgot', exact: true }).click();
  await expect(page.getByText(/passwords are reset by your administrator/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to Sign In' }).click();
  // Same two-panel layout as the prototype: 1.06fr / .94fr split and a card of at most 520px.
  const card = await page.locator('.login-card').boundingBox();
  expect(card?.width).toBeLessThanOrEqual(520);
  const left = await page.locator('.login-left').boundingBox();
  expect(Math.round(left?.width ?? 0)).toBeGreaterThan(740);
});

test('wrong password and unknown user get the same generic message (no user enumeration)', async ({ page }) => {
  await signIn(page, 'owner', 'Wrong#Password1');
  const msg1 = await page.locator('.msg.error').innerText();
  await signIn(page, 'nobody-here', 'Wrong#Password1');
  const msg2 = await page.locator('.msg.error').innerText();
  expect(msg1).toBe('Invalid login ID or password.');
  expect(msg2).toBe(msg1);
});

test('double-clicking Sign In sends exactly one login request (B-01)', async ({ page }) => {
  let logins = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v1/auth/login')) logins++;
  });
  await page.goto('/login');
  await page.getByLabel('Email / User ID').fill('owner');
  await page.getByLabel('Password', { exact: true }).fill(E2E.owner.initialPassword);
  await page.getByRole('button', { name: 'Sign In to ERP' }).dblclick();
  await expect(page.getByText('Set a new password')).toBeVisible();
  expect(logins).toBe(1);
});

test('owner must change the seeded password before anything else; tokens never reach web storage', async ({ page, context }) => {
  await signIn(page, E2E.owner.email.toUpperCase(), E2E.owner.initialPassword); // email + case-insensitive
  await expect(page.getByText('Set a new password')).toBeVisible(); // login finished
  await page.goto('/m/admin-users'); // full reload: session restored via refresh cookie, still forced
  await expect(page.getByText('Set a new password')).toBeVisible(); // still forced
  await setNewPassword(page, E2E.owner.initialPassword, E2E.owner.newPassword);
  await expect(page.getByRole('heading', { name: 'User Master' })).toBeVisible(); // returned to the page asked for
  const storage = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
  expect(storage).not.toMatch(/eyJ/); // no JWT anywhere in web storage
  const rt = (await context.cookies()).find((c) => c.name === 'rt');
  expect(rt?.httpOnly).toBe(true);
  expect(rt?.sameSite).toBe('Strict');
});

test('browser refresh keeps the session (B-04) and the owner sees all 22 families', async ({ page }) => {
  await signIn(page, 'owner', E2E.owner.newPassword);
  await expect(page.getByText(/Modules are being enabled/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Modules are being enabled/)).toBeVisible();
  await expect(page.locator('.menu-section')).toHaveCount(22);
});

test('owner (Super Admin) can create an Admin; Super Admin is never offered as a role', async ({ page }) => {
  await signIn(page, 'owner', E2E.owner.newPassword);
  await page.goto('/m/admin-users');
  await page.getByRole('button', { name: '＋ Add User' }).click();
  const options = await page.getByRole('dialog').getByLabel('Role').locator('option').allInnerTexts();
  expect(options.join('|')).toContain('Admin');
  expect(options.join('|')).not.toContain('Super Admin');
  await page.keyboard.press('Escape');
  await createUser(page, ADMIN, 'Admin', 'Administration');
});

test('Admin cannot create Admins but can create a Member', async ({ page }) => {
  await signIn(page, ADMIN.loginId, ADMIN.temp);
  await setNewPassword(page, ADMIN.temp, ADMIN.next);
  await page.goto('/m/admin-users');
  await page.getByRole('button', { name: '＋ Add User' }).click();
  const options = (await page.getByRole('dialog').getByLabel('Role').locator('option').allInnerTexts()).map((s) => s.trim());
  expect(options).not.toContain('Admin');
  expect(options).not.toContain('Super Admin');
  expect(options).toEqual(expect.arrayContaining(['Manager', 'Lead', 'Member']));
  await page.keyboard.press('Escape');
  await createUser(page, MEMBER, 'Member', 'Sales');
});

test('Member sees only Sales department families, no Users page, and the API refuses user creation', async ({ page }) => {
  await signIn(page, MEMBER.loginId, MEMBER.temp);
  await setNewPassword(page, MEMBER.temp, MEMBER.next);
  await expect(page.locator('.menu-section')).toHaveCount(7);
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
  await page.goto('/m/admin-users');
  await expect(page.getByText(/Access denied|does not exist or is not available/)).toBeVisible();
  // Hacker check: call the API directly with the member's own valid token.
  const status = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/auth/refresh`, { method: 'POST', headers: { 'X-Requested-With': 'rhai-web' }, credentials: 'include' });
    const { data } = (await r.json()) as { data: { accessToken: string } };
    const c = await fetch(`${api}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId: 'evil', name: 'Evil', role: 'ADMIN', department: 'Sales', temporaryPassword: 'Evil#Pass2026x' }),
    });
    return c.status;
  }, API);
  expect(status).toBe(403);
});

test('a forged / tampered token is rejected (hacker)', async ({ request }) => {
  const forged = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4Iiwicm9sZSI6IlNVUEVSX0FETUlOIn0.';
  const r = await request.get(`${API}/users`, { headers: { Authorization: `Bearer ${forged}` } });
  expect(r.status()).toBe(401);
});

test('deactivating a user signs them out everywhere immediately', async ({ browser }) => {
  const memberCtx: BrowserContext = await browser.newContext();
  const memberPage = await memberCtx.newPage();
  await signIn(memberPage, MEMBER.loginId, MEMBER.next);
  await expect(memberPage.getByText(/Modules are being enabled/)).toBeVisible();

  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await signIn(ownerPage, 'owner', E2E.owner.newPassword);
  await ownerPage.goto('/m/admin-users');
  await ownerPage.getByRole('button', { name: `Deactivate ${MEMBER.name}` }).click();
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(ownerPage.getByRole('dialog')).toBeHidden();

  await memberPage.reload();
  await expect(memberPage).toHaveURL(/\/login/);
  await signIn(memberPage, MEMBER.loginId, MEMBER.next);
  await expect(memberPage.locator('.msg.error')).toHaveText('Invalid login ID or password.');
  await memberCtx.close();
  await ownerCtx.close();
});

test('two tabs reloading at the same moment both stay signed in (refresh race)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await signIn(a, 'owner', E2E.owner.newPassword);
  await expect(a.getByText(/Modules are being enabled/)).toBeVisible();
  const b = await ctx.newPage();
  await b.goto('/');
  await expect(b.getByText(/Modules are being enabled/)).toBeVisible();
  await Promise.all([a.reload(), b.reload()]);
  await expect(a.getByText(/Modules are being enabled/)).toBeVisible();
  await expect(b.getByText(/Modules are being enabled/)).toBeVisible();
  // and a further reload still works (family not revoked)
  await a.reload();
  await expect(a.getByText(/Modules are being enabled/)).toBeVisible();
  await ctx.close();
});

test('signing out in one tab signs out the other tab (B-10)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await signIn(a, 'owner', E2E.owner.newPassword);
  await expect(a.getByText(/Modules are being enabled/)).toBeVisible();
  const b = await ctx.newPage();
  await b.goto('/');
  await expect(b.getByText(/Modules are being enabled/)).toBeVisible();
  await signOut(a);
  await expect(b).toHaveURL(/\/login/, { timeout: 10_000 });
  await ctx.close();
});
