import { describe, expect, it } from 'vitest'
import {
  COHERENCE_MIN_DAYS,
  capLabel,
  covers,
  expenditureRows,
  weekCoherence,
  weekFrom,
  type BalancoRows,
  type StoredDay,
} from '../src/lib/balanco-semana'
import type { Profile } from '../src/lib/types'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

const profile = {
  base_kcal: 1800,
  sex: 'm',
  height_cm: 183,
  birth_year: 1986,
  expected_tdee: 2200,
  maintenance_enabled: false,
  maintenance_anchor: null,
  protein_per_meal_g: 30,
} as unknown as Profile

function day(date: string, extra: Partial<StoredDay> = {}): StoredDay {
  return {
    date,
    kcal_in: 0,
    kcal_out_est: null,
    kcal_target: 0,
    kcal_exercise: 0,
    is_complete: false,
    flags: [],
    tdee_est: null,
    formula_base: null,
    daily_base_est: null,
    ...extra,
  }
}

function rows(extra: Partial<BalancoRows> = {}): BalancoRows {
  return {
    from: '2026-10-05',
    to: '2026-11-13',
    daysFrom: '2026-06-07',
    days: [],
    weights: [],
    meals: [],
    pending: [],
    workouts: [],
    health: [],
    reviews: [],
    firstDate: '2026-06-01',
    completeBefore: 0,
    ...extra,
  }
}

