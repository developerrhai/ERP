// Part A step 9 (approvals): suppliers are submitted for approval and approved in the Approval Center before a PO can use them.
import { expect, test } from '@playwright/test';
import { enter } from './helpers';
import { enterAs } from '../../ui-audit/login';
import { attempt, record } from './log';

test('step 9c: submit 8 suppliers for approval', async ({ page }) => {
  test.setTimeout(500_000);
  await enter(page);
  await attempt(page, 'A9', 'Submit suppliers for approval', 'scm-suppliers', async () => {
    let sent = 0;
    await page.goto('/m/scm-suppliers');
    await page.waitForTimeout(2000);
    for (let n = 1; n <= 8; n += 1) {
      const code = `SUP/${String(n).padStart(5, '0')}`;
      const btn = page.getByRole('button', { name: `Submit ${code} for approval` });
      if ((await btn.count()) === 0) continue;
      await btn.click();
      await page.waitForTimeout(1300);
      const toast = (await page.locator('.toast.show, [role="status"]').allInnerTexts()).join(' / ').replace(/\s+/g, ' ');
      if (/sent for approval/i.test(toast)) sent += 1;
    }
    record({ step: 'A9', item: 'finding: submit button on pending suppliers', status: 'finding', page: 'scm-suppliers', note: 'The row keeps showing "Submit for Approval" after the supplier is already pending; pressing it answers "Already pending approval". The button should be hidden or greyed with that reason.' });
    record({ step: 'A9', item: `suppliers submitted: ${sent}`, status: 'finding', page: 'scm-suppliers', note: 'Each supplier has its own Submit for Approval button; there is no bulk submit.' });
    return sent > 0 ? 'done' : 'exists';
  });
});

test('step 9d: the Purchase Manager (the matrix approver) approves them in the Approval Center', async ({ page }) => {
  test.setTimeout(700_000);
  await enterAs(page, 'mgr.purchase.tal');
  await page.goto('/approvals');
  await page.waitForTimeout(3000);
  const main = page.locator('.main');
  console.log('APPROVALS BUTTONS', (await main.locator('button').allInnerTexts()).map((b) => b.trim()).filter(Boolean).slice(0, 30).join(' | '));
  console.log('APPROVALS TEXT', (await main.innerText()).replace(/\s+/g, ' ').slice(0, 400));
  await page.screenshot({ path: 'tests/feed/ui/.artifacts/approvals.png' });
  let approved = 0;
  for (let i = 0; i < 12; i += 1) {
    const row = main.locator('tbody tr').first();
    if ((await row.count()) === 0 || (await main.locator('button:text-is("Approve")').count()) === 0) break;
    const ok = await attempt(page, 'A9', `Approve item ${i + 1}`, 'approvals', async () => {
      void row;
      const approve = main.locator('button:text-is("Approve")').first();
      await expect(approve).toBeVisible({ timeout: 8000 });
      await approve.click();
      const confirm = page.getByRole('dialog').getByRole('button', { name: /Approve|Confirm|Yes/ }).first();
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await page.waitForTimeout(1500);
      return 'done';
    });
    if (!ok) break;
    approved += 1;
  }
  record({ step: 'A9', item: `approvals approved: ${approved}`, status: 'finding', page: 'approvals', note: 'Approved in the Approval Center as the Purchase Department Manager (level 1 of the matrix).' });
});
