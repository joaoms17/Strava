import { createHmac, timingSafeEqual } from 'node:crypto'

// Token do Atalho do iPhone por pessoa: «<user_id>.<assinatura>», assinado
// com HEALTH_INGEST_TOKEN. Não precisa de coluna nova: o servidor sabe
// refazê-lo e confirmar de quem é. Trocar HEALTH_INGEST_TOKEN invalida todos.

function sign(secret: string, userId: string): string {
  return createHmac('sha256', secret).update(`atalho:${userId}`).digest('base64url').slice(0, 32)
}

export function personalToken(secret: string, userId: string): string {
  return `${userId}.${sign(secret, userId)}`
}

// O user_id do token, ou null se não for válido.
export function tokenUser(secret: string, token: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const userId = token.slice(0, dot)
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(secret, userId))
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null
}
