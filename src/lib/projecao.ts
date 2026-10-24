// Os dados da «Projeção» e de «O teu mês», lidos do Supabase (só os da
// pessoa, pela RLS) e passados às regras puras (rules/projecao.ts, mes.ts).
// Tudo no telemóvel: sem função nova nem cron.
import { supabase } from './supabase'
import { shiftDate } from './day'
import type { BodyMeasurement, Profile } from './types'
import { cleanStarts, cycleInfo, cycleOptions } from '../../api/_lib/rules/ciclo'
import { targetBodyFatPct, targetWaist, wrongWaistSite } from '../../api/_lib/rules/composicao'
import { moveNote, project, projectionLine, type ProjInput, type Projection } from '../../api/_lib/rules/projecao'
import { monthBounds, monthSummary, type MonthSummary } from '../../api/_lib/rules/mes'

export interface ProjectionData {
  input: ProjInput
  targetWaistCm: number | null
}

export function waterDayFor(profile: Profile): ((d: string) => boolean) | undefined {
  if (profile.sex !== 'f') return undefined
  const starts = cleanStarts(profile.goals?.ciclo)
  if (!starts.length) return undefined
  const options = cycleOptions(profile.goals)
  return (d) => cycleInfo(starts, d, options)?.waterWeek === true
}

// A cintura alvo é a da %G alvo (a mesma do cartão da cintura).
function waistTarget(profile: Profile, rows: BodyMeasurement[]): number | null {
  const last = rows[rows.length - 1]
  if (!last || last.neck_cm == null || wrongWaistSite(last, profile.sex)) return null
  const t = targetWaist(
    Number(profile.height_cm ?? 183),
    Number(last.neck_cm),
    targetBodyFatPct(profile.sex),
    profile.sex,
    last.hips_cm != null ? Number(last.hips_cm) : null,
  )
  return t != null && Number.isFinite(t) ? Math.round(t) : null
}

// As linhas já lidas (do Supabase, só as da pessoa) que a projeção usa.
export interface ProjectionRows {
  weights: { date: string; kg: number | string }[]
  days: { date: string; kcal_in: number | null; kcal_target?: number | null; is_complete: boolean | null; flags: string[] | null; tdee_est: number | null }[]
  workouts: { date: string; minutes: number | null; kcal_est: number | null }[]
  measurements: BodyMeasurement[]
}

// Os dados da projeção a partir das linhas (o Corpo lê-as uma vez para a
// página toda e passa-as aqui; sem pedidos a mais).
export function projectionFrom(profile: Profile, asOf: string, rows: ProjectionRows): ProjectionData {
  const measured = rows.measurements.filter((r) => r.waist_cm != null && !wrongWaistSite(r, profile.sex))
  const targetWaistCm = waistTarget(profile, measured)
  const target = Number(profile.target_weight_kg)
  return {
    targetWaistCm,
    input: {
      asOf,
      weights: rows.weights.map((x) => ({ date: x.date, value: Number(x.kg) })),
      days: rows.days.map((x) => ({
        date: x.date,
        kcal_in: Number(x.kcal_in ?? 0),
        is_complete: x.is_complete === true,
        flags: x.flags ?? [],
        tdee_est: x.tdee_est != null ? Number(x.tdee_est) : null,
        kcal_target: Number(x.kcal_target ?? 0),
      })) as ProjInput['days'],
      workouts: rows.workouts.map((x) => ({
        date: x.date,
        kcal: x.kcal_est != null ? Number(x.kcal_est) : null,
        minutes: x.minutes != null ? Number(x.minutes) : null,
      })),
      waist: measured.map((r) => ({ date: r.date, value: Number(r.waist_cm) })),
      targetKg: Number.isFinite(target) && target > 0 ? target : null,
      targetWaistCm,
      waterDay: waterDayFor(profile),
    },
  }
}

// De `from` a `to`: pesagens, dias, treinos e medições.
async function loadRange(profile: Profile, from: string, to: string, asOf: string): Promise<ProjectionData> {
  const [w, d, wk, m] = await Promise.all([
    supabase.from('weights').select('date,kg').gte('date', from).lte('date', to).order('date'),
    supabase.from('days').select('date,kcal_in,kcal_target,is_complete,flags,tdee_est').gte('date', from).lte('date', to).order('date'),
    supabase.from('workouts_active').select('date,minutes,kcal_est').gte('date', from).lte('date', to),
    supabase.from('body_measurements').select('*').order('date'),
  ])
  if (w.error || d.error) throw new Error(w.error?.message ?? d.error?.message)
  return projectionFrom(profile, asOf, {
    weights: (w.data ?? []) as ProjectionRows['weights'],
    days: (d.data ?? []) as ProjectionRows['days'],
    workouts: (wk.data ?? []) as ProjectionRows['workouts'],
    measurements: (m.data ?? []) as BodyMeasurement[],
  })
}

export async function loadProjection(profile: Profile, today: string): Promise<ProjectionData> {
  // 28 dias de agora e os 28 de há uma semana (a nota da semana).
  return loadRange(profile, shiftDate(today, -40), today, today)
}

export function weekAgo(data: ProjectionData): Projection {
  const asOf = shiftDate(data.input.asOf, -7)
  const cut = (x: { date: string }) => x.date < asOf
  const i = data.input
  return project({
    ...i,
    asOf,
    weights: i.weights.filter((w) => w.date <= asOf),
    days: i.days.filter(cut),
    workouts: i.workouts.filter(cut),
    waist: i.waist.filter((w) => w.date <= asOf),
  })
}

export function weekNote(data: ProjectionData, now: Projection) {
  return moveNote(now, weekAgo(data))
}

// O resumo de um mês, com a linha da projeção no dia seguinte ao fim do mês
// (ou hoje, no mês corrente).
export async function loadMonth(profile: Profile, month: string, today: string): Promise<MonthSummary> {
  const { first, last } = monthBounds(month)
  const asOf = shiftDate(last, 1) < today ? shiftDate(last, 1) : today
  const data = await loadRange(profile, shiftDate(first, -30), last, asOf)
  const { data: meals } = await supabase.from('meals_counted').select('date,items').gte('date', first).lte('date', last)
  const p = project({ ...data.input, days: data.input.days.filter((d) => d.date < asOf) })
  const i = data.input
  return monthSummary({
    month,
    weights: i.weights,
    waist: i.waist,
    days: i.days as unknown as Parameters<typeof monthSummary>[0]['days'],
    workouts: i.workouts as unknown as Parameters<typeof monthSummary>[0]['workouts'],
    meals: (meals ?? []).map((x) => ({ date: x.date as string, items: (x.items as { name: string }[] | null) ?? [] })),
    projection: projectionLine(p, i.targetKg, data.targetWaistCm, asOf),
  })
}
