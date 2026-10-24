// «Pergunta à app»: o contexto que vai para a IA, só da pessoa com sessão e
// só com números que a app já calcula (o plano de hoje como no Hoje, os dias
// completos da regra 5, o gasto medido, a fase da água do início da dieta, a
// semana de água do ciclo). Compacto: os últimos 28 dias numa linha cada, as semanas resumidas,
// as refeições dos últimos 7 dias por momento e as favoritas, com
// referências curtas (f1, r1, p1) no lugar dos ids. Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'
import { SLOTS, slotOf, type Slot } from './momentos.js'
import { mealName, proteinPicks } from './favoritos.js'
import type { ShoppingItem } from './extras.js'
import { trend7, weeklyRateAsOf, type DatedValue } from './weight.js'
import { inWaterPhase, isMaintenanceWeek, maintenanceTarget, mondayOf } from './manutencao.js'
import { cleanStarts, cycleInfo, cycleOptions, waterWeekDuring } from './ciclo.js'
import { storedExerciseKcal, type WorkoutType } from './targets.js'
import { mergeSessions } from './sessoes.js'
import { daysToConfirm, type MealDayStats } from './evolucao.js'
import { KCAL_PER_KG } from './gasto.js'
import { shortRefs, type AskRefs } from './pergunta-acoes.js'
import type { MealItem } from './meal-totals.js'
import type { DietMeals } from './dieta.js'

export const ASK_DAYS = 28
export const ASK_MEAL_DAYS = 7 // além de hoje
export const ASK_WORKOUT_DAYS = 14
export const ASK_FAVORITES = 30
export const ASK_WEEKS = 4 // a semana em curso e as 3 antes
// Pesagens a pedir: 4 semanas de calendário e a semana antes da primeira.
export const ASK_WEIGHT_DAYS = 35

export interface AskProfile {
  sex?: string | null
  birth_year?: number | null
  height_cm?: number | null
  target_weight_kg?: number | string | null
  base_kcal: number
  protein_g?: number | null
  protein_per_meal_g?: number | null
  kcal_floor_week?: number | null
  maintenance_enabled?: boolean | null
  maintenance_anchor?: string | null
  goals?: Record<string, unknown> | null
}

type Num = number | string | null | undefined

export interface AskDay {
  date: string
  kcal_in?: Num
  protein?: Num
  kcal_target?: Num
  kcal_out_est?: Num
  is_complete?: boolean | null
  flags?: string[] | null
  tdee_est?: Num
  tdee_raw?: Num
  formula_base?: Num
}

export interface AskMeal {
  id: string
  date: string
  logged_at: string
  slot: Slot | null
  input_type: string
  raw_text: string | null
  items: { name: string }[]
  kcal: Num
  protein: Num
}

export interface AskFavorite {
  id: string
  name: string
  kcal: Num
  protein: Num
  carbs: Num
  fat: Num
  default_slot: Slot | null
  items: MealItem[]
}

export interface AskWorkout {
  date: string
  started_at?: string | null
  type: WorkoutType
  sport?: string | null
  minutes: number | null
  elapsed_s?: number | null
  watts?: number | null
  avg_hr?: number | null
  kcal_est?: number | null
  raw?: { calories?: unknown } | null
}

export interface AskHealth {
  date: string
  sleep_minutes?: number | null
  sleep_score?: number | null
  steps?: number | null
  resting_hr?: number | null
}

export interface AskInput {
  today: string
  clock: { hour: number; minute: number } // hora de Lisboa
  profile: AskProfile
  days: AskDay[] // os últimos 28 dias e hoje
  weights: { date: string; kg: Num }[] // os últimos 35 dias
  meals: AskMeal[] // contadas (ok e por rever), de hoje e dos 7 dias antes
  mealStats: Record<string, MealDayStats> // refeições contadas e kcal por dia, 28 dias
  uncountedToday: number // fotos de hoje ainda sem números
  favorites: AskFavorite[]
  diet: { name: string; meals: DietMeals } | null
  workouts: AskWorkout[] // os últimos 14 dias
  health: AskHealth[] // os últimos 14 dias
  people: { id: string; name: string }[] // as outras pessoas da casa
  shopping: ShoppingItem[] // o que a pessoa já juntou à lista de compras (no telemóvel)
}

