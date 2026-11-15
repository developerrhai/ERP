// Part A step 1 (completed): company profile and the three plants (state, address, GSTIN) through the screens.
// Without a unit state/GSTIN no quotation or invoice can be saved ("Set the state (or GSTIN) of this unit first").
import { expect, test } from '@playwright/test';
import { openPage } from '../lib';
import { gstin, pan } from './gen';
import { enter } from './helpers';
import { attempt, record } from './log';

const UNITS = [
  { match: 'Talwade', address: 'Plot 14, MIDC Talwade', city: 'Pune', pin: '411062', pan: pan(201) },
  { match: 'Sawardari', address: 'Gat 220, Sawardari Road', city: 'Pune', pin: '410501', pan: pan(201) },
  { match: 'Varale', address: 'Survey 88, Varale Village', city: 'Pune', pin: '410507', pan: pan(201) },
];

test('step 1b: company profile and plant details', async ({ page }) => {
  test.setTimeout(500_000);
  await enter(page);

  await attempt(page, 'A1', 'Company profile details', 'admin-company', async () => {
    await openPage(page, 'admin-company');
    await page.waitForTimeout(2000);
    const main = page.locator('.main');
    const set = async (label: string, v: string) => main.getByLabel(new RegExp(`^${label}(\\s|\\*|$)`)).first().fill(v);
    await set('GSTIN', gstin('27', pan(201)));
    await set('PAN', pan(201));
    await set('Registered Address', 'Sawant House, Baner Road');
    await set('City', 'Pune');
    await set('State Code', '27');
    await set('Pincode', '411045');
    await set('Phone', '9822012345');
    await set('Email', 'accounts@sawant-group.example');
    await main.getByRole('button', { name: 'Save Company' }).click();
    await page.waitForTimeout(1500);
    return 'done';
  });

  for (const [i, u] of UNITS.entries()) {
    await attempt(page, 'A1', `Plant details ${u.match}`, 'admin-branches', async () => {
      await openPage(page, 'admin-branches');
      await page.waitForTimeout(2000);
      await expect(page.locator('.main').getByText(u.match, { exact: true }).first()).toBeVisible();
      await page.locator('.main button:text-is("Edit")').nth(i).click();
      const d = page.getByRole('dialog').first();
      const set = async (label: string, v: string) => d.getByLabel(new RegExp(`^${label}(\\s|\\*|$)`)).first().fill(v);
      await set('Address', u.address);
      await set('City', u.city);
      await set('State Code', '27');
      await set('Pincode', u.pin);
      await set('GSTIN', gstin('27', u.pan, String(i + 1)));
      await d.getByRole('button', { name: /Save|Update/ }).first().click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
  record({ step: 'A1', item: 'finding: unit state not set', status: 'finding', page: 'sales-quotations', note: 'Saving a quotation with a plant that has no state/GSTIN gives 422 field "unitId" - but the form has no unit field, so the message "Please fix the highlighted fields" highlights nothing. The error should say which screen to fix (Units) or link to it.' });
});
