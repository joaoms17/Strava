import { describe, expect, it } from 'vitest'
import {
  ASK_MAX_ACTIONS,
  ASK_TURNS_KEPT,
  ASK_TURNS_SENT,
  AskAiSchema,
  actionLabel,
  checkAction,
  cleanActions,
  cleanReply,
  dayWord,
  inActionWindow,
  keepTurns,
  parseTurns,
  shortRefs,
  turnsForServer,
  type AskRefs,
  type AskTurn,
} from '../api/_lib/rules/pergunta-acoes'
import { outputSchema } from '../api/_lib/rules/resposta-ia'
import { mergeShopping } from '../api/_lib/rules/extras'

const TODAY = '2026-10-18'
const FAV = '6f1c2a10-1a2b-4c3d-8e4f-0000000000f1'
const MEAL = '6f1c2a10-1a2b-4c3d-8e4f-0000000000a1'
const JOANA = '6f1c2a10-1a2b-4c3d-8e4f-00000000a002'

const item = (name: string, grams: number) => ({ name, grams, kcal: 100, protein: 10, carbs: 5, fat: 2, food_id: null, estimated: false })

const refs: AskRefs = {
  today: TODAY,
  favorites: {
    f1: { id: FAV, name: 'Frango com arroz', kcal: 620, default_slot: 'jantar', items: [item('Peito de frango', 200), item('Arroz', 150)] },
  },
  meals: { r1: { id: MEAL, name: 'Ovos mexidos com tosta', kcal: 424, date: '2026-10-17' } },
  people: { p1: { id: JOANA, name: 'Joana' } },
}

// O que a IA devolve: todos os campos (os que o tipo não usa a null).
const ai = (fields: Record<string, unknown>) => ({
  favorite_id: null,
  meal_id: null,
  person_id: null,
  date: null,
  slot: null,
  portion: null,
  glasses: null,
  flag: null,
  items: [],
  favorites: [],
  ...fields,
})

