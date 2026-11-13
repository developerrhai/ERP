// Phase 22-F (R2-7 / R-40): the "feed through the screens" framework.
// Every helper drives the real screens like a person does: log in, open a page, find an input by its
// label text (so a layout change does not break a feeder), press the same buttons. Nothing writes to
// the database directly. Specs import from here; datasets live in ../data.
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

export interface RoleSpec {
  /** Name shown in the Role dropdown of User Master. */
  role: string;
  /** Department dropdown label (any, for non-admin roles). */
  department: string;
}

/** The nine roles of R-03 with a home department for the crawler / feeders. */
export const ROLES: Record<string, RoleSpec & { loginId: string }> = {
  'Super User': { role: 'Super User', department: 'Administration', loginId: 'owner' },
  Administrator: { role: 'Administrator', department: 'Administration', loginId: 'feed.admin' },
  Director: { role: 'Director', department: 'Administration', loginId: 'feed.director' },
  CFO: { role: 'CFO', department: 'Finance', loginId: 'feed.cfo' },
  GM: { role: 'General Manager', department: 'Production', loginId: 'feed.gm' },
  'Dept Head': { role: 'Department Head', department: 'Sales', loginId: 'feed.head' },
  'Dept Manager': { role: 'Department Manager', department: 'Sales', loginId: 'feed.manager' },
  Supervisor: { role: 'Supervisor', department: 'Production', loginId: 'feed.supervisor' },
  Employee: { role: 'Employee', department: 'Warehouse', loginId: 'feed.employee' },
};
export type RoleName = keyof typeof ROLES;

export interface FeedEnv {
  ownerId: string;
  ownerPassword: string;
  /** Password of a freshly seeded owner; changed to ownerPassword on the first sign-in. */
  ownerInitialPassword?: string;
  /** Password given to feeder users (they change it on first login). */
  tempPassword: string;
  userPassword: string;
}

const known = new Set<string>();

async function typeLogin(page: Page, id: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email / User ID').fill(id);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login')),
    page.getByRole('button', { name: 'Sign In to ERP' }).click(),
  ]);
}

/** First sign-in of a user shows the DPDP privacy notice; it must be acknowledged before anything else can be clicked. */
export async function acknowledgePrivacyNoticeIfShown(page: Page): Promise<void> {
  const ok = page.getByRole('button', { name: 'I Acknowledge & Continue' });
  // isVisible() does not wait; the notice arrives after its own request, so wait for it explicitly.
  const shown = await ok.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
  if (shown) {
    await Promise.all([page.waitForResponse((r) => r.url().includes('/privacy') && r.request().method() !== 'GET').catch(() => undefined), ok.click()]);
    await expect(ok).toBeHidden();
  }
}

async function changePasswordIfAsked(page: Page, current: string, next: string): Promise<void> {
  if (!(await page.getByText('Set a new password').isVisible().catch(() => false))) return;
  await page.getByRole('textbox', { name: 'Current password', exact: true }).fill(current);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(next);
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill(next);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/change-password') && r.status() === 200),
    page.getByRole('button', { name: 'Save New Password' }).click(),
  ]);
}

