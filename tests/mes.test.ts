import { describe, expect, it } from 'vitest'
import { bannerKey, monthBanner, monthBounds, monthSummary, previousMonth } from '../api/_lib/rules/mes'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

describe('o teu mês', () => {
  it('limites e mês anterior', () => {
    expect(monthBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' })
    expect(monthBounds('2026-12').last).toBe('2026-12-31')
    expect(previousMonth('2027-01-02')).toBe('2026-12')
  })

  it('aviso nos dias 1–3, uma vez', () => {
    expect(monthBanner('2026-11-01', [])).toBe('2026-10')
    expect(monthBanner('2026-11-03', [])).toBe('2026-10')
    expect(monthBanner('2026-11-04', [])).toBeNull()
    expect(monthBanner('2026-11-02', [bannerKey('2026-10')])).toBeNull()
  })

  it('resumo de outubro', () => {
    const weights = []
    for (let i = -7; i < 31; i++) weights.push({ date: shiftDate('2026-10-01', i), value: 85 - (i + 7) * 0.05 })
    const days = Array.from({ length: 31 }, (_, i) => {
      const date = shiftDate('2026-10-01', i)
      // dias 10 e 20 acima do alvo (o 20 também acima do gasto); 15 incompleto
      return { date, kcal_in: i === 9 || i === 19 ? 2600 : 2000, kcal_target: 2050, is_complete: i !== 14, flags: [], kcal_out_est: i === 19 ? 2500 : 2700 }
    })
    const s = monthSummary({
      month: '2026-10',
      weights,
      waist: [
        { date: '2026-09-20', value: 95 },
        { date: '2026-10-04', value: 94 },
        { date: '2026-10-18', value: 93 },
      ],
      days,
      workouts: [
        { date: '2026-10-02', minutes: 45, kcal: 400 },
        { date: '2026-10-06', minutes: 60, kcal: 500 },
        { date: '2026-10-07', minutes: 30, kcal: 200 },
        { date: '2026-09-30', minutes: 99, kcal: 999 },
      ],
      meals: [
        { date: '2026-10-01', items: [{ name: 'Iogurte grego' }, { name: 'Aveia' }] },
        { date: '2026-10-02', items: [{ name: 'aveia' }, { name: 'Iogurte Grego' }] },
        { date: '2026-10-03', items: [{ name: 'Bitoque' }] },
      ],
      projection: 'A este ritmo: 78 kg a 14 dez',
    })
    expect(s.label).toBe('outubro de 2026')
    expect(s.kgChange).toBeLessThan(-1)
    expect(s.cmChange).toBe(-2)
    expect(s.workouts).toBe(3)
    expect(s.minutes).toBe(135)
    expect(s.workoutKcal).toBe(1100)
    expect(s.countedDays).toBe(30)
    expect(s.daysOnTarget).toBe(28)
    expect(s.daysAboveSpent).toBe(1)
    expect(s.streak).toBe(11) // 21 a 31
    expect(s.topMeal).toEqual({ name: 'Iogurte grego + Aveia', count: 2 })
    expect(s.bestWeek?.label).toBe('semana de 5 out')
    expect(s.projection).toMatch(/14 dez/)
  })

  it('mês vazio', () => {
    const s = monthSummary({ month: '2026-10', weights: [], waist: [], days: [], workouts: [], meals: [] })
    expect(s.kgChange).toBeNull()
    expect(s.topMeal).toBeNull()
    expect(s.bestWeek).toBeNull()
  })
})
