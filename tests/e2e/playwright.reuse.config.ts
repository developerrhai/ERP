// Local iteration only: like playwright.config.ts but re-uses servers you started yourself
//   node tests/e2e/start-api.mjs        (wipes and re-migrates rhai_erp_e2e, then serves on :4100)
//   VITE_PORT=5180 VITE_API_TARGET=http://localhost:4100 npm --prefix apps/web run dev
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, webServer: undefined });
