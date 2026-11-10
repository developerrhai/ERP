// Shared PWA manifest & Workbox injectManifest configuration imported by vite.config.ts & tests.
export const pwaPluginOptions = {
  strategies: 'injectManifest' as const,
  srcDir: 'src',
  filename: 'sw.ts',
  registerType: 'prompt' as const,
  injectRegister: 'auto' as const,
  includeAssets: ['offline.html', 'icons/*.svg'],
  manifest: {
    name: 'Sawant Group ERP',
    short_name: 'Sawant ERP',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone' as const,
    theme_color: '#0f766e',
    background_color: '#f8fafc',
    icons: [
      { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
      {
        src: '/icons/maskable-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'My Approvals', url: '/approvals' },
      { name: 'Notifications', url: '/m/notif-center' },
      { name: 'Scan QR', url: '/m/maint-qr' },
      { name: 'New Gate Entry', url: '/gate/kiosk' },
    ],
  },
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
};

