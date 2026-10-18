import { describe, expect, it } from 'vitest'
import { belowFloor, leftOutDates, leftOutDays, weekAverages, weekSoFar, type BalanceDay } from '../api/_lib/rules/balanco'

const day = (date: string, eaten: number, extra: Partial<BalanceDay> = {}): BalanceDay => ({
  date,
  eaten,
  plan: 1500,
  protein: 120,
  carbs: 150,
  fat: 50,
  meals: 3,
  complete: true,
  ...extra,
})

describe('médias da semana', () => {
  it('só dias acabados e completos (regra 5)', () => {
    const days = [
      day('2026-09-21', 1600),
      day('2026-09-22', 1800),
      day('2026-09-23', 0, { meals: 0, complete: false }),
      day('2026-09-24', 900, { complete: false }), // «faltou algo»
      day('2026-09-25', 400), // hoje, ainda a meio
    ]
    expect(weekAverages(days, '2026-09-25')).toMatchObject({ days: 2, eaten: 1700, plan: 1500 })
    expect(leftOutDays(days, '2026-09-25')).toBe(1)
  })

  it('um dia só com o pequeno-almoço não puxa a média para baixo', () => {
    const days = [
      day('2026-09-21', 1600),
      day('2026-09-22', 1700),
      day('2026-09-23', 500, { meals: 1, complete: false }),
    ]
    expect(weekAverages(days, '2026-09-28')).toMatchObject({ days: 2, eaten: 1650 })
    expect(leftOutDays(days, '2026-09-28')).toBe(1)
  })

  it('sem dias que contem não há médias', () => {
    expect(weekAverages([day('2026-09-25', 500)], '2026-09-25')).toBeNull()
  })

  it('o aviso do mínimo precisa de pelo menos 3 dias', () => {
    const low = [day('2026-09-21', 1200), day('2026-09-22', 1300)]
    expect(belowFloor(weekAverages(low, '2026-09-28'), 1400)).toBe(false)
    const lowWeek = [...low, day('2026-09-23', 1250)]
    expect(belowFloor(weekAverages(lowWeek, '2026-09-28'), 1400)).toBe(true)
  })
})

describe('a semana até agora (Hoje)', () => {
  const row = (date: string, kcal_in: number, kcal_target: number, is_complete = true) => ({
    date,
    kcal_in,
    kcal_target,
    is_complete,
  })

  it('dias completos desde segunda mais hoje ao vivo', () => {
    const days = [
      row('2026-10-12', 1400, 1900),
      row('2026-10-13', 1500, 1800),
      row('2026-10-14', 600, 1800, false), // incompleto: fora
      row('2026-10-15', 2400, 1800),
    ]
    // (500 + 300 − 600) + (1 800 − 2 300) = −300 → 300 acima do plano
    expect(weekSoFar(days, '2026-10-16', 1800, 2300)).toEqual({ days: 3, diff: -300 })
  })

  it('à segunda-feira (sem dias completos antes) não há', () => {
    expect(weekSoFar([], '2026-10-12', 1800, 2300)).toBeNull()
    expect(weekSoFar([row('2026-10-12', 0, 0)], '2026-10-13', 1800, 1000)).toBeNull()
  })
})

describe('dias que ficaram de fora', () => {
  it('as datas dos dias acabados com refeições que não contam (para os abrir no Hoje)', () => {
    const days = [
      day('2026-09-22', 1800),
      day('2026-09-23', 430, { meals: 1, complete: false }),
      day('2026-09-24', 0, { meals: 0, complete: false }),
      day('2026-09-25', 900, { meals: 2, complete: false }),
      day('2026-09-26', 300, { meals: 1, complete: false }),
    ]
    expect(leftOutDates(days, '2026-09-26')).toEqual(['2026-09-23', '2026-09-25'])
    expect(leftOutDays(days, '2026-09-26')).toBe(2)
  })
})
