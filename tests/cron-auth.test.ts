import { describe, expect, it } from 'vitest'
import { cronAuthorized, sameSecret } from '../api/_lib/secret'

// As crons (fecho do dia e lembretes) só correm com a CRON_SECRET certa.
describe('cron protegida', () => {
  it('sem CRON_SECRET no Vercel fica fechada', () => {
    expect(cronAuthorized('Bearer qualquer', undefined)).toBe(false)
    expect(cronAuthorized(undefined, '')).toBe(false)
    expect(cronAuthorized('Bearer ', '')).toBe(false)
  })

  it('só com «Bearer <CRON_SECRET>»', () => {
    expect(cronAuthorized('Bearer s3gr3do', 's3gr3do')).toBe(true)
    expect(cronAuthorized('Bearer s3gr3dx', 's3gr3do')).toBe(false)
    expect(cronAuthorized('s3gr3do', 's3gr3do')).toBe(false)
    expect(cronAuthorized('Bearer s3gr3do ', 's3gr3do')).toBe(false)
    expect(cronAuthorized(undefined, 's3gr3do')).toBe(false)
  })

  it('compara em tempo constante, também com tamanhos diferentes', () => {
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abcd')).toBe(false)
    expect(sameSecret('', 'abc')).toBe(false)
  })
})
