import { describe, expect, it } from 'vitest'
import { checkWeighing, weeklyRate } from '../api/_lib/rules/weight'

function series(start: string, days: number, from: number, perDay: number, every = 1) {
  const out = []
  for (let i = 0; i < days; i += every) {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ date, value: Math.round((from + perDay * i) * 100) / 100 })
  }
  return out
}

describe('ritmo semanal do peso médio', () => {
  it('a descer cerca de 0,4 kg por semana', () => {
    const rate = weeklyRate(series('2026-09-01', 21, 86, -0.4 / 7))
    expect(rate).toBeCloseTo(-0.4, 1)
  })

  it('sem 14 dias de história não há ritmo', () => {
    expect(weeklyRate(series('2026-09-01', 10, 86, -0.1))).toBeNull()
  })

  it('com menos de 8 pesagens nos últimos 14 dias não há ritmo', () => {
    expect(weeklyRate(series('2026-09-01', 21, 86, -0.05, 3))).toBeNull()
  })
})

describe('verificação da pesagem', () => {
  it('perto do peso médio passa', () => {
    expect(checkWeighing(84.6, 85)).toEqual({ kind: 'ok' })
    expect(checkWeighing(84.6, null)).toEqual({ kind: 'ok' })
  })

  it('falta a vírgula', () => {
    expect(checkWeighing(854, 85)).toEqual({ kind: 'suggest', value: 85.4 })
  })

  it('algarismos trocados', () => {
    expect(checkWeighing(48.5, 84.9)).toEqual({ kind: 'suggest', value: 84.5 })
  })

  it('sem troca óbvia pede confirmação', () => {
    expect(checkWeighing(72, 85)).toEqual({ kind: 'confirm' })
    expect(checkWeighing(58.4, 85)).toEqual({ kind: 'suggest', value: 85.4 })
  })
})
