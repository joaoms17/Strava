import { describe, expect, it } from 'vitest'
import {
  adaptiveDay,
  missingWeighings,
  weighingsDrop,
  dayTdee,
  smoothTdee,
  tdeeRaw,
  type ClosedDay,
} from '../api/_lib/rules/adaptativo'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

function makeWindow(n: number, kcal: number, trendStart: number, trendEnd: number): ClosedDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: shiftDate('2026-09-01', i),
    kcal_in: kcal,
    weight_trend: trendStart + ((trendEnd - trendStart) * i) / (n - 1),
  }))
}

// Regra 4: tdee = média(kcal_in) + (trend_inicio - trend_fim) x 7700 / n_dias.
describe('tdeeRaw', () => {
  it('soma a média de kcal com o défice implícito na tendência', () => {
    // 14 dias a 1500 kcal, tendência 85 -> 84,3 (0,7 kg em 13 dias de calendário)
    const raw = tdeeRaw(makeWindow(14, 1500, 85, 84.3))
    expect(raw).toBeCloseTo(1500 + (0.7 * 7700) / 13, 0)
  })

  it('peso estável significa tdee = média de kcal', () => {
    expect(tdeeRaw(makeWindow(14, 1800, 84, 84))).toBeCloseTo(1800, 1)
  })

  it('a ganhar peso, o tdee fica abaixo da média de kcal', () => {
    const raw = tdeeRaw(makeWindow(14, 2500, 84, 84.5))
    expect(raw).toBeLessThan(2500)
  })

  it('com menos de 10 dias completos não há estimativa', () => {
    expect(tdeeRaw(makeWindow(9, 1500, 85, 84.5))).toBeNull()
  })

  it('sem tendência de peso suficiente não há estimativa', () => {
    const window = makeWindow(12, 1500, 85, 84).map((d) => ({ ...d, weight_trend: null }))
    expect(tdeeRaw(window)).toBeNull()
  })
})

describe('smoothTdee', () => {
  it('EMA com alfa 0,1', () => {
    expect(smoothTdee(2000, 2100)).toBeCloseTo(2010, 5)
  })

  it('mexe no máximo 30 kcal por dia (o peso que cai depressa é água)', () => {
    expect(smoothTdee(2190, 3260)).toBe(2220)
    expect(smoothTdee(2190, 1500)).toBe(2160)
  })

  it('a primeira estimativa entra sem suavização', () => {
    expect(smoothTdee(null, 2100)).toBe(2100)
  })
})

// Um passo por dia completo: dias sem registos não mexem no gasto medido.
describe('dayTdee', () => {
  const reference = 2400 // fórmula + treino médio

  it('a primeira estimativa parte do valor pelo peso, mas a 100 da referência', () => {
    expect(dayTdee({ complete: true, previous: null, raw: 2700, reference })).toEqual({ value: 2500, limit: 'ritmo' })
    expect(dayTdee({ complete: true, previous: null, raw: 2450, reference })).toEqual({ value: 2450, limit: null })
  })

  it('um dia incompleto fica com o valor anterior', () => {
    expect(dayTdee({ complete: false, previous: 2430, raw: 2700, reference }).value).toBe(2430)
    expect(dayTdee({ complete: false, previous: null, raw: 2700, reference }).value).toBeNull()
  })

  it('um dia da fase de água fica com o valor anterior', () => {
    expect(dayTdee({ complete: true, excluded: true, previous: 2430, raw: 3200, reference })).toEqual({ value: 2430, limit: null })
  })

  it('uma semana de férias sem registos não dá 7 passos', () => {
    let tdee: number | null = 2430
    for (let i = 0; i < 7; i++) tdee = dayTdee({ complete: false, previous: tdee, raw: 2700, reference, weekStart: 2430 }).value
    expect(tdee).toBe(2430)
    tdee = dayTdee({ complete: true, previous: tdee, raw: 2700, reference, weekStart: 2430 }).value
    expect(tdee).toBe(2457) // 0,1 × (2 700 − 2 430)
  })

  it('no máximo 100 kcal por semana', () => {
    let tdee: number | null = 2400
    for (let i = 0; i < 7; i++) tdee = dayTdee({ complete: true, previous: tdee, raw: 2790, reference, weekStart: 2400 }).value
    expect(tdee).toBe(2500)
    expect(dayTdee({ complete: true, previous: 2500, raw: 2790, reference, weekStart: 2400 }).limit).toBe('ritmo')
  })

  it('o valor medido fica dentro dos limites (±400 da referência sem outros)', () => {
    expect(dayTdee({ complete: true, previous: 3000, raw: 3300, reference, weekStart: 2800 })).toEqual({ value: 2800, limit: 'teto' })
    expect(dayTdee({ complete: true, previous: 2400, raw: 1500, reference, weekStart: 2400 })).toEqual({ value: 2370, limit: 'piso' })
  })

  it('sem dados para medir, um dia completo fica com o valor anterior', () => {
    expect(dayTdee({ complete: true, previous: 2430, raw: null, reference }).value).toBe(2430)
    expect(dayTdee({ complete: true, previous: null, raw: null, reference }).value).toBeNull()
  })
})

