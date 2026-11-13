import { createHmac, timingSafeEqual } from 'node:crypto'

// Token do Atalho do iPhone por pessoa: «<user_id>.<assinatura>», assinado
// com HEALTH_INGEST_TOKEN. O servidor sabe refazê-lo e confirmar de quem é.
// Trocar HEALTH_INGEST_TOKEN invalida todos.
//
// G4: cada pessoa pode gerar um token novo (Definições › Atalho do iPhone),
// que invalida o anterior. A data em que foi gerado fica no perfil
// (`profile.ingest_token_at`, migração 20261113000061) e entra na
// assinatura: gerar outro muda a data e o token antigo deixa de bater certo.
// Sem data (antes de alguma vez gerar, ou sem a migração), vale o token de
// origem, o que já está no Atalho: nada se parte até a pessoa gerar um novo.

// A data guardada como número (ms), ou null (token de origem).
export function tokenEpoch(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null
  const ms = Date.parse(createdAt)
  return Number.isFinite(ms) ? ms : null
}

function sign(secret: string, userId: string, createdAt: string | null): string {
  const epoch = tokenEpoch(createdAt)
  const payload = epoch == null ? `atalho:${userId}` : `atalho:${userId}:${epoch}`
  return createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32)
}

export function personalToken(secret: string, userId: string, createdAt: string | null = null): string {
  return `${userId}.${sign(secret, userId, createdAt)}`
}

// De quem diz ser o token (sem confirmar a assinatura): para ler a data
// desse perfil antes de confirmar. null se não tiver a forma de um token.
export function tokenClaimedUser(token: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const userId = token.slice(0, dot)
  return /^[0-9a-f-]{36}$/i.test(userId) ? userId : null
}

// O user_id do token, ou null se não for válido (com a data atual desse
// perfil: um token de antes de gerar outro já não vale).
export function tokenUser(secret: string, token: string, createdAt: string | null = null): string | null {
  const userId = tokenClaimedUser(token)
  if (!userId) return null
  const given = Buffer.from(token.slice(token.lastIndexOf('.') + 1))
  const expected = Buffer.from(sign(secret, userId, createdAt))
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null
}

// O segredo da casa (HEALTH_INGEST_TOKEN) grava na primeira conta, como
// sempre; deixa de valer quando essa pessoa gera o seu token (era esse o
// «token anterior» dela).
export function sharedSecretAccepted(firstAccountTokenAt: string | null | undefined): boolean {
  return tokenEpoch(firstAccountTokenAt) == null
}

// A coluna não existe (migração por aplicar): 42703 no Postgres, PGRST204 no
// PostgREST (ao escrever).
export function missingColumn(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /ingest_token_at.*(does not exist|schema cache)|could not find the 'ingest_token_at'/i.test(error?.message ?? '')
  )
}
