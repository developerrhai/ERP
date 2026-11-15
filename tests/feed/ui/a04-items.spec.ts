// Part A step 5 (items): HSN master rows first, then the 60 items in batches of 10 - each batch is its own test,
// so it gets a fresh browser context (this PC has little memory; one long context crashed Chromium).
import { expect, test, type Locator } from '@playwright/test';
import { openPage } from '../lib';
import { ITEMS } from './gen';
import { enter } from './helpers';
import { attempt } from './log';

async function setField(scope: Locator, label: string, value: string | string[]): Promise<void> {
  const ctl = scope.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\*|\\(|$)`)).first();
  if ((await ctl.count()) === 0) throw new Error(`field "${label}" not on the form`);
  const tag = await ctl.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    const options = await ctl.locator('option').allInnerTexts();
    const wanted = Array.isArray(value) ? value : [value];
    const hit = wanted.map((w) => options.find((o) => o.trim().toLowerCase() === w.toLowerCase())).find(Boolean)
      ?? wanted.map((w) => options.find((o) => o.trim().toLowerCase().includes(w.toLowerCase()))).find(Boolean)
      ?? options.find((o) => o.trim() && !/^select|^choose|^--|^—/i.test(o.trim()));
    if (!hit) throw new Error(`no option for "${label}"`);
    await ctl.selectOption({ label: hit });
  } else await ctl.fill(String(value));
}

const HSN: [string, string][] = [
  ['720810', 'Flat-rolled iron or steel, hot-rolled'],
  ['850110', 'Electric motors up to 37.5 W'],
  ['848210', 'Ball bearings'],
  ['340319', 'Lubricating preparations'],
];

test('step 5c: HSN master rows', async ({ page }) => {
  test.setTimeout(300_000);
  await enter(page);
  for (const [code, desc] of HSN) {
    await attempt(page, 'A5', `HSN ${code}`, 'tax-hsn', async () => {
      await openPage(page, 'tax-hsn');
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: '＋ Add', exact: true }).click();
      const d = page.getByRole('dialog');
      await setField(d, 'HSN / SAC Code', code);
      await setField(d, 'Description', desc);
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});

const BATCH = 10;
for (let b = 0; b * BATCH < ITEMS.length; b += 1) {
  const slice = ITEMS.slice(b * BATCH, (b + 1) * BATCH);
  test(`step 5d: items batch ${b + 1}`, async ({ page }) => {
    test.setTimeout(600_000);
    await enter(page);
    for (const it of slice) {
      await attempt(page, 'A5', `Item ${it.code} ${it.name}`, 'inv-items', async () => {
        await openPage(page, 'inv-items');
        await page.waitForTimeout(800);
        await page.getByRole('button', { name: '＋ Add', exact: true }).click();
        const d = page.getByRole('dialog');
        await setField(d, 'Plant', ['Talwade']);
        await setField(d, 'Item Name', it.name);
        await setField(d, 'Item Type', [it.type]);
        await setField(d, 'Category', it.category).catch(() => undefined);
        await setField(d, 'HSN SAC', it.hsn);
        await setField(d, 'Base UOM', [it.uom]);
        await setField(d, 'Standard Cost', String(it.cost));
        if (it.price) await setField(d, 'Selling Price', String(it.price));
        await setField(d, 'Reorder Level', String(it.reorder));
        await d.getByRole('button', { name: 'Save Record' }).click();
        await expect(d).toBeHidden({ timeout: 10000 });
        return 'done';
      });
    }
  });
}
