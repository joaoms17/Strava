import { describe, expect, it } from 'vitest'
import {
  adaptiveDay,
  dietStarts,
  measuredBounds,
  tdeeRaw,
  waterForTdee,
  type AdaptiveDay,
} from '../api/_lib/rules/adaptativo'
import {
  dailyBase,
  limitWeeklyBase,
  measuredFlags,
  measuredNote,
  measuredNoteFromDays,
  trustedTdee,
  withMeasuredFlags,
} from '../api/_lib/rules/gasto'
import { mondayOf } from '../api/_lib/rules/manutencao'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

// Decisão 304: as primeiras semanas da dieta não entram no gasto medido, que
// fica a ±15 % da fórmula até 6 semanas de dados e muda no máximo 100 kcal
// por semana.

describe('dietStarts', () => {
  it('a âncora, a segunda-feira depois de cada pausa e os recomeços', () => {
    const starts = dietStarts({
      anchor: '2026-06-24', // quarta: conta a segunda-feira da semana
      maintenanceEnabled: true,
      completeDates: ['2026-08-01', '2026-08-02', '2026-09-28', '2026-09-29'],
      from: '2026-07-20',
      until: '2026-10-25',
    })
    expect(starts).toEqual(['2026-06-22', '2026-08-01', '2026-08-03', '2026-09-14', '2026-09-28'])
  })

  it('sem pausa, só a âncora; um intervalo de 7 dias sem dias completos não é recomeço', () => {
    const starts = dietStarts({
      anchor: '2026-09-28',
      maintenanceEnabled: false,
      completeDates: ['2026-09-28', '2026-10-01', '2026-10-08'],
      from: '2026-09-27',
      until: '2026-12-31',
    })
    expect(starts).toEqual(['2026-09-28'])
  })
})

describe('waterForTdee', () => {
  const starts = ['2026-09-28']
  it('as 2 primeiras semanas e a semana de pausa', () => {
    expect(waterForTdee('2026-09-28', starts, '2026-09-28', true)).toBe(true)
    expect(waterForTdee('2026-10-11', starts, '2026-09-28', true)).toBe(true)
    expect(waterForTdee('2026-10-12', starts, '2026-09-28', true)).toBe(false)
    expect(waterForTdee('2026-11-02', starts, '2026-09-28', true)).toBe(true) // semana de pausa
    expect(waterForTdee('2026-11-02', starts, '2026-09-28', false)).toBe(false)
  })
})

describe('tdeeRaw por troços', () => {
  it('não atravessa a fase de água', () => {
    const days = Array.from({ length: 20 }, (_, i) => ({
      date: shiftDate('2026-09-01', i),
      kcal_in: 1600,
      // 0,1 kg por dia nos 10 primeiros, um salto de 2 kg pelo meio (água) e 0,1 por dia depois.
      weight_trend: i < 10 ? 90 - i * 0.1 : 87 - (i - 10) * 0.1,
    }))
    const window = days.filter((_, i) => i !== 9 && i !== 10)
    const breaks = (a: string, b: string) => a < '2026-09-10' && b > '2026-09-11'
    // 8 + 9 dias de troço, 0,8 + 0,8 kg: 1,6 × 7 700 / 16
    expect(tdeeRaw(window, { breaks })).toBeCloseTo(1600 + (1.6 * 7700) / 16, 0)
    // Sem troços, o salto de água contava como gordura.
    expect(tdeeRaw(window)!).toBeGreaterThan(2900)
  })
})

describe('measuredBounds', () => {
  it('+15 % / −15 % da fórmula até 6 semanas; depois ±400', () => {
    expect(measuredBounds(2154, 140, false)).toEqual({ lo: 1971, hi: 2617 })
    expect(measuredBounds(2154, 140, true)).toEqual({ lo: 1894, hi: 2694 })
  })
})

describe('limitWeeklyBase', () => {
  it('a base medida muda no máximo 100 por semana; a fórmula não se limita', () => {
    expect(limitWeeklyBase({ base: 2477, learning: false }, 2175)).toEqual({ base: 2275, learning: false, limited: true })
    expect(limitWeeklyBase({ base: 2240, learning: false }, 2175)).toEqual({ base: 2240, learning: false, limited: false })
    expect(limitWeeklyBase({ base: 2160, learning: true }, 2400)).toEqual({ base: 2160, learning: true, limited: false })
    expect(limitWeeklyBase({ base: 2477, learning: false }, null).limited).toBe(false)
  })
})

describe('notas do gasto medido', () => {
  it('uma linha, a mais importante', () => {
    expect(measuredNote(['gasto_teto', 'gasto_ritmo'])).toBe(
      'O gasto medido ainda reflete as primeiras semanas; está limitado a +15 % da fórmula.',
    )
    expect(measuredNote(['gasto_ritmo'])).toContain('100 kcal por semana')
    expect(measuredNote(['gasto_agua'])).toContain('não contam para o gasto medido')
    expect(measuredNote(['chao'])).toBeNull()
  })

  it('as marcas trocam-se sem mexer nas outras', () => {
    const flags = withMeasuredFlags(['chao', 'gasto_agua'], measuredFlags({ limit: 'teto', excluded: false, baseLimited: true }))
    expect(flags).toEqual(['chao', 'gasto_teto', 'gasto_ritmo'])
  })

  it('a nota sai do último dia com gasto medido', () => {
    expect(
      measuredNoteFromDays([
        { tdee_est: 2400, flags: ['gasto_teto'] },
        { tdee_est: 2410, flags: [] },
        { tdee_est: null, flags: ['dia_incompleto'] },
      ]),
    ).toBeNull()
    expect(measuredNoteFromDays([{ tdee_est: 2400, flags: [] }, { tdee_est: 2410, flags: ['gasto_ritmo'] }])).toContain('100 kcal')
  })
})

