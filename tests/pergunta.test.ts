import { describe, expect, it } from 'vitest'
import {
  ASK_DAYS,
  buildAskContext,
  daySummaries,
  expenditureSummary,
  mealsByDay,
  todayStatus,
  trendAt,
  weekSummaries,
  weekendSplit,
  type AskDay,
  type AskFavorite,
  type AskInput,
  type AskMeal,
} from '../api/_lib/rules/pergunta'
import { cleanActions } from '../api/_lib/rules/pergunta-acoes'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

// Domingo, 18 de outubro: a semana em curso começou na segunda, 12.
const TODAY = '2026-10-18'
// Ids como os da base de dados (as ações só aceitam uuids).
const M_ONTEM = '6f1c2a10-1a2b-4c3d-8e4f-0000000000b3'
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

// 28 dias completos (dias úteis 1 800, fins de semana 2 600, gasto 2 300),
// menos a quinta 15, incompleta; hoje sem nada fechado.
function days(): AskDay[] {
  const rows: AskDay[] = []
  for (let back = ASK_DAYS; back >= 1; back--) {
    const date = shiftDate(TODAY, -back)
    const weekend = dow(date) === 0 || dow(date) === 6
    rows.push({
      date,
      kcal_in: date === '2026-10-15' ? 600 : weekend ? 2600 : 1800,
      protein: weekend ? 110 : 140,
      kcal_target: 2000,
      kcal_out_est: 2300,
      is_complete: date !== '2026-10-15',
      flags: date === '2026-10-15' ? ['dia_incompleto'] : date === '2026-10-11' ? ['dia_fechado'] : [],
      tdee_est: date >= '2026-10-01' ? 2310 : null,
      tdee_raw: date === '2026-10-17' ? 2250 : null,
      formula_base: 1950,
    })
  }
  rows.push({ date: TODAY, flags: [] })
  return rows
}

// Peso a descer até dia 11 e parado nesta semana.
const weights = [
  { date: '2026-10-05', kg: 89.4 },
  { date: '2026-10-07', kg: 89.0 },
  { date: '2026-10-09', kg: 88.8 },
  { date: '2026-10-11', kg: 88.4 },
  { date: '2026-10-13', kg: 88.6 },
  { date: '2026-10-15', kg: 88.5 },
  { date: '2026-10-17', kg: 88.4 },
]

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

const meal = (id: string, date: string, time: string, slot: AskMeal['slot'], name: string, kcal: number, protein: number): AskMeal => ({
  id,
  date,
  logged_at: `${date}T${time}:00.000Z`,
  slot,
  input_type: 'text',
  raw_text: null,
  items: [{ name }],
  kcal,
  protein,
})

const favorites: AskFavorite[] = [
  { id: 'fav-iog', name: 'Iogurte com granola', kcal: 300, protein: 18, carbs: 30, fat: 9, default_slot: 'pequeno_almoco', items: [item('Iogurte', 170, 160, 15)] },
  { id: 'fav-frango', name: 'Frango com arroz', kcal: 620, protein: 52, carbs: 60, fat: 12, default_slot: 'jantar', items: [item('Frango', 200, 330, 46)] },
  { id: 'fav-bolo', name: 'Bolo', kcal: 450, protein: 6, carbs: 60, fat: 20, default_slot: 'lanche', items: [item('Bolo', 100, 450, 6)] },
]

function input(extra: Partial<AskInput> = {}): AskInput {
  return {
    today: TODAY,
    clock: { hour: 13, minute: 30 },
    profile: {
      sex: 'm',
      birth_year: 1985,
      height_cm: 183,
      target_weight_kg: '80',
      base_kcal: 1850,
      protein_g: 160,
      protein_per_meal_g: 40,
      kcal_floor_week: 1750,
      maintenance_enabled: true,
      maintenance_anchor: '2026-08-31',
      goals: {},
    },
    days: days(),
    weights,
    meals: [
      meal('m-pa', TODAY, '07:05', 'pequeno_almoco', 'Ovos mexidos', 400, 30),
      meal('m-alm', TODAY, '12:10', 'almoco', 'Salada de atum', 460, 35),
      meal(M_ONTEM, '2026-10-17', '07:30', 'pequeno_almoco', 'Torradas', 380, 14),
      { ...meal('m-cafe', '2026-10-17', '15:00', 'lanche', 'Café', 0, 0), items: [] },
      meal('m-antiga', '2026-10-09', '20:00', 'jantar', 'Pizza', 900, 35),
    ],
    mealStats: { '2026-10-15': { refeicoes: 1, kcal: 600 } },
    uncountedToday: 1,
    favorites,
    diet: { name: 'Semana de trabalho', meals: { pequeno_almoco: ['fav-iog', 'apagada'], jantar: ['fav-frango'] } },
    workouts: [
      { date: TODAY, started_at: `${TODAY}T08:15:00.000Z`, type: 'bike', minutes: 25, elapsed_s: 1500, watts: 140, kcal_est: 200 },
      { date: TODAY, started_at: `${TODAY}T08:45:00.000Z`, type: 'bike', minutes: 20, elapsed_s: 1200, watts: 140, kcal_est: 170 },
      { date: '2026-10-16', type: 'strength', minutes: 50, kcal_est: 150 },
    ],
    health: [{ date: TODAY, sleep_minutes: 384, sleep_score: 88, steps: 6200, resting_hr: 56 }],
    people: [{ id: 'joana', name: 'Joana' }],
    shopping: [{ name: 'Limões', grams: null }],
    ...extra,
  }
}

