import { describe, expect, it } from 'vitest'
import {
  DIET_MAX_OPTIONS,
  addOption,
  cleanDietMeals,
  dietDay,
  dietSlots,
  dietTotals,
  makeHabitual,
  removeOption,
  type DietFavorite,
} from '../api/_lib/rules/dieta'

const fav = (id: string, kcal: number, protein: number): DietFavorite => ({ id, kcal, protein, carbs: 10, fat: 5 })
const FAVS = new Map([
  ['aveia', fav('aveia', 420, 25)],
  ['ovos', fav('ovos', 350, 28)],
  ['frango', fav('frango', 650, 50)],
  ['iogurte', fav('iogurte', 180, 15)],
  ['salmao', fav('salmao', 600, 42)],
])

describe('dieta com favoritas', () => {
  it('limpa o que vem da base de dados', () => {
    expect(cleanDietMeals(null)).toEqual({})
    expect(cleanDietMeals(['x'])).toEqual({})
    expect(
      cleanDietMeals({ almoco: ['frango', 'frango', 3, ''], brunch: ['x'], jantar: [] }),
    ).toEqual({ almoco: ['frango'] })
    // Só favoritas que existem (as arquivadas saem).
    expect(cleanDietMeals({ almoco: ['frango', 'apagada'] }, new Set(['frango']))).toEqual({ almoco: ['frango'] })
  })

  it('refeições pela ordem do dia', () => {
    expect(dietSlots({ jantar: ['salmao'], pequeno_almoco: ['aveia'] })).toEqual(['pequeno_almoco', 'jantar'])
  })

  it('total do dia: a habitual de cada refeição', () => {
    const totals = dietTotals({ pequeno_almoco: ['aveia', 'ovos'], almoco: ['frango'], lanche: ['iogurte'], jantar: ['salmao'] }, FAVS)
    expect(totals).toEqual({ kcal: 1850, protein: 132, carbs: 40, fat: 20, meals: 4 })
    expect(dietTotals({ almoco: ['desconhecida'] }, FAVS).meals).toBe(0)
  })

  it('o dia: o que já foi registado e se foi da dieta', () => {
    const day = dietDay({ pequeno_almoco: ['aveia', 'ovos'], almoco: ['frango'], jantar: ['salmao'] }, [
      { slot: 'pequeno_almoco', favorite_id: 'ovos' },
      { slot: 'almoco', favorite_id: null },
    ])
    expect(day).toEqual([
      { slot: 'pequeno_almoco', options: ['aveia', 'ovos'], done: true, followed: 'ovos' },
      { slot: 'almoco', options: ['frango'], done: true, followed: null },
      { slot: 'jantar', options: ['salmao'], done: false, followed: null },
    ])
  })

  it('juntar, tirar e passar a habitual', () => {
    let meals = addOption({}, 'almoco', 'frango')
    meals = addOption(meals, 'almoco', 'salmao')
    meals = addOption(meals, 'almoco', 'frango')
    expect(meals).toEqual({ almoco: ['frango', 'salmao'] })
    expect(makeHabitual(meals, 'almoco', 'salmao')).toEqual({ almoco: ['salmao', 'frango'] })
    expect(makeHabitual(meals, 'almoco', 'outra')).toBe(meals)
    expect(removeOption(removeOption(meals, 'almoco', 'frango'), 'almoco', 'salmao')).toEqual({})
  })

  it('no máximo algumas alternativas por refeição', () => {
    let meals = {}
    for (let i = 0; i < DIET_MAX_OPTIONS + 2; i++) meals = addOption(meals, 'lanche', `f${i}`)
    expect((meals as { lanche: string[] }).lanche).toHaveLength(DIET_MAX_OPTIONS)
  })
})
