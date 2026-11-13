// O fecho de um dia nutricional, só as contas (sem supabase): recebe o que
// se leu da base de dados e devolve a linha do dia já com o gasto medido.
// O close-day.ts lê, chama isto e grava; os testes correm o fecho dia a dia
// (tests/simulacao-fecho.test.ts).
import { shiftDate } from './nutritional-day.js'
import { round1 } from './meal-totals.js'
import { kcalTarget, storedExerciseKcal, type WorkoutType } from './targets.js'
import { isDayComplete } from './day-close.js'
import {
  TDEE_LOOKBACK_DAYS,
  TDEE_WINDOW_CALENDAR_DAYS,
  adaptiveDay,
  tdeeWindow,
  windowTraining,
  type AdaptiveDay,
  type AdaptiveResult,
  type Weighing,
} from './adaptativo.js'
import { isMaintenanceWeek, maintenanceTarget, mondayOf } from './manutencao.js'
import { dailyBase, formulaBase, kcalOut, limitWeeklyBase, measuredFlags, trustedTdee, withMeasuredFlags } from './gasto.js'

// Quanto ler para fechar um dia: o histórico do gasto medido (120 dias) e as
// pesagens da janela dele (56 dias).
export const CLOSE_HISTORY_DAYS = TDEE_LOOKBACK_DAYS
export const CLOSE_WEIGHTS_DAYS = TDEE_WINDOW_CALENDAR_DAYS

// As marcas que só a pessoa escreve («Foi tudo?»): se mudarem durante o
// fecho, o fecho volta a fazer-se (S5).
export const USER_DAY_FLAGS = ['dia_fechado', 'faltou_algo'] as const

export interface CloseProfile {
  base_kcal: number
  maintenance_enabled?: boolean | null
  height_cm?: number | null
  birth_year?: number | null
  sex?: string | null
  expected_tdee?: number | null
}

export interface CloseMeal {
  kcal: number | string | null
  protein: number | string | null
  carbs: number | string | null
  fat: number | string | null
}

export interface CloseWorkout {
  type: string
  minutes: number | null
  watts: number | null
  raw?: unknown
  kcal_est: number | null
}

// Um dia já fechado, antes do que se fecha (os numeric podem vir em texto).
export interface HistoryDay {
  date: string
  kcal_in: number | string | null
  is_complete: boolean
  weight_trend: number | string | null
  kcal_exercise: number | string | null
  formula_base: number | string | null
  tdee_est: number | string | null
  daily_base_est: number | string | null
}

export interface CloseInput {
  profile: CloseProfile
  date: string
  anchor: string | null
  meals: CloseMeal[]
  workouts: CloseWorkout[]
  weights: Weighing[] // pesagens de [date − 56, date]
  existing: { flags?: unknown; base_kcal?: number | string | null } | null
  history: HistoryDay[] // dias de [date − 120, date), por qualquer ordem
  pendingMeals: number // fotos ainda sem números
}

export interface ClosedDayRow {
  date: string
  kcal_in: number
  protein: number
  carbs: number
  fat: number
  kcal_exercise: number
  kcal_target: number
  is_complete: boolean
  weight_kg: number | null
  weight_trend: number | null
  flags: string[]
  meals_pending: number
  // Colunas do gasto (migração da fase 6) e do plano em vigor/valor bruto
  // (migração 20261018140000): o close-day grava sem elas se faltarem.
  formula_base: number
  daily_base_est: number
  kcal_out_est: number
  base_kcal: number
  tdee_est: number | null
  tdee_raw: number | null
}

export interface CloseResult {
  row: ClosedDayRow
  complete: boolean
  maintenance: boolean
  adaptive: AdaptiveResult
  baseLimited: boolean
}

const num = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v))
const round2 = (n: number) => Math.round(n * 100) / 100
const lastWith = <T>(rows: T[], pick: (r: T) => unknown): T | undefined => [...rows].reverse().find((r) => pick(r) != null)

function toAdaptive(d: HistoryDay): AdaptiveDay {
  return {
    date: d.date,
    kcal_in: Number(d.kcal_in ?? 0),
    weight_trend: num(d.weight_trend),
    kcal_exercise: num(d.kcal_exercise),
    formula_base: num(d.formula_base),
  }
}

