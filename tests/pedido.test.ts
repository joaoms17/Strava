import { describe, expect, it } from 'vitest'
import {
  MAX_ORDER_PEOPLE,
  dedupeOrderLines,
  dropNonFood,
  nonFoodLine,
  orderHintText,
  orderPeople,
  orderSplitHint,
  pendingSplit,
} from '../api/_lib/rules/pedido'
import { toMealItems } from '../api/_lib/rules/analise'
import { outputSchema, parseStructured } from '../api/_lib/rules/resposta-ia'
import { MealAnalysisSchema, MealPhotoAnalysisSchema } from '../api/_lib/schemas'
import { mealAnalysedNotice } from '../api/_lib/rules/notificacoes'

const line = (name: string, grams: number, kcal: number) => ({ name, grams, kcal, protein: 0, carbs: 0, fat: 0 })

// O jantar de sushi de entrega numa captura do Glovo: os pratos, as bebidas
// e os molhos contam; as taxas, a gorjeta e o saco nunca.
describe('linhas que não são comida', () => {
  it('taxas, gorjeta, descontos e totais saem sempre (PT e EN)', () => {
    for (const name of [
      'Taxa de entrega',
      'Taxa de serviço',
      'Taxas e outros encargos',
      'Taxa de saco',
      'Gorjeta para o estafeta',
      'Desconto Glovo Prime',
      'Cupão BEMVINDO',
      'Subtotal',
      'Sub total',
      'Total',
      'IVA incluído',
      'Entrega grátis',
      'Delivery fee',
      'Service fee',
      'Small order fee',
      'Tip for your courier',
      'Discount',
    ]) {
      expect(nonFoodLine(line(name, 0, 0)), name).toBe(true)
      // Mesmo que a IA lhes dê números.
      expect(nonFoodLine(line(name, 100, 150)), name).toBe(true)
    }
  })

  it('saco, talheres e pauzinhos saem com (quase) zero kcal, mas um saco de gomas conta', () => {
    expect(nonFoodLine(line('Saco', 0, 0))).toBe(true)
    expect(nonFoodLine(line('Saco de papel', 20, 0))).toBe(true)
    expect(nonFoodLine(line('Talheres', 30, 0))).toBe(true)
    expect(nonFoodLine(line('Pauzinhos (2)', 10, 0))).toBe(true)
    expect(nonFoodLine(line('Hashi', 10, 0))).toBe(true)
    expect(nonFoodLine(line('Cutlery', 0, 0))).toBe(true)
    expect(nonFoodLine(line('Saco de gomas', 100, 340))).toBe(false)
  })

  it('pratos, bebidas, sobremesas e molhos ficam, também os de poucas kcal', () => {
    for (const [name, grams, kcal] of [
      ['2× Poke de salmão', 900, 1300],
      ['Combinado 24 peças', 600, 1050],
      ['Coca-Cola 33 cl', 330, 139],
      ['Coca-Cola Zero 33 cl', 330, 1],
      ['Água 50 cl', 500, 0],
      ['Molho de soja (2)', 30, 16],
      ['Wasabi', 5, 5],
      ['Mochi de manga', 70, 160],
      ['Tipo de arroz: integral', 200, 230],
      ['Menu Entregas Rápidas', 400, 700],
    ] as const) {
      expect(nonFoodLine(line(name, grams, kcal)), name).toBe(false)
    }
  })

  it('uma linha sem gramas nem kcal não tem nada para contar', () => {
    expect(nonFoodLine(line('Oferta', 0, 0))).toBe(true)
    expect(nonFoodLine(line('   ', 100, 100))).toBe(true)
  })

  it('dropNonFood tira só essas linhas e mantém a ordem', () => {
    const items = [line('2× Poke de salmão', 900, 1300), line('Taxa de entrega', 0, 0), line('Coca-Cola 33 cl', 330, 139), line('Saco', 0, 0)]
    expect(dropNonFood(items).map((i) => i.name)).toEqual(['2× Poke de salmão', 'Coca-Cola 33 cl'])
  })
})

describe('duas capturas sobrepostas', () => {
  it('a mesma linha com os mesmos números conta uma vez', () => {
    const items = [line('2× Gyoza de frango', 240, 480), line('Combinado 24 peças', 600, 1050), line('2× gyoza de frango ', 240, 480)]
    expect(dedupeOrderLines(items).map((i) => i.name)).toEqual(['2× Gyoza de frango', 'Combinado 24 peças'])
  })
  it('o mesmo prato com outra quantidade fica (não é a mesma linha)', () => {
    const items = [line('Poke de salmão', 450, 650), line('Poke de salmão', 400, 600)]
    expect(dedupeOrderLines(items)).toHaveLength(2)
  })
})

describe('para quantas pessoas é o pedido', () => {
  it('só de 2 a 12, inteiro', () => {
    expect(orderPeople(2)).toBe(2)
    expect(orderPeople('3')).toBe(3)
    expect(orderPeople(MAX_ORDER_PEOPLE)).toBe(12)
    for (const n of [null, undefined, 0, 1, 2.5, 13, -2, 'dois', Number.NaN]) expect(orderPeople(n), String(n)).toBeNull()
  })

  it('fica à espera só quando a pessoa não disse como dividiram', () => {
    const plain = { share_with: [], share_split: null, tags: [], portion_factor: 1 }
    expect(pendingSplit(2, plain)).toBe(2)
    expect(pendingSplit(null, plain)).toBeNull()
    // «Também para Joana» (a meias ou cada um a toda), «Comi metade» ou outra porção: já disse.
    expect(pendingSplit(2, { ...plain, share_with: ['joana'] })).toBeNull()
    expect(pendingSplit(2, { ...plain, share_split: 0.5 })).toBeNull()
    expect(pendingSplit(2, { ...plain, tags: ['comi_metade'] })).toBeNull()
    expect(pendingSplit(2, { ...plain, portion_factor: 0.5 })).toBeNull()
    // Outras marcas não dizem nada sobre a divisão; sem as migrações, as colunas não vêm.
    expect(pendingSplit(2, { tags: ['jantar_fora', 'sem_molho'] })).toBe(2)
    expect(pendingSplit(2, { portion_factor: '1.00' })).toBe(2)
  })
})

