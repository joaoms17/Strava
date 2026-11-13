/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// O cliente aceita tanto VITE_SUPABASE_* como as SUPABASE_* normais —
// evita a briga do Vercel com prefixos públicos em variáveis "Sensitive".
// (URL e publishable key são públicos por natureza; o service role nunca
// passa por aqui.)
function clientEnv(mode: string) {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = process.env[name] ?? fileEnv[name]
      if (value) return value
    }
    return ''
  }
  return {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      pick('VITE_SUPABASE_URL', 'SUPABASE_URL'),
    ),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      pick('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
    ),
  }
}

// P2: o que só serve com rede não vai no service worker que se instala a
// toda a gente (era 2,4 MB): o leitor de códigos ZXing (só sem
// BarcodeDetector) e o Zod da «Pergunta à app». Ficam em cache na primeira
// vez que se usam (runtimeCaching, abaixo). O Recharts fica: o Treino e o
// Balanço importam-no logo, e sem ele esses ecrãs nem abriam sem rede.
const RUNTIME_ONLY = /node_modules[\\/](@zxing|zod)[\\/]/
const runtimeOnlyChunks = new Set<string>()

function markRuntimeOnly(): Plugin {
  return {
    name: 'so-com-rede',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && !chunk.isEntry && Object.keys(chunk.modules).some((id) => RUNTIME_ONLY.test(id))) {
          runtimeOnlyChunks.add(file)
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  define: clientEnv(mode),
  plugins: [
    react(),
    tailwindcss(),
    markRuntimeOnly(),
    VitePWA({
      registerType: 'autoUpdate',
      // As letras (Barlow) ficam no telemóvel para a app abrir igual sem rede.
      // As notificações (push e o toque) vêm de public/push-sw.js.
      // Os ícones PNG não entram (iam duas vezes: pelo padrão e pelo manifesto;
      // o sistema descarrega-os ao instalar).
      includeManifestIcons: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        importScripts: ['push-sw.js'],
        manifestTransforms: [
          async (entries) => ({ manifest: entries.filter((e) => !runtimeOnlyChunks.has(e.url)), warnings: [] }),
        ],
        runtimeCaching: [
          {
            // Os ficheiros têm o hash no nome: o que veio uma vez serve sempre.
            urlPattern: /\/assets\/.+\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'chunks-com-rede', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
        ],
      },
      manifest: {
        name: 'Daily Track',
        short_name: 'Daily Track',
        description: 'Comida, treino, peso e sono, todos os dias',
        lang: 'pt-PT',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0c110e',
        theme_color: '#0c110e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}))