const n = (v: Num): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}
const round = (v: number | null) => (v == null ? null : Math.round(v))
const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAY_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
const answerOf = (flags: string[] | null | undefined) =>
  flags?.includes('dia_fechado') ? 'sim_foi_tudo' : flags?.includes('faltou_algo') ? 'faltou_algo' : null

function weightSeries(weights: AskInput['weights'], today: string): DatedValue[] {
  return weights
    .filter((w) => w.date <= today && n(w.kg) != null)
    .map((w) => ({ date: w.date, value: n(w.kg)! }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// O peso médio (7 dias) num dia: o da última pesagem até esse dia, se for
// de há 7 dias ou menos.
export function trendAt(series: DatedValue[], date: string): number | null {
  const before = trend7(series).filter((p) => p.date <= date)
  const last = before[before.length - 1]
  return last && last.date >= shiftDate(date, -7) ? round1(last.value) : null
}

// Regra 2 e 7 ao vivo, como no Hoje: o plano base de hoje mais o treino do
// dia (um treino partido em dois conta como um) ou, na semana de pausa da
// dieta, o gasto medido (ou 2000).
export function todayStatus(input: Pick<AskInput, 'today' | 'profile' | 'days' | 'meals' | 'workouts' | 'weights' | 'uncountedToday'>) {
  const { today, profile } = input
  const meals = input.meals.filter((m) => m.date === today)
  const eaten = meals.reduce((a, m) => a + (n(m.kcal) ?? 0), 0)
  const protein = meals.reduce((a, m) => a + (n(m.protein) ?? 0), 0)
  const exercise = storedExerciseKcal(
    mergeSessions(input.workouts.filter((w) => w.date === today)).map((w) => ({
      type: w.type,
      minutes: w.minutes,
      watts: w.watts ?? null,
      deviceCalories: typeof w.raw?.calories === 'number' ? w.raw.calories : null,
      kcal_est: w.kcal_est ?? null,
    })),
  )
  const maintenance =
    profile.maintenance_enabled !== false &&
    profile.maintenance_anchor != null &&
    isMaintenanceWeek(profile.maintenance_anchor, today)
  const latestTdee = [...input.days]
    .filter((d) => d.date < today && n(d.tdee_est) != null)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const plan = maintenance ? maintenanceTarget(n(latestTdee?.tdee_est)) : Number(profile.base_kcal) + exercise
  const proteinGoal = n(profile.protein_g)
  return {
    plano_kcal: Math.round(plan),
    comeu_kcal: Math.round(eaten),
    // Negativo: passou do plano.
    falta_kcal: Math.round(plan - eaten),
    treino_kcal: Math.round(exercise),
    proteina_g: Math.round(protein),
    proteina_meta_g: proteinGoal,
    falta_proteina_g: proteinGoal != null ? Math.max(0, Math.round(proteinGoal - protein)) : null,
    refeicoes_contadas: meals.length,
    fotos_por_contar: input.uncountedToday,
    semana_de_pausa: maintenance,
  }
}

// Os últimos 28 dias (sem hoje), uma linha cada, do mais antigo ao mais
// recente: o que o fecho do dia guardou e a resposta «Foi tudo?».
export function daySummaries(days: AskDay[], weights: AskInput['weights'], mealStats: Record<string, MealDayStats>, today: string) {
  const from = shiftDate(today, -ASK_DAYS)
  const weighed = new Map(weights.filter((w) => n(w.kg) != null).map((w) => [w.date, round1(n(w.kg)!)]))
  return days
    .filter((d) => d.date >= from && d.date < today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      dia: d.date,
      ds: WEEKDAY[dow(d.date)],
      refeicoes: mealStats[d.date]?.refeicoes ?? 0,
      comeu_kcal: round(n(d.kcal_in)),
      proteina_g: round(n(d.protein)),
      plano_kcal: round(n(d.kcal_target)),
      gasto_kcal: round(n(d.kcal_out_est)),
      completo: d.is_complete === true,
      resposta: answerOf(d.flags),
      pausa: d.flags?.includes('manutencao') === true,
      peso_kg: weighed.get(d.date) ?? null,
    }))
}

// As semanas de calendário (segunda a domingo): a em curso (até ontem nos
// dias completos; hoje está em `hoje`) e as 3 antes. O que se comeu contra o
// gasto nos dias completos, o que isso daria pelo peso (7 700 kcal ≈ 1 kg)
// e o que o peso médio fez, com o que pode esconder a descida.
export function weekSummaries(input: Pick<AskInput, 'today' | 'profile' | 'days' | 'weights'>) {
  const { today, profile } = input
  const series = weightSeries(input.weights, today)
  const enabled = profile.maintenance_enabled !== false
  const anchor = profile.maintenance_anchor ?? null
  const monday = mondayOf(today)
  return Array.from({ length: ASK_WEEKS }, (_, k) => {
    const from = shiftDate(monday, -7 * k)
    const to = k === 0 ? today : shiftDate(from, 6)
    const inWeek = input.days.filter((d) => d.date >= from && d.date <= to)
    const complete = inWeek.filter((d) => d.date < today && d.is_complete === true && n(d.kcal_in) != null)
    const withOut = complete.filter((d) => n(d.kcal_out_est) != null)
    const avg = (rows: AskDay[], key: keyof AskDay) => round(mean(rows.map((d) => n(d[key] as Num)).filter((v): v is number => v != null)))
    const balance = withOut.reduce((a, d) => a + n(d.kcal_in)! - n(d.kcal_out_est)!, 0)
    const start = trendAt(series, shiftDate(from, -1))
    const end = trendAt(series, to)
    return {
      de: from,
      a: to,
      em_curso: k === 0,
      dias_completos: complete.length,
      comeu_kcal: avg(complete, 'kcal_in'),
      plano_kcal: avg(complete, 'kcal_target'),
      gasto_kcal: avg(withOut, 'kcal_out_est'),
      // Negativo: comeu abaixo do gasto.
      diferenca_kcal_dia: withOut.length ? Math.round(balance / withOut.length) : null,
      pelas_calorias_kg: withOut.length ? round2(balance / KCAL_PER_KG) : null,
      proteina_g: avg(complete, 'protein'),
      peso_medio_inicio: start,
      peso_medio_fim: end,
      peso_mudou_kg: start != null && end != null ? round1(end - start) : null,
      pesagens: series.filter((w) => w.date >= from && w.date <= to).length,
      semana_de_pausa: enabled && anchor != null && isMaintenanceWeek(anchor, from),
      fase_agua: inWaterPhase(anchor, to, enabled),
      semana_de_agua_ciclo: waterWeekDuring(profile, from, to),
    }
  })
}

// Dias úteis contra sábado e domingo, nos dias completos dos últimos 28.
// Cada lado só com 2 dias ou mais.
export function weekendSplit(days: AskDay[], today: string) {
  const from = shiftDate(today, -ASK_DAYS)
  const complete = days.filter((d) => d.date >= from && d.date < today && d.is_complete === true && n(d.kcal_in) != null)
  const side = (rows: AskDay[]) => {
    if (rows.length < 2) return null
    const avg = (key: keyof AskDay) => round(mean(rows.map((d) => n(d[key] as Num)).filter((v): v is number => v != null)))
    const over = rows.filter((d) => n(d.kcal_target) != null).map((d) => n(d.kcal_in)! - n(d.kcal_target)!)
    return { dias: rows.length, comeu_kcal: avg('kcal_in'), proteina_g: avg('protein'), acima_do_plano_kcal: round(mean(over)) }
  }
  const weekend = side(complete.filter((d) => dow(d.date) === 0 || dow(d.date) === 6))
  const weekdays = side(complete.filter((d) => dow(d.date) !== 0 && dow(d.date) !== 6))
  return {
    dias_uteis: weekdays,
    fim_de_semana: weekend,
    diferenca_kcal: weekend && weekdays && weekend.comeu_kcal != null && weekdays.comeu_kcal != null ? weekend.comeu_kcal - weekdays.comeu_kcal : null,
  }
}

// O gasto que a app usa: o medido pelo peso (regra 4, ajusta devagar: no
// máximo 30 kcal por dia e nunca a mais de 400 da fórmula), o só pelo peso
// dos 28 dias e a fórmula. Sem medido, a app ainda está a aprender.
export function expenditureSummary(days: AskDay[], today: string) {
  const latest = (key: keyof AskDay) =>
    round(n([...days].filter((d) => d.date <= today && n(d[key] as Num) != null).sort((a, b) => b.date.localeCompare(a.date))[0]?.[key] as Num))
  const measured = latest('tdee_est')
  return {
    medido_kcal: measured,
    so_pelo_peso_kcal: latest('tdee_raw'),
    formula_kcal: latest('formula_base'),
    a_aprender: measured == null,
    dias_completos_28: days.filter((d) => d.date >= shiftDate(today, -ASK_DAYS) && d.date < today && d.is_complete === true).length,
  }
}

// As refeições de hoje e dos 7 dias antes, por dia e por momento (as que se
// podem repetir ou partilhar levam referência).
export function mealsByDay(meals: AskMeal[], today: string, refOf: Map<string, string>) {
  const from = shiftDate(today, -ASK_MEAL_DAYS)
  const byDay = new Map<string, Partial<Record<Slot, { id: string | null; nome: string; kcal: number; proteina_g: number }[]>>>()
  for (const meal of [...meals].sort((a, b) => a.logged_at.localeCompare(b.logged_at))) {
    if (meal.date < from || meal.date > today) continue
    const slot = meal.slot ?? slotOf(new Date(meal.logged_at))
    const day = byDay.get(meal.date) ?? {}
    ;(day[slot] ??= []).push({
      id: refOf.get(meal.id) ?? null,
      nome: mealName(meal).slice(0, 60),
      kcal: Math.round(n(meal.kcal) ?? 0),
      proteina_g: Math.round(n(meal.protein) ?? 0),
    })
    byDay.set(meal.date, day)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, slots]) => ({
      dia: date,
      ds: WEEKDAY[dow(date)],
      momentos: Object.fromEntries(SLOTS.filter((s) => slots[s]).map((s) => [s, slots[s]])),
    }))
}

