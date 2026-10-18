import { timingSafeEqual } from 'node:crypto'

// Segredos comparados em tempo constante (CRON_SECRET, tokens).
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// As crons do Vercel mandam «Authorization: Bearer <CRON_SECRET>». Sem a
// CRON_SECRET no Vercel a cron fica fechada (antes corria para qualquer um).
export function cronAuthorized(authorization: string | undefined, secret: string | undefined): boolean {
  if (!secret) return false
  const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  return sameSecret(given, secret)
}
