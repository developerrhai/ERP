// Every approver in the matrix approves what waits for them in the Approval Center (run after documents are submitted).
import { expect, test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';
import { record } from './log';

const WHO = (process.env.APPROVERS ?? 'mgr.stores.tal,head.warehouse,mgr.purchase.tal,head.purchase,mgr.sales.tal,head.sales,mgr.production.saw,head.production,mgr.quality.tal,head.quality,mgr.finance,head.finance,cfo.deshpande,dir.kulkarni,gm.patil').split(',');

for (const who of WHO) {
  test(`approve-all ${who}`, async ({ page }) => {
    test.setTimeout(600_000);
    await enterAs(page, who);
    let n = 0;
    for (let i = 0; i < 20; i += 1) {
      await page.goto('/approvals');
      await page.waitForTimeout(2200);
      const btn = page.locator('.main button:text-is("Approve")').first();
      if ((await btn.count()) === 0) break;
      await btn.click();
      await page.waitForTimeout(1200);
      const ok = page.getByRole('dialog').last().getByRole('button', { name: /^(Approve|Confirm|Yes)/ }).last();
      if (await ok.isVisible().catch(() => false)) await ok.click();
      await page.waitForTimeout(1500);
      n += 1;
    }
    if (n > 0) record({ step: 'A9', item: `approvals by ${who}: ${n}`, status: 'finding', page: 'approvals', note: `${who} approved ${n} request(s) in the Approval Center.` });
    await expect(page.locator('.main')).toBeVisible();
  });
}
