// Debug helper: AUDIT_PAGE=<id> AUDIT_W=<px> lists the elements that stick out past the viewport / .main.
import { test } from '@playwright/test';
import { enterAs, ROLE_LOGINS } from './login';

test('probe overflow', async ({ page }) => {
  test.setTimeout(120_000);
  const w = Number(process.env.AUDIT_W ?? 1440);
  await page.setViewportSize({ width: w, height: 900 });
  await enterAs(page, ROLE_LOGINS.super!);
  await page.goto(`/m/${process.env.AUDIT_PAGE ?? 'sales-pricelist'}`);
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const main = document.querySelector('.main') as HTMLElement;
    const info = { docSW: document.documentElement.scrollWidth, innerW: window.innerWidth, mainSW: main.scrollWidth, mainCW: main.clientWidth };
    const bad: string[] = [];
    for (const e of document.querySelectorAll('.main *')) {
      if ((e as HTMLElement).closest('.actionbar')) continue;
      const r = (e as HTMLElement).getBoundingClientRect();
      if (r.right > main.getBoundingClientRect().right + 2 && r.width > 0) bad.push(`${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 40)} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
      if (bad.length > 8) break;
    }
    return { info, bad };
  });
  console.log('PROBE', JSON.stringify(out));
});
