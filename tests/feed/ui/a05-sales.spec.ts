// Part A step 7: 10 enquiries -> 8 quotations -> 6 sales orders (multi-line, across plants), through the real forms.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPage } from '../lib';
import { parties, ITEMS } from './gen';
import { enter } from './helpers';
import { attempt, record } from './log';

const CUSTOMERS = parties('C');
const FG = ITEMS.filter((i) => i.code.startsWith('FG'));

function ctl(scope: Locator, label: string, nth = 0): Locator {
  return scope.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\*|\\(|$)`)).nth(nth);
}
/** Type-ahead picker (Phase 36 Combobox): the n-th combobox on the form - type, then click the matching option. */
async function pickCombo(d: Locator, n: number, text: string): Promise<void> {
  const box = d.locator('input[role=combobox]').nth(n);
  await box.click();
  await box.pressSequentially(text.split(' ')[0] ?? text, { delay: 60 }); // type like a person, then pick
  const opt = d.page().getByRole('option').filter({ hasText: text }).first();
  await opt.waitFor({ state: 'visible', timeout: 10000 });
  await opt.click();
}

/** Line controls are reached by the label's place in the page: the 2nd+ line's labels are NOT linked to their inputs (A11Y finding). */
function lineCtl(d: Locator, label: string, i: number, tag: 'select' | 'input'): Locator {
  return d.locator('label', { hasText: new RegExp(`^${label}`) }).nth(i).locator(`xpath=following::${tag}[1]`);
}

async function fillLines(d: Locator, n: number, seed: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    if (i > 0) await d.getByRole('button', { name: /Add line/ }).click();
    await d.page().waitForTimeout(400);
    await pickCombo(d, 1 + i, FG[(seed + i * 3) % FG.length]!.name);
    await lineCtl(d, 'Quantity', i, 'input').fill(String(5 + ((seed + i) % 6) * 5));
    await lineCtl(d, 'GST %', i, 'input').fill('18');
  }
}

async function openForm(page: Page, pageId: string, add: string): Promise<Locator> {
  await openPage(page, pageId);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: add }).click();
  return page.getByRole('dialog').first();
}

test('step 7a: enquiries', async ({ page }) => {
  test.setTimeout(500_000);
  await enter(page);
  for (let i = 0; i < 10; i += 1) {
    await attempt(page, 'A7', `Enquiry ${i + 1} ${CUSTOMERS[i]!.name}`, 'sales-enquiries', async () => {
      const d = await openForm(page, 'sales-enquiries', '＋ Add');
      await ctl(d, 'Customer or prospect name').fill(CUSTOMERS[i]!.name);
      await ctl(d, 'Product').fill(FG[i % FG.length]!.name);
      await ctl(d, 'Quantity').fill(String(10 + i * 5));
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
  record({ step: 'A7', item: 'finding: enquiry form', status: 'finding', page: 'sales-enquiries', note: 'Enquiry form has only name, product, quantity (V40 enquiry has contact, source, due date, notes).' });
});

test('step 7b: quotations', async ({ page }) => {
  test.setTimeout(700_000);
  await enter(page);
  for (let i = 0; i < (process.env.FEED_ONE ? 1 : 8); i += 1) {
    await attempt(page, 'A7', `Quotation ${i + 1} ${CUSTOMERS[i]!.name}`, 'sales-quotations', async () => {
      const d = await openForm(page, 'sales-quotations', '＋ New Quotation');
      await pickCombo(d, 0, CUSTOMERS[i]!.name);
      await ctl(d, 'Valid until').fill('2026-12-31');
      await fillLines(d, 1 + (i % 3), i);
      await d.getByRole('button', { name: 'Save draft' }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
  record({ step: 'A7', item: 'finding: GST rate missing', status: 'finding', page: 'tax-hsn / sales-quotations', note: 'HSN master form has no GST rate field, so a quotation line fails with "Enter the GST rate: no rate is set for HSN/SAC ..." until the user types GST % on every line. The GST rate table should be set up with the HSN (or the line should auto-fill it).' });
  record({ step: 'A7', item: 'finding: line labels', status: 'finding', page: 'sales-quotations / sales-orders', note: 'In the line grid the 2nd and later lines have labels that are not linked to their inputs (duplicate ids) - screen readers and getByLabel only see line 1; the grid also repeats a header row AND a label in every cell.' });
  record({ step: 'A7', item: 'finding: quotation form', status: 'finding', page: 'sales-quotations', note: 'Customer is a plain full-list dropdown (no type-ahead); Valid until is a browser date box showing mm/dd/yyyy (V40/R: dd-mm-yyyy); the line grid repeats column headers inside every cell and is clipped at the right edge; no totals panel (Taxable/CGST/SGST/Grand Total); saves only as draft.' });
});

test('step 7c: sales orders', async ({ page }) => {
  test.setTimeout(700_000);
  await enter(page);
  for (let i = 0; i < 6; i += 1) {
    await attempt(page, 'A7', `Sales order ${i + 1} ${CUSTOMERS[i]!.name}`, 'sales-orders', async () => {
      const d = await openForm(page, 'sales-orders', '＋ New Sales Order');
      await pickCombo(d, 0, CUSTOMERS[i]!.name);
      await ctl(d, 'Customer PO number').fill(`PO-${2026}-${String(100 + i)}`);
      await ctl(d, 'Customer PO date').fill('2026-11-02');
      await ctl(d, 'Deliver by').fill('2026-12-15');
      await fillLines(d, 2 + (i % 2), i + 2);
      await d.getByRole('button', { name: 'Save draft' }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});
