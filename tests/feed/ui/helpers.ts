import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { acknowledgePrivacyNoticeIfShown, loginAs, ROLES, type FeedEnv, type RoleName } from '../lib';

export const ENV: FeedEnv = JSON.parse(readFileSync(path.join(__dirname, 'state.json'), 'utf8')) as FeedEnv;

async function pastPicker(page: Page): Promise<void> {
  const all = page.getByRole('button', { name: 'All my plants' });
  if (await all.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
    await all.click();
    const remember = page.getByLabel(/Remember my choice/);
    if (await remember.count()) await remember.check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.main').first().waitFor({ state: 'visible', timeout: 15000 });
  }
  await acknowledgePrivacyNoticeIfShown(page);
}

/** Logs in as the role, then gets past the plant picker ("All my plants", remembered) and the DPDP notice. */
export async function enter(page: Page, who: RoleName = 'Super User'): Promise<void> {
  await loginAs(page, ENV, who);
  await pastPicker(page);
}

/** First ever sign-in of a feed user created with the temporary password (waits for the forced password screen). */
export async function enterFirst(page: Page, who: RoleName): Promise<void> {
  const loginId = ROLES[who]?.loginId ?? '';
  await page.goto('/login');
  await page.getByLabel('Email / User ID').fill(loginId);
  await page.getByLabel('Password', { exact: true }).fill(ENV.tempPassword);
  await page.getByRole('button', { name: 'Sign In to ERP' }).click();
  const heading = page.getByText('Set a new password');
  if (await heading.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)) {
    await page.getByRole('textbox', { name: 'Current password', exact: true }).fill(ENV.tempPassword);
    await page.getByRole('textbox', { name: 'New password', exact: true }).fill(ENV.userPassword);
    await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill(ENV.userPassword);
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/change-password') && r.status() === 200),
      page.getByRole('button', { name: 'Save New Password' }).click(),
    ]);
  }
  await pastPicker(page);
}
