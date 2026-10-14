import { describe, expect, it } from 'vitest'
import { proteinBySlot, shoppingList, shoppingText, waterGoalMl } from '../api/_lib/rules/extras'

const item = (name: string, grams: number) => ({
  name,
  grams,
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  food_id: null,
  estimated: false,
})

describe('proteinBySlot', () => {
  it('média por dia em que a refeição existiu', () => {
    const r = proteinBySlot([
      { date: '2026-10-01', slot: 'pequeno_almoco', protein: 10 },
      { date: '2026-10-01', slot: 'pequeno_almoco', protein: 6 },
      { date: '2026-10-02', slot: 'pequeno_almoco', protein: 20 },
      { date: '2026-10-01', slot: 'jantar', protein: 45 },
      { date: '2026-10-01', slot: null, protein: 99 },
    ])
    expect(r.find((x) => x.slot === 'pequeno_almoco')).toEqual({ slot: 'pequeno_almoco', avg: 18, days: 2 })
    expect(r.find((x) => x.slot === 'jantar')).toEqual({ slot: 'jantar', avg: 45, days: 1 })
  })
})

describe('waterGoalMl', () => {
  it('35 ml/kg a copos de 250, entre 1,5 e 4 L', () => {
    expect(waterGoalMl(84)).toBe(3000)
    expect(waterGoalMl(63)).toBe(2250)
    expect(waterGoalMl(30)).toBe(1500)
    expect(waterGoalMl(null)).toBe(2000)
  })
})

describe('shoppingList', () => {
  it('junta pelo nome e multiplica pelas vezes', () => {
    const lines = shoppingList([
      { items: [item('Arroz', 80), item('Frango', 150)], times: 3 },
      { items: [item('frango', 120), item('Ovo', 0)], times: 2 },
      { items: [item('Nada', 100)], times: 0 },
    ])
    expect(lines).toEqual([
      { name: 'Arroz', grams: 240, times: 3 },
      { name: 'Frango', grams: 690, times: 5 },
      { name: 'Ovo', grams: 0, times: 2 },
    ])
    expect(shoppingText(lines)).toBe('• Arroz — 240 g\n• Frango — 690 g\n• Ovo × 2')
  })
})
