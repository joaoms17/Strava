// O Balanço feito em memória (P1b): as linhas lidas uma vez para várias
// semanas (lib/balanco.ts) dão a semana vista, o gasto da semana e a
// proteína por refeição, sem um pedido por cada ‹ ›. Puro: sem supabase.
import { shiftDate } from '../../api/_lib/rules/nutritional-day'
import {
  MEASURED_MAX_GAP_KCAL,
  coherence,
  dailyBase,
  formulaBase,
  kcalOut,
  limitWeeklyBase,
  measuredNote,
  measuredState,
  measuredVsFormula,
  trustedTdee,
  type MeasuredState,
} from '../../api/_lib/rules/gasto'
import { TDEE_LOOKBACK_DAYS, missingWeighings, tdeeWindow, windowTraining } from '../../api/_lib/rules/adaptativo'
import { isDayComplete } from '../../api/_lib/rules/day-close'
import { isMaintenanceWeek, maintenanceTarget } from '../../api/_lib/rules/manutencao'
import { storedExerciseKcal } from '../../api/_lib/rules/targets'
import { proteinBySlot } from '../../api/_lib/rules/extras'
import { weeklyRateAsOf } from '../../api/_lib/rules/weight'
import type { WeekAverages, BalanceDay } from '../../api/_lib/rules/balanco'
import type { Slot } from '../../api/_lib/rules/momentos'
import type { Profile } from './types'

// --- O gasto da semana ---------------------------------------------------

export interface ExpenditureContext {
  base: number // base sem treino, por dia
  learning: boolean // sem gasto medido (antes de 10 dias completos ou sem pesagens que cheguem): fórmula
  tdeeFrozen: number | null // gasto usado até antes da semana: o medido, já com a base limitada a 100 kcal por semana (decisão 304)
  tdeeMeasured: number | null // só pelo peso, sem o ajuste lento nem o limite (tdee_raw; null sem a migração)
  formula: number // Mifflin × 1,2 (ou o valor fixo)
  avgTraining: number // kcal de treino por dia (a janela do gasto medido; sem ela, 14 dias completos)
  completeDays: number
  weighings: number // dias com pesagem nos 28 dias até ao fim da semana
  state: MeasuredState // «medido», «a aprender (faltam N pesagens)» ou «fórmula» (K1)
  flags: string[] // as marcas do gasto medido do dia congelado, mais o limite de ±400 se cortou aqui
  note: string | null // uma linha quando o gasto medido está limitado ou a acompanhar (decisão 304)
}

// O que o gasto de uma semana precisa (lido à parte ou tirado da memória).
export interface ExpenditureRows {
  frozen: { date?: string; tdee_est?: number | null; tdee_raw?: number | null; flags?: string[] | null } | undefined // o último dia com gasto medido antes da segunda
  complete: { date: string; kcal_exercise: number | null }[] // os dias completos dos 120 dias antes da segunda, por ordem
  lastWeights: number[] // as 7 pesagens mais recentes até ao fim da semana
  weighDates: string[] // os dias com pesagem nos 28 dias até ao fim da semana
  prevBase: number | null // a base guardada no último dia antes da segunda
}

