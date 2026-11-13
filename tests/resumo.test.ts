import { describe, expect, it } from 'vitest'
import {
  REVIEW_LOOKBACK_WEEKS,
  REVIEW_WEEKS_PER_NIGHT,
  dataFingerprint,
  reviewHeadline,
  reviewWeeks,
  weekHasData,
} from '../api/_lib/rules/resumo'
import { weeklyRateAsOf } from '../api/_lib/rules/weight'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

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

describe('o resumo diz o mesmo que o topo do Balanço', () => {
  const weekStart = '2026-10-05'
  const day = (date: string, kcal_in: number, kcal_out_est: number | null, is_complete: boolean) => ({
    date,
    kcal_in,
    kcal_out_est,
    is_complete,
  })
  const days = [
    day('2026-10-05', 1800, 2400, true),
    day('2026-10-06', 1950, 2500, true),
    day('2026-10-07', 430, 2300, false), // só o almoço
    day('2026-10-08', 1700, 2350, true),
    day('2026-10-09', 0, 2300, false), // nada registado
    day('2026-10-10', 2100, 2600, false), // «faltou algo»
    day('2026-10-11', 2000, 2450, true),
  ]
  const mealDates = ['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-08', '2026-10-10', '2026-10-10', '2026-10-11', '2026-10-11']
  // 30 dias de pesagens a descer até ao domingo.
  const weights = Array.from({ length: 30 }, (_, i) => ({ date: shiftDate('2026-10-11', -29 + i), kg: 90 - i * 0.05 }))

  it('a diferença comer − gasto das médias dos dias completos, a 10', () => {
    // (1800 + 1950 + 1700 + 2000) / 4 = 1862,5; (2400 + 2500 + 2350 + 2450) / 4 = 2425 → −562,5 → −560.
    expect(reviewHeadline({ weekStart, days, mealDates, weights }).comeuMenosGasto).toBe(-560)
  })

  it('o ritmo do peso é o do Balanço (das pesagens até domingo) e só com uma pesagem recente', () => {
    const asBalanco = weeklyRateAsOf(
      weights.filter((w) => w.date >= shiftDate('2026-10-11', -40)).map((w) => ({ date: w.date, value: w.kg })),
      '2026-10-11',
    )
    const { ritmoKgSemana } = reviewHeadline({ weekStart, days, mealDates, weights })
    expect(ritmoKgSemana).toBe(asBalanco)
    expect(ritmoKgSemana).toBeCloseTo(-0.35, 2)
    const old = weights.filter((w) => w.date <= '2026-10-06')
    expect(reviewHeadline({ weekStart, days, mealDates, weights: old }).ritmoKgSemana).toBeNull()
  })

  it('os dias de fora: com refeições e incompletos (um dia sem nada não conta)', () => {
    expect(reviewHeadline({ weekStart, days, mealDates, weights }).diasDeFora).toEqual(['2026-10-07', '2026-10-10'])
  })

  it('sem dias completos não há diferença', () => {
    const none = days.map((d) => ({ ...d, is_complete: false }))
    expect(reviewHeadline({ weekStart, days: none, mealDates, weights: [] })).toEqual({
      comeuMenosGasto: null,
      ritmoKgSemana: null,
      diasDeFora: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-10', '2026-10-11'],
    })
  })
})

// B9: além da semana anterior, a cron volta a ver as semanas já resumidas
// cujos dias foram fechados de novo (um «dia de fora» respondido há 3
// semanas) e, por ordem, as outras resumidas recentes (um recálculo feito
// durante o dia não deixa marca à noite); a IA só corre se os dados mudaram.
describe('semanas a rever numa noite (B9)', () => {
  const today = '2026-11-13' // sexta
  const prev = '2026-11-02'

  it('sem mais nada, só a semana anterior', () => {
    expect(reviewWeeks({ today, reviewed: [], touched: [] })).toEqual([prev])
  })

  it('a semana anterior primeiro, depois as tocadas esta noite, depois as outras resumidas', () => {
    const reviewed = ['2026-10-12', '2026-10-19', '2026-10-26', prev]
    const touched = ['2026-10-14', '2026-11-12'] // um dia de há 4 semanas e ontem (semana em curso)
    expect(reviewWeeks({ today, reviewed, touched })).toEqual([prev, '2026-10-12', '2026-10-26', '2026-10-19'])
  })

  it('só semanas que já têm resumo, nunca a semana em curso nem uma fora da janela', () => {
    const old = '2026-08-03'
    const weeks = reviewWeeks({ today, reviewed: [old], touched: ['2026-10-14', '2026-08-04', '2026-11-10'] })
    expect(weeks).toEqual([prev])
  })

  it('no máximo REVIEW_WEEKS_PER_NIGHT por pessoa', () => {
    const reviewed = Array.from({ length: REVIEW_LOOKBACK_WEEKS + 3 }, (_, i) => shiftDate(prev, -7 * i))
    const weeks = reviewWeeks({ today, reviewed, touched: [] })
    expect(weeks.length).toBe(Math.min(REVIEW_WEEKS_PER_NIGHT, REVIEW_LOOKBACK_WEEKS))
    expect(weeks[0]).toBe(prev)
    expect(new Set(weeks).size).toBe(weeks.length)
    expect(weeks.every((w) => w >= shiftDate(prev, -7 * (REVIEW_LOOKBACK_WEEKS - 1)))).toBe(true)
  })
})
