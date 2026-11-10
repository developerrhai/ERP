// Vite + Vitest config: dev server on VITE_PORT (default 5173) with /api proxied to VITE_API_TARGET
// (default http://localhost:4000) for same-origin cookies, the @registry alias so the menu is read
// straight from packages/registry, and vite-plugin-pwa (injectManifest) for installable PWA shell.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { pwaPluginOptions } from './src/lib/pwaManifest';

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
  plugins: [react(), ...(process.env.VITEST ? [] : [VitePWA(pwaPluginOptions)])],
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
