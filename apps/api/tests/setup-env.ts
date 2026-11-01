// Runs in each test worker before the test file is imported, so src/config/env.ts validates the
// test environment (rhai_erp_test, silent logs, rate limits off) rather than apps/api/.env.
import { TEST_ENV } from './test-env';

Object.assign(process.env, TEST_ENV);
