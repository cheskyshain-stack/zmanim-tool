import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base is configurable so the same build can be deployed at a domain root or under a
// subpath (GitHub Pages project sites serve from /<repo>/). Set BASE_PATH at build time.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Print Upscaler',
        short_name: 'Upscaler',
        description:
          'Upscale images with AI and prepare them for very large format printing.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        // This pair is load bearing, not a leftover. Android reads display_override, so
        // Chrome installs this as a real app: no browser chrome, and the launcher uses
        // the maskable icon. Safari does not implement display_override and falls
        // through to "browser", so an iPhone keeps opening it in Safari with the
        // address bar. That is what we want there: saving a large file from a
        // standalone web app on iOS is unreliable, and downloading the print file is
        // the entire point. Collapsing these into a plain "standalone" would take
        // downloads away from every iPhone that installs it.
        display_override: ['standalone'],
        display: 'browser',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The model weights are the whole point of caching: once they are in the cache
        // the app upscales with no network at all. They are a few MB each, well over
        // Workbox's 2 MB default precache ceiling.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,bin,wasm}'],
        // A 300 MP render can run for a long time. Never let a service worker update
        // yank the page out from under a job in progress.
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // tfjs is large and splits poorly. One vendor chunk keeps the entry small so the
    // first screen paints before the ML runtime has finished arriving.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@tensorflow')) return 'tfjs'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
    chunkSizeWarningLimit: 4000,
  },
})
