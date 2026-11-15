// Discovery only: prints the buttons and form labels of the pages the feed will use. No data is written.
import { test } from '@playwright/test';
import { openPage } from '../lib';
import { enter } from './helpers';

const PAGES = (process.env.DISCOVER ?? 'admin-company,admin-branches,admin-departments,admin-users').split(',');
test('discover', async ({ page }) => {
  await enter(page);
  console.log('URL after login:', page.url());
  for (const id of PAGES) {
    await openPage(page, id);
    await page.waitForTimeout(2000);
    const btns = await page.locator('.main button').allInnerTexts();
    console.log(`\n== ${id} buttons:`, btns.map((b) => b.trim()).filter(Boolean).slice(0, 25).join(' | '));
    const add = page.locator('.main button').filter({ hasText: /Add|New|Create|Onboard|Pre-register|Report a/ }).first();
    if (await add.count()) {
      await add.click();
      await page.waitForTimeout(2000);
      const dlg = page.getByRole('dialog').first();
      const scope = (await dlg.count()) ? dlg : page.locator('.main');
      const labels = await scope.locator('label').allInnerTexts();
      console.log(`   form labels:`, labels.map((l) => l.replace(/\s+/g, ' ').trim()).join(' | '));
      const foot = await scope.getByRole('button').allInnerTexts();
      console.log(`   form buttons:`, foot.map((b) => b.trim()).join(' | '));
      await page.keyboard.press('Escape');
    }
  }
});
