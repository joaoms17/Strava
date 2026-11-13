import { describe, expect, it } from 'vitest'
import {
  analysedStatus,
  appliedText,
  correctionText,
  foodRefs,
  guardedWrite,
  implausibleItem,
  mergeAdded,
  ownPhotoPath,
  sameTags,
  toMealItems,
  type AnalysisInput,
} from '../api/_lib/rules/analise'
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

  it('números impossíveis ficam com confiança baixa (e a refeição por rever)', () => {
    const { refs } = foodRefs([])
    const [tooHeavy, tooDense, macrosOver, beer, water] = toMealItems(
      [
        { ...item('alta'), name: 'Arroz', grams: 1800, kcal: 2300 },
        { ...item('alta'), name: 'Iogurte', grams: 125, kcal: 1500, protein: 5, carbs: 6, fat: 3 },
        { ...item('alta'), name: 'Frango', grams: 150, kcal: 25, protein: 40, carbs: 0, fat: 5 },
        { ...item('alta'), name: 'Cerveja', grams: 330, kcal: 140, protein: 1.5, carbs: 12, fat: 0 },
        { ...item('alta'), name: 'Água', grams: 500, kcal: 0, protein: 0, carbs: 0, fat: 0 },
      ],
      refs,
    )
    expect(tooHeavy).toMatchObject({ confidence: 'baixa', estimated: true, grams: 1800, kcal: 2300 })
    expect(tooDense!.confidence).toBe('baixa')
    expect(macrosOver!.confidence).toBe('baixa')
    // o álcool tem calorias sem macros: não é um erro
    expect(beer).toMatchObject({ confidence: 'alta', estimated: false })
    expect(water!.confidence).toBe('alta')
    expect(analysedStatus([tooHeavy!, beer!], 'alta')).toBe('por_rever')
  })

  it('implausibleItem: limites de gramas, densidade e macros', () => {
    expect(implausibleItem({ grams: 15, kcal: 133, protein: 0, carbs: 0, fat: 15 })).toBe(false) // azeite
    expect(implausibleItem({ grams: 0, kcal: 300, protein: 20, carbs: 30, fat: 10 })).toBe(false)
    expect(implausibleItem({ grams: 0, kcal: 0, protein: 20, carbs: 30, fat: 10 })).toBe(true)
    expect(implausibleItem({ grams: 1501, kcal: 600, protein: 10, carbs: 100, fat: 10 })).toBe(true)
  })

  it('estado: ok só com tudo em alta; baixa ou refeição média ficam por rever', () => {
    expect(analysedStatus([{ confidence: 'alta' }], 'alta')).toBe('ok')
    expect(analysedStatus([{ confidence: 'alta' }, { confidence: 'baixa' }], 'alta')).toBe('por_rever')
    expect(analysedStatus([{ confidence: 'alta' }], 'media')).toBe('por_rever')
    expect(analysedStatus([], 'alta')).toBe('erro')
  })
})

describe('escrita protegida da nota e das etiquetas', () => {
  const base: MealItem[] = [{ name: 'Arroz', grams: 180, kcal: 230, protein: 4, carbs: 50, fat: 0, food_id: null, estimated: true }]
  const none: AnalysisInput = { note: null, tags: [] }

  // Base de dados falsa: uma linha com nota, etiquetas e lease, e escrita condicional.
  function store(initialNote: string | null, initialTags: string[] = []) {
    const row = { note: initialNote, tags: initialTags, startedAt: 'T1', deleted: false, items: [] as MealItem[], applied: [] as (string | null)[] }
    return {
      row,
      deps: {
        write: async (items: MealItem[], used: AnalysisInput) => {
          if (row.startedAt !== 'T1' || row.note !== used.note || !sameTags(row.tags, used.tags)) return null
          row.items = items
          return { ...row }
        },
        reread: async () => ({ note: row.note, tags: row.tags, startedAt: row.startedAt, deleted: row.deleted }),
        correct: async (items: MealItem[], correction: string, applied: string | null) => {
          row.applied.push(applied)
          return /comi metade/.test(correction) ? items.map((i) => ({ ...i, grams: i.grams / 2, kcal: i.kcal / 2 })) : items
        },
      },
    }
  }

  it('sem mudanças, grava à primeira', async () => {
    const { deps, row } = store(null)
    expect(await guardedWrite(base, none, 'T1', deps)).not.toBeNull()
    expect(row.items[0]!.kcal).toBe(230)
  })

  it('a nota chega a meio da análise: aplica a correção e grava', async () => {
    const { deps, row } = store(null)
    // passo intercalado: o utilizador junta «comi metade» depois de a análise começar
    row.note = 'comi metade'
    const result = await guardedWrite(base, none, 'T1', deps)
    expect(result).not.toBeNull()
    expect(row.items[0]).toMatchObject({ grams: 90, kcal: 115 })
  })

  it('M1: só o chip «Comi metade» tocado a meio, sem texto: os números ficam a metade', async () => {
    const { deps, row } = store(null)
    row.tags = ['comi_metade']
    expect(await guardedWrite(base, none, 'T1', deps)).not.toBeNull()
    expect(row.items[0]).toMatchObject({ grams: 90, kcal: 115 })
  })

  it('M1: «Jantar fora» a meio não pede correção (não muda as quantidades)', async () => {
    const { deps, row } = store(null)
    row.tags = ['jantar_fora']
    expect(await guardedWrite(base, none, 'T1', deps)).not.toBeNull()
    expect(row.items[0]!.kcal).toBe(230)
    expect(row.applied).toEqual([])
  })

  it('M4: a correção a meio leva o que já estava aplicado', async () => {
    const { deps, row } = store('comi metade')
    row.note = 'comi metade, sem pão'
    await guardedWrite(base, { note: 'comi metade', tags: [] }, 'T1', deps)
    expect(row.applied).toEqual(['comi metade'])
  })

  it('outra tentativa reivindicou a análise: desiste sem gravar', async () => {
    const { deps, row } = store(null)
    row.startedAt = 'T2'
    expect(await guardedWrite(base, none, 'T1', deps)).toBeNull()
    expect(row.items).toEqual([])
  })

  it('refeição apagada entretanto: desiste', async () => {
    const { deps, row } = store(null)
    row.note = 'x'
    row.deleted = true
    expect(await guardedWrite(base, none, 'T1', deps)).toBeNull()
  })
})

