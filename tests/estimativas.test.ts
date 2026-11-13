import { describe, expect, it } from 'vitest'
import { mealIsEstimate } from '../api/_lib/rules/estimativas'

// Regra 12: is_estimate em foto e "jantar fora"; % de estimados na semana.
describe('mealIsEstimate', () => {
  it('fotografia é sempre estimativa', () => {
    expect(mealIsEstimate('photo', false, [{ estimated: false }])).toBe(true)
  })

  it('jantar fora é estimativa em qualquer tipo', () => {
    expect(mealIsEstimate('text', true, [{ estimated: false }])).toBe(true)
  })

  it('um item estimado marca a refeição', () => {
    expect(mealIsEstimate('text', false, [{ estimated: false }, { estimated: true }])).toBe(true)
  })

  it('texto preciso não é estimativa', () => {
    expect(mealIsEstimate('text', false, [{ estimated: false }])).toBe(false)
    expect(mealIsEstimate('barcode', false, [{ estimated: false }])).toBe(false)
  })
})
