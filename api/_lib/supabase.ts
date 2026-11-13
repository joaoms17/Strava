import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'
import { houseByEmail, houseEmails } from './rules/casa.js'
import { SESSION_CACHE_MAX, sessionCacheUntil, userFromClaims } from './rules/sessao.js'

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
// fazer (api_calls, ler fotos do Storage, cron).
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
  const user = await verifiedUser(token)
  if (!user) throw new HttpError(401, 'Sessão inválida.')
  await requireHouse(user)
  return { user, db: userClient(token), token }
}

// P7: o token verifica-se pela assinatura (getClaims: chaves públicas do
// projeto, guardadas 10 min, quando o projeto usa chaves assimétricas; com o
// segredo partilhado HS256, o próprio getClaims pergunta ao Auth, como o
// getUser de antes). A assinatura e a validade são sempre verificadas; um
// token verificado fica lembrado no máximo 60 s nesta instância da função
// (rules/sessao.ts), nunca para lá da validade dele. A autenticação não
// enfraquece: um token falso, expirado ou da chave anónima continua a dar 401.
let verifier: SupabaseClient | null = null
const verifiedTokens = new Map<string, { user: User; until: number }>()

async function verifiedUser(token: string): Promise<User | null> {
  const now = Date.now()
  const hit = verifiedTokens.get(token)
  if (hit && hit.until > now) return hit.user
  if (hit) verifiedTokens.delete(token)
  verifier ??= createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let claims: unknown
  try {
    const { data, error } = await verifier.auth.getClaims(token)
    if (error || !data) return null
    claims = data.claims
  } catch (err) {
    console.error('Sessão: verificação do token falhou', err)
    return null
  }
  const fromClaims = userFromClaims(claims)
  if (!fromClaims) return null
  const user = { ...fromClaims, created_at: '' } as User
  const until = sessionCacheUntil(now, (claims as { exp?: unknown }).exp)
  if (until != null) {
    // Poucas pessoas, poucos tokens: o mais antigo sai quando a lista enche.
    if (verifiedTokens.size >= SESSION_CACHE_MAX) {
      const oldest = verifiedTokens.keys().next().value
      if (oldest !== undefined) verifiedTokens.delete(oldest)
    }
    verifiedTokens.set(token, { user, until })
  }
  return user
}

// G1: com HOUSE_EMAILS definida, só entra quem está na lista ou já tem
// perfil (rules/casa.ts). Sem a variável, como sempre. Quem já passou fica
// lembrado enquanto a função estiver quente (não volta a ler o perfil).
const houseMembers = new Set<string>()
async function requireHouse(user: User): Promise<void> {
  const list = houseEmails(process.env.HOUSE_EMAILS)
  if (houseByEmail(user.email, list) || houseMembers.has(user.id)) return
  const { data, error } = await adminClient().from('profile').select('user_id').eq('user_id', user.id).maybeSingle()
  if (error) {
    console.error('Casa: leitura do perfil', error.message)
    throw new HttpError(503, 'Não consegui confirmar a conta. Tenta outra vez.')
  }
  if (!data) throw new HttpError(403, 'Esta conta não é desta casa.')
  houseMembers.add(user.id)
}
