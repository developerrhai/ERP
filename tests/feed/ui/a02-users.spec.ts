// Part A steps 2-3: the Super User creates the Administrator; the Administrator creates ~30 users (1-, 2- and 3-plant).
import { expect, test, type Page } from '@playwright/test';
import { openPage, ROLES } from '../lib';
import { USERS, type FeedUser } from './data';
import { enter, enterFirst, ENV } from './helpers';
import { attempt, record } from './log';

async function createUser(page: Page, u: FeedUser): Promise<'done' | 'exists'> {
  await openPage(page, 'admin-users');
  await page.waitForTimeout(1200);
  if (await page.locator('.main').getByText(u.loginId, { exact: true }).count()) return 'exists';
  await page.getByRole('button', { name: '＋ Add User' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Login ID').fill(u.loginId);
  await d.getByLabel('Full Name').fill(u.name);
  await d.getByLabel('Email').fill(`${u.loginId}@feed.example`);
  await d.getByLabel('Role').selectOption({ label: u.role });
  await d.getByLabel('Department').selectOption({ label: u.dept });
  if (u.role !== 'Administrator') {
    for (const plant of ['Talwade', 'Sawardari', 'Varale']) {
      const box = d.getByRole('checkbox', { name: plant });
      if (await box.count()) await box.setChecked(u.plants.includes(plant as FeedUser['plants'][number]));
    }
  }
  const def = d.getByLabel('Default unit');
  if (await def.count()) await def.selectOption({ label: u.plants[0] });
  if (u.limit !== undefined) await d.getByLabel(/Approval Limit/).fill(String(u.limit));
  await d.getByRole('textbox', { name: 'Temporary Password', exact: true }).fill(ENV.tempPassword);
  await d.getByRole('button', { name: 'Create User' }).click();
  await expect(d).toBeHidden({ timeout: 10000 });
  return 'done';
}

test('step 2: Super User creates the Administrator', async ({ page }) => {
  test.setTimeout(300_000);
  await enter(page);
  const admin: FeedUser = { loginId: ROLES.Administrator!.loginId, name: 'Feed Administrator', role: 'Administrator', dept: 'Administration', plants: [] };
  await attempt(page, 'A2', 'User feed.admin (Administrator)', 'admin-users', () => createUser(page, admin));
});

test('step 3: the Administrator creates users for every role', async ({ page }) => {
  test.setTimeout(1_800_000);
  await enter(page, 'Administrator').catch(() => undefined);
  if (!(await page.locator('.main').first().isVisible().catch(() => false))) await enterFirst(page, 'Administrator');
  let ok = 0;
  for (const u of USERS) {
    if (await attempt(page, 'A3', `User ${u.loginId} (${u.role}, ${u.plants.join('+')})`, 'admin-users', () => createUser(page, u))) ok += 1;
  }
  record({ step: 'A3', item: `summary ${ok}/${USERS.length} users`, status: 'finding', note: 'Users created by the Administrator through the Add User form', page: 'admin-users' });
});
