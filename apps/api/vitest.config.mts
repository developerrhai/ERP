// Vitest setup: one global DB reset, the test env injected into every worker before any app module
// loads, and files run one at a time because they share rhai_erp_test (and its single SUPER_ADMIN).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup-env.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
