// Screenshots of ERP pages after the data has loaded, desktop and phone (env SHOT_IDS=a,b,c  SHOT_USER=owner login id or empty for the owner).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';

const ids = (process.env.SHOT_IDS ?? 'dashboard').split(',').filter(Boolean);
test('shots', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const state = JSON.parse(readFileSync(path.join(__dirname, 'state.json'), 'utf8')) as { ownerId: string };
  await enterAs(page, process.env.SHOT_USER || state.ownerId);
  for (const id of ids) {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/m/${id}`);
      await page.waitForTimeout(4500);
      const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      await page.screenshot({ path: path.resolve(__dirname, `../../../docs/ui-audit/shots/${id}-${w}.png`), fullPage: w === 390 });
      console.log(`SHOT ${id} ${w} sideways=${over}`);
    }
  }
});
