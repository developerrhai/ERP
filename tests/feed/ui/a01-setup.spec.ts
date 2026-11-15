// Part A step 1-2 (Super User): the missing department, designations, and the Administrator user - all through the screens.
import { expect, test } from '@playwright/test';
import { enter, ENV } from './helpers';
import { attempt, record } from './log';
import { openPage } from '../lib';

const DESIGNATIONS = [
  ['MD', 'Managing Director', 'Administration', 99], ['DIR', 'Director', 'Administration', 90], ['CFO', 'Chief Financial Officer', 'Finance', 85],
  ['GM', 'General Manager', 'Production', 80], ['HOD', 'Head of Department', 'Sales', 70], ['MGR', 'Manager', 'Sales', 60],
  ['SUP', 'Supervisor', 'Production', 40], ['EXE', 'Executive', 'Purchase', 30], ['OPR', 'Operator', 'Production', 20], ['STK', 'Store Keeper', 'Warehouse', 20],
] as const;

test('step 1: department + designations (Super User)', async ({ page }) => {
  test.setTimeout(600_000);
  await enter(page);
  await attempt(page, 'A1', 'Department Engineering', 'admin-departments', async () => {
    await openPage(page, 'admin-departments');
    await page.waitForTimeout(1500);
    if (await page.locator('.main').getByText('Engineering', { exact: true }).count()) return 'exists';
    await page.getByRole('button', { name: '＋ Add Department' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Code').fill('ENG');
    await d.getByLabel('Name').fill('Engineering');
    await d.getByRole('button', { name: 'Create Department' }).click();
    await expect(d).toBeHidden({ timeout: 8000 });
    return 'done';
  });
  for (const [code, title, dept, level] of DESIGNATIONS) {
    await attempt(page, 'A1', `Designation ${title}`, 'admin-designations', async () => {
      await openPage(page, 'admin-designations');
      await page.waitForTimeout(1200);
      if (await page.locator('.main').getByText(title, { exact: true }).count()) return 'exists';
      await page.getByRole('button', { name: '＋ Add Designation' }).click();
      const d = page.getByRole('dialog');
      await d.getByLabel('Code').fill(code);
      await d.getByLabel('Title / Name').fill(title);
      await d.getByLabel('Department').selectOption({ label: dept });
      await d.getByLabel(/Authority Level/).fill(String(level));
      await d.getByRole('button', { name: 'Create Designation' }).click();
      await expect(d).toBeHidden({ timeout: 8000 });
      return 'done';
    });
  }
  record({ step: 'A1', item: 'finding: users form', status: 'finding', note: 'ENV loaded for later steps', page: ENV.ownerId ? 'admin-users' : '' });
});
