import { describe, expect, it } from 'vitest'
import { analysedStatus, foodRefs, guardedWrite, toMealItems } from '../api/_lib/rules/analise'
import type { MealItem } from '../api/_lib/rules/meal-totals'

const item = (confidence: 'alta' | 'media' | 'baixa', food_ref: string | null = null) => ({
  name: 'Arroz', grams: 180, kcal: 230.04, protein: 4.3, carbs: 50, fat: 0.5, confidence, food_ref,
})

describe('resultado da análise', () => {
  it('referências curtas voltam a ser ids e a confiança marca a estimativa', () => {
    const { refs } = foodRefs(['uuid-arroz', 'uuid-frango'])
    const items = toMealItems([item('alta', 'a1'), item('media', 'a9')], refs)
    expect(items[0]).toMatchObject({ food_id: 'uuid-arroz', estimated: false, kcal: 230 })
    expect(items[1]).toMatchObject({ food_id: null, estimated: true, confidence: 'media' })
  })

  it('estado: ok só com tudo em alta; baixa ou refeição média ficam por rever', () => {
    expect(analysedStatus([{ confidence: 'alta' }], 'alta')).toBe('ok')
    expect(analysedStatus([{ confidence: 'alta' }, { confidence: 'baixa' }], 'alta')).toBe('por_rever')
    expect(analysedStatus([{ confidence: 'alta' }], 'media')).toBe('por_rever')
    expect(analysedStatus([], 'alta')).toBe('erro')
  })
})

describe('escrita protegida da nota', () => {
  const base: MealItem[] = [{ name: 'Arroz', grams: 180, kcal: 230, protein: 4, carbs: 50, fat: 0, food_id: null, estimated: true }]

  // Base de dados falsa: uma linha com nota e lease, e escrita condicional.
  function store(initialNote: string | null) {
    const row = { note: initialNote, startedAt: 'T1', deleted: false, items: [] as MealItem[] }
    return {
      row,
      deps: {
        write: async (items: MealItem[], noteUsed: string | null) => {
          if (row.startedAt !== 'T1' || row.note !== noteUsed) return null
          row.items = items
          return { ...row }
        },
        reread: async () => ({ note: row.note, startedAt: row.startedAt, deleted: row.deleted }),
        correct: async (items: MealItem[], note: string) =>
          note === 'comi metade' ? items.map((i) => ({ ...i, grams: i.grams / 2, kcal: i.kcal / 2 })) : items,
      },
    }
  }

  it('sem mudanças, grava à primeira', async () => {
    const { deps, row } = store(null)
    expect(await guardedWrite(base, null, 'T1', deps)).not.toBeNull()
    expect(row.items[0]!.kcal).toBe(230)
  })

  it('a nota chega a meio da análise: aplica a correção e grava', async () => {
    const { deps, row } = store(null)
    // passo intercalado: o utilizador junta «comi metade» depois de a análise começar
    row.note = 'comi metade'
    const result = await guardedWrite(base, null, 'T1', deps)
    expect(result).not.toBeNull()
    expect(row.items[0]).toMatchObject({ grams: 90, kcal: 115 })
  })

  it('outra tentativa reivindicou a análise: desiste sem gravar', async () => {
    const { deps, row } = store(null)
    row.startedAt = 'T2'
    expect(await guardedWrite(base, null, 'T1', deps)).toBeNull()
    expect(row.items).toEqual([])
  })

  it('refeição apagada entretanto: desiste', async () => {
    const { deps, row } = store(null)
    row.note = 'x'
    row.deleted = true
    expect(await guardedWrite(base, null, 'T1', deps)).toBeNull()
  })
})
