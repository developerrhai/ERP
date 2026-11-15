// Part A step 5 (BOMs) and the release flow that production orders need ("This item has no released bill of materials").
import { expect, test } from '@playwright/test';
import { ITEMS } from './gen';
import { enter } from './helpers';
import { openAdd } from './forms';
import { attempt, record } from './log';

const FG = ITEMS.filter((i) => i.code.startsWith('FG'));
const RM = ITEMS.filter((i) => i.code.startsWith('RM'));

test('step 5f: three BOM drafts', async ({ page }) => {
  test.setTimeout(600_000);
  await enter(page);
  for (let b = 0; b < 3; b += 1) {
    await attempt(page, 'A5', `BOM ${FG[b]!.name}`, 'mfg-bom', async () => {
      const d = await openAdd(page, 'mfg-bom', /New BOM/);
      const pickItem = async (searchIdx: number, selectIdx: number, name: string) => {
        await d.getByPlaceholder('Type to search').nth(searchIdx).fill(name.split(' ')[0]!);
        await page.waitForTimeout(700);
        const sel = d.locator('select:not([aria-label])').nth(selectIdx);
        const opts = await sel.locator('option').allInnerTexts();
        const hit = opts.find((o) => o.includes(name));
        if (!hit) throw new Error(`item "${name}" not offered (${opts.length} options)`);
        await sel.selectOption({ label: hit });
      };
      await pickItem(0, 0, FG[b]!.name);
      for (let c = 0; c < 3; c += 1) {
        if (c >= 1) await d.getByRole('button', { name: /Add component/ }).click();
        await pickItem(1 + c, 1 + c, RM[(b * 3 + c) % RM.length]!.name);
        await d.getByLabel(`Quantity ${c + 1}`).fill(String(1 + c));
      }
      await d.getByRole('button', { name: 'Save draft' }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
  await page.goto('/m/mfg-bom');
  await page.waitForTimeout(2000);
  const rows = await page.locator('.main tbody tr').allInnerTexts();
  const btns = await page.locator('.main tbody button').allInnerTexts();
  record({ step: 'A5', item: 'BOM register after save', status: 'finding', page: 'mfg-bom', note: `rows ${rows.length}: ${rows.slice(0, 3).map((r) => r.replace(/\s+/g, ' ')).join(' || ').slice(0, 220)}; row buttons: ${[...new Set(btns.map((x) => x.trim()))].join(', ')}` });
});
