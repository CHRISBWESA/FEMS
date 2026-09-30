import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The app shell (built assets + index.html) is precached so the app opens offline, and any in-app route
        // falls back to it. API requests are never answered by the service worker.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Deliberately NO runtime caching of API responses (there used to be a NetworkFirst rule for /api/).
        // They are authenticated, per-user and may hold personal, financial or safeguarding data; the HTTP cache
        // key does not include the Authorization header, so a shared device would serve one user's data to the
        // next and it would outlive logout. Offline data lives only in the explicit, user-scoped, expiring store
        // in src/offline (attendance roster + outbox), which is wiped on logout.
        runtimeCaching: [],
      },
      includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Fellowship Manager',
        short_name: 'Fellowship',
        description: 'Fellowship Management System',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'business'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('1.0.0'),
  },
  ssr: {
    noExternal: ['@vitejs/plugin-react'],
  },
});
