import { describe, expect, it } from 'vitest'
import { favoriteName, rankFavorites, rescaleItems, scaleItems } from '../api/_lib/rules/favoritos'
import { mealTotals } from '../api/_lib/rules/meal-totals'

const item = (name: string, grams: number, kcal: number, protein: number) => ({
  name,
  grams,
  kcal,
  protein,
  carbs: 10,
  fat: 5,
  food_id: null,
  estimated: false,
})

describe('porções dos favoritos', () => {
  it('meia porção divide itens e totais', () => {
    const items = [item('Iogurte', 170, 100, 17), item('Aveia', 40, 150, 5)]
    const half = scaleItems(items, 0.5)
    expect(half[0]).toMatchObject({ grams: 85, kcal: 50, protein: 8.5, carbs: 5, fat: 2.5 })
    expect(mealTotals(half).kcal).toBe(125)
  })

  it('mudar de 1½ para 2 parte da porção original', () => {
    const base = [item('Arroz', 100, 130, 2.7)]
    const oneAndHalf = scaleItems(base, 1.5)
    expect(rescaleItems(oneAndHalf, 1.5, 2)[0]).toMatchObject({ grams: 200, kcal: 260 })
  })
})

describe('ordem dos favoritos', () => {
  const fav = (id: string, slot: 'almoco' | 'pequeno_almoco' | null, uses: number, last: string | null = null) => ({
    id,
    default_slot: slot,
    use_count: uses,
    last_used_at: last,
  })

  it('primeiro os do momento, depois os mais usados', () => {
    const ranked = rankFavorites(
      [fav('a', 'almoco', 20), fav('b', 'pequeno_almoco', 3), fav('c', null, 9), fav('d', 'pequeno_almoco', 7)],
      'pequeno_almoco',
    )
    expect(ranked.map((f) => f.id)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('empate de usos: o mais recente primeiro', () => {
    const ranked = rankFavorites(
      [fav('a', null, 2, '2026-09-01T10:00:00Z'), fav('b', null, 2, '2026-09-20T10:00:00Z')],
      'almoco',
    )
    expect(ranked.map((f) => f.id)).toEqual(['b', 'a'])
  })
})

describe('nome de um favorito novo', () => {
  it('junta até 3 itens', () => {
    expect(favoriteName([{ name: 'Iogurte' }, { name: 'aveia' }, { name: 'banana' }])).toBe(
      'Iogurte + aveia + banana',
    )
    expect(favoriteName([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }])).toBe(
      'a + b + c + …',
    )
    expect(favoriteName([])).toBe('Refeição')
  })
})
