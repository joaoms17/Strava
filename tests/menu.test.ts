import { describe, expect, it } from 'vitest'
import { cleanMenu, dayLeft, dishItem, rankDishes, type Dish } from '../api/_lib/rules/menu'

const dish = (name: string, kcal: number, protein: number, type: Dish['type'] = 'prato'): Dish => ({
  name,
  type,
  description: null,
  grams: 400,
  kcal,
  protein,
  carbs: 50,
  fat: 20,
  price: null,
})

describe('cleanMenu', () => {
  it('arruma o que a IA devolveu', () => {
    const out = cleanMenu([
      { nome: '  Bife  de frango grelhado ', tipo: 'prato', descricao: 'com salada', gramas: 350, kcal: 520.4, proteina: 48.26, hidratos: 20, gordura: 22, preco: 11.5 },
      { nome: 'Bife de Frango Grelhado', tipo: 'prato', kcal: 600, proteina: 40 },
      { nome: 'Água', tipo: 'bebida', kcal: 0, proteina: 0 },
      { nome: '', tipo: 'prato', kcal: 500, proteina: 30 },
      { nome: 'Coisa', tipo: 'inventado', kcal: '300', proteina: '12,5' },
    ])
    expect(out).toEqual([
      {
        name: 'Bife de frango grelhado',
        type: 'prato',
        description: 'com salada',
        grams: 350,
        kcal: 520,
        protein: 48.3,
        carbs: 20,
        fat: 22,
        price: 11.5,
      },
      { name: 'Coisa', type: 'outro', description: null, grams: null, kcal: 300, protein: 12.5, carbs: 0, fat: 0, price: null },
    ])
  })

  it('a proteína nunca dá mais calorias do que o prato', () => {
    expect(cleanMenu([{ nome: 'Atum', tipo: 'prato', kcal: 200, proteina: 80 }])[0]!.protein).toBe(50)
  })

  it('no máximo 40 pratos; lixo dá lista vazia', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ nome: `Prato ${i}`, tipo: 'prato', kcal: 500, proteina: 30 }))
    expect(cleanMenu(many)).toHaveLength(40)
    expect(cleanMenu(null)).toEqual([])
    expect(cleanMenu('menu')).toEqual([])
  })
})

describe('dayLeft', () => {
  const base = { baseKcal: 1800, exerciseKcal: 300, maintenance: false, tdee: 2400, kcalIn: 900, proteinIn: 70, proteinTarget: 150 }

  it('a meta com o treino menos o que já comeu', () => {
    expect(dayLeft(base)).toEqual({ kcal: 1200, protein: 80 })
  })

  it('na semana de pausa, a meta é o gasto estimado', () => {
    expect(dayLeft({ ...base, maintenance: true })).toEqual({ kcal: 1500, protein: 80 })
    expect(dayLeft({ ...base, maintenance: true, tdee: null })).toEqual({ kcal: 1100, protein: 80 })
  })

  it('passou o plano e já chegou à proteína', () => {
    expect(dayLeft({ ...base, kcalIn: 2300, proteinIn: 160 })).toEqual({ kcal: -200, protein: 0 })
    expect(dayLeft({ ...base, proteinTarget: null }).protein).toBeNull()
  })
})

describe('rankDishes', () => {
  const menu = [
    dish('Francesinha', 1400, 60),
    dish('Salada de atum', 420, 35),
    dish('Frango grelhado com arroz', 650, 50),
    dish('Bacalhau à Brás', 750, 38),
    dish('Polvo à lagareiro', 700, 45),
    dish('Pudim', 350, 8, 'sobremesa'),
    dish('Sopa de legumes', 120, 4, 'sopa'),
  ]

  it('os que cabem primeiro, pela proteína por caloria', () => {
    const ranked = rankDishes(menu, 1000)
    expect(ranked.map((d) => d.name)).toEqual([
      'Salada de atum',
      'Frango grelhado com arroz',
      'Polvo à lagareiro',
      'Bacalhau à Brás',
      'Francesinha',
    ])
    expect(ranked[0]).toMatchObject({ proteinPer100: 8.3, fits: true, kcalAfter: 580 })
    expect(ranked[4]).toMatchObject({ fits: false, kcalAfter: -400 })
  })

  it('só pratos quando há 3 ou mais', () => {
    expect(rankDishes(menu, 1000).some((d) => d.type !== 'prato')).toBe(false)
  })

  it('com poucos pratos entram as sopas e entradas, nunca sobremesas nem bebidas', () => {
    const small = [dish('Prego', 600, 35), dish('Sopa', 150, 6, 'sopa'), dish('Pudim', 350, 8, 'sobremesa'), dish('Imperial', 150, 1, 'bebida')]
    expect(rankDishes(small, 800).map((d) => d.name)).toEqual(['Prego', 'Sopa'])
  })

  it('com o plano passado: do mais leve para o mais pesado', () => {
    expect(rankDishes(menu, -100).map((d) => d.name).slice(0, 3)).toEqual([
      'Salada de atum',
      'Frango grelhado com arroz',
      'Polvo à lagareiro',
    ])
    const tie = rankDishes([dish('A', 500, 20), dish('B', 500, 40), dish('C', 900, 80)], 0)
    expect(tie.map((d) => d.name)).toEqual(['B', 'A', 'C'])
  })

  it('sem saber o que falta, só pela proteína por caloria', () => {
    const ranked = rankDishes(menu, null)
    expect(ranked.every((d) => d.fits && d.kcalAfter == null)).toBe(true)
    expect(ranked[0]!.name).toBe('Salada de atum')
  })
})

it('o prato escolhido vira um item estimado', () => {
  expect(dishItem({ ...dish('Polvo', 700, 45), grams: null })).toEqual({
    name: 'Polvo',
    grams: 0,
    kcal: 700,
    protein: 45,
    carbs: 50,
    fat: 20,
    food_id: null,
    estimated: true,
  })
})
