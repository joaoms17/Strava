import { describe, expect, it } from 'vitest'
import { diffText, stepItem } from '../src/lib/meal-diff'

const arroz = { name: 'Arroz', grams: 180, kcal: 230, protein: 4.3, carbs: 50, fat: 0.5, food_id: null, estimated: true }
const queijo = { name: 'Queijo', grams: 30, kcal: 110, protein: 7, carbs: 0, fat: 9, food_id: null, estimated: true }

describe('diferença de uma correção', () => {
  it('gramas mudados e kcal a menos', () => {
    expect(diffText([arroz], [{ ...arroz, grams: 90, kcal: 115 }])).toBe('Arroz 180 → 90 g · menos 120 kcal')
  })
  it('item retirado', () => {
    expect(diffText([arroz, queijo], [arroz])).toBe('sem queijo · menos 110 kcal')
  })
})

describe('passos de 10 g', () => {
  it('escala kcal e macros e deixa de ser estimativa', () => {
    const next = stepItem(arroz, 10)
    expect(next).toMatchObject({ grams: 190, estimated: false, confidence: 'alta' })
    expect(next.kcal).toBeCloseTo(242.8, 1)
  })
  it('nunca abaixo de 5 g e itens sem gramas não mexem', () => {
    expect(stepItem({ ...arroz, grams: 8 }, -10).grams).toBe(5)
    const quick = { ...arroz, grams: 0 }
    expect(stepItem(quick, 10)).toBe(quick)
  })
})
