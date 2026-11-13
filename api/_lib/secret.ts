import { createHash, timingSafeEqual } from 'node:crypto'

// Segredos comparados em tempo constante (CRON_SECRET, tokens): compara-se o
// SHA-256 de cada um, sempre com 32 bytes, para nem o tamanho se notar no tempo.
export function sameSecret(given: string, expected: string): boolean {
  if (!expected) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b) && given.length === expected.length
}

// As crons do Vercel mandam «Authorization: Bearer <CRON_SECRET>». Sem a
// CRON_SECRET no Vercel a cron fica fechada (antes corria para qualquer um).
export function cronAuthorized(authorization: string | undefined, secret: string | undefined): boolean {
  if (!secret) return false
  const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  return sameSecret(given, secret)
}
