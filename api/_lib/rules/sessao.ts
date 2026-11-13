// P7: a sessão de cada pedido valida-se sem ir ao Supabase Auth sempre que
// possível. O token (JWT) é verificado pela assinatura com as chaves públicas
// do projeto (JWKS, guardadas 10 min) quando o projeto usa chaves
// assimétricas; com o segredo partilhado (HS256) o Supabase não deixa
// verificar localmente e a verificação continua a ser feita pelo Auth. Em
// ambos os casos, um token já verificado fica lembrado pouco tempo na
// memória da função (nunca para lá da validade dele).

export const SESSION_CACHE_MS = 60_000
export const SESSION_CACHE_MAX = 100
// Margem antes do fim do token: um token quase a expirar não fica lembrado.
const EXPIRY_MARGIN_MS = 5_000

// Até quando um token verificado pode ser reutilizado sem nova verificação
// (null: não guardar).
export function sessionCacheUntil(nowMs: number, expSeconds: unknown, ttlMs = SESSION_CACHE_MS): number | null {
  if (typeof expSeconds !== 'number' || !Number.isFinite(expSeconds)) return null
  const until = Math.min(nowMs + ttlMs, expSeconds * 1000 - EXPIRY_MARGIN_MS)
  return until > nowMs ? until : null
}

export interface ClaimsUser {
  id: string
  email: string | undefined
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
  aud: string
}

// A pessoa de um token já verificado: só sessões de quem entrou
// (`role: authenticated`, com `sub`); a chave anónima e a de serviço não são
// pessoas e ficam de fora.
export function userFromClaims(claims: unknown): ClaimsUser | null {
  if (claims == null || typeof claims !== 'object') return null
  const c = claims as Record<string, unknown>
  if (typeof c.sub !== 'string' || c.sub.length === 0) return null
  if (c.role !== 'authenticated') return null
  const record = (v: unknown) => (v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
  return {
    id: c.sub,
    email: typeof c.email === 'string' && c.email ? c.email : undefined,
    user_metadata: record(c.user_metadata),
    app_metadata: record(c.app_metadata),
    aud: typeof c.aud === 'string' ? c.aud : 'authenticated',
  }
}
