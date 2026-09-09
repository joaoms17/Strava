import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente em falta: ${name}`)
  if (name === 'SUPABASE_URL') {
    // só a origem — protege contra URLs colados com caminho a mais
    try {
      return new URL(value).origin
    } catch {
      throw new Error('SUPABASE_URL inválido — devia ser https://xxxx.supabase.co')
    }
  }
  return value.trim()
}

// Cliente com service role — ignora RLS. Só para o que o cliente não pode
// fazer (api_calls, strava_tokens, ler fotos do Storage).
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

// Cliente com o token do utilizador — todas as queries passam pelo RLS.
export function userClient(accessToken: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function requireUser(
  req: VercelRequest,
): Promise<{ user: User; db: SupabaseClient; token: string }> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new HttpError(401, 'Sessão em falta.')
  const db = userClient(token)
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) throw new HttpError(401, 'Sessão inválida.')
  return { user: data.user, db, token }
}