// Os treinos dos últimos 14 dias (um partido em dois conta como um).
export function workoutSummaries(workouts: AskWorkout[], today: string) {
  const from = shiftDate(today, -ASK_WORKOUT_DAYS)
  return mergeSessions(workouts.filter((w) => w.date >= from && w.date <= today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({
      dia: w.date,
      tipo: w.type === 'bike' ? 'bicicleta' : w.type === 'strength' ? 'ginasio' : 'outro',
      desporto: w.type === 'other' ? (w.sport ?? null) : null,
      minutos: w.minutes,
      watts: w.watts ?? null,
      kcal: Math.round(
        storedExerciseKcal([
          {
            type: w.type,
            minutes: w.minutes,
            watts: w.watts ?? null,
            deviceCalories: typeof w.raw?.calories === 'number' ? w.raw.calories : null,
            kcal_est: w.kcal_est ?? null,
          },
        ]),
      ),
    }))
}

export function buildAskContext(input: AskInput): { context: Record<string, unknown>; refs: AskRefs } {
  const { today, profile } = input
  const favorites = shortRefs('f', input.favorites.slice(0, ASK_FAVORITES))
  // Só as refeições com conta (itens e kcal) se podem repetir ou partilhar.
  const repeatable = input.meals.filter(
    (m) => m.date >= shiftDate(today, -ASK_MEAL_DAYS) && m.items.length > 0 && (n(m.kcal) ?? 0) > 0,
  )
  const meals = shortRefs('r', [...repeatable].sort((a, b) => b.logged_at.localeCompare(a.logged_at)))
  const people = shortRefs('p', input.people)
  const now = todayStatus(input)
  const goals = profile.goals ?? null
  const cycle =
    profile.sex === 'f' ? cycleInfo(cleanStarts(goals?.ciclo), today, cycleOptions(goals)) : null
  const health = input.health
    .filter((h) => h.date >= shiftDate(today, -ASK_WORKOUT_DAYS) && h.date <= today)
    .filter((h) => h.sleep_minutes != null || h.steps != null || h.resting_hr != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => ({
      dia: h.date,
      sono_min: h.sleep_minutes ?? null,
      sono_pontos: h.sleep_score ?? null,
      passos: h.steps ?? null,
      fc_repouso: h.resting_hr ?? null,
    }))
  const series = weightSeries(input.weights, today)
  const enabled = profile.maintenance_enabled !== false
  const dietSlots = input.diet
    ? Object.fromEntries(
        SLOTS.map((s) => [s, (input.diet!.meals[s] ?? []).map((id) => favorites.byId.get(id)).filter(Boolean)]).filter(
          ([, refs]) => (refs as string[]).length > 0,
        ),
      )
    : null

  const context = {
    agora: {
      dia: today,
      dia_semana: WEEKDAY_LONG[dow(today)],
      hora: `${String(input.clock.hour).padStart(2, '0')}:${String(input.clock.minute).padStart(2, '0')}`,
      ontem: shiftDate(today, -1),
    },
    pessoa: {
      sexo: profile.sex === 'f' ? 'mulher' : 'homem',
      idade: profile.birth_year ? Number(today.slice(0, 4)) - Number(profile.birth_year) : null,
      altura_cm: profile.height_cm ?? null,
      peso_alvo_kg: n(profile.target_weight_kg),
      plano_base_kcal: profile.base_kcal,
      proteina_dia_g: profile.protein_g ?? null,
      proteina_refeicao_g: profile.protein_per_meal_g ?? null,
      minimo_semana_kcal: profile.kcal_floor_week ?? null,
    },
    hoje: now,
    semanas: weekSummaries(input),
    fim_de_semana: weekendSplit(input.days, today),
    dias: daySummaries(input.days, input.weights, input.mealStats, today),
    dias_por_confirmar: daysToConfirm(input.days, input.mealStats, today),
    peso: series.length
      ? {
          ultima: { dia: series[series.length - 1]!.date, kg: round1(series[series.length - 1]!.value) },
          media_7_dias: trendAt(series, today),
          ritmo_kg_semana: weeklyRateAsOf(series, today),
          pesagens_28_dias: series.filter((w) => w.date > shiftDate(today, -ASK_DAYS)).length,
        }
      : null,
    gasto: expenditureSummary(input.days, today),
    dieta: {
      inicio: profile.maintenance_anchor ?? null,
      fase_agua: inWaterPhase(profile.maintenance_anchor ?? null, today, enabled),
      semanas_de_pausa: enabled,
      ativa: input.diet ? { nome: input.diet.name, refeicoes: dietSlots } : null,
    },
    ciclo: cycle
      ? { dia: cycle.dayOfCycle, fase: cycle.phase, semana_de_agua: cycle.waterWeek, atrasado: cycle.overdue }
      : null,
    refeicoes: mealsByDay(input.meals, today, meals.byId),
    favoritas: input.favorites.slice(0, ASK_FAVORITES).map((f) => ({
      id: favorites.byId.get(f.id)!,
      nome: f.name.slice(0, 60),
      kcal: Math.round(n(f.kcal) ?? 0),
      proteina_g: Math.round(n(f.protein) ?? 0),
      momento: f.default_slot,
    })),
    // As que fecham a proteína sem passar das calorias que faltam (o cartão do Hoje).
    sugestoes_proteina: proteinPicks(
      input.favorites.slice(0, ASK_FAVORITES).map((f) => ({
        id: f.id,
        kcal: n(f.kcal) ?? 0,
        protein: n(f.protein) ?? 0,
        carbs: n(f.carbs) ?? 0,
        fat: n(f.fat) ?? 0,
      })),
      now.falta_kcal,
    ).map((f) => favorites.byId.get(f.id)!),
    treinos: workoutSummaries(input.workouts, today),
    sono_e_passos: health.length ? health : null,
    lista_compras: input.shopping.slice(0, 40).map((i) => ({ nome: i.name, gramas: i.grams })),
    pessoas: input.people.map((p) => ({ id: people.byId.get(p.id)!, nome: p.name })),
  }

  const refs: AskRefs = {
    today,
    favorites: Object.fromEntries(
      Object.entries(favorites.refs).map(([ref, f]) => [
        ref,
        { id: f.id, name: f.name.slice(0, 80), kcal: n(f.kcal) ?? 0, default_slot: f.default_slot, items: f.items },
      ]),
    ),
    meals: Object.fromEntries(
      Object.entries(meals.refs).map(([ref, m]) => [ref, { id: m.id, name: mealName(m).slice(0, 80), kcal: n(m.kcal) ?? 0, date: m.date }]),
    ),
    people: Object.fromEntries(Object.entries(people.refs).map(([ref, p]) => [ref, { id: p.id, name: p.name.slice(0, 80) }])),
  }
  return { context, refs }
}