describe('correção pela nota e pelas etiquetas (M1, M4)', () => {
  it('uma etiqueta nova numa refeição já analisada pede a correção', () => {
    expect(correctionText({ note: null, tags: [] }, { note: null, tags: ['comi_metade'] })).toBe('comi metade')
  })

  it('tirar «Comi metade» desfaz o corte', () => {
    expect(correctionText({ note: null, tags: ['comi_metade'] }, { note: null, tags: [] })).toMatch(/dose toda/)
  })

  it('sem nada que mude as quantidades: sem correção', () => {
    expect(correctionText({ note: null, tags: [] }, { note: null, tags: ['jantar_fora'] })).toBeNull()
    expect(correctionText({ note: 'sem pão', tags: [] }, { note: null, tags: [] })).toBeNull()
    expect(correctionText({ note: 'x', tags: ['azeite'] }, { note: 'x', tags: ['azeite'] })).toBeNull()
  })

  it('nota editada: vai a nota nova inteira, e o que já estava aplicado à parte', () => {
    const applied = { note: 'comi metade', tags: ['azeite'] }
    expect(correctionText(applied, { note: 'comi metade, sem pão', tags: ['azeite'] })).toBe('comi metade, sem pão')
    expect(appliedText(applied)).toBe('comi metade; com azeite')
    expect(appliedText({ note: null, tags: [] })).toBeNull()
  })

  it('a ordem das etiquetas não conta', () => {
    expect(sameTags(['azeite', 'comi_metade'], ['comi_metade', 'azeite'])).toBe(true)
    expect(sameTags(['azeite'], [])).toBe(false)
  })
})

describe('juntar fotos a uma refeição com itens', () => {
  const exact = (name: string, kcal: number): MealItem => ({
    name, grams: 125, kcal, protein: 10, carbs: 5, fat: 2, food_id: 'f1', estimated: false, confidence: 'alta',
  })
  const guess = (name: string, kcal: number): MealItem => ({
    name, grams: 125, kcal, protein: 10, carbs: 5, fat: 2, food_id: null, estimated: true, confidence: 'media',
  })

  it('os itens que lá estavam ficam e entra o que é novo', () => {
    const merged = mergeAdded([exact('Iogurte grego', 120)], [guess('Pudim flan', 210)])
    expect(merged.map((i) => i.name)).toEqual(['Iogurte grego', 'Pudim flan'])
    expect(merged[0]).toMatchObject({ kcal: 120, food_id: 'f1' })
  })

  it('um item exato nunca muda nem se repete; um estimado dá lugar ao rótulo', () => {
    const labelled = { ...exact('Arroz', 160), food_id: null }
    const merged = mergeAdded([exact('Iogurte grego', 120), guess('arroz', 230)], [guess('Iogurte Grego', 300), labelled])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ name: 'Iogurte grego', kcal: 120 })
    expect(merged[1]).toMatchObject({ name: 'Arroz', kcal: 160, confidence: 'alta' })
  })

  it('nada de novo: fica tudo igual', () => {
    const current = [exact('Iogurte grego', 120)]
    expect(mergeAdded(current, [])).toEqual(current)
  })
})

describe('fotos só da pasta de quem é dono (G2)', () => {
  it('aceita a pasta da pessoa e recusa a de outra ou com ..', () => {
    expect(ownPhotoPath('u1/c1/a.jpg', 'u1')).toBe(true)
    expect(ownPhotoPath('u2/c1/a.jpg', 'u1')).toBe(false)
    expect(ownPhotoPath('u1/../u2/a.jpg', 'u1')).toBe(false)
    expect(ownPhotoPath('u10/a.jpg', 'u1')).toBe(false)
  })
})
