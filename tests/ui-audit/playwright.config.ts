// Phase 36 audit: reuses the servers from tests/feed/ui/start-ui-servers.ts (API 4100, web 5180). One worker, one browser.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  testIgnore: process.env.PROBE ? [] : /probe\.spec/, // PROBE=1 npx playwright test ... probe
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 3_000_000,
  outputDir: './.artifacts',
  reporter: [['list']],
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:5180', viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 },
});