// O mesmo cálculo do fecho do dia (rules/fecho.ts), feito no telemóvel para a
// semana em curso: gasto medido congelado antes da segunda-feira, o treino
// médio da janela que o mediu (K3) e, sem 10 dias completos ou sem gasto
// medido, a fórmula. Numa semana passada, só com as pesagens até ao fim
// dela. A base medida muda no máximo 100 kcal por semana (a da semana
// anterior, guardada no fecho), como no servidor.
export function expenditureFrom(profile: Profile, monday: string, rows: ExpenditureRows): ExpenditureContext {
  const completeRows = rows.complete.map((d) => ({
    date: d.date,
    kcal_in: 0,
    weight_trend: null,
    kcal_exercise: d.kcal_exercise != null ? Number(d.kcal_exercise) : null,
  }))
  const stored = rows.frozen
  const last14 = completeRows.slice(-14)
  const frozenDate = stored?.date
  const avgTraining = frozenDate
    ? windowTraining(
        tdeeWindow({
          date: frozenDate,
          rows: completeRows.filter((d) => d.date <= frozenDate),
          anchor: profile.maintenance_anchor ?? null,
          maintenanceEnabled: profile.maintenance_enabled !== false,
        }).window,
        last14,
      )
    : windowTraining(last14)
  const weights = rows.lastWeights
  const formula = formulaBase({
    weightKg: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null,
    heightCm: profile.height_cm ?? null,
    birthYear: profile.birth_year ?? null,
    sex: profile.sex ?? 'm',
    date: monday,
    fallback: Number(profile.expected_tdee ?? 2200),
  })
  const storedTdee = stored?.tdee_est != null ? Number(stored.tdee_est) : null
  const measured = trustedTdee(storedTdee, formula + avgTraining)
  const tdeeMeasured = stored?.tdee_raw != null ? Number(stored.tdee_raw) : null
  const completeDays = completeRows.length
  const { base, learning, limited } = limitWeeklyBase(
    dailyBase({ completeDays, tdeeFrozen: measured, avgTrainingKcal: avgTraining, formula }),
    rows.prevBase,
  )
  // O gasto usado (coerência, sugestão do plano): o mesmo da base, já limitado.
  const tdeeFrozen = measured != null && !learning ? Math.round(base + avgTraining) : measured
  // O limite de ±400 da fórmula fica à vista (K4), também quando corta aqui.
  const reference = formula + avgTraining
  const capped =
    storedTdee != null && storedTdee > reference + MEASURED_MAX_GAP_KCAL
      ? ['gasto_teto400']
      : storedTdee != null && storedTdee < reference - MEASURED_MAX_GAP_KCAL
        ? ['gasto_piso400']
        : []
  const flags = [...new Set([...(stored?.flags ?? []), ...capped, ...(limited ? ['gasto_ritmo'] : [])])]
  const note = learning ? null : measuredNote(flags)
  const weighings = new Set(rows.weighDates).size
  const state = measuredState({ learning, completeDays, missingWeighings: missingWeighings(rows.weighDates), weighingDays: weighings })
  return { base, learning, tdeeFrozen, tdeeMeasured, formula, avgTraining, completeDays, weighings, state, flags, note }
}

// K4: o limite de ±400 da fórmula, numa marca curta (ou nada).
export function capLabel(flags: string[]): string | null {
  if (flags.includes('gasto_teto400')) return 'limitado a +400 da fórmula'
  if (flags.includes('gasto_piso400')) return 'limitado a −400 da fórmula'
  return null
}

// --- As linhas lidas -----------------------------------------------------

export interface StoredDay {
  date: string
  kcal_in: number | null
  kcal_out_est: number | null
  kcal_target: number | null
  kcal_exercise: number | null
  is_complete: boolean | null
  flags: string[] | null
  tdee_est: number | null
  tdee_raw?: number | null // só com a migração 20261018140000
  formula_base: number | null
  daily_base_est: number | null
  base_kcal?: number | null // só com a migração 20261018140000
}

export interface MealRow {
  date: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  slot: Slot | null
}

export interface WorkoutRow {
  id?: string
  date: string
  started_at?: string | null
  type: 'bike' | 'strength' | 'other'
  sport?: string | null
  minutes: number | null
  elapsed_s?: number | null
  watts: number | null
  kcal_est: number | null
  calories?: number | null // raw->calories (do relógio)
}

export interface HealthRow {
  date: string
  steps: number | null
  sleep_minutes: number | null
  sleep_score?: number | null
  sleep_quality?: number | null
}

export interface BalancoRows {
  from: string // a primeira segunda-feira com a semana toda em memória
  to: string // o último dia lido (hoje, ou o fim de um bloco antigo)
  daysFrom: string // os dias e as pesagens começam aqui (120 dias antes de `from`, para o gasto)
  days: StoredDay[] // por data
  weights: { date: string; kg: number }[] // por data
  meals: MealRow[] // desde 14 dias antes de `from` (a proteína por refeição)
  pending: string[] // as datas das fotos ainda sem números (o dia não conta, regra 5)
  workouts: WorkoutRow[] // desde 40 dias antes de `to` ou `from`, o que vier primeiro
  health: HealthRow[]
  reviews: { week_start: string; text: string | null }[]
  firstDate: string | null // a primeira refeição de sempre
  completeBefore: number // dias completos antes de `daysFrom`
}

// Uma semana sai destas linhas quando estão todas lá (a de hoje, até hoje).
export function covers(rows: BalancoRows, monday: string): boolean {
  return monday >= rows.from && monday <= rows.to
}