describe('ações da «Pergunta à app»', () => {
  it('troca as referências do contexto pelos ids, com o nome e as kcal para o cartão', () => {
    const [log, repeat, share] = cleanActions(
      [
        ai({ type: 'log_favorite', favorite_id: 'f1', portion: 1.5 }),
        ai({ type: 'repeat_meal', meal_id: 'r1', date: TODAY, slot: 'pequeno_almoco' }),
        ai({ type: 'share_meal', meal_id: 'r1', person_id: 'p1' }),
      ],
      refs,
    )
    // Sem dia, hoje; sem momento, o habitual da favorita; kcal × porção, a 10.
    expect(log).toEqual({
      type: 'log_favorite',
      favorite_id: FAV,
      name: 'Frango com arroz',
      kcal: 930,
      date: TODAY,
      slot: 'jantar',
      portion: 1.5,
    })
    expect(repeat).toEqual({
      type: 'repeat_meal',
      meal_id: MEAL,
      name: 'Ovos mexidos com tosta',
      kcal: 420,
      date: TODAY,
      slot: 'pequeno_almoco',
    })
    expect(share).toEqual({ type: 'share_meal', meal_id: MEAL, name: 'Ovos mexidos com tosta', person_id: JOANA, person_name: 'Joana' })
  })

  it('recusa ids que não foram no contexto (também um uuid verdadeiro)', () => {
    expect(
      cleanActions(
        [
          ai({ type: 'log_favorite', favorite_id: 'f9' }),
          ai({ type: 'log_favorite', favorite_id: FAV }),
          ai({ type: 'repeat_meal', meal_id: 'r2' }),
          ai({ type: 'share_meal', meal_id: 'r1', person_id: 'p2' }),
          ai({ type: 'share_meal', meal_id: 'r1', person_id: JOANA }),
          ai({ type: 'log_favorite', favorite_id: 'constructor' }),
          ai({ type: 'add_shopping_items', favorites: [{ favorite_id: '__proto__', times: 2 }, { favorite_id: 'toString', times: 1 }] }),
        ],
        refs,
      ),
    ).toEqual([])
  })

  it('só tipos da lista; nada de SQL nem campos a mais', () => {
    const out = cleanActions(
      [
        ai({ type: 'delete_meal', meal_id: 'r1' }),
        ai({ type: 'sql', items: [{ name: 'drop table meals', grams: null }] }),
        ai({ type: 'add_water', glasses: 2, user_id: 'outra pessoa' }),
      ],
      refs,
    )
    expect(out).toEqual([{ type: 'add_water', date: TODAY, glasses: 2 }])
  })

  it('dias só dos últimos 28 e nunca no futuro', () => {
    expect(inActionWindow(TODAY, TODAY)).toBe(true)
    expect(inActionWindow('2026-09-20', TODAY)).toBe(true)
    expect(inActionWindow('2026-09-19', TODAY)).toBe(false)
    expect(inActionWindow('2026-10-19', TODAY)).toBe(false)
    expect(inActionWindow('ontem', TODAY)).toBe(false)
    const out = cleanActions(
      [
        ai({ type: 'add_water', date: '2026-10-19', glasses: 1 }),
        ai({ type: 'repeat_meal', meal_id: 'r1', date: '2026-08-01' }),
        ai({ type: 'log_favorite', favorite_id: 'f1', date: '17/10' }),
      ],
      refs,
    )
    expect(out).toEqual([])
  })

  it('marcar o dia precisa do dia e da marca', () => {
    const out = cleanActions(
      [
        ai({ type: 'mark_day', flag: 'dia_fechado' }),
        ai({ type: 'mark_day', date: '2026-10-17', flag: null }),
        ai({ type: 'mark_day', date: '2026-10-17', flag: 'dia_fechado' }),
      ],
      refs,
    )
    expect(out).toEqual([{ type: 'mark_day', date: '2026-10-17', flag: 'dia_fechado' }])
  })

  it('porções e copos dentro dos limites', () => {
    const out = cleanActions(
      [
        ai({ type: 'log_favorite', favorite_id: 'f1', portion: 3 }),
        ai({ type: 'log_favorite', favorite_id: 'f1', portion: 0.75 }),
        ai({ type: 'add_water', glasses: 0 }),
        ai({ type: 'add_water', glasses: 13 }),
        ai({ type: 'add_water', glasses: 1.5 }),
        ai({ type: 'add_water', glasses: 12 }),
      ],
      refs,
    )
    expect(out).toEqual([{ type: 'add_water', date: TODAY, glasses: 12 }])
  })

  it('compras: os alimentos das favoritas × vezes, mais o que a IA escreveu, sem repetir', () => {
    const [shop] = cleanActions(
      [
        ai({
          type: 'add_shopping_items',
          favorites: [
            { favorite_id: 'f1', times: 3 },
            { favorite_id: 'f7', times: 2 },
            { favorite_id: 'f1', times: 40 },
          ],
          items: [
            { name: 'peito de frango', grams: 100 },
            { name: 'Limões', grams: null },
            { name: '  ', grams: 50 },
          ],
        }),
      ],
      refs,
    )
    expect(shop).toEqual({
      type: 'add_shopping_items',
      items: [
        { name: 'Arroz', grams: 450 },
        { name: 'Peito de frango', grams: 700 },
        { name: 'Limões', grams: null },
      ],
    })
    // Sem nada que sirva, não há ação.
    expect(cleanActions([ai({ type: 'add_shopping_items', favorites: [{ favorite_id: 'f9', times: 2 }] })], refs)).toEqual([])
  })

  it('juntar à lista soma as gramas do mesmo alimento (sem maiúsculas)', () => {
    expect(
      mergeShopping(
        [{ name: 'Arroz', grams: 300 }, { name: 'Ovos', grams: null }],
        [{ name: 'arroz', grams: 150 }, { name: 'Ovos', grams: null }, { name: 'Iogurte', grams: 500 }],
      ),
    ).toEqual([
      { name: 'Arroz', grams: 450 },
      { name: 'Ovos', grams: null },
      { name: 'Iogurte', grams: 500 },
    ])
  })

  it('cada ação uma vez e no máximo 3', () => {
    const out = cleanActions(
      [
        ai({ type: 'add_water', glasses: 2 }),
        ai({ type: 'add_water', glasses: 2 }),
        ai({ type: 'add_water', glasses: 1 }),
        ai({ type: 'mark_day', date: '2026-10-17', flag: 'faltou_algo' }),
        ai({ type: 'log_favorite', favorite_id: 'f1' }),
      ],
      refs,
    )
    expect(out).toHaveLength(ASK_MAX_ACTIONS)
    expect(out.map((a) => a.type)).toEqual(['add_water', 'add_water', 'mark_day'])
    expect(cleanActions('nada', refs)).toEqual([])
  })

  it('o telemóvel volta a validar: forma certa e dia dentro da janela de hoje', () => {
    const water = { type: 'add_water', date: TODAY, glasses: 2 }
    expect(checkAction(water, TODAY)).toEqual(water)
    expect(checkAction({ ...water, date: '2026-10-19' }, TODAY)).toBeNull()
    expect(checkAction({ ...water, glasses: 40 }, TODAY)).toBeNull()
    expect(checkAction({ type: 'log_favorite', favorite_id: 'f1', name: 'X', kcal: 100, date: TODAY, slot: null, portion: 1 }, TODAY)).toBeNull()
    expect(checkAction({ type: 'apagar_tudo' }, TODAY)).toBeNull()
    expect(checkAction(null, TODAY)).toBeNull()
  })

  it('o texto do cartão sai dos dados validados', () => {
    expect(
      actionLabel({ type: 'log_favorite', favorite_id: FAV, name: 'Frango com arroz', kcal: 310, date: TODAY, slot: 'jantar', portion: 0.5 }, TODAY),
    ).toBe('Registar «Frango com arroz» · hoje · jantar · ½ dose · 310 kcal')
    expect(
      actionLabel({ type: 'repeat_meal', meal_id: MEAL, name: 'Ovos mexidos', kcal: 1420, date: TODAY, slot: 'pequeno_almoco' }, TODAY),
    ).toBe('Repetir «Ovos mexidos» · hoje · pequeno-almoço · 1 420 kcal')
    expect(actionLabel({ type: 'mark_day', date: '2026-10-17', flag: 'dia_fechado' }, TODAY)).toBe('Marcar ontem como «Sim, foi tudo»')
    expect(actionLabel({ type: 'mark_day', date: '2026-10-14', flag: 'faltou_algo' }, TODAY)).toBe(
      'Marcar qua 14 out como «Não, faltou algo»',
    )
    expect(actionLabel({ type: 'add_water', date: TODAY, glasses: 2 }, TODAY)).toBe('Juntar 2 copos de água · hoje (500 ml)')
    expect(
      actionLabel(
        {
          type: 'add_shopping_items',
          items: [
            { name: 'Arroz', grams: 1200 },
            { name: 'Frango', grams: 600 },
            { name: 'Limões', grams: null },
            { name: 'Ovos', grams: null },
          ],
        },
        TODAY,
      ),
    ).toBe('Juntar à lista de compras: Arroz 1,2 kg, Frango 600 g, Limões e mais 1')
    expect(actionLabel({ type: 'share_meal', meal_id: MEAL, name: 'Bacalhau', person_id: JOANA, person_name: 'Joana' }, TODAY)).toBe(
      'Partilhar «Bacalhau» com Joana',
    )
    expect(dayWord('2026-10-16', TODAY)).toBe('anteontem')
  })

  it('a resposta: texto simples e curto', () => {
    expect(cleanReply('  Faltam **640 kcal** hoje.\n\n\n\nE 40 g de proteína. ')).toBe('Faltam 640 kcal hoje.\n\nE 40 g de proteína.')
    expect(cleanReply(42)).toBe('')
    expect(cleanReply('x'.repeat(2000))).toHaveLength(1200)
  })

  it('referências curtas por ordem', () => {
    const { refs: r, byId } = shortRefs('f', [{ id: 'a' }, { id: 'b' }])
    expect(Object.keys(r)).toEqual(['f1', 'f2'])
    expect(byId.get('b')).toBe('f2')
  })

  it('o schema da IA é plano e aceita-se como structured output', () => {
    const json = outputSchema(AskAiSchema) as { properties: Record<string, unknown> }
    expect(Object.keys(json.properties)).toEqual(['reply', 'actions'])
    expect(JSON.stringify(json)).not.toContain('oneOf')
  })
})

