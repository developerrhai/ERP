// Inbox flow through the screens: each department's own head user opens the inbox, walks all 12 views, uses the row buttons, checks a phone width.
import { expect, test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';

const USERS = ['head.sales', 'head.purchase', 'head.warehouse', 'head.quality', 'head.finance'];
const OUT = 'docs/ui-audit/inbox-flow';

for (const u of USERS) {
  test(`inbox as ${u}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    await enterAs(page, u);
    await page.goto('/m/dept-movement-inbox');
    await page.waitForTimeout(2500);
    const main = page.locator('.main');
    const tabs = main.getByRole('tab');
    const n = await tabs.count();
    const seen: string[] = [];
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(700);
      const rows = await main.locator('tbody tr').count();
      const empty = await main.locator('tbody tr', { hasText: /^No |nothing|empty/i }).count();
      seen.push(`${(await tabs.nth(i).innerText()).trim()}=${empty ? 0 : rows}`);
    }
    console.log(u, 'views:', seen.join(' | '));
    await page.screenshot({ path: `${OUT}/${u}-desktop.png`, fullPage: true });
    // act on real rows: Receive then Accept if offered
    for (const [tab, verb] of [['Pending Receipt', /^(Receive|Mark Received|Received)/], ['Pending Acceptance', /^Accept/]] as const) {
      await main.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(1000);
      const b = main.locator('tbody button').filter({ hasText: verb }).first();
      if (await b.count()) {
        await b.click();
        await page.waitForTimeout(1200);
        const ok = page.getByRole('dialog').last().getByRole('button', { name: /^(Receive|Received|Accept|Accepted|Confirm|Yes|Save)/ }).last();
        if (await ok.isVisible().catch(() => false)) await ok.click();
        await page.waitForTimeout(1500);
        console.log(u, tab, 'action clicked');
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForTimeout(2500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    await page.screenshot({ path: `${OUT}/${u}-phone.png` });
    console.log(u, 'phone sideways scroll:', over, 'errors:', errors.length ? errors.join('; ') : 'none');
    expect(over, 'sideways scroll on phone').toBe(false);
    expect(errors, 'page errors').toEqual([]);
  });
}