describe('P1b: a semana vista sai das linhas lidas uma vez', () => {
  it('covers: as semanas do bloco, até à de hoje', () => {
    const r = rows()
    expect(covers(r, '2026-10-05')).toBe(true)
    expect(covers(r, '2026-11-09')).toBe(true) // a semana de hoje (sexta 13)
    expect(covers(r, '2026-09-28')).toBe(false) // antes do bloco: lê o seu
    expect(covers(r, '2026-11-16')).toBe(false)
  })

  it('expenditureRows: o último gasto medido, os dias completos dos 120 dias e as pesagens até ao fim da semana', () => {
    const r = rows({
      days: [
        day('2026-10-01', { tdee_est: 2300, flags: ['gasto_ritmo'], daily_base_est: 2000, is_complete: true, kcal_exercise: 200 }),
        day('2026-10-02', { is_complete: true, kcal_exercise: 100 }),
        day('2026-10-06', { tdee_est: 2400, is_complete: true }), // depois da segunda: não conta
      ],
      weights: [
        { date: '2026-09-01', kg: 90 },
        { date: '2026-10-08', kg: 88 },
        { date: '2026-10-12', kg: 87 }, // a segunda seguinte: fora
      ],
    })
    const e = expenditureRows(r, '2026-10-05')
    expect(e.frozen).toMatchObject({ date: '2026-10-01', tdee_est: 2300, flags: ['gasto_ritmo'] })
    expect(e.complete.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02'])
    expect(e.prevBase).toBe(2000)
    expect(e.lastWeights).toEqual([90, 88])
    expect(e.weighDates).toEqual(['2026-10-08']) // só os 28 dias até ao fim da semana
  })

  it('weekFrom: refeições por dia, fotos por contar, gasto guardado e proteína dos 14 dias', () => {
    const monday = '2026-11-02'
    const r = rows({
      days: [day('2026-11-02', { kcal_out_est: 2500 }), day('2026-11-03', { flags: ['faltou_algo'] })],
      meals: [
        { date: '2026-11-02', kcal: 600, protein: 40, carbs: 50, fat: 20, slot: 'almoco' },
        { date: '2026-11-02', kcal: 700, protein: 35, carbs: 60, fat: 25, slot: 'jantar' },
        { date: '2026-11-03', kcal: 900, protein: 30, carbs: 60, fat: 25, slot: 'almoco' },
        { date: '2026-11-03', kcal: 900, protein: 30, carbs: 60, fat: 25, slot: 'jantar' },
        { date: '2026-11-04', kcal: 900, protein: 30, carbs: 60, fat: 25, slot: 'almoco' },
        { date: '2026-11-04', kcal: 900, protein: 30, carbs: 60, fat: 25, slot: 'jantar' },
      ],
      pending: ['2026-11-04'],
      reviews: [{ week_start: '2026-10-26', text: 'Semana passada' }],
    })
    const w = weekFrom(profile, r, monday, '2026-11-06')
    expect(w.days).toHaveLength(7)
    expect(w.days[0]).toMatchObject({ date: monday, eaten: 1300, meals: 2, complete: true, out: 2500 })
    expect(w.days[1]).toMatchObject({ complete: false, missing: true }) // «faltou algo»
    expect(w.days[2]!.complete).toBe(false) // foto ainda sem números
    expect(w.lastWeekReview).toBe('Semana passada')
    expect(w.protein.find((p) => p.slot === 'almoco')?.days).toBe(3)
  })

  it('weekFrom: dias completos até ao fim da semana somam os de antes dos dias lidos', () => {
    const r = rows({
      completeBefore: 4,
      days: [day('2026-10-20', { is_complete: true }), day('2026-11-04', { is_complete: true }), day('2026-11-12', { is_complete: true })],
    })
    expect(weekFrom(profile, r, '2026-10-26', '2026-11-13').completeDays).toBe(5)
    expect(weekFrom(profile, r, '2026-11-09', '2026-11-13').completeDays).toBe(7)
  })

  it('weekFrom: a média dos últimos 7 dias completos, sem hoje', () => {
    const days = Array.from({ length: 9 }, (_, i) => day(shiftDate('2026-11-04', i), { is_complete: true, kcal_in: 1000 + i * 100 }))
    const w = weekFrom(profile, rows({ days }), '2026-11-09', '2026-11-12')
    // 04..11 completos até ontem (11): os 7 últimos são 05..11 → 1100..1700
    expect(w.avg7).toBe(1400)
  })
})

describe('K7: «Bate certo» só com dias que cheguem', () => {
  const averages = (days: number) => ({ days, eaten: 1700, plan: 1800, protein: 0, carbs: 0, fat: 0 })
  it('com 1 ou 2 dias completos, não há veredicto', () => {
    expect(weekCoherence({ averages: averages(1), tdeeFrozen: 2300, rate: -0.5, thirdWeek: true })).toBeNull()
    expect(weekCoherence({ averages: averages(COHERENCE_MIN_DAYS - 1), tdeeFrozen: 2300, rate: -0.5, thirdWeek: true })).toBeNull()
  })
  it('a partir de 3 dias, o veredicto da regra', () => {
    expect(weekCoherence({ averages: averages(3), tdeeFrozen: 2300, rate: -0.55, thirdWeek: true })).toBe('bate_certo')
    expect(weekCoherence({ averages: averages(4), tdeeFrozen: 2300, rate: 0.4, thirdWeek: true })).toBe('ainda_nao')
  })
  it('antes da 3.ª semana, sem ritmo ou sem gasto, nada', () => {
    expect(weekCoherence({ averages: averages(5), tdeeFrozen: 2300, rate: -0.5, thirdWeek: false })).toBeNull()
    expect(weekCoherence({ averages: averages(5), tdeeFrozen: 2300, rate: null, thirdWeek: true })).toBeNull()
    expect(weekCoherence({ averages: averages(5), tdeeFrozen: null, rate: -0.5, thirdWeek: true })).toBeNull()
  })
})

describe('K4: a marca do limite de ±400 à vista', () => {
  it('teto e piso', () => {
    expect(capLabel(['gasto_teto400'])).toBe('limitado a +400 da fórmula')
    expect(capLabel(['gasto_ritmo', 'gasto_piso400'])).toBe('limitado a −400 da fórmula')
    expect(capLabel(['gasto_ritmo'])).toBeNull()
  })
})
