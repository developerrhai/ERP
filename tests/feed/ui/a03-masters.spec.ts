// Part A step 5: customers, suppliers and items through the real Add forms (as Super User - see DATA-FEED-LOG deviation note).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPage } from '../lib';
import { ITEMS, parties } from './gen';
import { enter } from './helpers';
import { attempt, record } from './log';

/** Sets a control found by its label: select -> option by label (first match of the candidates), checkbox, or text. */
async function setField(scope: Locator, label: string, value: string | string[]): Promise<void> {
  const ctl = scope.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\*|\\(|$)`)).first();
  if ((await ctl.count()) === 0) throw new Error(`field "${label}" not on the form`);
  const tag = await ctl.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    const options = await ctl.locator('option').allInnerTexts();
    const wanted = Array.isArray(value) ? value : [value];
    const hit = wanted.map((w) => options.find((o) => o.trim().toLowerCase() === w.toLowerCase())).find(Boolean)
      ?? wanted.map((w) => options.find((o) => o.trim().toLowerCase().includes(w.toLowerCase()))).find(Boolean)
      ?? options.find((o) => o.trim() && !/^select|^choose|^--/i.test(o.trim()));
    if (!hit) throw new Error(`no option for "${label}"`);
    await ctl.selectOption({ label: hit });
  } else await ctl.fill(String(value));
}

async function addParty(page: Page, pageId: string, addBtn: string, p: { name: string; gstin: string; city: string; mobile: string }): Promise<'done' | 'exists'> {
  await openPage(page, pageId);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: addBtn }).click();
  const d = page.getByRole('dialog');
  await setField(d, 'Name', p.name);
  await setField(d, 'Registration type', ['Regular', 'Registered']);
  await setField(d, 'GSTIN', p.gstin);
  await setField(d, 'City', p.city);
  await setField(d, 'Mobile', p.mobile);
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden({ timeout: 10000 });
  return 'done';
}

test('step 5a: customers and suppliers', async ({ page }) => {
  test.setTimeout(1_500_000);
  await enter(page);
  for (const p of parties('C')) await attempt(page, 'A5', `Customer ${p.name}`, 'crm-customer360', () => addParty(page, 'crm-customer360', '＋ Add Customer', p));
  for (const p of parties('S')) await attempt(page, 'A5', `Supplier ${p.name}`, 'scm-suppliers', () => addParty(page, 'scm-suppliers', '＋ Add Supplier', p));
  record({ step: 'A5', item: 'finding: party forms', status: 'finding', page: 'crm-customer360', note: 'Customer and Supplier forms ask only Name, Registration type, GSTIN, City, Mobile (V40 customer form has address, credit, contacts, bank).' });
});

test('step 5b: items', async ({ page }) => {
  test.setTimeout(2_400_000);
  await enter(page);
  for (const it of ITEMS) {
    await attempt(page, 'A5', `Item ${it.code} ${it.name}`, 'inv-items', async () => {
      await openPage(page, 'inv-items');
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: '＋ Add', exact: true }).click();
      const d = page.getByRole('dialog');
      await setField(d, 'Plant', ['Talwade']);
      await setField(d, 'Item Name', it.name);
      await setField(d, 'Item Type', [it.type]);
      await setField(d, 'Category', it.category).catch(() => undefined);
      await setField(d, 'HSN SAC', it.hsn).catch(() => undefined);
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
