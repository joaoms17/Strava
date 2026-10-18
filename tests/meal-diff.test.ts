import { describe, expect, it } from 'vitest'
import { MAX_ITEM_GRAMS, diffText, setItemGrams, stepItem } from '../src/lib/meal-diff'

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

describe('gramas escritas à mão', () => {
  it('escala kcal e macros na mesma proporção e deixa de ser estimativa', () => {
    const next = setItemGrams(arroz, 90)
    expect(next).toMatchObject({ grams: 90, kcal: 115, protein: 2.2, carbs: 25, fat: 0.3, estimated: false, confidence: 'alta' })
  })
  it('230 → 120 g de uma vez (antes eram 11 toques no −)', () => {
    const batata = { name: 'Batata cozida', grams: 230, kcal: 200, protein: 4.6, carbs: 44, fat: 0.2, food_id: null, estimated: true }
    expect(setItemGrams(batata, 120)).toMatchObject({ grams: 120, kcal: 104.3 })
  })
  it('o mesmo número, vazio, 0 ou negativo não mexe; o máximo tem teto', () => {
    expect(setItemGrams(arroz, 180)).toBe(arroz)
    expect(setItemGrams(arroz, Number.NaN)).toBe(arroz)
    expect(setItemGrams(arroz, 0)).toBe(arroz)
    expect(setItemGrams(arroz, -20)).toBe(arroz)
    expect(setItemGrams(arroz, 99_999).grams).toBe(MAX_ITEM_GRAMS)
  })
  it('itens sem gramas («Registo rápido») não mexem', () => {
    const quick = { ...arroz, grams: 0 }
    expect(setItemGrams(quick, 100)).toBe(quick)
  })
  it('decimais com uma casa', () => {
    expect(setItemGrams(arroz, 92.46).grams).toBe(92.5)
  })
})
