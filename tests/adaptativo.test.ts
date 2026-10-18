import { describe, expect, it } from 'vitest'
import {
  dayTdee,
  paceKgPerWeek,
  shouldAdjustBase,
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

describe('shouldAdjustBase', () => {
  it('propõe ajuste com diferença acima de 250 kcal', () => {
    expect(shouldAdjustBase(2451, 2200)).toBe(true)
    expect(shouldAdjustBase(1949, 2200)).toBe(true)
    expect(shouldAdjustBase(2450, 2200)).toBe(false)
  })
})

describe('paceKgPerWeek', () => {
  it('défice de 700 kcal/dia = -0,64 kg/semana', () => {
    expect(paceKgPerWeek(1500, 2200)).toBeCloseTo(-0.64, 2)
  })
})

// Um passo por dia completo: dias sem registos não mexem no gasto medido.
describe('dayTdee', () => {
  const reference = 2400 // fórmula + treino médio

  it('a primeira estimativa parte da referência, no máximo 30 kcal', () => {
    expect(dayTdee({ complete: true, previous: null, raw: 2700, reference })).toBe(2430)
  })

  it('um dia incompleto fica com o valor anterior', () => {
    expect(dayTdee({ complete: false, previous: 2430, raw: 2700, reference })).toBe(2430)
    expect(dayTdee({ complete: false, previous: null, raw: 2700, reference })).toBeNull()
  })

  it('uma semana de férias sem registos não dá 7 passos', () => {
    let tdee: number | null = 2430
    for (let i = 0; i < 7; i++) tdee = dayTdee({ complete: false, previous: tdee, raw: 2700, reference })
    expect(tdee).toBe(2430)
    tdee = dayTdee({ complete: true, previous: tdee, raw: 2700, reference })
    expect(tdee).toBe(2457) // 0,1 × (2 700 − 2 430)
  })

  it('o valor medido fica a ±400 da referência', () => {
    expect(dayTdee({ complete: true, previous: 3000, raw: 3300, reference })).toBe(2800)
    expect(dayTdee({ complete: true, previous: 2400, raw: 1500, reference })).toBe(2370)
  })

  it('sem dados para medir, um dia completo fica sem estimativa', () => {
    expect(dayTdee({ complete: true, previous: 2430, raw: null, reference })).toBeNull()
  })
})
