import { describe, expect, it } from 'vitest'
import {
  dayLabel,
  needsSlot,
  normalizeWhen,
  slotForRanking,
  whenApi,
  whenFromParams,
  whenLabel,
  whenParams,
  withDate,
} from '../src/lib/when'
import { frequentMeals, groupByDay, mealName, repeatable, searchMeals, type RepeatSource } from '../src/lib/repetir'

const TODAY = '2026-10-04'

describe('Quando (dia e refeição)', () => {
  it('sem parâmetros: hoje, agora', () => {
    expect(whenFromParams(new URLSearchParams(), TODAY)).toEqual({ date: TODAY, slot: 'agora' })
  })

  it('dia passado sem refeição: falta escolher', () => {
    const when = whenFromParams(new URLSearchParams({ data: '2026-10-02' }), TODAY)
    expect(when).toEqual({ date: '2026-10-02', slot: null })
    expect(needsSlot(when)).toBe(true)
  })

  it('lê a refeição e ignora datas no futuro ou inválidas', () => {
    expect(whenFromParams(new URLSearchParams({ data: '2026-10-03', momento: 'jantar' }), TODAY)).toEqual({
      date: '2026-10-03',
      slot: 'jantar',
    })
    expect(whenFromParams(new URLSearchParams({ data: '2026-10-09' }), TODAY).date).toBe(TODAY)
    expect(whenFromParams(new URLSearchParams({ data: 'ontem', momento: 'brunch' }), TODAY)).toEqual({
      date: TODAY,
      slot: 'agora',
    })
  })

  it('usa o dia que se está a ver quando não vem nenhum', () => {
    expect(whenFromParams(new URLSearchParams(), TODAY, '2026-09-30')).toEqual({ date: '2026-09-30', slot: null })
  })

  it('«Agora» só existe hoje; mudar de dia mantém a refeição', () => {
    expect(normalizeWhen({ date: '2026-10-03', slot: 'agora' }, TODAY)).toEqual({ date: '2026-10-03', slot: null })
    expect(withDate({ date: '2026-10-03', slot: 'jantar' }, '2026-10-01', TODAY)).toEqual({
      date: '2026-10-01',
      slot: 'jantar',
    })
    expect(withDate({ date: '2026-10-03', slot: null }, TODAY, TODAY)).toEqual({ date: TODAY, slot: 'agora' })
  })

  it('para a API: agora = nada; senão dia e refeição (também hoje)', () => {
    expect(whenApi({ date: TODAY, slot: 'agora' }, TODAY)).toEqual({})
    expect(whenApi({ date: TODAY, slot: 'almoco' }, TODAY)).toEqual({ date: TODAY, slot: 'almoco' })
    expect(whenApi({ date: '2026-10-01', slot: 'ceia' }, TODAY)).toEqual({ date: '2026-10-01', slot: 'ceia' })
  })

  it('para outra folha: só o que não é o normal', () => {
    expect(whenParams({ date: TODAY, slot: 'agora' }, TODAY)).toEqual({})
    expect(whenParams({ date: '2026-10-03', slot: 'lanche' }, TODAY)).toEqual({ data: '2026-10-03', momento: 'lanche' })
    expect(whenParams({ date: TODAY, slot: 'jantar' }, TODAY)).toEqual({ momento: 'jantar' })
  })

  it('refeição de referência: a escolhida ou a da hora', () => {
    const dinnerTime = new Date('2026-10-04T19:30:00Z') // 20:30 em Lisboa
    expect(slotForRanking({ date: TODAY, slot: 'agora' }, dinnerTime)).toBe('jantar')
    expect(slotForRanking({ date: TODAY, slot: 'pequeno_almoco' }, dinnerTime)).toBe('pequeno_almoco')
  })

  it('nomes dos dias e etiqueta', () => {
    expect(dayLabel(TODAY, TODAY)).toBe('Hoje')
    expect(dayLabel('2026-10-03', TODAY)).toBe('Ontem')
    expect(dayLabel('2026-10-02', TODAY)).toBe('Anteontem')
    expect(dayLabel('2026-09-28', TODAY)).toBe('seg 28 set')
    expect(whenLabel({ date: '2026-10-03', slot: 'jantar' }, TODAY)).toBe('Ontem · jantar')
    expect(whenLabel({ date: TODAY, slot: 'agora' }, TODAY)).toBe('Hoje · agora')
    expect(whenLabel({ date: '2026-09-28', slot: null }, TODAY)).toBe('seg 28 set')
  })
})

