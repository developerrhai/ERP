// Part A step 9: goods receipts against the approved purchase orders (what actually arrived), saved and submitted.
import { expect, test } from '@playwright/test';
import { enter } from './helpers';
import { openAdd, setField } from './forms';
import { attempt } from './log';

test('step 9g: GRNs against purchase orders', async ({ page }) => {
  test.setTimeout(800_000);
  await enter(page);
  for (let i = 0; i < 4; i += 1) {
    await attempt(page, 'A9', `GRN ${i + 1}`, 'scm-grn', async () => {
      const d = await openAdd(page, 'scm-grn', /Receive against PO/);
      const sel = d.getByLabel(/^Purchase order/);
      const opts = await sel.locator('option').allInnerTexts();
      const real = opts.filter((o) => /PO\//.test(o));
      if (real.length === 0) return 'exists';
      await sel.selectOption({ label: real[0]! });
      await page.waitForTimeout(1500);
      await setField(d, 'Warehouse', ['RM', 'Raw Material', 'Main']);
      const nums = d.locator('input[type=number]');
      const n = await nums.count();
      for (let k = 0; k < n; k += 1) {
        const lab = (await nums.nth(k).getAttribute('aria-label')) ?? '';
        const id = (await nums.nth(k).getAttribute('id')) ?? '';
        const text = id ? ((await d.locator(`label[for="${id}"]`).first().innerText().catch(() => '')) || '') : '';
        if (/freight/i.test(lab + text)) continue;
        if ((await nums.nth(k).inputValue()) === '') await nums.nth(k).fill('10');
      }
      await d.getByRole('button', { name: 'Save and submit' }).click();
      // the dialog turns into the receipt view (Pending Approval) instead of closing
      await expect(page.getByRole('dialog').first()).toContainText(/Pending Approval|Approved|Goods receipt GRN/, { timeout: 10000 });
      return 'done';
    });
  }
});
