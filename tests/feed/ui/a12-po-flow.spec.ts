// Part A step 9: submit the 6 purchase orders, then every approver in the matrix approves what waits for them.
import { expect, test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';
import { enter } from './helpers';
import { attempt, record } from './log';

test('step 9e: submit the purchase orders', async ({ page }) => {
  test.setTimeout(600_000);
  await enter(page);
  record({ step: 'A9', item: 'finding: PO detail shows raw item id', status: 'finding', page: 'scm-po', note: 'The PO detail drawer shows the ITEM column as a raw UUID (e.g. 9a1b8449-441e-...) instead of the item code and name. P1 TEXT/DATA bug (web: map item id to label).' });
  for (let i = 0; i < 6; i += 1) {
    await attempt(page, 'A9', `Submit PO ${i + 1}`, 'scm-po', async () => {
      await page.goto('/m/scm-po');
      await page.waitForTimeout(2000);
      const row = page.locator('.main tbody tr', { hasText: 'Draft' }).first();
      if ((await row.count()) === 0) return 'exists';
      await row.locator('button').first().click();
      await page.waitForTimeout(1500);
      const scope = page.locator('.drawer.show, [role=dialog]').first();
      await scope.locator('button:text-is("Submit")').click();
      await page.waitForTimeout(1800);
      return 'done';
    });
  }
});

for (const who of ['mgr.purchase.tal', 'head.purchase', 'dir.kulkarni', 'cfo.deshpande']) {
  test(`step 9f: ${who} approves what waits for them`, async ({ page }) => {
    test.setTimeout(600_000);
    await enterAs(page, who);
    let n = 0;
    for (let i = 0; i < 15; i += 1) {
      await page.goto('/approvals');
      await page.waitForTimeout(2200);
      const btn = page.locator('.main button:text-is("Approve")').first();
      if ((await btn.count()) === 0) break;
      await btn.click();
      await page.waitForTimeout(1200);
      const dlg = page.getByRole('dialog').last();
      const ok = dlg.getByRole('button', { name: /^(Approve|Confirm|Yes)/ }).last();
      if (await ok.isVisible().catch(() => false)) await ok.click();
      await page.waitForTimeout(1500);
      n += 1;
    }
    record({ step: 'A9', item: `approvals by ${who}: ${n}`, status: 'finding', page: 'approvals', note: `${who} approved ${n} request(s) waiting for them in the Approval Center.` });
    await expect(page.locator('.main')).toBeVisible();
  });
}
