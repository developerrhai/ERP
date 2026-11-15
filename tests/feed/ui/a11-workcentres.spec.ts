// Part A step 5/10: Finance completes the work centre rates so production orders can be released.
import { expect, test } from '@playwright/test';
import { enter } from './helpers';
import { setField } from './forms';
import { attempt } from './log';

test('step 5k: work centre labour/overhead rates and cost centre', async ({ page }) => {
  test.setTimeout(600_000);
  await enter(page);
  for (const code of ['WC-CNC', 'WC-WND', 'WC-ASM']) {
    await attempt(page, 'A5', `Work centre ${code} rates`, 'mfg-workcenters', async () => {
      await page.goto('/m/mfg-workcenters');
      await page.waitForTimeout(2000);
      const row = page.locator('.main tbody tr', { hasText: code }).first();
      await row.locator('button:text-is("Edit"), button:text-is("Open")').first().click();
      await page.waitForTimeout(1200);
      let d = page.getByRole('dialog').first();
      const edit = d.locator('button:text-is("Edit")');
      if (await edit.count()) {
        await edit.first().click();
        await page.waitForTimeout(800);
        d = page.getByRole('dialog').first();
      }
      await setField(d, 'Labour rate per hour', '180');
      await setField(d, 'Overhead rate per hour', '90');
      await setField(d, 'Cost center', ['']);
      await d.getByRole('button', { name: /^Save/ }).first().click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});
