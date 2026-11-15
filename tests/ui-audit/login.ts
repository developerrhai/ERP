// Logs a feed user (or the owner) into the ERP for the audit: normal login, forced password change on first use,
// then the plant picker and the DPDP notice. Passwords come from the git-ignored tests/feed/ui/state.json only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { acknowledgePrivacyNoticeIfShown } from '../feed/lib';

const ENV = JSON.parse(readFileSync(path.resolve(__dirname, '../feed/ui/state.json'), 'utf8')) as {
  ownerId: string; ownerPassword: string; tempPassword: string; userPassword: string;
};

export const ROLE_LOGINS: Record<string, string> = {
  super: ENV.ownerId,
  admin: 'feed.admin',
  'mgr-purchase': 'mgr.purchase.tal',
  'emp-stores': 'emp.stores.tal',
  'sales-talsaw': 'emp.sales.talsaw',
};

export async function enterAs(page: Page, loginId: string): Promise<void> {
  const isOwner = loginId === ENV.ownerId;
  const pwd = isOwner ? ENV.ownerPassword : ENV.userPassword;
  await page.goto('/login');
  await page.getByLabel('Email / User ID').fill(loginId);
  await page.getByLabel('Password', { exact: true }).fill(pwd);
  await page.getByRole('button', { name: 'Sign In to ERP' }).click();
  const forced = await page.getByRole('textbox', { name: 'Current password', exact: true }).waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
  if (!forced && (await page.getByText(/incorrect/i).first().isVisible().catch(() => false)) && !isOwner) {
    // first ever sign-in: the temporary password is still in force
    await page.getByLabel('Password', { exact: true }).fill(ENV.tempPassword);
    await page.getByRole('button', { name: 'Sign In to ERP' }).click();
    await page.getByRole('textbox', { name: 'Current password', exact: true }).waitFor({ state: 'visible', timeout: 8000 });
    await changePassword(page, ENV.tempPassword, ENV.userPassword);
  } else if (forced) await changePassword(page, isOwner ? ENV.ownerPassword : ENV.tempPassword, ENV.userPassword);
  const all = page.getByRole('button', { name: 'All my plants' });
  if (await all.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
    await all.click();
    const remember = page.getByLabel(/Remember my choice/);
    if (await remember.count()) await remember.check();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await acknowledgePrivacyNoticeIfShown(page);
  await page.locator('.main').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function changePassword(page: Page, current: string, next: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Current password', exact: true }).fill(current);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(next);
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill(next);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/change-password')),
    page.getByRole('button', { name: 'Save New Password' }).click(),
  ]);
}
