// Part A step 5/10: send the 3 BOM drafts for approval, then approve and release them as the people the matrix names.
import { expect, test } from '@playwright/test';
import { enterAs } from '../../ui-audit/login';
import { enter } from './helpers';
import { attempt, record } from './log';

test('step 5g: send BOMs for approval and read who must approve', async ({ page }) => {
  test.setTimeout(500_000);
  await enter(page);
  for (let i = 0; i < 3; i += 1) {
    await attempt(page, 'A5', `BOM ${i + 1} send for approval`, 'mfg-bom', async () => {
      await page.goto('/m/mfg-bom');
      await page.waitForTimeout(2000);
      await page.locator('.main tbody tr', { hasText: 'DRAFT' }).first().locator('button:text-is("Open")').click();
      await page.waitForTimeout(1500);
      const scope = page.locator('.drawer.show, [role=dialog]').first();
      await scope.locator('button:text-is("Send for approval")').click();
      await page.waitForTimeout(1500);
      const dlg = page.getByRole('dialog').last();
      const go = dlg.getByRole('button', { name: /Send|Submit|Confirm/ }).last();
      if (await go.isVisible().catch(() => false)) await go.click();
      await page.waitForTimeout(1500);
      return 'done';
    });
  }
  await page.goto('/approvals');
  await page.waitForTimeout(2500);
  await page.locator('.main button').filter({ hasText: 'All (in my scope)' }).click();
  await page.waitForTimeout(2000);
  const rows = (await page.locator('.main tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, ' '));
  record({ step: 'A5', item: 'finding: BOM approval routing', status: 'finding', page: 'approvals', note: rows.filter((r) => /BOM/.test(r)).slice(0, 3).join(' || ').slice(0, 400) || 'no BOM request visible' });
  await expect(page.locator('.main')).toBeVisible();
});

test('step 5h: release the BOMs', async ({ page }) => {
  test.setTimeout(500_000);
  await enter(page);
  for (let i = 0; i < 3; i += 1) {
    await attempt(page, 'A5', `BOM ${i + 1} release`, 'mfg-bom', async () => {
      await page.goto('/m/mfg-bom');
      await page.waitForTimeout(2000);
      await page.locator('.main tbody tr', { hasText: 'PENDING' }).first().locator('button:text-is("Open")').click();
      await page.waitForTimeout(1500);
      const scope = page.locator('.drawer.show, [role=dialog]').first();
      console.log('BOMBTNS', (await scope.locator('button').allInnerTexts()).map((b) => b.trim()).filter(Boolean).join(' | '));
      await scope.locator('button:text-is("Release")').click();
      await page.waitForTimeout(1200);
      const dlg = page.getByRole('dialog').last();
      const go = dlg.getByRole('button', { name: /Release|Approve|Confirm|Yes/ }).last();
      if (await go.isVisible().catch(() => false)) await go.click();
      await page.waitForTimeout(1500);
      return 'done';
    });
  }
});

import { ITEMS } from './gen';
import { openAdd } from './forms';

const FGI = ITEMS.filter((i) => i.code.startsWith('FG'));

test('step 5i: three routings', async ({ page }) => {
  test.setTimeout(600_000);
  await enter(page);
  for (let r = 0; r < 3; r += 1) {
    await attempt(page, 'A5', `Routing ${FGI[r]!.name}`, 'mfg-routing', async () => {
      const d = await openAdd(page, 'mfg-routing', /New routing/);
      await d.getByPlaceholder('Type to search').first().fill(FGI[r]!.name.split(' ')[0]!);
      await page.waitForTimeout(700);
      const itemSel = d.locator('select').first();
      const opts = await itemSel.locator('option').allInnerTexts();
      const hit = opts.find((o) => o.includes(FGI[r]!.name));
      if (!hit) throw new Error(`item "${FGI[r]!.name}" not offered`);
      await itemSel.selectOption({ label: hit });
      const ops = [['Winding', 1], ['Final assembly', 2]] as const;
      for (const [k, [name]] of ops.entries()) {
        if (k >= 1) await d.getByRole('button', { name: /Add operation/ }).click();
        await d.getByLabel(`Operation name ${k + 1}`).fill(name);
        const wc = d.locator('select').nth(1 + k);
        const wopts = await wc.locator('option').allInnerTexts();
        const w = wopts.find((o) => /WC-/.test(o)) ?? wopts.find((o) => o.trim() && !/choose/i.test(o));
        if (w) await wc.selectOption({ label: w });
        await d.getByLabel(`runMinutes ${k + 1}`).fill(String(10 + k * 5));
        await d.getByLabel(`setupMinutes ${k + 1}`).fill('15');
      }
      await d.getByRole('button', { name: 'Save draft' }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});

test('step 5j: release the routings (a routing releases straight from draft)', async ({ page }) => {
  test.setTimeout(700_000);
  await enter(page);
  for (let i = 0; i < 3; i += 1) {
    await attempt(page, 'A5', `Routing ${i + 1} release`, 'mfg-routing', async () => {
      await page.goto('/m/mfg-routing');
      await page.waitForTimeout(2000);
      const row = page.locator('.main tbody tr', { hasText: /DRAFT|Draft/ }).first();
      if ((await row.count()) === 0) return 'exists';
      await row.locator('button:text-is("Open")').click();
      await page.waitForTimeout(1500);
      await page.locator('.drawer.show, [role=dialog]').first().locator('button:text-is("Release")').click();
      await page.waitForTimeout(1800);
      return 'done';
    });
  }
});
