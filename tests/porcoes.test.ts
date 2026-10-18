import { describe, expect, it } from 'vitest'
import {
  MAX_UNDO_ROWS,
  canChangePortion,
  copyPhotos,
  factorOf,
  isFactor,
  isSplit,
  joinNames,
  liveCopies,
  portionRow,
  portionToast,
  shareToast,
  slotScope,
  slotScopeLabel,
  splitFactors,
  splitFor,
  splitLabel,
  splitText,
  undoPlan,
  type ScopeMeal,
} from '../api/_lib/rules/porcoes'
import { portionLabel, rescaleItems } from '../api/_lib/rules/favoritos'
import { mealTotals } from '../api/_lib/rules/meal-totals'

const kcal = (n: number) => String(Math.round(n / 10) * 10)

// A porção gravada: as quatro de sempre e as de uma divisão.
describe('isFactor', () => {
  it('aceita de 0,1 a 3 com duas casas', () => {
    for (const f of [0.1, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.5, 2, 3]) expect(isFactor(f)).toBe(true)
  })
  it('recusa o resto', () => {
    for (const f of [0, 0.05, 3.01, 4, -1, 0.333, Number.NaN, Number.POSITIVE_INFINITY]) expect(isFactor(f)).toBe(false)
    expect(isFactor('0.5')).toBe(false)
    expect(isFactor(null)).toBe(false)
  })
  it('a porção lida da base: vazia ou estranha é 1', () => {
    expect(factorOf(null)).toBe(1)
    expect(factorOf('0.6')).toBe(0.6)
    expect(factorOf(0)).toBe(1)
    expect(factorOf('x')).toBe(1)
  })
})

describe('portionRow e portionLabel', () => {
  it('½ · 1 · 1½ · 2 quando a porção é uma delas', () => {
    expect(portionRow(1).map(portionLabel)).toEqual(['½', '1', '1½', '2'])
    expect(portionRow(0.5)).toHaveLength(4)
  })
  it('a de uma divisão aparece também, por ordem', () => {
    expect(portionRow(0.6).map(portionLabel)).toEqual(['½', '0,6', '1', '1½', '2'])
    expect(portionRow(0.4).map(portionLabel)).toEqual(['0,4', '½', '1', '1½', '2'])
    expect(portionRow(0.75).map(portionLabel)).toEqual(['½', '0,75', '1', '1½', '2'])
  })
  it('uma porção impossível não entra', () => {
    expect(portionRow(7)).toHaveLength(4)
  })
})

