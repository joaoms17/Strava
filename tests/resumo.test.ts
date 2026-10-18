import { describe, expect, it } from 'vitest'
import { dataFingerprint, weekHasData } from '../api/_lib/rules/resumo'

describe('resumo da semana', () => {
  it('sem dias completos, refeições nem treinos não se escreve', () => {
    expect(weekHasData({ completeDays: 0, meals: 0, workouts: 0 })).toBe(false)
    expect(weekHasData({ completeDays: 0, meals: 0, workouts: 1 })).toBe(true)
    expect(weekHasData({ completeDays: 0, meals: 2, workouts: 0 })).toBe(true)
  })

  it('a impressão digital não depende da ordem das chaves (o jsonb reordena-as)', () => {
    const a = { semana: { inicio: '2026-10-05', fim: '2026-10-11' }, dias: [{ date: '2026-10-05', kcal_in: 1800 }] }
    const b = { dias: [{ kcal_in: 1800, date: '2026-10-05' }], semana: { fim: '2026-10-11', inicio: '2026-10-05' } }
    expect(dataFingerprint(a)).toBe(dataFingerprint(b))
    expect(dataFingerprint(a)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('muda quando um dia muda (ex.: «Foi tudo?» de domingo respondido)', () => {
    const before = { dias: [{ date: '2026-10-11', is_complete: false }] }
    const after = { dias: [{ date: '2026-10-11', is_complete: true }] }
    expect(dataFingerprint(before)).not.toBe(dataFingerprint(after))
  })
})
