import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Fecha y hora del build, calculada una vez al cargar la config. Va SOLO al index.html
// construido (meta `app-build-time`), nunca al JS con `define`: si entrara al bundle, el
// chunk de entrada cambiaria de hash en cada build aunque el codigo fuera el mismo, y la
// comprobacion de "ultima version" (que compara ese hash) mentiria.
const BUILD_TIME = new Date().toISOString()
const appBuildTime = {
  name: 'app-build-time',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { name: 'app-build-time', content: BUILD_TIME }, injectTo: 'head' }
  ]
}

// PWA instalable en Android desde Chrome (sin Play Store).
// La app debe poder usarse 100% offline: el service worker precachea el shell
// y todos los datos viven en IndexedDB.
export default defineConfig({
  plugins: [
    react(),
    appBuildTime,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'MypiCuadre',
        short_name: 'MypiCuadre',
        description: 'Gestion de turnos, ventas e inventario para MYPIME',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a1f3c',
        theme_color: '#0a1f3c',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html'
      },
      devOptions: {
        enabled: false
      }
    })
  ]
})
