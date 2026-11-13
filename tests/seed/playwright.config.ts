import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration tuned for unattended UI data seeding against RHAI Enterprise ERP.
 * - workers: 1 & fullyParallel: false prevent concurrent form collisions on sequential numbering.
 * - retries: 0 avoids silently duplicating partially committed rows on slow responses.
 * - timeout: 25 minutes per test block covers 50 sequential UI form submissions per module.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 25 * 60 * 1000,
  outputDir: './.artifacts',
  expect: {
    timeout: 15_000,
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'seed-report' }]],
  use: {
    baseURL: process.env.ERP_BASE_URL ?? 'https://erp.sawantgroup.co.in',
    headless: process.env.HEADLESS === '1',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      // slowMo (40ms) keeps UI transitions clean while completing 150 rows within ~8-12 minutes
      slowMo: 40,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

