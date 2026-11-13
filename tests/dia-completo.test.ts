import { describe, expect, it } from 'vitest'
import { isDayComplete, streakFromDays } from '../api/_lib/rules/day-close'

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

  it('uma foto ainda sem números deixa o dia incompleto, até «Sim, foi tudo»', () => {
    expect(isDayComplete({ mealCount: 2, kcalIn: 1100, manuallyClosed: false, uncountedMeals: 1 })).toBe(false)
    expect(isDayComplete({ mealCount: 2, kcalIn: 1100, manuallyClosed: true, uncountedMeals: 1 })).toBe(true)
    expect(isDayComplete({ mealCount: 2, kcalIn: 1100, manuallyClosed: false, uncountedMeals: 0 })).toBe(true)
  })

  it('"faltou algo" tira o dia das contas, mesmo com refeições suficientes', () => {
    expect(
      isDayComplete({ mealCount: 3, kcalIn: 1800, manuallyClosed: false, missingSomething: true }),
    ).toBe(false)
    expect(
      isDayComplete({ mealCount: 3, kcalIn: 1800, manuallyClosed: true, missingSomething: true }),
    ).toBe(false)
  })
})

// Regra 6: média de 7 dias completos < kcal_floor_week gera aviso.
describe('streakFromDays (H3: a sequência pelos dias guardados)', () => {
  const full = { mealCount: 3, kcalIn: 1800 }
  it('dias fechados pelo is_complete; hoje e ontem pelas refeições', () => {
    const days = [
      { date: '2026-10-11', is_complete: true, kcal_in: 1800 },
      { date: '2026-10-10', is_complete: true, kcal_in: 1700 },
      { date: '2026-10-09', is_complete: false, kcal_in: 600 }, // quebra
      { date: '2026-10-08', is_complete: true, kcal_in: 1900 },
    ]
    // Ontem ainda sem fecho (a linha não existe): conta pelas refeições.
    expect(streakFromDays(days, { '2026-10-13': full, '2026-10-12': full }, '2026-10-13')).toBe(4)
    expect(streakFromDays(days, { '2026-10-13': { mealCount: 1, kcalIn: 300 }, '2026-10-12': full }, '2026-10-13')).toBe(3)
  })

  it('«faltou algo» com refeições não soma nem quebra; um dia por recalcular conta pelas refeições', () => {
    const days = [
      { date: '2026-10-12', is_complete: false, kcal_in: 900, flags: ['faltou_algo'] },
      { date: '2026-10-11', is_complete: false, kcal_in: 500 }, // dirty: as refeições dizem que está completo
      { date: '2026-10-10', is_complete: true, kcal_in: 1800 },
    ]
    expect(streakFromDays(days, { '2026-10-11': full }, '2026-10-13')).toBe(2)
    expect(streakFromDays(days, {}, '2026-10-13')).toBe(0)
  })

  it('uma sequência longa não se perde (mais de 1 000 refeições)', () => {
    const days = Array.from({ length: 400 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 12) - i * 86_400_000).toISOString().slice(0, 10),
      is_complete: true,
      kcal_in: 1800,
    }))
    expect(streakFromDays(days, {}, '2026-10-13', 365)).toBe(365)
  })
})
