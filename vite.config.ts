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
        theme_color: '#fafaf9',
        background_color: '#fafaf9',
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
  // For GitHub Pages: set to your repo name (e.g., '/meridian/')
  // For local dev or custom domain: use '/'
  base: '/',
})
