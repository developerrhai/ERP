// Vite + Vitest config: dev server on VITE_PORT (default 5173) with /api proxied to VITE_API_TARGET
// (default http://localhost:4000) for same-origin cookies, and the @registry alias so the menu is
// read straight from packages/registry (never copied).
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const registryPath = fileURLToPath(
  new URL('../../packages/registry/registry.json', import.meta.url),
);

const port = Number(process.env.VITE_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`VITE_PORT must be a port number, got "${process.env.VITE_PORT ?? ''}"`);
}
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:4000';
const proxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@registry': registryPath },
  },
  server: {
    port,
    strictPort: true,
    fs: { allow: ['.', '../../packages/registry'] },
    proxy,
  },
  preview: { port: 4173, proxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 20000,
  },
});
