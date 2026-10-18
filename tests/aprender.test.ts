import { describe, expect, it } from 'vitest'
import { itemsToLearn } from '../api/_lib/rules/aprender'
import type { MealItem } from '../api/_lib/rules/meal-totals'

const item = (name: string, grams: number, confidence: MealItem['confidence'], food_id: string | null = null): MealItem => ({
  name, grams, kcal: grams, protein: 1, carbs: 1, fat: 1, food_id, estimated: confidence !== 'alta', confidence,
})

// Decisão 26: a biblioteca aprende com as refeições, mas nunca com a
// estimativa crua de uma foto.
describe('itemsToLearn', () => {
  const meal = [item('Arroz', 120, 'alta', 'f1'), item('Frango', 150, 'media'), item('Salada', 0, 'alta')]

  it('analisada: só o texto, e só o que tem confiança alta', () => {
    expect(itemsToLearn('analisada', 'text', meal).map((i) => i.name)).toEqual(['Arroz'])
    expect(itemsToLearn('analisada', 'photo', meal)).toEqual([])
  })

  it('confirmada: no texto as estimativas que faltavam; na foto tudo', () => {
    expect(itemsToLearn('confirmada', 'text', meal).map((i) => i.name)).toEqual(['Frango'])
    expect(itemsToLearn('confirmada', 'photo', meal).map((i) => i.name)).toEqual(['Arroz', 'Frango'])
  })

  it('editada: só o que mudou de gramas ou é novo', () => {
    const after = [item('arroz', 60, 'alta', 'f1'), item('Frango', 150, 'media'), item('Ovo', 50, 'alta')]
    expect(itemsToLearn('editada', 'photo', after, meal).map((i) => i.name)).toEqual(['arroz', 'Ovo'])
  })
})