// «Todo o jantar»: o jantar de entrega em 5 fotos.
describe('slotScope', () => {
  const meal = (id: string, over: Partial<ScopeMeal> = {}): ScopeMeal => ({
    id,
    date: '2026-10-18',
    slot: 'jantar',
    logged_at: '2026-10-18T19:40:00.000Z',
    status: 'ok',
    items: [{}],
    deleted_at: null,
    ...over,
  })

  it('a aberta primeiro e as outras do mesmo dia e momento pela hora', () => {
    const open = meal('poke', { logged_at: '2026-10-18T19:50:00.000Z' })
    const day = [
      meal('combi', { logged_at: '2026-10-18T19:40:00.000Z' }),
      open,
      meal('gunkan', { logged_at: '2026-10-18T19:42:00.000Z', status: 'por_rever' }),
      meal('almoco', { slot: 'almoco', logged_at: '2026-10-18T12:10:00.000Z' }),
      meal('ontem', { date: '2026-10-17' }),
      meal('apagada', { deleted_at: '2026-10-18T20:00:00.000Z' }),
      meal('a-analisar', { status: 'a_analisar', items: [] }),
      meal('sem-itens', { items: [] }),
    ]
    expect(slotScope(open, day).map((m) => m.id)).toEqual(['poke', 'combi', 'gunkan'])
  })

  it('sem momento gravado, conta o da hora (19:30–21:59 é jantar)', () => {
    const open = meal('a', { slot: null, logged_at: '2026-10-18T20:00:00.000Z' })
    const other = meal('b', { slot: 'jantar' })
    expect(slotScope(open, [open, other]).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('uma refeição que não se pode mudar fica sozinha', () => {
    const open = meal('x', { status: 'erro', items: [] })
    expect(slotScope(open, [open, meal('y')]).map((m) => m.id)).toEqual(['x'])
    expect(canChangePortion(open)).toBe(false)
  })

  it('«Todo o jantar (5)», «Toda a ceia (2)»', () => {
    expect(slotScopeLabel('jantar', 5)).toBe('Todo o jantar (5)')
    expect(slotScopeLabel('pequeno_almoco', 2)).toBe('Todo o pequeno-almoço (2)')
    expect(slotScopeLabel('ceia', 2)).toBe('Toda a ceia (2)')
  })
})

describe('dividir ao partilhar', () => {
  it('a meias: metade para cada um', () => {
    expect(splitFactors(1, 0.5)).toEqual({ own: 0.5, copy: 0.5 })
  })
  it('João 60 · Joana 40', () => {
    expect(splitFactors(1, 0.6)).toEqual({ own: 0.6, copy: 0.4 })
    expect(splitFactors(1, 0.3)).toEqual({ own: 0.3, copy: 0.7 })
  })
  it('parte da porção que a refeição já tinha', () => {
    expect(splitFactors(2, 0.5)).toEqual({ own: 1, copy: 1 })
    expect(splitFactors(1.5, 0.6)).toEqual({ own: 0.9, copy: 0.6 })
  })
  it('sem divisão, cada um comeu isto tudo', () => {
    expect(splitFactors(1.5, null)).toEqual({ own: 1.5, copy: 1.5 })
  })
  it('nunca abaixo de 0,1', () => {
    expect(splitFactors(0.2, 0.3)).toEqual({ own: 0.1, copy: 0.1 })
  })
  it('as duas partes somam a porção que havia', () => {
    for (const base of [0.5, 0.75, 1, 1.25, 1.5, 2, 0.6]) {
      for (const split of [0.5, 0.7, 0.6, 0.4, 0.3]) {
        const { own, copy } = splitFactors(base, split)
        expect(Math.round((own + copy) * 100)).toBe(Math.round(base * 100))
      }
    }
    expect(splitFactors(0.75, 0.5)).toEqual({ own: 0.38, copy: 0.37 })
  })
  it('os itens e os totais ficam certos', () => {
    const items = [{ name: 'Poke de salmão', grams: 420, kcal: 640, protein: 32, carbs: 80, fat: 20, food_id: null, estimated: true }]
    const { own, copy } = splitFactors(1, 0.6)
    expect(mealTotals(rescaleItems(items, 1, own)).kcal).toBe(384)
    expect(mealTotals(rescaleItems(items, 1, copy)).kcal).toBe(256)
  })
  it('só entre duas pessoas e só divisões válidas', () => {
    expect(splitFor(1, 0.5)).toBe(0.5)
    expect(splitFor(2, 0.5)).toBeNull()
    expect(splitFor(1, null)).toBeNull()
    expect(splitFor(1, 1)).toBeNull()
    expect(splitFor(1, 0.05)).toBeNull()
    expect(isSplit(0.9)).toBe(true)
    expect(isSplit(0.95)).toBe(false)
  })
  it('o que dizem os botões e os avisos', () => {
    expect(splitLabel(0.5, 'João', 'Joana')).toBe('A meias')
    expect(splitLabel(0.6, 'João', 'Joana')).toBe('João 60 · Joana 40')
    expect(splitLabel(0.3, 'João', 'Joana')).toBe('João 30 · Joana 70')
    expect(splitLabel(null, 'João', 'Joana')).toBe('Cada um comeu isto')
    expect(splitText(0.5, 'João', 'Joana')).toBe('a\u00a0meias')
    expect(splitText(0.7, 'João', 'Joana')).toBe('João 70 · Joana 30')
    expect(splitText(null, 'João', 'Joana')).toBeNull()
  })
})

describe('Anular: só o que é de quem pede e as cópias delas', () => {
  it('separa as refeições próprias das cópias e deixa de fora o resto', () => {
    const plan = undoPlan(
      [
        { meal_id: 'a', factor: 1 },
        { meal_id: 'copia-a', factor: 1 },
        { meal_id: 'da-joana', factor: 2 },
        { meal_id: 'a', factor: 2 },
        { meal_id: 'b', factor: 9 },
      ],
      ['a', 'b'],
      ['copia-a'],
    )
    expect(plan.own).toEqual([{ meal_id: 'a', factor: 1 }])
    expect(plan.copies).toEqual([{ meal_id: 'copia-a', factor: 1 }])
  })
  it('no máximo as linhas de um momento e das cópias', () => {
    const many = Array.from({ length: MAX_UNDO_ROWS + 5 }, (_, i) => ({ meal_id: `m${i}`, factor: 1 }))
    expect(undoPlan(many, many.map((c) => c.meal_id), []).own).toHaveLength(MAX_UNDO_ROWS)
  })
  it('cópias vivas de refeições de quem pede, noutra conta', () => {
    const rows = [
      { id: 'c1', user_id: 'joana', source_meal_id: 'a', deleted_at: null },
      { id: 'c2', user_id: 'joana', source_meal_id: 'de-outro', deleted_at: null },
      { id: 'c3', user_id: 'joana', source_meal_id: 'a', deleted_at: '2026-10-18T21:00:00Z' },
      { id: 'c4', user_id: 'joao', source_meal_id: 'a', deleted_at: null },
      { id: 'c5', user_id: 'joana', source_meal_id: null, deleted_at: null },
    ]
    expect(liveCopies(rows, ['a'], 'joao').map((r) => r.id)).toEqual(['c1'])
  })
  it('só apaga as fotos da pasta da cópia', () => {
    const copy = { id: 'c1', user_id: 'joana' }
    expect(
      copyPhotos(copy, ['joana/partilhada-c1/f.jpg', 'joana/partilhada-c1/f.jpg', 'joao/meal/f.jpg', 'joana/partilhada-c2/f.jpg', 'joana/partilhada-c1/../x.jpg', null]),
    ).toEqual(['joana/partilhada-c1/f.jpg'])
  })
})

describe('avisos', () => {
  it('«Porção ½ · 5 refeições · também nas de Joana · −1 010 kcal»', () => {
    expect(portionToast({ factor: 0.5, count: 5, copies: 5, sharedWith: ['Joana'], kcalDelta: -1012 }, kcal)).toBe(
      'Porção ½ · 5 refeições · também nas de Joana · −1010 kcal',
    )
  })
  it('uma só, sem cópias', () => {
    expect(portionToast({ factor: 1.5, count: 1, copies: 0, sharedWith: [], kcalDelta: 320 }, kcal)).toBe('Porção 1½ · +320 kcal')
    expect(portionToast({ factor: 0.6, count: 1, copies: 1, sharedWith: ['Joana'], kcalDelta: -256 }, kcal)).toBe(
      'Porção 0,6 · também na de Joana · −260 kcal',
    )
  })
  it('só mudaram as cópias, ou nada', () => {
    expect(portionToast({ factor: 0.5, count: 0, copies: 2, sharedWith: ['Joana'], kcalDelta: 0 }, kcal)).toBe('Porção ½ nas de Joana')
    expect(portionToast({ factor: 0.5, count: 0, copies: 0, sharedWith: [], kcalDelta: 0 }, kcal)).toBe('A porção já era ½.')
  })
  it('partilhar: uma sem divisão diz o que já dizia', () => {
    expect(shareToast({ to: 'Joana', shared: 1, already: 0, split: null, me: 'João', kcalDelta: 0 }, kcal)).toBe(
      'Partilhada com Joana. Aparece-lhe no Hoje para confirmar a porção.',
    )
    expect(shareToast({ to: 'Joana', shared: 0, already: 1, split: 0.5, me: 'João', kcalDelta: 0 }, kcal)).toBe(
      'Já estava partilhada com Joana.',
    )
    expect(shareToast({ to: 'Joana', shared: 0, already: 3, split: null, me: 'João', kcalDelta: 0 }, kcal)).toBe(
      'Já estavam partilhadas com Joana.',
    )
  })
  it('partilhar o jantar todo a meias', () => {
    expect(shareToast({ to: 'Joana', shared: 5, already: 0, split: 0.5, me: 'João', kcalDelta: -1010 }, kcal)).toBe(
      'Partilhadas com Joana · 5 refeições · a\u00a0meias · −1010 kcal',
    )
    expect(shareToast({ to: 'Joana', shared: 1, already: 0, split: 0.6, me: 'João', kcalDelta: -256 }, kcal)).toBe(
      'Partilhada com Joana · João 60 · Joana 40 · −260 kcal',
    )
    expect(shareToast({ to: 'Joana', shared: 3, already: 2, split: null, me: 'João', kcalDelta: 0 }, kcal)).toBe(
      'Partilhadas com Joana · 3 refeições · 2 já estavam',
    )
  })
  it('nomes juntos', () => {
    expect(joinNames(['Joana'])).toBe('Joana')
    expect(joinNames(['Joana', 'Rita'])).toBe('Joana e Rita')
    expect(joinNames(['Joana', 'Rita', 'Miguel'])).toBe('Joana, Rita e Miguel')
  })
})