const meal = (over: Partial<RepeatSource> & { id: string }): RepeatSource => ({
  date: TODAY,
  logged_at: `${TODAY}T12:00:00Z`,
  slot: 'almoco',
  input_type: 'text',
  raw_text: null,
  items: [{ name: 'Arroz com frango', grams: 300, kcal: 520, protein: 40, carbs: 60, fat: 10, food_id: null, estimated: false }],
  kcal: 520,
  protein: 40,
  status: 'ok',
  ...over,
})

describe('Repetir uma refeição', () => {
  it('só as que têm conta', () => {
    expect(repeatable(meal({ id: 'a' }))).toBe(true)
    expect(repeatable(meal({ id: 'b', status: 'a_analisar' }))).toBe(false)
    expect(repeatable(meal({ id: 'c', status: 'erro' }))).toBe(false)
    expect(repeatable(meal({ id: 'd', items: [], kcal: 0 }))).toBe(false)
  })

  it('nome: o do favorito ou os alimentos', () => {
    expect(mealName(meal({ id: 'a' }))).toBe('Arroz com frango')
    expect(mealName(meal({ id: 'b', input_type: 'favorite', raw_text: 'Papas de aveia' }))).toBe('Papas de aveia')
  })

  it('procura todas as palavras, sem acentos', () => {
    const list = [
      meal({ id: 'a' }),
      meal({ id: 'b', items: [{ name: 'Pão com fiambre', grams: 80, kcal: 220, protein: 12, carbs: 25, fat: 7, food_id: null, estimated: false }] }),
    ]
    expect(searchMeals(list, 'frango arroz').map((m) => m.id)).toEqual(['a'])
    expect(searchMeals(list, 'PAO').map((m) => m.id)).toEqual(['b'])
    expect(searchMeals(list, '  ')).toHaveLength(2)
  })

  it('agrupa por dia, mais recente primeiro, dentro do dia pela hora', () => {
    const groups = groupByDay([
      meal({ id: 'a', date: '2026-10-02', logged_at: '2026-10-02T19:00:00Z' }),
      meal({ id: 'b', date: '2026-10-03', logged_at: '2026-10-03T12:00:00Z' }),
      meal({ id: 'c', date: '2026-10-02', logged_at: '2026-10-02T07:00:00Z' }),
    ])
    expect(groups.map((g) => g.date)).toEqual(['2026-10-03', '2026-10-02'])
    expect(groups[1]!.meals.map((m) => m.id)).toEqual(['c', 'a'])
  })

  it('as que mais repetes: pelo menos 2 vezes, a mais recente de cada', () => {
    const list = [
      meal({ id: 'a', logged_at: '2026-10-01T08:00:00Z', kcal: 410 }),
      meal({ id: 'b', logged_at: '2026-10-03T08:00:00Z', kcal: 420 }),
      meal({ id: 'c', logged_at: '2026-10-02T08:00:00Z', kcal: 900 }),
      meal({ id: 'd', input_type: 'favorite', raw_text: 'Iogurte', logged_at: '2026-10-02T16:00:00Z', kcal: 150 }),
    ]
    const top = frequentMeals(list)
    expect(top).toHaveLength(1)
    expect(top[0]!.meal.id).toBe('b')
    expect(top[0]!.count).toBe(2)
  })
})
