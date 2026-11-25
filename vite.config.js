import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// المسار الأساسي: على GitHub Pages يكون /suwar/ ، ومحليًا /
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || new Date().toISOString().slice(0, 10)) },
  build: { target: 'es2020', chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/unit/**/*.test.js'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'لوحة — تركيب الصور',
        short_name: 'لوحة',
        description: 'قصّ العناصر من الصور وتركيبها في لوحة واحدة منسجمة',
        lang: 'ar',
        dir: 'rtl',
        display: 'standalone',
        orientation: 'any',
        background_color: '#16171b',
        theme_color: '#16171b',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        file_handlers: [
          { action: '.', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'], 'application/octet-stream': ['.psd', '.lawha'] } }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff2,wasm,onnx,json}'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        navigateFallback: 'index.html'
      }
    })
  ]
});