describe('conversa da «Pergunta à app»', () => {
  const turns: AskTurn[] = [
    { from: 'me', text: 'bebi mais 2 copos' },
    {
      from: 'app',
      text: 'Junto 2 copos a hoje?',
      actions: [{ action: { type: 'add_water', date: TODAY, glasses: 2 }, state: 'feito' }],
    },
  ]

  it('guarda as últimas 10 mensagens', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ from: 'me' as const, text: String(i) }))
    expect(keepTurns(many)).toHaveLength(ASK_TURNS_KEPT)
    expect(keepTurns(many)[0]!.text).toBe('4')
  })

  it('ao servidor vão só as últimas, com o que aconteceu às ações', () => {
    expect(turnsForServer(turns, TODAY)).toEqual([
      { from: 'me', text: 'bebi mais 2 copos' },
      { from: 'app', text: 'Junto 2 copos a hoje?\n[Propus: Juntar 2 copos de água · hoje (500 ml) (feito)]' },
    ])
    const many = Array.from({ length: 10 }, (_, i) => ({ from: 'me' as const, text: String(i) }))
    expect(turnsForServer(many, TODAY)).toHaveLength(ASK_TURNS_SENT)
  })

  it('a conversa guardada estragada ou de outra versão não parte a folha', () => {
    expect(parseTurns('{', TODAY)).toEqual([])
    expect(parseTurns(null, TODAY)).toEqual([])
    const stored = JSON.stringify([
      ...turns,
      { from: 'sistema', text: 'x' },
      { from: 'app', text: 'Antiga', actions: [{ action: { type: 'add_water', date: '2026-09-01', glasses: 2 }, state: 'por_fazer' }] },
      { from: 'app', text: 'Estado estranho', actions: [{ action: { type: 'add_water', date: TODAY, glasses: 1 }, state: 'falhou' }] },
    ])
    const parsed = parseTurns(stored, TODAY)
    expect(parsed.map((t) => t.text)).toEqual(['bebi mais 2 copos', 'Junto 2 copos a hoje?', 'Antiga', 'Estado estranho'])
    // A ação de um dia fora da janela sai; um estado desconhecido fica «não».
    expect(parsed[2]!.actions).toBeUndefined()
    expect(parsed[3]!.actions?.[0]?.state).toBe('nao')
  })
})
