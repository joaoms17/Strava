import { describe, expect, it } from 'vitest'
import { mealTotals, round1 } from '../api/_lib/rules/meal-totals'

const item = (partial: Partial<Parameters<typeof mealTotals>[0][number]>) => ({
  name: 'x',
  grams: 100,
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  food_id: null,
  estimated: false,
  ...partial,
})

describe('mealTotals', () => {
  it('soma os macros de todos os itens', () => {
    const totals = mealTotals([
      item({ kcal: 155, protein: 12.6, carbs: 1.1, fat: 11 }),
      item({ kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3 }),
    ])
    expect(totals).toEqual({ kcal: 285, protein: 15.3, carbs: 29.3, fat: 11.3 })
  })

  it('arredonda a 1 casa decimal sem erros de vírgula flutuante', () => {
    const totals = mealTotals([
      item({ protein: 0.1 }),
      item({ protein: 0.2 }),
    ])
    expect(totals.protein).toBe(0.3)
  })

  it('refeição vazia soma zero', () => {
    expect(mealTotals([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })
})

describe('round1', () => {
  it('arredonda a 1 casa decimal', () => {
    expect(round1(1.25)).toBe(1.3)
    expect(round1(1.24)).toBe(1.2)
  })
})
