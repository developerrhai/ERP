// Part A steps 7-8: submit the 6 sales orders (approvers then approve in a14), movement chain to follow.
import { test } from '@playwright/test';
import { enter } from './helpers';
import { attempt, record } from './log';

test('step 7d: submit the sales orders', async ({ page }) => {
  test.setTimeout(700_000);
  await enter(page);
  record({ step: 'A7', item: 'finding: raw item id in document lines', status: 'finding', page: 'sales-orders / scm-po / sales-quotations', note: 'Detail drawers show the ITEM column as a raw UUID. The API line objects carry only itemId; they should also return itemCode and itemName (API owner, Phase 37). The web has no by-id item lookup to work around it.' });
  for (let i = 0; i < 6; i += 1) {
    await attempt(page, 'A7', `Submit sales order ${i + 1}`, 'sales-orders', async () => {
      await page.goto('/m/sales-orders');
      await page.waitForTimeout(2000);
      const row = page.locator('.main tbody tr', { hasText: 'Draft' }).first();
      if ((await row.count()) === 0) return 'exists';
      await row.locator('button').first().click();
      await page.waitForTimeout(1500);
      await page.locator('.drawer.show, [role=dialog]').first().locator('button:text-is("Submit")').click();
      await page.waitForTimeout(2000);
      return 'done';
    });
  }
});
