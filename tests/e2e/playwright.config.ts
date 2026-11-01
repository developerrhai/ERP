// Why: Playwright configuration for the cross-system (browser → Vite → API → PostgreSQL) end-to-end suite.
// It boots a fresh API (clean e2e DB) and the web dev server on dedicated ports, then runs the specs serially
// because they share one database and build on each other's users.
import { defineConfig } from '@playwright/test';
import { E2E } from './e2e-env.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: './.artifacts',
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${E2E.webPort}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node tests/e2e/start-api.mjs',
      cwd: '../..',
      url: `http://localhost:${E2E.apiPort}/api/v1/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm --prefix apps/web run dev',
      cwd: '../..',
      url: `http://localhost:${E2E.webPort}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_PORT: String(E2E.webPort), VITE_API_TARGET: `http://localhost:${E2E.apiPort}` },
    },
  ],
});
