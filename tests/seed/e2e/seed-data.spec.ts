import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateRealisticDataset } from '../utils/dataFactory';

const SEED_COUNT = Number(process.env.SEED_COUNT ?? '50');
const HR_COUNT = Number(process.env.HR_COUNT ?? SEED_COUNT);
const CRM_COUNT = Number(process.env.CRM_COUNT ?? SEED_COUNT);
const FINANCE_COUNT = Number(process.env.FINANCE_COUNT ?? SEED_COUNT);
const RUN_STEP4 = process.env.RUN_STEP4 !== '0';
const ERROR_DIR = path.resolve('seed-errors');
const STATE_FILE = path.resolve('seed-errors/last-run-summary.json');

interface FailureRecord {
  module: string;
  row: number;
  reason: string;
  screenshot: string;
}

async function captureRowError(
  page: Page,
  moduleName: string,
  rowIndex: number,
  err: unknown,
  failures: FailureRecord[],
): Promise<void> {
  await fs.mkdir(ERROR_DIR, { recursive: true });
  const reason = (err instanceof Error ? err.message : String(err)).replace(/\u001b\[[0-9;]*m/g, '');
  const file = path.join(ERROR_DIR, `${moduleName}-row-${rowIndex}-${Date.now()}.png`);
  console.error(`[SEED ERROR] module=${moduleName} row=${rowIndex}: ${reason}`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    // Ignore screenshot capture errors if page already closed
  }
  failures.push({ module: moduleName, row: rowIndex, reason, screenshot: file });
}

async function dismissPrivacyIfShown(page: Page): Promise<void> {
  const ackBtn = page.getByRole('button', { name: /I Acknowledge/i });
  try {
    await ackBtn.waitFor({ state: 'visible', timeout: 2_500 });
    await ackBtn.click();
    await expect(ackBtn).toBeHidden({ timeout: 5_000 });
  } catch {
    // Already acknowledged or not triggered for this session
  }
}

async function ensureConcreteUnitSelected(page: Page): Promise<void> {
  const unitSelect = page.getByLabel('Unit', { exact: true });
  await expect(unitSelect).toBeVisible();
  // Wait until units finish loading (not single disabled placeholder "Unit")
  await expect
    .poll(async () => await unitSelect.locator('option').count(), { timeout: 10_000 })
    .toBeGreaterThan(1);

  const currentVal = await unitSelect.inputValue();
  if (!currentVal) {
    // Pick the first non-empty factory unit so Finance journals have a concrete unitId
    const values = await unitSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v.length > 0),
    );
    if (values[0]) {
      await unitSelect.selectOption(values[0]);
      await page.waitForTimeout(300);
    }
  }
}

async function loginAsUser(page: Page, identifier: string, password: string): Promise<void> {
  await page.goto('/login');
  await expect(page.getByLabel('Email / User ID')).toBeVisible();
  await page.getByLabel('Email / User ID').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In to ERP' }).click();

  // Wait for either main app shell or forced first-login password change screen
  await expect(
    page.locator('#main').or(page.getByRole('heading', { name: /Set a new password/i })),
  ).toBeVisible({ timeout: 25_000 });
}