export function expenditureRows(rows: BalancoRows, monday: string): ExpenditureRows {
  const nextMonday = shiftDate(monday, 7)
  const lookback = shiftDate(monday, -TDEE_LOOKBACK_DAYS)
  const before = rows.days.filter((d) => d.date < monday)
  const frozen = [...before].reverse().find((d) => d.tdee_est != null)
  const prev = [...before].reverse().find((d) => d.daily_base_est != null)
  const weights = rows.weights.filter((w) => w.date < nextMonday)
  return {
    frozen: frozen && { date: frozen.date, tdee_est: frozen.tdee_est, tdee_raw: frozen.tdee_raw ?? null, flags: frozen.flags },
    complete: before
      .filter((d) => d.is_complete === true && d.date >= lookback)
      .map((d) => ({ date: d.date, kcal_exercise: d.kcal_exercise })),
    lastWeights: weights.slice(-7).map((w) => Number(w.kg)),
    weighDates: weights.filter((w) => w.date >= shiftDate(nextMonday, -28)).map((w) => w.date),
    prevBase: prev?.daily_base_est != null ? Number(prev.daily_base_est) : null,
  }
}

// --- A semana vista ------------------------------------------------------

export type WeekDayRow = BalanceDay & { out: number; missing: boolean }
export type ProteinRow = { slot: Slot; avg: number; days: number }

export interface WeekData {
  monday: string
  days: WeekDayRow[]
  workouts: WorkoutRow[]
  rate: number | null
  completeDays: number // dias completos até ao fim desta semana (numa semana passada, os de então)
  expenditure: ExpenditureContext
  firstDate: string | null
  review: string | null
  lastWeekReview: string | null
  weeklyGaps: number[]
  avg7: number | null
  protein: ProteinRow[] // a proteína de cada refeição nos 14 dias até ao fim da semana (ou até hoje)
}

const avgOf = (values: (number | null | undefined)[]) => {
  const known = values.filter((v): v is number => v != null)
  return known.length ? known.reduce((a, b) => a + Number(b), 0) / known.length : null
}

