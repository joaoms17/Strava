import { createClient } from '@supabase/supabase-js'

// Aceita o URL mesmo que venha colado com um caminho a mais
// (ex.: copiado da barra de endereço) — só a origem interessa.
function baseUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

const url = baseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined)
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const supabaseConfigured = Boolean(url && anonKey)

// Com env em falta, a app mostra o ecrã de configuração antes de usar isto.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'anon')