test.describe.serial('RHAI Enterprise ERP - Playwright UI Seeding & RBAC Suite', () => {
  const dataset = generateRealisticDataset(Math.max(HR_COUNT, CRM_COUNT, FINANCE_COUNT, 1));
  const hrRows = dataset.employees.slice(0, HR_COUNT);
  const crmRows = dataset.leads.slice(0, CRM_COUNT);
  const finRows = dataset.vouchers.slice(0, FINANCE_COUNT);
  const failures: FailureRecord[] = [];
  const stats = {
    hrCreated: 0,
    crmCreated: 0,
    financeCreated: 0,
    demoUserCreated: false,
    demoUserLoginId: dataset.demoMember.loginId,
  };

  test('Steps 1-3: Admin Login + Seed HR Employees, CRM Leads, and Finance Journals via UI', async ({
    page,
  }) => {
    const adminId = process.env.ADMIN_EMAIL;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminId || !adminPass) {
      throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before running.');
    }

    // Track alert() dialogs & failed HR employee POSTs without hanging Chromium
    let lastDialogMsg = '';
    page.on('dialog', async (dialog) => {
      lastDialogMsg = dialog.message();
      await dialog.accept();
    });
    let lastHrPostErr = '';
    page.on('response', (res) => {
      if (res.url().includes('/hr/employees') && res.request().method() === 'POST' && res.status() >= 400) {
        lastHrPostErr = `HTTP ${res.status()} from POST /api/v1/hr/employees`;
      }
    });

    await loginAsUser(page, adminId, adminPass);
    await dismissPrivacyIfShown(page);
    await ensureConcreteUnitSelected(page);

    // -------------------------------------------------------------------------
    // MODULE 1: HR -> Employees (/m/hr-employees)
    // -------------------------------------------------------------------------
    if (hrRows.length > 0) {
      await page.goto('/m/hr-employees');
      await expect(page.getByRole('heading', { name: 'Employee Directory' })).toBeVisible();

      for (let i = 0; i < hrRows.length; i++) {
        const emp = hrRows[i]!;
        const modal = page.getByRole('dialog');

        try {
          lastDialogMsg = '';
          lastHrPostErr = '';
          await page.getByRole('button', { name: '+ Onboard Employee' }).click();
          await expect(modal).toBeVisible();

          await modal.getByLabel('First Name *').fill(emp.firstName);
          await modal.getByLabel('Last Name *').fill(emp.lastName);
          await modal.getByLabel('Gender *').selectOption(emp.gender);

          const unitSelect = modal.getByLabel('Unit *');
          if (!(await unitSelect.inputValue())) {
            const firstUnitVal = await unitSelect.locator('option').nth(1).getAttribute('value');
            if (firstUnitVal) await unitSelect.selectOption(firstUnitVal);
          }

          const deptControl = modal.getByLabel('Department *');
          const deptTag = await deptControl.evaluate((el) => el.tagName.toLowerCase());
          if (deptTag === 'select') {
            const deptVal = await deptControl.locator('option').evaluateAll((opts, wanted) => {
              const list = opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v.length > 0);
              return list.find((v) => v === wanted) ?? list[0] ?? '';
            }, emp.department);
            if (deptVal) await deptControl.selectOption(deptVal);
          } else {
            await deptControl.fill(emp.department);
          }

          await modal.getByLabel('Date of Birth *').fill(emp.dateOfBirth);
          await modal.getByLabel('Date of Joining *').fill(emp.dateOfJoining);
          await modal.getByLabel('Mobile (10 digits) *').fill(emp.mobile);
          await modal.getByLabel('Personal Email').fill(emp.personalEmail);
          await modal.getByLabel('Aadhaar (12 digits) *').fill(emp.aadhaar);
          await modal.getByLabel('PAN Card *').fill(emp.pan);

          await modal.getByRole('button', { name: 'Save & Encrypt Vault' }).click();

          await expect
            .poll(
              async () =>
                Boolean(lastDialogMsg) ||
                Boolean(lastHrPostErr) ||
                !(await modal.isVisible().catch(() => false)),
              { timeout: 15_000, intervals: [200] },
            )
            .toBe(true);
          if (lastDialogMsg || lastHrPostErr) {
            throw new Error(
              [lastHrPostErr, lastDialogMsg ? `UI Alert: ${lastDialogMsg}` : '']
                .filter(Boolean)
                .join(' — '),
            );
          }
          stats.hrCreated += 1;
        } catch (err) {
          const msg = lastDialogMsg || lastHrPostErr ? `${lastHrPostErr} ${lastDialogMsg}`.trim() : err;
          await captureRowError(page, 'hr-employee', i + 1, msg, failures);
          if (await modal.isVisible().catch(() => false)) {
            await modal.getByRole('button', { name: 'Cancel' }).click().catch(() => undefined);
          }
        }
        await page.waitForTimeout(500);
      }
      console.log(`[HR SUMMARY] Created ${stats.hrCreated}/${hrRows.length} employees`);
    }

    // -------------------------------------------------------------------------
    // MODULE 2: CRM -> Leads (/m/crm-leads)
    // -------------------------------------------------------------------------
    if (crmRows.length > 0) {
      await page.goto('/m/crm-leads');
      await expect(page.getByRole('heading', { name: 'Lead Management' })).toBeVisible();

      for (let i = 0; i < crmRows.length; i++) {
        const lead = crmRows[i]!;
        const modal = page.getByRole('dialog');

        try {
          await page.getByRole('button', { name: '＋ New Lead' }).click();
          await expect(modal).toBeVisible();

          // DocPage assigns id="f-<key>" and matching htmlFor labels
          await modal.locator('#f-name').fill(lead.name);
          await modal.locator('#f-company').fill(lead.company);
          await modal.locator('#f-mobile').fill(lead.mobile);
          await modal.locator('#f-email').fill(lead.email);
          await modal.locator('#f-interest').fill(lead.interestedIn);
          await modal.locator('#f-estValue').fill(lead.expectedValueInr);

          await modal.getByRole('button', { name: 'Save draft' }).click();
          await expect(modal).toBeHidden({ timeout: 10_000 });
          stats.crmCreated += 1;
        } catch (err) {
          await captureRowError(page, 'crm-lead', i + 1, err, failures);
          if (await modal.isVisible().catch(() => false)) {
            await modal.getByRole('button', { name: 'Cancel' }).click().catch(() => undefined);
          }
        }
        await page.waitForTimeout(500);
      }
      console.log(`[CRM SUMMARY] Created ${stats.crmCreated}/${crmRows.length} leads`);
    }

    // -------------------------------------------------------------------------
    // MODULE 3: Finance -> Journals (/m/fin-journal)
    // -------------------------------------------------------------------------
    if (finRows.length > 0) {
      await page.goto('/m/fin-journal');
      await expect(page.getByRole('heading', { name: 'Journal Entries' })).toBeVisible();

      for (let i = 0; i < finRows.length; i++) {
        const v = finRows[i]!;
        const modal = page.getByRole('dialog');

        try {
          await page.getByRole('button', { name: '＋ New Journal' }).click();
          await expect(modal).toBeVisible();

          await modal.locator('#journal-form input[type="date"]').fill(v.voucherDate);
          await modal.getByLabel('Type', { exact: true }).selectOption(v.voucherType);
          await modal.getByLabel('Narration', { exact: true }).fill(v.narration);

          const acct1 = modal.getByLabel('Line 1 account');
          const acct2 = modal.getByLabel('Line 2 account');
          await expect(acct1.locator('option').nth(2)).toBeAttached({ timeout: 15_000 });
          const val1 = await acct1.locator('option').nth(1).getAttribute('value');
          const val2 = await acct2.locator('option').nth(2).getAttribute('value');
          if (!val1 || !val2) {
            throw new Error('Insufficient postable Chart of Accounts entries to balance journal');
          }

          await acct1.selectOption(val1);
          await modal.getByLabel('Line 1 debit').fill(v.totalAmount);
          await acct2.selectOption(val2);
          await modal.getByLabel('Line 2 credit').fill(v.totalAmount);

          await expect(modal.getByRole('status')).toContainText('Balanced');
          await modal.getByRole('button', { name: 'Save Draft' }).click();
          await expect(modal).toBeHidden({ timeout: 15_000 });
          stats.financeCreated += 1;
        } catch (err) {
          await captureRowError(page, 'finance-journal', i + 1, err, failures);
          if (await modal.isVisible().catch(() => false)) {
            await modal.getByRole('button', { name: 'Cancel' }).click().catch(() => undefined);
          }
        }
        await page.waitForTimeout(500);
      }
      console.log(
        `[FINANCE SUMMARY] Created ${stats.financeCreated}/${finRows.length} balanced journals`,
      );
    }

    // -------------------------------------------------------------------------
    // Pre-step for Step 4: Provision a Demo Member account via User Master UI
    // -------------------------------------------------------------------------
    if (RUN_STEP4) {
      await page.goto('/m/admin-users');
      await expect(page.getByRole('heading', { name: 'User Master' })).toBeVisible();
      await page.getByRole('button', { name: '＋ Add User' }).click();
      const userModal = page.getByRole('dialog');
      await expect(userModal).toBeVisible();

      await userModal.getByLabel('Login ID', { exact: true }).fill(dataset.demoMember.loginId);
      await userModal.getByLabel('Full Name', { exact: true }).fill(dataset.demoMember.fullName);
      await userModal.getByLabel('Email', { exact: true }).fill(dataset.demoMember.email);

      // Select lowest-privilege Employee/Member role available in Role dropdown
      const roleSelect = userModal.getByLabel('Role', { exact: true });
      await expect(roleSelect.locator('option').nth(1)).toBeAttached();
      const roleVal = await roleSelect.locator('option').evaluateAll((opts) => {
        const candidates = opts.map((o) => ({
          val: (o as HTMLOptionElement).value,
          text: (o.textContent ?? '').toUpperCase(),
        }));
        const emp = candidates.find(
          (c) =>
            c.val === 'MEMBER' ||
            c.val === 'EMPLOYEE' ||
            c.text.includes('EMPLOYEE') ||
            c.text.includes('MEMBER'),
        );
        return emp?.val ?? candidates.find((c) => c.val.length > 0 && !c.text.includes('ADMIN'))?.val ?? '';
      });
      if (!roleVal) throw new Error('No assignable role found in User Master modal');
      await roleSelect.selectOption(roleVal);

      const deptSelect = userModal.getByLabel('Department', { exact: true });
      await expect(deptSelect.locator('option').nth(1)).toBeAttached();
      const deptVal = await deptSelect.locator('option').nth(1).getAttribute('value');
      if (deptVal) await deptSelect.selectOption(deptVal);

      // Check first factory unit checkbox if Units fieldset is rendered for non-admin role
      const firstUnitCheckbox = userModal.locator('fieldset.unit-checks input[type="checkbox"]').first();
      if (await firstUnitCheckbox.isVisible().catch(() => false)) {
        await firstUnitCheckbox.check();
      }

      await userModal
        .getByLabel('Temporary Password', { exact: true })
        .fill(dataset.demoMember.tempPassword);
      await userModal.getByRole('button', { name: 'Create User' }).click();
      await expect(userModal).toBeHidden({ timeout: 10_000 });
      stats.demoUserCreated = true;
    }

    await fs.mkdir(ERROR_DIR, { recursive: true });
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify({ stats, failureCount: failures.length, failures }, null, 2),
      'utf8',
    );
  });

  // ===========================================================================
  // STEP 4: Role-Based Member Verification Flow
  // ===========================================================================
  test('Step 4: Logout Admin, sign in as Demo Member, and verify RBAC isolation', async ({
    page,
  }) => {
    test.skip(!RUN_STEP4, 'RUN_STEP4=0 skips member RBAC check');
    const adminId = process.env.ADMIN_EMAIL;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminId || !adminPass) {
      throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
    }

    // Ensure authenticated as Admin first, then perform clean UI Sign Out via Account Drawer
    await loginAsUser(page, adminId, adminPass);
    await dismissPrivacyIfShown(page);

    await page.locator('header button.user').click();
    const signOutBtn = page.getByRole('button', { name: 'Sign Out', exact: true });
    await expect(signOutBtn).toBeVisible();
    // Hidden bottom-right .toast container lacks pointer-events:none in CSS and can intercept
    // mouse coordinates over the drawer footer; activating via keyboard focus + Enter triggers Sign Out cleanly.
    await signOutBtn.focus();
    await signOutBtn.press('Enter');
    await expect(page).toHaveURL(/\/login/);

    // Log in as the newly provisioned Demo Member account
    await loginAsUser(page, dataset.demoMember.loginId, dataset.demoMember.tempPassword);

    // Complete mandatory first-login password change if prompted
    const changePwHeading = page.getByRole('heading', { name: /Set a new password/i });
    if (await changePwHeading.isVisible().catch(() => false)) {
      await page.getByLabel('Current password', { exact: true }).fill(dataset.demoMember.tempPassword);
      await page.getByLabel('New password', { exact: true }).fill(dataset.demoMember.finalPassword);
      await page.getByLabel('Confirm new password', { exact: true }).fill(dataset.demoMember.finalPassword);
      await page.getByRole('button', { name: 'Save New Password' }).click();
      await expect(page.locator('#main')).toBeVisible({ timeout: 15_000 });
    }
    await dismissPrivacyIfShown(page);

    // Navigate to Employee Self-Service (/m/hr-ess)
    await page.goto('/m/hr-ess');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Onboard Employee' })).toHaveCount(0);

    // Negative RBAC check: Admin User Master (/m/admin-users) must deny access to Member role
    await page.goto('/m/admin-users');
    await expect(page.getByText(/Access denied|Available to Super Admin/i)).toBeVisible();
  });
});