// Gasto de um dia (Fase 6, só para mostrar): base sem treino + treino. A
// base usa o gasto medido congelado antes da segunda-feira da semana menos o
// treino médio da mesma janela que o mediu (K3: os dois reagem ao mesmo
// ritmo quando a frequência de treino muda); com menos de 10 dias completos
// ou sem gasto medido, a fórmula. A base medida muda no máximo 100 kcal por
// semana em relação à da semana anterior (decisão 304).
export function dayExpenditure(input: {
  profile: CloseProfile
  date: string
  anchor: string | null
  history: HistoryDay[] // por ordem
  weightTrend: number | null
  kcalExercise: number
}) {
  const { profile, date } = input
  const monday = mondayOf(date)
  const before = input.history.filter((d) => d.date < monday)
  const completeBefore = before.filter((d) => d.is_complete).map(toAdaptive)
  const frozenRow = lastWith(before, (d) => d.tdee_est)
  const last14 = completeBefore.slice(-14)
  let avgTraining = windowTraining(last14)
  if (frozenRow) {
    const { window } = tdeeWindow({
      date: frozenRow.date,
      rows: completeBefore.filter((d) => d.date <= frozenRow.date),
      anchor: input.anchor,
      maintenanceEnabled: profile.maintenance_enabled !== false,
    })
    avgTraining = windowTraining(window, last14)
  }
  const trendRow = input.weightTrend != null ? null : lastWith(input.history.filter((d) => d.date <= date), (d) => d.weight_trend)
  const weightKg = input.weightTrend ?? num(trendRow?.weight_trend)
  const formula = formulaBase({
    weightKg,
    heightCm: profile.height_cm ?? null,
    birthYear: profile.birth_year ?? null,
    sex: profile.sex ?? 'm',
    date,
    fallback: Number(profile.expected_tdee ?? 2200),
  })
  const lastBase = lastWith(before, (d) => d.daily_base_est)
  const base = limitWeeklyBase(
    dailyBase({
      completeDays: completeBefore.length,
      tdeeFrozen: trustedTdee(num(frozenRow?.tdee_est), formula + avgTraining),
      avgTrainingKcal: avgTraining,
      formula,
    }),
    num(lastBase?.daily_base_est),
  )
  return {
    formula,
    avgTraining,
    base: base.base,
    learning: base.learning,
    baseLimited: base.limited,
    kcalOut: kcalOut(base.base, input.kcalExercise),
  }
}

