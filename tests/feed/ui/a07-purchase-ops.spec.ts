// Part A steps 5/9/10/13 (part): purchase requisitions and orders, work centres, tasks, assets, production orders.
// Everything is typed into the real forms as Super User (deviation from "right role": see DATA-FEED-LOG).
import { expect, test } from '@playwright/test';
import { ITEMS, parties } from './gen';
import { enter } from './helpers';
import { openAdd, pickCombo, setField } from './forms';
import { attempt } from './log';

const RM = ITEMS.filter((i) => i.code.startsWith('RM'));
const SUP = parties('S');
const future = (days: number) => new Date(Date.UTC(2026, 11, 1 + days)).toISOString().slice(0, 10);

test('step 9a: purchase requisitions', async ({ page }) => {
  test.setTimeout(700_000);
  await enter(page);
  for (let i = 0; i < 5; i += 1) {
    await attempt(page, 'A9', `PR ${i + 1}`, 'scm-pr', async () => {
      const d = await openAdd(page, 'scm-pr', /New Requisition/);
      await setField(d, 'Needed by', future(10 + i), 0).catch(() => undefined);
      await setField(d, 'Purpose', `Feed requisition ${i + 1}`).catch(() => undefined);
      for (let l = 0; l < 1 + (i % 2); l += 1) {
        if (l > 0) await d.getByRole('button', { name: /Add line/ }).click();
        await pickCombo(d, l, RM[(i * 2 + l) % RM.length]!.name);
        await setField(d, 'Quantity', String(20 + i * 10), l);
      }
      await d.getByRole('button', { name: /Save draft/ }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});

test('step 9b: purchase orders', async ({ page }) => {
  test.setTimeout(900_000);
  await enter(page);
  for (let i = 0; i < 6; i += 1) {
    await attempt(page, 'A9', `PO ${i + 1} ${SUP[i]!.name}`, 'scm-po', async () => {
      const d = await openAdd(page, 'scm-po', /New Purchase Order/);
      await pickCombo(d, 0, SUP[i]!.name);
      for (let l = 0; l < 1 + (i % 3); l += 1) {
        if (l > 0) await d.getByRole('button', { name: /Add line/ }).click();
        await pickCombo(d, 1 + l, RM[(i + l * 2) % RM.length]!.name);
        await setField(d, 'Quantity', String(50 + i * 25), l);
        await setField(d, 'Rate', String(90 + i * 7 + l * 5), l);
        await setField(d, 'GST %', '18', l);
      }
      await d.getByRole('button', { name: /Save draft/ }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});

test('step 5b: work centres, step 13: tasks and assets', async ({ page }) => {
  test.setTimeout(900_000);
  await enter(page);
  const WC = [['WC-CNC', 'CNC Machining Cell'], ['WC-WND', 'Winding Section'], ['WC-ASM', 'Final Assembly Line']];
  for (const [code, name] of WC) {
    await attempt(page, 'A5', `Work centre ${code}`, 'mfg-workcenters', async () => {
      const d = await openAdd(page, 'mfg-workcenters', /New work center/);
      await setField(d, 'Code', code!);
      await setField(d, 'Name', name!);
      await setField(d, 'Shifts per day', '2').catch(() => undefined);
      await setField(d, 'Hours per shift', '8').catch(() => undefined);
      await setField(d, 'Labour rate per hour', '180').catch(() => undefined);
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
  const TASKS = ['Calibrate torque wrench', 'Review supplier audit report', 'Update safety signage', 'Prepare month-end stock count', 'Train operators on new fixture', 'Close open customer complaints'];
  for (const [i, t] of TASKS.entries()) {
    await attempt(page, 'A13', `Task ${t}`, 'ops-tasks', async () => {
      const d = await openAdd(page, 'ops-tasks', /^＋ Add$/);
      await setField(d, 'Task', t);
      await setField(d, 'Department', ['Production', 'Quality', 'Maintenance', 'Warehouse', 'HR', 'Sales'][i]!);
      await setField(d, 'Due date', future(5 + i)).catch(() => undefined);
      const prio = ['Medium', 'High'][i % 2]!;
      const radio = d.getByRole('radio', { name: prio });
      if (await radio.count()) await radio.check();
      else await d.getByText(prio, { exact: true }).first().click().catch(() => undefined);
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
  const ASSETS = ['CNC Lathe CL-20', 'Winding Machine WM-3', 'Air Compressor AC-7', 'Forklift FL-2'];
  for (const a of ASSETS) {
    await attempt(page, 'A13', `Asset ${a}`, 'asset-master', async () => {
      const d = await openAdd(page, 'asset-master', /New asset/);
      await setField(d, 'Name', a);
      await setField(d, 'Category', ['Machinery', 'Plant']);
      await setField(d, 'Location', 'Talwade plant').catch(() => undefined);
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});

test('step 5e: warehouses (Talwade stores)', async ({ page }) => {
  test.setTimeout(400_000);
  await enter(page);
  for (const [code, name] of [['TAL-FG', 'Talwade Finished Goods Store'], ['TAL-RM', 'Talwade Raw Material Store'], ['TAL-SP', 'Talwade Spares Store']]) {
    await attempt(page, 'A5', `Warehouse ${code}`, 'wms-warehouses', async () => {
      const d = await openAdd(page, 'wms-warehouses', /^＋ Add$/);
      await setField(d, 'Plant', ['Talwade']);
      await setField(d, 'Warehouse Code', code!);
      await setField(d, 'Warehouse Name', name!);
      await d.getByRole('button', { name: 'Save Record' }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});

test('step 10: production orders', async ({ page }) => {
  test.setTimeout(600_000);
  await enter(page);
  const FG = ITEMS.filter((i) => i.code.startsWith('FG'));
  for (let i = 0; i < 3; i += 1) {
    await attempt(page, 'A10', `Production order ${i + 1} ${FG[i]!.name}`, 'mfg-orders', async () => {
      await page.goto('/m/mfg-orders');
      await page.waitForTimeout(1800);
      if ((await page.locator('.main tbody tr', { hasText: FG[i]!.name }).count()) > 0) return 'exists';
      const d = await openAdd(page, 'mfg-orders', /New production order/);
      await pickCombo(d, 0, FG[i]!.name).catch(async () => setField(d, 'Item to make', [FG[i]!.name]));
      await setField(d, 'Quantity', String(10 + i * 5));
      await setField(d, 'Due date', future(20 + i * 3));
      await setField(d, 'Finished goods store', ['']);
      await setField(d, 'Raw material store', ['']);
      await d.getByRole('button', { name: 'Create', exact: true }).click();
      // the dialog turns into the new order's panel (status Planned) instead of closing
      await expect(page.getByRole('dialog').first()).toContainText('Planned', { timeout: 10000 });
      return 'done';
    });
  }
});

test('step 10b: release the production orders (job cards are made on release)', async ({ page }) => {
  test.setTimeout(500_000);
  await enter(page);
  for (let i = 0; i < 3; i += 1) {
    await attempt(page, 'A10', `Release production order ${i + 1}`, 'mfg-orders', async () => {
      await page.goto('/m/mfg-orders');
      await page.waitForTimeout(1800);
      const row = page.locator('.main tbody tr', { hasText: 'Planned' }).first();
      if ((await row.count()) === 0) return 'exists';
      await row.locator('button:text-is("Open")').click();
      const dlg = page.getByRole('dialog').first();
      await dlg.locator('button:text-is("Release")').click();
      await page.waitForTimeout(2000);
      await expect(dlg).toContainText(/Released|In progress|Job cards/, { timeout: 8000 });
      return 'done';
    });
  }
});