export function weekFrom(profile: Profile, rows: BalancoRows, monday: string, today: string): WeekData {
  const sunday = shiftDate(monday, 6)
  const inWeek = (d: string) => d >= monday && d <= sunday
  const expenditure = expenditureFrom(profile, monday, expenditureRows(rows, monday))
  const rowByDate = new Map(rows.days.filter((d) => inWeek(d.date)).map((d) => [d.date, d]))
  const uncounted = new Map<string, number>()
  for (const date of rows.pending) if (inWeek(date)) uncounted.set(date, (uncounted.get(date) ?? 0) + 1)
  const weekMeals = rows.meals.filter((m) => inWeek(m.date))
  const workouts = rows.workouts.filter((w) => inWeek(w.date))
  // A meta de um dia de pausa: o último gasto medido antes desse dia (como o fecho do dia).
  const tdees = rows.days.filter((d) => d.tdee_est != null)
  const tdeeBefore = (date: string) => {
    const found = [...tdees].reverse().find((d) => d.date < date)
    return found ? Number(found.tdee_est) : null
  }
  const days = Array.from({ length: 7 }, (_, i): WeekDayRow => {
    const date = shiftDate(monday, i)
    const ofDay = weekMeals.filter((m) => m.date === date)
    const exercise = storedExerciseKcal(
      workouts
        .filter((w) => w.date === date)
        .map((w) => ({ type: w.type, minutes: w.minutes, watts: w.watts, deviceCalories: w.calories ?? null, kcal_est: w.kcal_est })),
    )
    const maintenance =
      profile.maintenance_enabled !== false && profile.maintenance_anchor != null && isMaintenanceWeek(profile.maintenance_anchor, date)
    const sum = (pick: (m: MealRow) => number) => ofDay.reduce((a, m) => a + Number(pick(m) ?? 0), 0)
    const row = rowByDate.get(date)
    const flags = row?.flags ?? []
    const eaten = sum((m) => m.kcal)
    // O plano base desse dia (o guardado no fecho); hoje e sem migração, o de hoje.
    const base = date < today && row?.base_kcal != null ? Number(row.base_kcal) : profile.base_kcal
    return {
      date,
      eaten,
      protein: sum((m) => m.protein),
      carbs: sum((m) => m.carbs),
      fat: sum((m) => m.fat),
      meals: ofDay.length,
      // Marcado «faltou algo»: o dia tocado diz porquê e deixa voltar atrás.
      missing: flags.includes('faltou_algo'),
      plan: maintenance ? maintenanceTarget(tdeeBefore(date), expenditure.formula + expenditure.avgTraining) : base + exercise,
      complete: isDayComplete({
        mealCount: ofDay.length,
        kcalIn: eaten,
        manuallyClosed: flags.includes('dia_fechado'),
        missingSomething: flags.includes('faltou_algo'),
        uncountedMeals: uncounted.get(date) ?? 0,
      }),
      // Gasto do dia: o guardado pelo fecho do dia ou, na semana em curso, o mesmo cálculo aqui.
      out: row?.kcal_out_est != null ? Number(row.kcal_out_est) : kcalOut(expenditure.base, exercise),
    }
  })
  // Gasto medido contra a fórmula, visto em cada uma das últimas 3 segundas-feiras.
  const hist = rows.days.filter((d) => d.date >= shiftDate(monday, -35) && d.date < monday)
  const weeklyGaps: number[] = []
  for (const back of [14, 7, 0]) {
    const cut = shiftDate(monday, -back)
    const before = hist.filter((d) => d.date < cut)
    const tdee = [...before].reverse().find((d) => d.tdee_est != null)?.tdee_est
    const formula = [...before].reverse().find((d) => d.formula_base != null)?.formula_base
    const trainings = before.filter((d) => d.is_complete).slice(-14).map((d) => Number(d.kcal_exercise ?? 0))
    if (tdee != null && formula != null) {
      const avg = trainings.length ? trainings.reduce((a, b) => a + b, 0) / trainings.length : 0
      weeklyGaps.push(measuredVsFormula(Number(tdee), Number(formula), avg))
    }
  }
  const reviewOf = (week: string) => rows.reviews.find((r) => r.week_start === week)?.text ?? null
  const end = sunday < today ? sunday : today
  // Média do que se comeu nos últimos 7 dias completos (até ao fim desta semana, sem hoje).
  const last7 = rows.days
    .filter((d) => d.is_complete === true && d.date <= (sunday < today ? sunday : shiftDate(today, -1)))
    .slice(-7)
  // A proteína dos 14 dias antes de `until` (o cartão e «Para esta semana»).
  const until = sunday < today ? shiftDate(sunday, 1) : today
  const proteinMeals = rows.meals.filter((m) => m.date >= shiftDate(until, -14) && m.date < until)
  return {
    monday,
    days,
    workouts,
    // O ritmo só com uma pesagem recente (até 4 dias antes do fim da semana ou de hoje).
    rate: weeklyRateAsOf(
      rows.weights.filter((w) => w.date >= shiftDate(sunday, -40) && w.date <= sunday).map((w) => ({ date: w.date, value: Number(w.kg) })),
      end,
    ),
    completeDays: rows.completeBefore + rows.days.filter((d) => d.is_complete === true && d.date <= sunday).length,
    expenditure,
    firstDate: rows.firstDate,
    review: reviewOf(monday),
    lastWeekReview: reviewOf(shiftDate(monday, -7)),
    weeklyGaps,
    avg7: avgOf(last7.map((d) => Number(d.kcal_in ?? 0))),
    protein: proteinBySlot(proteinMeals),
  }
}

// --- «Bate certo» (K7) ---------------------------------------------------

// O veredicto «✓ Bate certo» / «ainda não coincidem» só com 3 dias completos
// ou mais na semana (como o aviso do mínimo): à terça de manhã um dia só
// decidia tudo.
export const COHERENCE_MIN_DAYS = 3

export function weekCoherence(input: {
  averages: WeekAverages | null
  tdeeFrozen: number | null
  rate: number | null
  thirdWeek: boolean // a partir da 3.ª semana com dados
}): 'bate_certo' | 'ainda_nao' | null {
  const { averages, tdeeFrozen, rate } = input
  if (!input.thirdWeek || !averages || averages.days < COHERENCE_MIN_DAYS || tdeeFrozen == null || rate == null) return null
  return coherence(averages.eaten, tdeeFrozen, rate)
}
