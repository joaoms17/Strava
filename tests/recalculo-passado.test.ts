import { describe, expect, it } from 'vitest'
import { pastRecomputePlan } from '../api/_lib/rules/recalculo-passado'

describe('recalcular dias passados depois de uma escrita (M8)', () => {
  it('sem dias sujos, ou só hoje: nada', () => {
    expect(pastRecomputePlan('2026-11-13', null)).toEqual({ dates: [], next: null })
    expect(pastRecomputePlan('2026-11-13', '2026-11-13')).toEqual({ dates: [], next: null })
  })

  it('uma favorita registada ontem: só ontem', () => {
    expect(pastRecomputePlan('2026-11-13', '2026-11-12')).toEqual({ dates: ['2026-11-12'], next: null })
  })

  it('uma cópia para há 3 dias: desde esse dia até ontem, por ordem', () => {
    expect(pastRecomputePlan('2026-11-13', '2026-11-10').dates).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
  })

  it('cadeia longa: pára no máximo e diz onde a cron continua', () => {
    const { dates, next } = pastRecomputePlan('2026-11-13', '2026-09-01', 30)
    expect(dates).toHaveLength(30)
    expect(dates[0]).toBe('2026-09-01')
    expect(next).toBe('2026-10-01')
  })
})
