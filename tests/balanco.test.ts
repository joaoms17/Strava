import { describe, expect, it } from 'vitest'
import { belowFloor, weekAverages, type BalanceDay } from '../api/_lib/rules/balanco'

const day = (date: string, eaten: number, extra: Partial<BalanceDay> = {}): BalanceDay => ({
  date,
  eaten,
  plan: 1500,
  protein: 120,
  carbs: 150,
  fat: 50,
  meals: 3,
  missingSomething: false,
  ...extra,
})

describe('médias da semana', () => {
  it('só dias acabados, com refeições e sem «faltou algo»', () => {
    const avg = weekAverages(
      [
        day('2026-09-21', 1600),
        day('2026-09-22', 1800),
        day('2026-09-23', 0, { meals: 0 }),
        day('2026-09-24', 900, { missingSomething: true }),
        day('2026-09-25', 400), // hoje, ainda a meio
      ],
      '2026-09-25',
    )
    expect(avg).toMatchObject({ days: 2, eaten: 1700, plan: 1500 })
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
