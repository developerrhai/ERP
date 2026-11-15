import { test } from '@playwright/test';
import { enter } from './helpers';
import { openAdd } from './forms';

test('shot', async ({ page }) => {
  test.setTimeout(90_000);
  page.on('response', (r) => { if (r.url().includes('/customers') || r.url().includes('/lookups')) console.log('NET', r.status(), r.url().replace(/^https?:\/\/[^/]+/, '')); });
  await enter(page);
  const d = await openAdd(page, 'sales-quotations', /New Quotation/);
  const box = d.locator('input[role=combobox]').first();
  await box.click();
  await page.waitForTimeout(800);
  console.log('AFTER CLICK options', await page.getByRole('option').count(), 'listbox', await page.getByRole('listbox').count());
  await box.pressSequentially('Asha', { delay: 80 });
  await page.waitForTimeout(1500);
  console.log('AFTER TYPE options', await page.getByRole('option').count(), 'listbox', await page.getByRole('listbox').count(), 'expanded', await box.getAttribute('aria-expanded'));
});
