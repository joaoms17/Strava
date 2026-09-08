import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

// Com env em falta, a app mostra o ecrã de configuração antes de usar isto.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'anon')
