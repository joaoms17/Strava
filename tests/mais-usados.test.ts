import { describe, expect, it } from 'vitest'
import { normalizeFoodName, rankFoodsForSlot } from '../api/_lib/rules/mais-usados'

const food = (id: string, name: string, use_count: number, default_portion_g: number | null = null) => ({
  id,
  name,
  use_count,
  default_portion_g,
})
const item = (name: string, grams: number, food_id: string | null = null) => ({ name, grams, food_id })
// 22:00 em Lisboa (inverno, UTC+0) é ceia; 08:30 é pequeno-almoço.
const ceia = (items: ReturnType<typeof item>[]) => ({ slot: 'ceia' as const, logged_at: '2026-11-10T22:00:00Z', items })

const whey = food('w', 'Whey Prozis', 3, 30)
const farinha = food('f', 'farinha de arroz Prozis', 5, 50)
const ovos = food('o', 'Ovos', 40, 120)
const pao = food('p', 'Pão', 10)

describe('mais usados por momento', () => {
  it('os do momento primeiro (por refeições), depois os outros por uso', () => {
    const meals = [ceia([item('Whey', 25, 'w'), item('x', 40, 'f')]), ceia([item('Whey', 25, 'w')])]
    const r = rankFoodsForSlot([ovos, farinha, whey, pao], meals, 'ceia')
    expect(r.map((u) => u.food.id)).toEqual(['w', 'f', 'o', 'p'])
    expect(r.map((u) => u.inSlot)).toEqual([2, 1, 0, 0])
  })

  it('empate no momento desempata pelo uso geral', () => {
    const meals = [ceia([item('a', 25, 'w'), item('b', 40, 'f')])]
    expect(rankFoodsForSlot([whey, farinha], meals, 'ceia').map((u) => u.food.id)).toEqual(['f', 'w'])
  })

  it('sem food_id liga pelo nome normalizado', () => {
    const meals = [ceia([item('Farinha de Arróz  prozis', 40)])]
    const r = rankFoodsForSlot([farinha], meals, 'ceia')
    expect(r[0]).toMatchObject({ inSlot: 1, grams: 40 })
  })

  it('o mesmo alimento duas vezes na refeição conta uma, com as gramas somadas', () => {
    const meals = [ceia([item('a', 20, 'w'), item('b', 15, 'w')])]
    expect(rankFoodsForSlot([whey], meals, 'ceia')[0]).toMatchObject({ inSlot: 1, grams: 35 })
  })

  it('gramas: mediana no momento; senão a porção habitual; senão 100', () => {
    const meals = [30, 40, 40, 200].map((g) => ceia([item('w', g, 'w')]))
    expect(rankFoodsForSlot([whey], meals, 'ceia')[0]!.grams).toBe(40)
    const pair = [30, 45].map((g) => ceia([item('w', g, 'w')]))
    expect(rankFoodsForSlot([whey], pair, 'ceia')[0]!.grams).toBe(38)
    expect(rankFoodsForSlot([ovos, pao], [], 'ceia').map((u) => u.grams)).toEqual([120, 100])
  })

  it('sem slot, o momento vem da hora; outros momentos não contam', () => {
    const breakfast = { slot: null, logged_at: '2026-11-10T08:30:00Z', items: [item('w', 25, 'w')] }
    expect(rankFoodsForSlot([whey], [breakfast], 'pequeno_almoco')[0]!.inSlot).toBe(1)
    expect(rankFoodsForSlot([whey], [breakfast], 'ceia')[0]!.inSlot).toBe(0)
  })

  it('corta no máximo e aguenta refeições sem itens', () => {
    const r = rankFoodsForSlot([ovos, farinha, whey, pao], [{ slot: 'ceia', logged_at: '2026-11-10T22:00:00Z', items: null }], 'ceia', 2)
    expect(r).toHaveLength(2)
  })

  it('normaliza nomes', () => {
    expect(normalizeFoodName('  Farinha de Arróz  PROZIS ')).toBe('farinha de arroz prozis')
  })
})
