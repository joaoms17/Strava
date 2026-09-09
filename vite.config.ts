/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
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
    'import.meta.env.VITE_STRAVA_ENABLED': JSON.stringify(
      pick('VITE_STRAVA_ENABLED', 'STRAVA_ENABLED'),
    ),
  }
}

export default defineConfig(({ mode }) => ({
  define: clientEnv(mode),
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'A Época do Regresso',
        short_name: 'Regresso',
        description: 'Nutrição, treino e peso',
        lang: 'pt-PT',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0b',
        theme_color: '#0a0a0b',
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
