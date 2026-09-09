import { describe, expect, it } from 'vitest'
import { floorWarning, isDayComplete } from '../api/_lib/rules/day-close'

// Regra 5: >= 2 refeições ou "dia fechado"; < 800 kcal sem marca é incompleto.
describe('isDayComplete', () => {
  it('2 refeições com kcal suficientes é completo', () => {
    expect(isDayComplete({ mealCount: 2, kcalIn: 1400, manuallyClosed: false })).toBe(true)
  })

  it('1 refeição sem marca é incompleto', () => {
    expect(isDayComplete({ mealCount: 1, kcalIn: 900, manuallyClosed: false })).toBe(false)
  })

  it('menos de 800 kcal sem marca é incompleto mesmo com 2 refeições', () => {
    expect(isDayComplete({ mealCount: 2, kcalIn: 799, manuallyClosed: false })).toBe(false)
  })

  it('"dia fechado" torna o dia completo em qualquer caso', () => {
    expect(isDayComplete({ mealCount: 0, kcalIn: 0, manuallyClosed: true })).toBe(true)
    expect(isDayComplete({ mealCount: 1, kcalIn: 500, manuallyClosed: true })).toBe(true)
  })
})

// Regra 6: média de 7 dias completos < kcal_floor_week gera aviso.
describe('floorWarning', () => {
  it('avisa quando a média dos últimos 7 dias completos fica abaixo do chão', () => {
    const days = [1300, 1350, 1380, 1390, 1350, 1300, 1320]
    expect(floorWarning(days, 1400)).toBe(true)
  })

  it('não avisa com a média no chão ou acima', () => {
    const days = [1400, 1400, 1400, 1400, 1400, 1400, 1400]
    expect(floorWarning(days, 1400)).toBe(false)
  })

  it('usa só os 7 dias completos mais recentes', () => {
    const days = [900, 900, 1450, 1450, 1450, 1450, 1450, 1450, 1450]
    expect(floorWarning(days, 1400)).toBe(false)
  })

  it('com menos de 7 dias completos ainda não avisa', () => {
    expect(floorWarning([1000, 1000, 1000], 1400)).toBe(false)
  })
})