describe('a dica «Pedido para 2»', () => {
  const meal = { order_people: 2, status: 'por_rever', deleted_at: null, note: null, portion_factor: 1, share_with: [], share_split: null, tags: [] }
  it('numa refeição por rever, ainda por dividir', () => {
    expect(orderSplitHint(meal)).toBe(2)
    expect(orderHintText(2)).toBe('Pedido para 2 · divide em Porção ½ ou partilha a meias')
    expect(orderHintText(3)).toBe('Pedido para 3 · escolhe a tua porção')
  })
  it('sai quando se confirma, se divide, se apaga ou numa cópia partilhada', () => {
    expect(orderSplitHint({ ...meal, status: 'ok' })).toBeNull()
    expect(orderSplitHint({ ...meal, status: 'a_analisar' })).toBeNull()
    expect(orderSplitHint({ ...meal, portion_factor: 0.5 })).toBeNull()
    expect(orderSplitHint({ ...meal, deleted_at: '2026-10-18T21:00:00Z' })).toBeNull()
    expect(orderSplitHint({ ...meal, note: 'Partilhada por João' })).toBeNull()
    expect(orderSplitHint({ ...meal, order_people: null })).toBeNull()
    // Sem a migração 20261018220000 a coluna não vem: sem dica.
    const { order_people: _, ...without } = meal
    expect(orderSplitHint(without)).toBeNull()
  })
  it('o aviso «Jantar analisado» diz o mesmo', () => {
    const n = mealAnalysedNotice({ id: 'm', date: '2026-10-18', slot: 'jantar', kcal: 2410, status: 'por_rever', orderPeople: 2 })
    expect(n.title).toBe('Jantar analisado · 2410 kcal')
    expect(n.body).toBe('Pedido para 2 · divide em Porção ½ ou partilha a meias.')
    expect(mealAnalysedNotice({ id: 'm', date: '2026-10-18', slot: 'jantar', kcal: 800, status: 'por_rever', orderPeople: null }).body).toBe(
      'Vê se as porções estão certas.',
    )
  })
})

// A resposta da foto (meal-photo v3) com o bloco do pedido, num schema só
// das fotos: o do texto, do juntar e das correções fica igual.
describe('schema da foto com o pedido', () => {
  const answer = {
    title: 'Sushi Kyoto (Glovo)',
    items: [
      { name: 'Combinado 24 peças', grams: 600, kcal: 1050, protein: 45, carbs: 150, fat: 28, confidence: 'media', food_ref: null },
      { name: '2× Poke de salmão', grams: 900, kcal: 1300, protein: 70, carbs: 160, fat: 40, confidence: 'media', food_ref: null },
    ],
    meal_confidence: 'media',
  }

  it('lê o pedido (app, restaurante, pessoas)', () => {
    const json = outputSchema(MealPhotoAnalysisSchema)
    const parsed = parseStructured(JSON.stringify({ ...answer, order: { app: 'Glovo', restaurant: 'Kyoto', people: 2 } }), MealPhotoAnalysisSchema, json)
    expect(parsed.order).toEqual({ app: 'Glovo', restaurant: 'Kyoto', people: 2 })
  })

  it('uma foto de comida devolve order null (e sem o campo também passa)', () => {
    const json = outputSchema(MealPhotoAnalysisSchema)
    expect(parseStructured(JSON.stringify({ ...answer, order: null }), MealPhotoAnalysisSchema, json).order).toBeNull()
    expect(parseStructured(JSON.stringify(answer), MealPhotoAnalysisSchema, json).order).toBeNull()
  })

  it('o schema das outras análises não tem o pedido', () => {
    const json = outputSchema(MealAnalysisSchema) as { properties: Record<string, unknown> }
    expect(Object.keys(json.properties)).toEqual(['title', 'items', 'meal_confidence'])
    const photo = outputSchema(MealPhotoAnalysisSchema) as { properties: Record<string, unknown>; required: string[] }
    expect(photo.required).toContain('order')
  })

  it('o que passa a filtragem entra com as guardas de sempre (números impossíveis → baixa)', () => {
    const items = toMealItems(
      dropNonFood([
        ...answer.items.map((i) => ({ ...i, confidence: 'media' as const })),
        { name: 'Taxa de entrega', grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: 'alta' as const, food_ref: null },
        { name: 'Coca-Cola 33 cl', grams: 330, kcal: 3390, protein: 0, carbs: 35, fat: 0, confidence: 'media' as const, food_ref: null },
      ]),
      {},
    )
    expect(items.map((i) => [i.name, i.confidence])).toEqual([
      ['Combinado 24 peças', 'media'],
      ['2× Poke de salmão', 'media'],
      ['Coca-Cola 33 cl', 'baixa'],
    ])
  })
})
