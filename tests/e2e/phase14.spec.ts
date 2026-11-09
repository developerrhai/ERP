// Why: browser smoke test of the Phase 14 pages: each of the 18 pages opens for the owner through the real Vite -> API -> PostgreSQL chain.
// The rules and the numbers (capitalisation, depreciation, disposal, PM plans, breakdowns, MTBF) are proved by apps/api/tests/phase14-assets.test.ts.
import { test, expect, type Page } from "@playwright/test";
import { E2E } from "./e2e-env.mjs";

const OWNER_PW = E2E.owner.newPassword;
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, id: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email / User ID").fill(id);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/login")),
    page.getByRole("button", { name: "Sign In to ERP" }).click(),
  ]);
}

async function selectUnit(page: Page, label: string) {
  const unit = page.getByLabel("Unit", { exact: true });
  await expect(unit.locator("option", { hasText: label })).toHaveCount(1);
  if ((await unit.locator("option:checked").innerText()).trim() === label)
    return;
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/me/context") &&
        r.request().method() === "PUT" &&
        r.ok(),
    ),
    unit.selectOption({ label }),
  ]);
}

const PAGES: [string, RegExp][] = [
  ["maint-machines", /Machine Master/],
  ["maint-equipment", /Equipment Master/],
  ["maint-preventive", /Preventive Maintenance/],
  ["maint-schedule", /Maintenance Schedule/],
  ["maint-breakdown", /Breakdown Log/],
  ["maint-workorders", /Maintenance Work Orders/],
  ["maint-spares", /Spare Parts/],
  ["maint-downtime", /Downtime/],
  ["maint-mtbf", /MTBF and MTTR/],
  ["maint-alerts", /Maintenance Alerts/],
  ["asset-master", /Asset Master/],
  ["asset-capitalization", /Capitalisation/],
  ["asset-allocation", /Asset Allocation/],
  ["asset-transfer", /Asset Transfer/],
  ["asset-maintenance", /Asset Maintenance/],
  ["asset-depreciation", /Depreciation/],
  ["asset-disposal", /Asset Disposal/],
  ["asset-qr", /QR and Verification/],
];

test("the owner opens the 18 Phase 14 maintenance and asset pages", async ({
  page,
}) => {
  await signIn(page, "owner", OWNER_PW);
  await selectUnit(page, "Talwade");
  for (const [id, title] of PAGES) {
    await page.goto(`/m/${id}`);
    await expect(
      page.getByRole("heading", { name: title }).first(),
      id,
    ).toBeVisible();
  }
});