// K1: o gasto medido só com pesagens reais suficientes (4 dias de pesagem a
// cobrir 10 dias ou mais), medido entre as pesagens e não entre dias que
// carregam a média.
describe('gasto medido com pesagens reais (K1)', () => {
  const days = (n: number, kcal: number, trend: number | null = 84) =>
    Array.from({ length: n }, (_, i) => ({
      date: shiftDate('2026-09-01', i),
      kcal_in: kcal,
      weight_trend: trend,
      kcal_exercise: 0,
      formula_base: 1900,
    }))

  it('faltam pesagens: pelo número e pelo espaço entre elas', () => {
    expect(missingWeighings([])).toBe(4)
    expect(missingWeighings(['2026-09-05', '2026-09-06'])).toBe(2)
    expect(missingWeighings(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'])).toBe(1)
    expect(missingWeighings(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'])).toBe(0)
    expect(missingWeighings(['2026-09-01', '2026-09-04', '2026-09-08', '2026-09-11'])).toBe(0)
  })

  it('duas pesagens no mesmo fim de semana não dão «peso estável» (gasto = o que comeu)', () => {
    // Antes: o peso médio guardado carregava a mesma média 7 dias e o gasto saía 1 600.
    const window = days(14, 1600, 84)
    expect(tdeeRaw(window)).toBeCloseTo(1600, 0)
    const weighings = [
      { date: '2026-09-05', kg: 84.2 },
      { date: '2026-09-06', kg: 83.8 },
    ]
    expect(tdeeRaw(window, { weighings })).toBeNull()
  })

  it('com pesagens semanais (4 em 3 semanas) mede pela reta das pesagens', () => {
    const window = days(22, 1600, null)
    const weighings = [0, 7, 14, 21].map((d, i) => ({ date: shiftDate('2026-09-01', d), kg: 85 - 0.6 * i }))
    // 0,6 kg por semana = 660 kcal por dia acima do que comeu.
    expect(tdeeRaw(window, { weighings })).toBeCloseTo(1600 + (0.6 * 7700) / 7, 0)
  })

  it('a regressão por troços não atravessa a fase de água', () => {
    const ws = [
      { date: '2026-09-01', kg: 85 },
      { date: '2026-09-05', kg: 84.6 },
      { date: '2026-09-20', kg: 82 },
      { date: '2026-09-24', kg: 81.6 },
    ]
    const r = weighingsDrop(ws, (a, b) => a === '2026-09-05' && b === '2026-09-20')
    expect(r.span).toBe(8)
    expect(r.drop).toBeCloseTo(0.8, 5)
  })

  it('uma pesagem só: sem gasto medido e o estado diz quantas faltam', () => {
    const rows = days(30, 1600, 84)
    const r = adaptiveDay({
      date: rows[rows.length - 1]!.date,
      complete: true,
      rows,
      weighings: [{ date: '2026-09-20', kg: 84 }],
      anchor: null,
      maintenanceEnabled: false,
      previous: null,
      weekStart: null,
    })
    expect(r.raw).toBeNull()
    expect(r.tdee).toBeNull()
    expect(r.missingWeighings).toBe(3)
  })
})
