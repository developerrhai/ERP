// Part A step 8: three sales orders move forward through departments: Move Forward -> Received -> Accepted. One is returned.
import { expect, test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';
import { enter } from './helpers';
import { attempt, record } from './log';

const TARGETS = [
  { dept: 'Purchase', user: 'head.purchase' },
  { dept: 'Production', user: 'head.production' },
  { dept: 'Warehouse', user: 'head.warehouse' },
];

test('step 8a: Move Forward from Sales', async ({ page }) => {
  test.setTimeout(700_000);
  await enter(page);
  for (const [i, t] of TARGETS.entries()) {
    await attempt(page, 'A8', `Move sales order ${i + 1} to ${t.dept}`, 'sales-orders', async () => {
      await page.goto('/m/sales-orders');
      await page.waitForTimeout(2000);
      await page.locator('.main tbody tr').nth(i).locator('button').first().click();
      await page.waitForTimeout(1500);
      await page.locator('.drawer.show, [role=dialog]').first().locator('button:text-is("Move Forward")').click();
      await page.waitForTimeout(1500);
      const d = page.getByRole('dialog').last();
      await d.locator('#mf-to').selectOption({ label: t.dept });
      await d.locator('#mf-prio').selectOption({ label: 'High' }).catch(() => undefined);
      await d.getByLabel(/Short Handover Note/).fill(`Please start work on this order (${t.dept})`).catch(() => undefined);
      await d.getByRole('button', { name: 'Move Forward' }).click();
      await page.waitForTimeout(2000);
      return 'done';
    });
  }
});

for (const t of TARGETS) {
  test(`step 8b: ${t.dept} receives and accepts`, async ({ page }) => {
    test.setTimeout(500_000);
    await enterAs(page, t.user);
    await page.goto('/m/dept-inbox');
    await page.waitForTimeout(3000);
    const main = page.locator('.main');
    console.log('INBOX BTNS', t.dept, [...new Set((await main.locator('button').allInnerTexts()).map((b) => b.trim()).filter(Boolean))].join(' | '));
    for (const verb of ['Received', 'Accepted']) {
      await attempt(page, 'A8', `${t.dept} marks ${verb}`, 'dept-inbox', async () => {
        if (verb === 'Accepted') {
          await main.locator('button:text-is("To Accept")').click();
          await page.waitForTimeout(1500);
        }
        const btn = verb === 'Accepted' ? main.locator('tbody button').filter({ hasText: /^Accept/ }).first() : main.locator(`button:text-is("${verb}"), button:text-is("Mark ${verb}")`).first();
        await expect(btn).toBeVisible({ timeout: 8000 });
        await btn.click();
        await page.waitForTimeout(1800);
        const ok = page.getByRole('dialog').last().getByRole('button', { name: new RegExp(`^(${verb}|Confirm|Yes|Save)`) }).last();
        if (await ok.isVisible().catch(() => false)) await ok.click();
        await page.waitForTimeout(1500);
        return 'done';
      });
    }
    record({ step: 'A8', item: `finding: inbox ${t.dept}`, status: 'finding', page: 'dept-inbox', note: 'Department Inbox opened as the department head; see attempt rows above for Received / Accepted.' });
  });
}
