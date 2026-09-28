import { describe, expect, it } from 'vitest'
import { recomputeRange } from '../api/_lib/close-day'

describe('dias a recalcular numa noite', () => {
  it('sem dias sujos: os últimos 3 até ontem', () => {
    expect(recomputeRange('2026-09-28', null, 21)).toEqual({
      dates: ['2026-09-25', '2026-09-26', '2026-09-27'],
      next: null,
    })
  })

  it('uma pesagem de há 5 dias: recalcula desde esse dia, para a frente', () => {
    const { dates } = recomputeRange('2026-09-28', '2026-09-23', 21)
    expect(dates[0]).toBe('2026-09-23')
    expect(dates[dates.length - 1]).toBe('2026-09-27')
  })

  it('um dia sujo recente não encurta os 3 dias de segurança', () => {
    expect(recomputeRange('2026-09-28', '2026-09-27', 21).dates).toHaveLength(3)
  })

  it('mais de 21 dias: para e diz onde continuar na noite seguinte', () => {
    const { dates, next } = recomputeRange('2026-09-28', '2026-08-01', 21)
    expect(dates).toHaveLength(21)
    expect(dates[0]).toBe('2026-08-01')
    expect(next).toBe('2026-08-22')
  })
})
