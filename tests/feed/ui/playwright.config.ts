// Phase 36 feed/audit: reuses the servers started by start-ui-servers.ts (never starts its own).
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: './.artifacts',
  reporter: [['list']],
  expect: { timeout: 10_000 },
  use: { actionTimeout: 15_000, baseURL: 'http://localhost:5180', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
});
