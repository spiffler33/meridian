import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // main.tsx registers the worker; no injected inline script, which the CSP forbids.
      injectRegister: null,
      manifest: {
        name: 'Meridian',
        short_name: 'Meridian',
        description:
          'Meridian - A personal dashboard for daily execution and long-term perspective',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // The night background, measured from index.css. The installed app
        // opens on this before the first paint, so a light value here is a
        // white flash on every cold start.
        theme_color: '#0d0b08',
        background_color: '#0d0b08',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      // The globs below already cover the icons; re-adding them here would
      // put duplicate entries in the precache manifest.
      includeManifestIcons: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  // Served from a custom domain (meridian.spiffler.xyz), so the app is at
  // the root rather than under a repo-name path.
  base: '/',
})