/** Creates the role's user on the User Master screen (once per run), as the owner. */
export async function ensureUser(page: Page, env: FeedEnv, who: RoleName): Promise<void> {
  const spec = ROLES[who];
  if (!spec || spec.loginId === env.ownerId || known.has(spec.loginId)) return;
  await page.goto('/m/admin-users');
  await page.getByRole('button', { name: '＋ Add User' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full Name').fill(`Feed ${spec.role}`);
  await dialog.getByLabel('Login ID').fill(spec.loginId);
  await dialog.getByLabel('Role').selectOption({ label: spec.role });
  await dialog.getByLabel('Department').selectOption({ label: spec.department });
  for (const unit of ['Talwade', 'Sawardari', 'Varale']) {
    const box = dialog.getByLabel(unit);
    if (await box.count()) await box.check();
  }
  await dialog.getByRole('textbox', { name: 'Temporary Password', exact: true }).fill(env.tempPassword);
  await dialog.getByRole('button', { name: /^(Create User|Save)/ }).click();
  await expect(dialog).toBeHidden();
  known.add(spec.loginId);
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Picks the plants to work in from the top bar Unit select (one label, or 'All'). */
export async function selectPlants(page: Page, plants: string): Promise<void> {
  const unit = page.getByLabel('Unit', { exact: true });
  if ((await unit.count()) === 0) return; // single-plant users have no choice to make
  const current = (await unit.locator('option:checked').innerText()).trim();
  if (current === plants) return;
  const opt = unit.locator('option', { hasText: plants });
  if ((await opt.count()) === 0) return;
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/me/context') && r.request().method() === 'PUT'),
    unit.selectOption({ label: plants }),
  ]);
}

/** loginAs(role, plants): sign in through the login screen as that role, working in `plants`. */
export async function loginAs(page: Page, env: FeedEnv, who: RoleName, plants = ''): Promise<void> {
  const spec = ROLES[who];
  if (!spec) throw new Error(`Unknown role ${String(who)}`);
  if (spec.loginId === env.ownerId) {
    await typeLogin(page, env.ownerId, env.ownerPassword);
    const refused = await page.getByText(/incorrect/i).first().isVisible({ timeout: 1500 }).catch(() => false);
    if (refused && env.ownerInitialPassword) {
      await typeLogin(page, env.ownerId, env.ownerInitialPassword);
      await changePasswordIfAsked(page, env.ownerInitialPassword, env.ownerPassword);
    }
  } else {
    await typeLogin(page, spec.loginId, env.userPassword);
    if (await page.getByText('Set a new password').isVisible().catch(() => false)) {
      // first sign-in after creation: the temp password is still in force
    }
    if (!(await page.getByText(/Incorrect|incorrect/).isVisible().catch(() => false))) {
      // keep going
    }
  }
  await changePasswordIfAsked(page, spec.loginId === env.ownerId ? env.ownerPassword : env.tempPassword, env.userPassword);
  await acknowledgePrivacyNoticeIfShown(page);
  if (plants) await selectPlants(page, plants);
}

/** First time for a role: sign in with the temp password, set the real one, land in the app. */
export async function firstLogin(page: Page, env: FeedEnv, who: RoleName): Promise<void> {
  const spec = ROLES[who];
  if (!spec) throw new Error(`Unknown role ${String(who)}`);
  await typeLogin(page, spec.loginId, env.tempPassword);
  await changePasswordIfAsked(page, env.tempPassword, env.userPassword);
  await acknowledgePrivacyNoticeIfShown(page);
}

export async function logout(page: Page): Promise<void> {
  await signOut(page);
}

export async function openPage(page: Page, id: string, tab?: number | string): Promise<void> {
  await page.goto(`/m/${id}${typeof tab === 'string' ? `?tab=${encodeURIComponent(tab)}` : typeof tab === 'number' ? `?tab=${tab}` : ''}`);
  await expect(page.locator('h1').first()).toBeVisible();
}

/**
 * fillForm({ 'Rack Code': 'R-01', Zone: 'Zone A', Active: true }): finds each control by its label
 * text and fills it the way a person would (type, choose an option, tick a box).
 */
export async function fillForm(
  scope: Page | Locator,
  values: Record<string, string | number | boolean>,
): Promise<void> {
  for (const [label, value] of Object.entries(values)) {
    const ctl = scope.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\*|\\(|$)`)).first();
    await expect(ctl, `field "${label}"`).toBeVisible();
    const tag = await ctl.evaluate((el) => el.tagName.toLowerCase());
    const type = await ctl.evaluate((el) => (el as HTMLInputElement).type ?? '');
    if (tag === 'select') await ctl.selectOption({ label: String(value) });
    else if (type === 'checkbox') {
      if (Boolean(value) !== (await ctl.isChecked())) await ctl.click();
    } else await ctl.fill(String(value));
  }
}

/** addLine(): the "＋ Add Line" button of a document form. */
export async function addLine(scope: Page | Locator): Promise<void> {
  await scope.getByRole('button', { name: /Add Line|＋ Line/ }).first().click();
}

/** pick('Item', 'Mild Steel Plate'): types into a lookup and chooses the matching suggestion. */
export async function pick(scope: Page | Locator, lookupLabel: string, text: string, optionText = text): Promise<void> {
  const box = scope.getByLabel(new RegExp(`^${lookupLabel}(\\s|\\*|$)`)).first();
  await box.fill(text);
  const root: Page = 'goto' in scope ? scope : scope.page();
  const opt = root.getByRole('option').filter({ hasText: optionText }).first();
  await expect(opt, `lookup "${lookupLabel}" for "${optionText}"`).toBeVisible();
  await opt.click();
}

export async function clickAction(scope: Page | Locator, label: string): Promise<void> {
  const btn = scope.getByRole('button', { name: label, exact: true }).first();
  await expect(btn, `button "${label}"`).toBeEnabled();
  await btn.click();
}

export async function expectToast(page: Page, text?: string | RegExp): Promise<string> {
  const toast = page.locator('.toast.show, [role="status"].toast').first();
  await expect(toast).toBeVisible();
  if (text !== undefined) await expect(toast).toContainText(text);
  return (await toast.innerText()).trim();
}

/** readDocNo(): the document number shown in the success toast or the open drawer, e.g. "RK-2026-0001". */
export async function readDocNo(page: Page): Promise<string> {
  const body = await page.locator('.toast.show, .drawer.show, [role="dialog"]').allInnerTexts();
  const m = /\b([A-Z]{2,6}[-/]\d{2,4}(?:[-/]\d{1,6})+)\b/.exec(body.join(' '));
  if (!m?.[1]) throw new Error('No document number found on the screen.');
  return m[1];
}

/** approveAs(role, docNo): a second browser context signs in as `who` and approves from My Approvals. */
export async function approveAs(browser: Browser, env: FeedEnv, who: RoleName, docNo: string): Promise<void> {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, env, who);
    await openPage(page, 'my-approvals');
    const row = page.getByRole('row', { name: new RegExp(docNo) }).first();
    await expect(row, `approval for ${docNo}`).toBeVisible();
    await row.click();
    await clickAction(page, 'Approve');
    await expectToast(page);
  } finally {
    await ctx.close();
  }
}