export function computeCloseDay(input: CloseInput): CloseResult {
  const { profile, date, anchor } = input
  const history = input.history
    .filter((d) => d.date < date && d.date >= shiftDate(date, -CLOSE_HISTORY_DAYS))
    .sort((a, b) => a.date.localeCompare(b.date))

  const sum = (pick: (m: CloseMeal) => unknown) => input.meals.reduce((acc, m) => acc + Number(pick(m) ?? 0), 0)
  const kcalIn = Math.round(sum((m) => m.kcal))
  const protein = round1(sum((m) => m.protein))
  const carbs = round1(sum((m) => m.carbs))
  const fat = round1(sum((m) => m.fat))

  // Soma as kcal guardadas em cada treino (a regra 2 corre ao gravar).
  const kcalExercise = storedExerciseKcal(
    input.workouts.map((w) => ({
      type: w.type as WorkoutType,
      minutes: w.minutes,
      watts: w.watts,
      deviceCalories:
        typeof (w.raw as { calories?: unknown } | null)?.calories === 'number' ? (w.raw as { calories: number }).calories : null,
      kcal_est: w.kcal_est,
    })),
  )

  // O plano base em vigor nesse dia: o guardado no primeiro fecho fica, para
  // mudar o plano não reescrever os dias antigos (no ecrã e no recálculo).
  const existingBase = num(input.existing?.base_kcal)
  const base = existingBase ?? profile.base_kcal

  const prevFlags: string[] = Array.isArray(input.existing?.flags) ? (input.existing.flags as string[]) : []
  const complete = isDayComplete({
    mealCount: input.meals.length,
    kcalIn,
    manuallyClosed: prevFlags.includes('dia_fechado'),
    missingSomething: prevFlags.includes('faltou_algo'),
    uncountedMeals: input.pendingMeals,
  })

  // Peso médio (regra 3): média das pesagens na janela [date-6, date].
  const weekFrom = shiftDate(date, -6)
  const windowWeights = input.weights.filter((w) => w.date >= weekFrom && w.date <= date).map((w) => Number(w.kg))
  const weightTrend = windowWeights.length ? round2(windowWeights.reduce((a, b) => a + b, 0) / windowWeights.length) : null
  const ofDay = input.weights.filter((w) => w.date === date)
  const weightKg = ofDay.length ? Number(ofDay[ofDay.length - 1]!.kg) : null

  const expenditure = dayExpenditure({ profile, date, anchor, history, weightTrend, kcalExercise })

  // Regra 7: na semana de pausa da dieta, a meta é o gasto medido; sem ele,
  // a fórmula da pessoa mais o treino médio (K5; antes, 2 000 para todos).
  const maintenance = profile.maintenance_enabled !== false && anchor != null && isMaintenanceWeek(anchor, date)
  const lastTdee = num(lastWith(history, (d) => d.tdee_est)?.tdee_est)
  const target = maintenance
    ? maintenanceTarget(lastTdee, expenditure.formula + expenditure.avgTraining)
    : kcalTarget(base, kcalExercise)

  // A marca «chao» (regra 6) deixou de se calcular aqui (P3): nenhum ecrã a
  // lia; o Balanço faz o aviso do mínimo com a média da semana.
  const flags = new Set(prevFlags)
  flags.delete('chao')
  if (complete) flags.delete('dia_incompleto')
  else flags.add('dia_incompleto')
  if (maintenance) flags.add('manutencao')
  else flags.delete('manutencao')

  // Regra 4 (decisão 304, K1): o gasto medido com os dias completos dos
  // últimos 120 dias (este incluído, se completo) e as pesagens reais.
  const completeRows = history.filter((d) => d.is_complete).map(toAdaptive)
  if (complete) {
    completeRows.push({ date, kcal_in: kcalIn, weight_trend: weightTrend, kcal_exercise: kcalExercise, formula_base: expenditure.formula })
  }
  const monday = mondayOf(date)
  const adaptive = adaptiveDay({
    date,
    complete,
    rows: completeRows,
    weighings: input.weights,
    anchor,
    maintenanceEnabled: profile.maintenance_enabled !== false,
    previous: lastTdee,
    weekStart: num(lastWith(history.filter((d) => d.date < monday), (d) => d.tdee_est)?.tdee_est),
  })
  // Uma pesagem mal escrita pode dar um valor só pelo peso absurdo (fora de
  // numeric(6,1)): fica sem ele.
  const rawStored = adaptive.raw != null && Math.abs(adaptive.raw) < 100_000 ? adaptive.raw : null
  const allFlags = withMeasuredFlags(
    [...flags],
    measuredFlags({ limit: adaptive.limit, excluded: adaptive.excluded, baseLimited: expenditure.baseLimited }),
  )

  return {
    row: {
      date,
      kcal_in: kcalIn,
      protein,
      carbs,
      fat,
      kcal_exercise: kcalExercise,
      kcal_target: target,
      is_complete: complete,
      weight_kg: weightKg,
      weight_trend: weightTrend,
      flags: allFlags,
      meals_pending: input.pendingMeals,
      formula_base: expenditure.formula,
      daily_base_est: expenditure.base,
      kcal_out_est: expenditure.kcalOut,
      base_kcal: base,
      tdee_est: adaptive.tdee,
      tdee_raw: rawStored,
    },
    complete,
    maintenance,
    adaptive,
    baseLimited: expenditure.baseLimited,
  }
}

// As marcas da pessoa iguais nas duas leituras (antes e depois das contas)?
export function sameUserFlags(a: unknown, b: unknown): boolean {
  const pick = (f: unknown) =>
    (Array.isArray(f) ? (f as string[]) : []).filter((x) => (USER_DAY_FLAGS as readonly string[]).includes(x)).sort().join(',')
  return pick(a) === pick(b)
}

// As marcas calculadas com as respostas «Foi tudo?» de `from` (as lidas por
// último), para nunca gravar por cima de uma resposta dada durante o fecho.
export function withUserFlags(flags: string[], from: unknown): string[] {
  const user = (Array.isArray(from) ? (from as string[]) : []).filter((x) => (USER_DAY_FLAGS as readonly string[]).includes(x))
  return [...flags.filter((f) => !(USER_DAY_FLAGS as readonly string[]).includes(f)), ...user]
}