describe('contexto da «Pergunta à app»', () => {
  it('hoje: o plano com o treino (as duas partes contam como uma), e o que falta', () => {
    expect(todayStatus(input())).toEqual({
      plano_kcal: 2220,
      comeu_kcal: 860,
      falta_kcal: 1360,
      treino_kcal: 370,
      proteina_g: 65,
      proteina_meta_g: 160,
      falta_proteina_g: 95,
      refeicoes_contadas: 2,
      fotos_por_contar: 1,
      semana_de_pausa: false,
    })
  })

  it('hoje, na semana de pausa: o plano é o gasto medido, fixo', () => {
    // Âncora 5 semanas antes desta: esta é a 6.ª, de pausa.
    const status = todayStatus(input({ profile: { ...input().profile, maintenance_anchor: '2026-09-07' } }))
    expect(status.semana_de_pausa).toBe(true)
    expect(status.plano_kcal).toBe(2310)
    // Passar do plano dá negativo.
    const over = todayStatus(input({ meals: [meal('x', TODAY, '12:00', 'almoco', 'Cozido', 2500, 80)] }))
    expect(over.falta_kcal).toBe(-280)
  })

  it('semanas: só os dias completos, o que dava pelas calorias e o que o peso fez', () => {
    const [current, previous] = weekSummaries(input())
    expect(current).toMatchObject({
      de: '2026-10-12',
      a: TODAY,
      em_curso: true,
      dias_completos: 5, // a quinta ficou incompleta e hoje não conta
      comeu_kcal: 1960,
      gasto_kcal: 2300,
      diferenca_kcal_dia: -340,
      pelas_calorias_kg: -0.22,
      peso_medio_inicio: 88.9,
      peso_medio_fim: 88.5,
      peso_mudou_kg: -0.4,
      pesagens: 3,
      semana_de_pausa: false,
      semana_de_agua_ciclo: false,
    })
    expect(previous).toMatchObject({ de: '2026-10-05', a: '2026-10-11', dias_completos: 7, pesagens: 4 })
    expect(weekSummaries(input())).toHaveLength(4)
  })

  it('semanas: fase da água no início da dieta e semana de água do ciclo', () => {
    const woman = input({
      profile: { ...input().profile, sex: 'f', maintenance_anchor: '2026-10-05', goals: { ciclo: ['2026-07-22'], ciclo_pilula: true, ciclo_dias: 91 } },
    })
    const [current] = weekSummaries(woman)
    expect(current!.fase_agua).toBe(true)
    // Pílula contínua: a pausa prevista é a 21/10, a semana antes é de água.
    expect(current!.semana_de_agua_ciclo).toBe(true)
  })

  it('fim de semana contra os dias úteis, nos dias completos dos últimos 28', () => {
    expect(weekendSplit(days(), TODAY)).toEqual({
      dias_uteis: { dias: 19, comeu_kcal: 1800, proteina_g: 140, acima_do_plano_kcal: -200 },
      fim_de_semana: { dias: 8, comeu_kcal: 2600, proteina_g: 110, acima_do_plano_kcal: 600 },
      diferenca_kcal: 800,
    })
    // Com menos de 2 dias de um lado, esse lado fica sem números.
    const few = days().filter((d) => d.date >= '2026-10-16')
    expect(weekendSplit(few, TODAY)).toMatchObject({ fim_de_semana: null, dias_uteis: null, diferenca_kcal: null })
  })

  it('dias: 28 linhas, sem hoje, com a resposta «Foi tudo?» e o peso do dia', () => {
    const rows = daySummaries(days(), weights, { '2026-10-15': { refeicoes: 1, kcal: 600 } }, TODAY)
    expect(rows).toHaveLength(28)
    expect(rows[0]!.dia).toBe('2026-09-20')
    expect(rows[rows.length - 1]!.dia).toBe('2026-10-17')
    expect(rows.find((r) => r.dia === '2026-10-15')).toMatchObject({ ds: 'qui', refeicoes: 1, comeu_kcal: 600, completo: false, resposta: null })
    expect(rows.find((r) => r.dia === '2026-10-11')).toMatchObject({ resposta: 'sim_foi_tudo', peso_kg: 88.4 })
    expect(rows.find((r) => r.dia === '2026-10-17')).toMatchObject({ gasto_kcal: 2300 })
  })

  it('gasto: o medido, o só pelo peso e a fórmula; sem medido, a aprender', () => {
    expect(expenditureSummary(days(), TODAY)).toEqual({
      medido_kcal: 2310,
      so_pelo_peso_kcal: 2250,
      formula_kcal: 1950,
      a_aprender: false,
      dias_completos_28: 27,
    })
    const learning = days().map((d) => ({ ...d, tdee_est: null, tdee_raw: null }))
    expect(expenditureSummary(learning, TODAY)).toMatchObject({ medido_kcal: null, a_aprender: true })
  })

  it('peso médio num dia só com uma pesagem até 7 dias antes', () => {
    const series = weights.map((w) => ({ date: w.date, value: w.kg }))
    expect(trendAt(series, '2026-10-17')).toBe(88.5)
    expect(trendAt(series, '2026-10-30')).toBeNull()
    expect(trendAt(series, '2026-10-01')).toBeNull()
  })

  it('refeições por dia e por momento; só as que se podem repetir levam referência', () => {
    const refOf = new Map([['m-pa', 'r1']])
    const out = mealsByDay(input().meals, TODAY, refOf)
    expect(out.map((d) => d.dia)).toEqual([TODAY, '2026-10-17']) // a de dia 9 é de há mais de 7 dias
    expect(out[0]!.momentos).toEqual({
      pequeno_almoco: [{ id: 'r1', nome: 'Ovos mexidos', kcal: 400, proteina_g: 30 }],
      almoco: [{ id: null, nome: 'Salada de atum', kcal: 460, proteina_g: 35 }],
    })
  })

  it('o contexto leva só referências curtas; as ações só voltam com elas', () => {
    const { context, refs } = buildAskContext(input())
    const json = JSON.stringify(context)
    // Nenhum id verdadeiro vai para a IA.
    for (const id of ['m-pa', M_ONTEM, 'fav-iog', 'fav-frango', 'joana']) expect(json).not.toContain(`"${id}"`)
    expect(Object.keys(refs.meals)).toEqual(['r1', 'r2', 'r3']) // o café a 0 kcal e a pizza antiga ficam de fora
    expect(refs.meals.r1).toEqual({ id: 'm-alm', name: 'Salada de atum', kcal: 460, date: TODAY })
    expect(refs.favorites.f2).toMatchObject({ id: 'fav-frango', name: 'Frango com arroz', default_slot: 'jantar' })
    expect(refs.people).toEqual({ p1: { id: 'joana', name: 'Joana' } })
    expect(context.dieta).toMatchObject({ ativa: { nome: 'Semana de trabalho', refeicoes: { pequeno_almoco: ['f1'], jantar: ['f2'] } } })
    // Cabe nas 1 360 kcal que faltam: primeiro a que dá mais proteína por caloria.
    expect(context.sugestoes_proteina).toEqual(['f2', 'f1'])
    expect(context.ciclo).toBeNull()
    expect(context.pessoas).toEqual([{ id: 'p1', nome: 'Joana' }])
    expect(context.lista_compras).toEqual([{ nome: 'Limões', gramas: null }])
    expect(context.agora).toEqual({ dia: TODAY, dia_semana: 'domingo', hora: '13:30', ontem: '2026-10-17' })

    // «Regista o pequeno-almoço de ontem também hoje.»
    const [repeat] = cleanActions(
      [
        {
          type: 'repeat_meal',
          meal_id: 'r3',
          date: TODAY,
          slot: 'pequeno_almoco',
          favorite_id: null,
          person_id: null,
          portion: null,
          flag: null,
          items: [],
          favorites: [],
        },
      ],
      refs,
    )
    expect(repeat).toMatchObject({ type: 'repeat_meal', meal_id: M_ONTEM, name: 'Torradas', date: TODAY })
  })

  it('o ciclo só vai para mulheres que o marcam', () => {
    const woman = buildAskContext(
      input({ profile: { ...input().profile, sex: 'f', goals: { ciclo: ['2026-07-22'], ciclo_pilula: true, ciclo_dias: 91 } } }),
    )
    expect(woman.context.ciclo).toMatchObject({ fase: 'pilula', semana_de_agua: true, atrasado: false })
    expect(woman.context.pessoa).toMatchObject({ sexo: 'mulher' })
    const noCycle = buildAskContext(input({ profile: { ...input().profile, sex: 'f', goals: {} } }))
    expect(noCycle.context.ciclo).toBeNull()
  })

  it('sem pesagens nem favoritas, as secções ficam vazias em vez de inventar', () => {
    const { context, refs } = buildAskContext(input({ weights: [], favorites: [], diet: null, people: [], health: [] }))
    expect(context.peso).toBeNull()
    expect(context.favoritas).toEqual([])
    expect(context.sugestoes_proteina).toEqual([])
    expect(context.sono_e_passos).toBeNull()
    expect(refs.favorites).toEqual({})
    expect((context.semanas as { peso_medio_fim: number | null }[])[0]!.peso_medio_fim).toBeNull()
  })
})
