// «O teu mês»: o resumo de um mês de calendário para a imagem de partilhar
// (e o aviso no Hoje nos dias 1–3 do mês seguinte). Só os dados da pessoa.
import { trend7, type DatedValue } from './weight.js'
import { shiftDate } from './nutritional-day.js'
import { mondayOf } from './manutencao.js'
import { counted, fmtDayMon } from './projecao.js'

export const ON_TARGET_TOLERANCE_KCAL = 100
export const BANNER_LAST_DAY = 3

export interface MonthDay {
  date: string
  kcal_in: number
  kcal_target: number
  is_complete: boolean
  flags?: string[] | null
}

export interface MonthWorkout {
  date: string
  minutes: number | null
  kcal: number | null
}

export interface MonthMeal {
  date: string
  items: { name: string }[]
}

export interface MonthSummary {
  month: string // YYYY-MM
  label: string // «outubro de 2026»
  kgChange: number | null
  cmChange: number | null
  workouts: number
  minutes: number
  workoutKcal: number
  daysOnTarget: number
  countedDays: number
  streak: number
  topMeal: { name: string; count: number } | null
  bestWeek: { monday: string; label: string; onTarget: number; workouts: number } | null
  projection: string | null
}

const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function monthLabel(month: string): string {
  return `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`
}

export function monthName(month: string): string {
  return MONTHS_LONG[Number(month.slice(5, 7)) - 1]!
}

export function monthBounds(month: string): { first: string; last: string } {
  const first = `${month}-01`
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { first, last: shiftDate(next, -1) }
}

export function previousMonth(date: string): string {
  return shiftDate(`${date.slice(0, 7)}-01`, -1).slice(0, 7)
}

// O aviso «O teu mês de outubro está pronto»: nos dias 1–3, uma vez por mês.
export function monthBanner(today: string, dismissed: string[]): string | null {
  if (Number(today.slice(8, 10)) > BANNER_LAST_DAY) return null
  const month = previousMonth(today)
  return dismissed.includes(bannerKey(month)) ? null : month
}

export const bannerKey = (month: string) => `mes:${month}`

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function onTarget(d: MonthDay): boolean {
  return counted(d) && d.kcal_target > 0 && d.kcal_in <= d.kcal_target + ON_TARGET_TOLERANCE_KCAL
}

export function monthSummary(input: {
  month: string
  weights: DatedValue[] // incluindo a semana antes do mês (peso médio do dia 1)
  waist: DatedValue[]
  days: MonthDay[]
  workouts: MonthWorkout[]
  meals: MonthMeal[]
  projection?: string | null
}): MonthSummary {
  const { first, last } = monthBounds(input.month)
  const inMonth = (d: string) => d >= first && d <= last

  // kg: peso médio (7 dias) no fim do mês − no início.
  const trend = trend7(input.weights.filter((w) => w.date <= last))
  const startT = trend.filter((p) => p.date <= shiftDate(first, 3)).pop() ?? trend.find((p) => inMonth(p.date))
  const endT = trend.filter((p) => inMonth(p.date)).pop()
  const kgChange = startT && endT && startT.date < endT.date ? Math.round((endT.value - startT.value) * 10) / 10 : null

  const waist = input.waist.filter((w) => w.date <= last).sort((a, b) => a.date.localeCompare(b.date))
  const wStart = waist.filter((w) => w.date < first).pop() ?? waist.find((w) => inMonth(w.date))
  const wEnd = waist.filter((w) => inMonth(w.date)).pop()
  const cmChange = wStart && wEnd && wStart.date < wEnd.date ? Math.round((wEnd.value - wStart.value) * 10) / 10 : null

  const ws = input.workouts.filter((w) => inMonth(w.date))
  const days = input.days.filter((d) => inMonth(d.date)).sort((a, b) => a.date.localeCompare(b.date))
  const good = new Set(days.filter(onTarget).map((d) => d.date))

  let streak = 0
  let run = 0
  for (let d = first; d <= last; d = shiftDate(d, 1)) {
    run = good.has(d) ? run + 1 : 0
    streak = Math.max(streak, run)
  }

  const counts = new Map<string, { name: string; count: number }>()
  for (const m of input.meals.filter((x) => inMonth(x.date))) {
    const names = (m.items ?? []).map((i) => i.name?.trim()).filter((n): n is string => !!n)
    if (!names.length) continue
    const key = names.map(normalize).sort().join('+')
    const entry = counts.get(key) ?? { name: names.join(' + '), count: 0 }
    entry.count++
    counts.set(key, entry)
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0]

  let bestWeek: MonthSummary['bestWeek'] = null
  for (let monday = mondayOf(first); monday <= last; monday = shiftDate(monday, 7)) {
    const sunday = shiftDate(monday, 6)
    const inside = (d: string) => d >= monday && d <= sunday && inMonth(d)
    let len = 0
    for (let d = monday; d <= sunday; d = shiftDate(d, 1)) if (inMonth(d)) len++
    if (len < 4) continue
    const on = [...good].filter(inside).length
    const wk = ws.filter((w) => inside(w.date)).length
    if (on === 0 && wk === 0) continue
    if (!bestWeek || on > bestWeek.onTarget || (on === bestWeek.onTarget && wk > bestWeek.workouts)) {
      bestWeek = { monday, label: `semana de ${fmtDayMon(monday)}`, onTarget: on, workouts: wk }
    }
  }

  return {
    month: input.month,
    label: monthLabel(input.month),
    kgChange,
    cmChange,
    workouts: ws.length,
    minutes: Math.round(ws.reduce((a, w) => a + (w.minutes ?? 0), 0)),
    workoutKcal: Math.round(ws.reduce((a, w) => a + (w.kcal ?? 0), 0)),
    daysOnTarget: good.size,
    countedDays: days.filter((d) => counted(d)).length,
    streak,
    topMeal: top && top.count >= 2 ? top : null,
    bestWeek,
    projection: input.projection ?? null,
  }
}
