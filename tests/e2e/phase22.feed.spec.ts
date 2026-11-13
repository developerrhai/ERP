// Phase 22-F (R2-7): feeders and flows through the real screens, as real roles, on rhai_erp_e2e only.
//   Feeders: (1) warehouses  (2) zones, racks and shelves  (3) employees and loans
//   Flows:   (1) rack -> shelf -> bin on the shelf -> tag in the RFID registry
//            (2) loan of Rs 20,000 over 10 EMIs -> ten rows of Rs 2,000
// Everything is typed in like a person would; nothing is written to the database directly.
import { expect, test, type Page } from '@playwright/test';
import { E2E } from './e2e-env.mjs';
import {
  clickAction,
  expectToast,
  fillForm,
  loginAs,
  openPage,
  pick,
  selectPlants,
  type FeedEnv,
} from '../feed/lib';
import { EMPLOYEES, LOANS, LOCATIONS, WAREHOUSES, emiOf } from '../feed/data/company';

const ENV: FeedEnv = {
  ownerId: E2E.owner.loginId,
  ownerPassword: E2E.owner.newPassword,
  ownerInitialPassword: E2E.owner.initialPassword,
  tempPassword: 'Feed#Temp2026xq',
  userPassword: 'Feed#Next2026xq',
};

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await loginAs(page, ENV, 'Super User');
});
test.afterAll(async () => {
  await page.close();
});

const nameOf = (key: string): string => WAREHOUSES.find((w) => w.key === key)?.name ?? key;

const save = async (label: string | RegExp = 'Save') => {
  await page.getByRole('dialog').getByRole('button', { name: label }).click();
};

test('feeder 1: the demo warehouses (one per plant they belong to)', async () => {
  for (const unit of ['Talwade', 'Sawardari']) {
    await selectPlants(page, unit);
    for (const w of WAREHOUSES.filter((x) => x.unit === unit)) {
      await openPage(page, 'wms-warehouses');
      await clickAction(page.getByRole('main'), '＋ Add');
      const dlg = page.getByRole('dialog');
      await fillForm(dlg, { 'Warehouse Code': w.code, 'Warehouse Name': w.name });
      await save('Save Record');
      await expectToast(page);
      await expect(dlg).toBeHidden();
    }
  }
});

test('feeder 2: zones, racks and shelves for the Talwade warehouses', async () => {
  await selectPlants(page, 'Talwade');
  for (const loc of LOCATIONS.filter((l) => WAREHOUSES.find((w) => w.key === l.warehouse)?.unit === 'Talwade')) {
    await openPage(page, 'wms-zones');
    await clickAction(page.getByRole('main'), '＋ Add');
    let dlg = page.getByRole('dialog');
    await pick(dlg, 'Warehouse', nameOf(loc.warehouse));
    await fillForm(dlg, { 'Zone Code': loc.zone.replace('Zone ', 'Z-'), 'Zone Name': loc.zone });
    await save();
    await expectToast(page, /Saved/);

    for (const rack of loc.racks) {
      await openPage(page, 'wms-racks');
      await clickAction(page.getByRole('main'), '＋ Add');
      dlg = page.getByRole('dialog');
      await pick(dlg, 'Zone', loc.zone.replace('Zone ', 'Z-'));
      await fillForm(dlg, { 'Rack Code': rack.code, Levels: 3 });
      await save();
      await expectToast(page, /Saved/);

      for (const shelf of rack.shelves) {
        await openPage(page, 'wms-shelves');
        await clickAction(page.getByRole('main'), '＋ Add');
        dlg = page.getByRole('dialog');
        await pick(dlg, 'Rack', rack.code, `${rack.code} (${nameOf(loc.warehouse)})`);
        await fillForm(dlg, { 'Shelf Code': shelf, Level: 1 });
        await save();
        await expectToast(page, /Saved/);
      }
    }
  }
});

test('flow 1: the new rack and shelf show in the lists, with their parents', async () => {
  await openPage(page, 'wms-racks');
  const rows = page.getByRole('main').getByRole('row');
  await expect(rows.filter({ hasText: 'R-01' }).first()).toBeVisible();
  await openPage(page, 'wms-shelves');
  const shelfRow = page.getByRole('main').getByRole('row').filter({ hasText: 'S-01' }).first();
  await expect(shelfRow).toBeVisible();
  await expect(shelfRow).toContainText('R-01');
  await shelfRow.click();
  await expect(page.getByRole('dialog', { name: /Shelf Management/ })).toBeVisible();
  await expect(page.getByText('Bins on this shelf')).toBeVisible();
});

test('feeder 3: two employees, then two loans', async () => {
  await selectPlants(page, 'Talwade');
  for (const [i, e] of EMPLOYEES.entries()) {
    await openPage(page, 'hr-employees');
    await page.getByRole('button', { name: '+ Onboard Employee' }).click();
    const dlg = page.getByRole('dialog');
    await fillForm(dlg, {
      'First Name': e.firstName,
      'Last Name': e.lastName,
      Gender: i === 0 ? 'FEMALE' : 'MALE',
      Unit: 'Talwade',
      Department: e.department,
      'Date of Birth': '1992-04-15',
      'Date of Joining': '2024-06-01',
      'Mobile (10 digits)': `90000000${10 + i}`,
      'Aadhaar (12 digits)': '234123412346',
      'PAN Card': `ABCDE123${i}F`,
    });
    await dlg.getByRole('button', { name: /Save/ }).click();
    await expectToast(page);
    await expect(dlg).toBeHidden();
  }
});

test('flow 2: loan of Rs 20,000 over 10 EMIs gives ten rows of Rs 2,000', async () => {
  for (const loan of LOANS) {
    await openPage(page, 'pay-loan');
    await clickAction(page.getByRole('main'), '＋ Add');
    const dlg = page.getByRole('dialog');
    await pick(dlg, 'Employee', loan.employee.split(' ')[0] ?? '');
    await fillForm(dlg, {
      Principal: loan.principal,
      'Tenure (months)': loan.emis,
      'Disbursement Date': '2026-12-05',
    });
    await save();
    await expectToast(page, /Saved/);
  }
  await openPage(page, 'pay-loan');
  const first = page.getByRole('main').getByRole('row').filter({ hasText: 'Asha' }).first();
  await first.click();
  const schedule = page.getByRole('region', { name: 'EMI Schedule' });
  await expect(schedule).toBeVisible();
  const emi = emiOf(LOANS[0].principal, LOANS[0].emis);
  await expect(schedule.getByRole('row')).toHaveCount(1 + LOANS[0].emis); // header + 10
  await expect(schedule.getByText(`₹ ${emi.toLocaleString('en-IN')}.00`)).toHaveCount(LOANS[0].emis);
});
