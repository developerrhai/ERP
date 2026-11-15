// Part A steps 6 and 13: 40 employees (with valid Aadhaar / PAN shapes), visitors and breakdowns.
import { expect, test } from '@playwright/test';
import { PEOPLE } from './gen';
import { enter } from './helpers';
import { openAdd, setField } from './forms';
import { attempt } from './log';

const BATCH = 10;
for (let b = 0; b * BATCH < PEOPLE.length; b += 1) {
  test(`step 6: employees batch ${b + 1}`, async ({ page }) => {
    test.setTimeout(700_000);
    await enter(page);
    for (const [k, p] of PEOPLE.slice(b * BATCH, (b + 1) * BATCH).entries()) {
      await attempt(page, 'A6', `Employee ${p.first} ${p.last} (${b * BATCH + k + 1})`, 'hr-employees', async () => {
        const d = await openAdd(page, 'hr-employees', /Onboard Employee/);
        await setField(d, 'First Name', p.first);
        await setField(d, 'Last Name', `${p.last}${b * BATCH + k + 1}`);
        await setField(d, 'Gender', [p.gender]);
        await setField(d, 'Unit', [p.plant]);
        await setField(d, 'Department', [p.dept]);
        await setField(d, 'Date of Birth', p.dob);
        await setField(d, 'Date of Joining', p.doj);
        await setField(d, 'Mobile', p.mobile);
        await setField(d, 'Aadhaar', p.aadhaar);
        await setField(d, 'PAN Card', p.pan);
        await d.getByRole('button', { name: /Save & Encrypt Vault/ }).click();
        await expect(d).toBeHidden({ timeout: 12000 });
        return 'done';
      });
    }
  });
}

test('step 13: visitors and breakdowns', async ({ page }) => {
  test.setTimeout(500_000);
  await enter(page);
  for (const [i, v] of [['Ramesh Naik', 'Alfa Metals'], ['Seema Rao', 'Bharat Fabricators'], ['Vijay Kale', 'Everest Precision']].entries()) {
    await attempt(page, 'A13', `Visitor ${v[0]}`, 'ops-visitors', async () => {
      const d = await openAdd(page, 'ops-visitors', /Pre-register/);
      await setField(d, 'Visitor name', v[0]!);
      await setField(d, 'Company', v[1]!);
      await setField(d, 'Mobile', `98${String(20000000 + i * 111111)}`);
      await setField(d, 'Purpose', 'Supplier meeting');
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
  for (const m of ['CNC Lathe CL-20', 'Air Compressor AC-7']) {
    await attempt(page, 'A13', `Breakdown ${m}`, 'maint-breakdown', async () => {
      const d = await openAdd(page, 'maint-breakdown', /Report a breakdown/);
      await setField(d, 'Machine', [m]);
      await setField(d, 'What is wrong', 'Unusual vibration and noise during operation');
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(d).toBeHidden({ timeout: 10000 });
      return 'done';
    });
  }
});