// O João (183 cm, homem): recomeçou a dieta a 28/9 depois de duas semanas sem
// registos. Médias por semana: comeu 1 921, 1 636, 1 609, 1 572; peso médio
// 85,40 → 84,29 → 82,90 → 81,60 → 81,10. Antes, a base medida subia todas as
// semanas (2 348, 2 438, 2 524 a 26/10) com o peso a parar.
describe('o gasto do João', () => {
  const weeks = [
    { monday: '2026-09-28', kcal: 1921 },
    { monday: '2026-10-05', kcal: 1636 },
    { monday: '2026-10-12', kcal: 1609 },
    { monday: '2026-10-19', kcal: 1572 },
  ]
  // Peso médio de cada semana na quinta-feira; entre elas, em linha reta.
  const points: [string, number][] = [
    ['2026-10-01', 85.4],
    ['2026-10-08', 84.29],
    ['2026-10-15', 82.9],
    ['2026-10-22', 81.6],
    ['2026-10-29', 81.1],
  ]
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000
  function trend(d: string): number {
    for (let i = 0; i < points.length - 1; i++) {
      const [a, va] = points[i]!
      const [b, vb] = points[i + 1]!
      if (d <= b || i === points.length - 2) return Math.round((va + ((vb - va) * (day(d) - day(a))) / (day(b) - day(a))) * 100) / 100
    }
    return 85.4
  }
  // Mifflin × 1,2 dá 12 kcal por kg (2 205 a 85,4 kg).
  const formula = (kg: number) => Math.round(2205 - 12 * (85.4 - kg))
  const TRAINING = 140

  function simulate(anchor: string) {
    const stored: (AdaptiveDay & { tdee_est: number | null; daily_base_est: number; flags: string[] })[] = []
    const lastBefore = <K extends 'tdee_est' | 'daily_base_est'>(cut: string, key: K) =>
      [...stored].reverse().find((r) => r.date < cut && r[key] != null)?.[key] ?? null
    const baseFor = (date: string) => {
      const monday = mondayOf(date)
      const before = stored.filter((r) => r.date < monday)
      const trainings = before.slice(-14).map((r) => Number(r.kcal_exercise ?? 0))
      const avg = trainings.length ? trainings.reduce((a, b) => a + b, 0) / trainings.length : 0
      const f = formula(trend(date))
      return limitWeeklyBase(
        dailyBase({ completeDays: before.length, tdeeFrozen: trustedTdee(lastBefore(monday, 'tdee_est'), f + avg), avgTrainingKcal: avg, formula: f }),
        lastBefore(monday, 'daily_base_est'),
      )
    }
    for (const w of weeks) {
      for (let i = 0; i < 7; i++) {
        const date = shiftDate(w.monday, i)
        const base = baseFor(date)
        const row = {
          date,
          kcal_in: w.kcal,
          weight_trend: trend(date),
          kcal_exercise: TRAINING,
          formula_base: formula(trend(date)),
          daily_base_est: base.base,
          tdee_est: null as number | null,
          flags: [] as string[],
        }
        stored.push(row)
        const r = adaptiveDay({
          date,
          complete: true,
          rows: stored,
          anchor,
          maintenanceEnabled: true,
          previous: lastBefore(date, 'tdee_est'),
          weekStart: lastBefore(mondayOf(date), 'tdee_est'),
        })
        row.tdee_est = r.tdee
        row.flags = measuredFlags({ limit: r.limit, excluded: r.excluded, baseLimited: base.limited })
      }
    }
    return { stored, base26: baseFor('2026-10-26') }
  }

  it('as 2 primeiras semanas não contam e a base de 26/10 fica entre 2 350 e 2 450 (era 2 524)', () => {
    const { stored, base26 } = simulate('2026-09-28')
    // Nas 2 primeiras semanas não há gasto medido: a base é a fórmula.
    expect(stored.filter((r) => r.date < '2026-10-12').every((r) => r.tdee_est == null && r.flags.includes('gasto_agua'))).toBe(true)
    const weekBase = (monday: string) => stored.find((r) => r.date === monday)!.daily_base_est
    expect(weekBase('2026-10-12')).toBe(formula(trend('2026-10-12')))
    // Depois, no máximo 100 por semana.
    expect(weekBase('2026-10-19') - weekBase('2026-10-12')).toBeLessThanOrEqual(100)
    expect(base26.base - weekBase('2026-10-19')).toBeLessThanOrEqual(100)
    expect(base26.learning).toBe(false)
    expect(base26.base).toBeGreaterThanOrEqual(2350)
    expect(base26.base).toBeLessThanOrEqual(2450)
    // O peso ainda diz mais do que +15 % da fórmula: a nota diz que está limitado.
    expect(measuredNoteFromDays(stored)).toBe('O gasto medido ainda reflete as primeiras semanas; está limitado a +15 % da fórmula.')
    // O gasto medido nunca passa os +15 % da fórmula (mais o treino).
    for (const r of stored) if (r.tdee_est != null) expect(r.tdee_est).toBeLessThanOrEqual(Math.round(r.formula_base! * 1.15 + TRAINING))
  })

  it('com uma âncora antiga, o recomeço depois de 2 semanas sem registos conta na mesma', () => {
    // Âncora a 1/6: a semana de 28/9 seria de pausa e as 2 a seguir fase de água; nada disso entra.
    const { stored, base26 } = simulate('2026-06-01')
    expect(stored.filter((r) => r.date <= '2026-10-18').every((r) => r.flags.includes('gasto_agua'))).toBe(true)
    expect(stored.find((r) => r.date === '2026-10-25')!.tdee_est).not.toBeNull()
    expect(base26.base).toBeLessThan(2450)
  })
})
