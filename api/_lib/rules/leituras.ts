// Corpo: o título de cada gráfico é uma frase com os números da pessoa
// («−4,1 kg em 9 semanas», «Desceu 3 bpm desde agosto», «Dormes 7 h 05 por
// noite, mais 25 min do que em agosto»). Quando piorou diz-se na mesma, sem
// drama («Média de 6 900 passos por dia, menos 800 do que no mês anterior»).
// Também os marcos nos gráficos (o início, o mais baixo, a melhor semana) e o
// resumo «Desde o início». Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'
import { fmtSleep } from './sono.js'
import { fmtDayMon, type GoalEta } from './projecao.js'
import {
  dayNum,
  daysBetween,
  fromDayNum,
  highest,
  lowest,
  meanOf,
  type DatedValue,
  type Period,
} from './graficos.js'

// --- Números em PT-PT ----------------------------------------------------

const THIN = ' '
const MINUS = '−'
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function int(n: number): string {
  const r = Math.round(n)
  return (r < 0 ? MINUS : '') + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN)
}

export function dec1(n: number): string {
  return (Math.round(Math.abs(n) * 10) / 10).toFixed(1).replace('.', ',')
}

// «−4,1» / «+0,6» (o sinal certo, com o menos tipográfico).
export function signed1(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${r < 0 ? MINUS : r > 0 ? '+' : ''}${dec1(r)}`
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step

function monthOf(date: string, asOf: string): string {
  const name = MONTHS_LONG[Number(date.slice(5, 7)) - 1]!
  return date.slice(0, 4) === asOf.slice(0, 4) ? name : `${name} de ${date.slice(0, 4)}`
}

// --- Agora contra antes --------------------------------------------------

export const COMPARE_DAYS = 30
export const MIN_VALUES = 7 // dias com valor em cada janela para comparar
export const MIN_NOW_VALUES = 3 // para haver média

export interface Comparison {
  now: number // média dos últimos 30 dias
  nowCount: number
  then: number | null // média da janela de antes
  diff: number | null // now − then
  since: string | null // «desde agosto» · «face ao mês anterior»
  than: string | null // «do que em agosto» · «do que no mês anterior»
  like: string | null // «como em agosto» · «como no mês anterior»
}

function meanIn(rows: DatedValue[], from: string, to: string): { mean: number | null; n: number } {
  const v = rows.filter((r) => r.date >= from && r.date <= to && Number.isFinite(r.value)).map((r) => r.value)
  return { mean: meanOf(v), n: v.length }
}

// Os últimos 30 dias contra: no 1M, os 30 antes; no 3M e no «Tudo», os
// primeiros 30 do período (com o nome do mês do meio dessa janela).
// `excludeToday`: os passos de hoje ainda vão a meio.
export function compareWindows(
  rows: DatedValue[],
  today: string,
  period: Period,
  periodStart: string,
  opts: { excludeToday?: boolean; days?: number } = {},
): Comparison | null {
  const days = opts.days ?? COMPARE_DAYS
  const end = opts.excludeToday ? shiftDate(today, -1) : today
  const nowFrom = shiftDate(end, -(days - 1))
  const now = meanIn(rows, nowFrom, end)
  if (now.mean == null || now.n < MIN_NOW_VALUES) return null
  let refFrom: string
  let refTo: string
  let since: string
  let than: string
  let like: string
  if (period === '1M') {
    refTo = shiftDate(nowFrom, -1)
    refFrom = shiftDate(refTo, -(days - 1))
    since = 'face ao mês anterior'
    than = 'do que no mês anterior'
    like = 'como no mês anterior'
  } else {
    const firstRow = rows
      .filter((r) => r.date >= periodStart && Number.isFinite(r.value))
      .reduce<string | null>((a, r) => (a == null || r.date < a ? r.date : a), null)
    refFrom = firstRow ?? periodStart
    refTo = shiftDate(refFrom, days - 1)
    const month = monthOf(fromDayNum(Math.round((dayNum(refFrom) + dayNum(refTo)) / 2)), today)
    since = `desde ${month}`
    than = `do que em ${month}`
    like = `como em ${month}`
  }
  const ref = refTo < nowFrom ? meanIn(rows, refFrom, refTo) : { mean: null, n: 0 }
  if (ref.mean == null || ref.n < MIN_VALUES || now.n < MIN_VALUES) {
    return { now: now.mean, nowCount: now.n, then: null, diff: null, since: null, than: null, like: null }
  }
  return { now: now.mean, nowCount: now.n, then: ref.mean, diff: now.mean - ref.mean, since, than, like }
}

export const FEW_DATA = 'Ainda poucos dados: volta daqui a 1 semana'

// Sem os últimos 30 dias (o relógio deixou de mandar), mas com 7 dias ou
// mais no período: a média do período, dita como tal.
export const MIN_PERIOD_VALUES = 7

export function periodMean(rows: DatedValue[], from: string, to: string): number | null {
  const v = rows.filter((r) => r.date >= from && r.date <= to && Number.isFinite(r.value)).map((r) => r.value)
  return v.length >= MIN_PERIOD_VALUES ? meanOf(v) : null
}

export function staleReading(kind: 'steps' | 'sleep' | 'rhr' | 'hrv', mean: number): string {
  const tail = 'no período; sem dados nos últimos 30 dias'
  if (kind === 'steps') return `Média de ${int(roundTo(mean, 100))} passos por dia ${tail}`
  if (kind === 'sleep') return `Dormias ${fmtSleep(Math.round(mean))} por noite ${tail}`
  if (kind === 'rhr') return `Média de ${Math.round(mean)} bpm ${tail}`
  return `Média de ${Math.round(mean)} ms ${tail}`
}

export function stepsReading(c: Comparison | null): string {
  if (!c) return FEW_DATA
  const base = `Média de ${int(roundTo(c.now, 100))} passos por dia`
  if (c.diff == null) return base
  if (Math.abs(c.diff) < 300) return `${base}, ${c.like}`
  return `${base}, ${c.diff > 0 ? 'mais' : 'menos'} ${int(roundTo(Math.abs(c.diff), 100))} ${c.than}`
}

export function sleepReading(c: Comparison | null): string {
  if (!c) return FEW_DATA
  const base = `Dormes ${fmtSleep(Math.round(c.now))} por noite`
  if (c.diff == null) return base
  if (Math.abs(c.diff) < 10) return `${base}, ${c.like}`
  return `${base}, ${c.diff > 0 ? 'mais' : 'menos'} ${roundTo(Math.abs(c.diff), 5)} min ${c.than}`
}

// Mais baixa é melhor (o coração mais em forma).
export function restingHrReading(c: Comparison | null): string {
  if (!c) return FEW_DATA
  const now = Math.round(c.now)
  if (c.diff == null) return `Média de ${now} bpm`
  const d = Math.round(c.diff)
  if (d === 0) return `Estável em ${now} bpm ${c.since}`
  return `${d < 0 ? 'Desceu' : 'Subiu'} ${Math.abs(d)} bpm ${c.since} (agora ${now})`
}

// Mais alta costuma querer dizer mais recuperado.
export function hrvReading(c: Comparison | null): string {
  if (!c) return FEW_DATA
  const now = Math.round(c.now)
  if (c.diff == null) return `Média de ${now} ms`
  const d = Math.round(c.diff)
  if (Math.abs(d) < 2) return `Estável em ${now} ms ${c.since}`
  return `${d > 0 ? 'Subiu' : 'Desceu'} ${Math.abs(d)} ms ${c.since} (agora ${now})`
}

// Hoje contra a média dos 30 dias: «2 bpm abaixo da média», «como a média».
export function vsAverage(today: number, avg: number, unit: string, same: number): string {
  if (Math.abs(today - avg) < same) return 'como a média'
  const d = Math.round(Math.abs(today - avg))
  return `${int(d)}${unit ? ` ${unit}` : ''} ${today > avg ? 'acima' : 'abaixo'} da média`
}

// --- Peso ----------------------------------------------------------------

export interface WeightChange {
  start: DatedValue
  end: DatedValue
  kg: number
  days: number
  water: boolean // as pesagens mais recentes são da semana de água (ficaram de fora)
}

// O peso médio (7 dias) do início do período ao mais recente. Nas mulheres
// com o ciclo marcado, as pesagens da semana de água não são ponta da conta
// (o peso sobe com água, não com gordura).
// `startAt`: no «Tudo», o começo de sempre (startWeight), o mesmo número do
// resumo «Desde o início».
export function weightChange(trend: DatedValue[], from: string, waterDay?: (d: string) => boolean, startAt?: DatedValue | null): WeightChange | null {
  const pts = trend.filter((p) => p.date >= from).sort((a, b) => a.date.localeCompare(b.date))
  const clean = waterDay ? pts.filter((p) => !waterDay(p.date)) : pts
  const use = clean.length >= 2 ? clean : pts
  if (use.length < 2) return null
  const start = startAt ?? use[0]!
  const end = use[use.length - 1]!
  const days = daysBetween(start.date, end.date)
  if (days < 7) return null
  const last = pts[pts.length - 1]!
  return { start, end, kg: Math.round((end.value - start.value) * 10) / 10, days, water: end.date !== last.date }
}

function spanText(days: number): string {
  return days >= 14 ? `em ${Math.round(days / 7)} semanas` : `em ${days} dias`
}

export function weightReading(change: WeightChange | null): string {
  if (!change) return 'Ainda poucas pesagens: volta daqui a 1 semana'
  const when = spanText(change.days)
  const text = Math.abs(change.kg) < 0.2 ? `Peso médio estável ${when}` : `${signed1(change.kg)} kg ${when}`
  return change.water ? `${text} (sem a semana de água)` : text
}

export interface Mark {
  id: string
  date: string
  value: number
  label: string
  priority: number
  prefer?: 'above' | 'below'
  strong?: boolean // o ponto principal (o de hoje)
}

// Os marcos da linha do peso médio: o começo (ou o início de tudo), o mais
// baixo (quando não é nem o começo nem o último) e o último.
// Os rótulos dizem sempre «valor · papel» («95,2 · início», «87,1 · mais
// baixo»). `start`: o começo de sempre (no «Tudo»), em vez do 1.º ponto.
export function weightMarks(trend: DatedValue[], opts: { firstEver: boolean; lowestEver: boolean; start?: DatedValue | null }): Mark[] {
  if (trend.length === 0) return []
  const first = opts.start ?? trend[0]!
  const last = trend[trend.length - 1]!
  const marks: Mark[] = []
  if (trend.length >= 2) {
    marks.push({ id: 'inicio', date: first.date, value: first.value, label: opts.firstEver ? `${dec1(first.value)} · início` : dec1(first.value), priority: 2, prefer: 'above' })
  }
  const low = lowest(trend)
  const lowText = opts.lowestEver ? 'mais baixo de sempre' : 'mais baixo'
  // O último a menos de 0,2 kg do mais baixo conta como o mais baixo (um rótulo só).
  const lastIsLow = low != null && last.value - low.value < 0.2 && trend.length >= 10 && first.value - last.value >= 0.3
  if (low && !lastIsLow && low.date > first.date && low.date !== last.date && first.value - low.value >= 0.3) {
    marks.push({ id: 'baixo', date: low.date, value: low.value, label: `${dec1(low.value)} · ${lowText}`, priority: 3, prefer: 'below' })
  }
  marks.push({ id: 'ultimo', date: last.date, value: last.value, label: lastIsLow ? `${dec1(last.value)} · ${lowText}` : dec1(last.value), priority: 4, prefer: 'above', strong: true })
  return marks
}

// --- Projeção desenhada no gráfico ---------------------------------------

export interface ProjectionPoint {
  date: string
  mid: number
  low: number | null // a descer mais depressa
  high: number | null // mais devagar
}

export interface ProjectionPath {
  points: ProjectionPoint[]
  reachesInView: boolean // a linha chega ao alvo dentro do gráfico
  end: DatedValue // onde a linha acaba
}

// A linha tracejada do peso médio de hoje até ao alvo, na data da projeção
// (rules/projecao.ts). Se a data fica para lá de `horizonEnd`, a linha acaba
// aí (o rótulo diz a data). O leque vai das datas «a partir de» às «até».
export function projectionPath(start: DatedValue, eta: GoalEta, target: number, horizonEnd: string): ProjectionPath | null {
  if (eta.kind !== 'date' || start.value <= target) return null
  const s = dayNum(start.date)
  const at = (endDate: string | null, day: number): number | null => {
    if (!endDate) return null
    const e = dayNum(endDate)
    if (e <= s) return target
    const t = Math.min(1, (day - s) / (e - s))
    return Math.round((start.value + (target - start.value) * t) * 100) / 100
  }
  const end = Math.min(dayNum(eta.date), dayNum(horizonEnd))
  if (end <= s) return null
  const days: number[] = []
  for (let d = s; d < end; d += 7) days.push(d)
  days.push(end)
  const points = days.map((d) => ({
    date: fromDayNum(d),
    mid: at(eta.date, d)!,
    low: at(eta.early, d),
    high: at(eta.late, d),
  }))
  const last = points[points.length - 1]!
  return { points, reachesInView: dayNum(eta.date) <= dayNum(horizonEnd), end: { date: last.date, value: last.mid } }
}

// Onde a linha tracejada começa: hoje, no peso da reta da projeção (o mesmo
// «agora» do cartão da Projeção, sem a semana de água), não no último ponto
// do peso médio.
export function projectionStart(asOf: string, currentKg: number): DatedValue {
  return { date: asOf, value: currentKg }
}

// Quantos dias de projeção cabem à direita: até 75 % do período (pelo menos
// 4 semanas), para os dados não ficarem espremidos à esquerda.
export function projectionHorizon(periodStart: string, today: string): string {
  const span = Math.max(1, daysBetween(periodStart, today))
  return shiftDate(today, Math.max(28, Math.round(span * 0.75)))
}

// --- Cintura -------------------------------------------------------------

// `points`: as medições (no mesmo sítio) que o gráfico mostra; `allMin`: a
// mais baixa de todas as medições.
export function waistReading(points: DatedValue[], allMin: number | null, asOf: string): string {
  if (points.length === 0) return 'Mede a cintura para veres a evolução'
  const last = points[points.length - 1]!
  if (points.length === 1) return `${dec1(last.value)} cm a ${fmtDayMon(last.date, asOf)}`
  const first = points[0]!
  const d = last.value - first.value
  if (Math.abs(d) < 0.5) return `Igual desde ${fmtDayMon(first.date, asOf)} (${dec1(last.value)} cm)`
  const best = allMin != null && last.value <= allMin + 1e-9 && points.length >= 3 && d < 0 ? ' · a mais baixa de sempre' : ''
  return `${signed1(d)} cm desde ${fmtDayMon(first.date, asOf)}${best}`
}

export function waistMarks(points: DatedValue[]): Mark[] {
  if (points.length === 0) return []
  const last = points[points.length - 1]!
  const low = lowest(points)
  const marks: Mark[] = []
  if (low && low.date !== last.date && points.length >= 3) {
    marks.push({ id: 'baixa', date: low.date, value: low.value, label: `${dec1(low.value)} · a mais baixa`, priority: 3, prefer: 'below' })
  }
  marks.push({ id: 'ultima', date: last.date, value: last.value, label: dec1(last.value), priority: 4, prefer: 'above', strong: true })
  return marks
}

// --- %G ao longo do tempo (decisão 303) -----------------------------------

// «−2,7 pontos desde 29 set»: a %G de cada medição do período (no mesmo
// sítio da cintura); `allMin`, a mais baixa de todas.
export function fatReading(points: DatedValue[], allMin: number | null, asOf: string): string {
  if (points.length === 0) return 'Mede a cintura e o pescoço para veres a %G'
  const last = points[points.length - 1]!
  if (points.length === 1) return `${dec1(last.value)} % a ${fmtDayMon(last.date, asOf)}`
  const first = points[0]!
  const d = last.value - first.value
  if (Math.abs(d) < 0.5) return `Igual desde ${fmtDayMon(first.date, asOf)} (${dec1(last.value)} %)`
  const best = allMin != null && last.value <= allMin + 1e-9 && points.length >= 3 && d < 0 ? ' · a mais baixa de sempre' : ''
  return `${signed1(d)} pontos desde ${fmtDayMon(first.date, asOf)}${best}`
}

// O começo, a mais baixa (quando não é nem o começo nem a última) e a última.
export function fatMarks(points: DatedValue[]): Mark[] {
  if (points.length === 0) return []
  const first = points[0]!
  const last = points[points.length - 1]!
  const marks: Mark[] = []
  if (points.length >= 2) marks.push({ id: 'inicio', date: first.date, value: first.value, label: `${dec1(first.value)} · início`, priority: 2, prefer: 'above' })
  const low = lowest(points)
  if (low && points.length >= 3 && low.date !== first.date && low.date !== last.date) {
    marks.push({ id: 'baixa', date: low.date, value: low.value, label: `${dec1(low.value)} · a mais baixa`, priority: 3, prefer: 'below' })
  }
  marks.push({ id: 'ultima', date: last.date, value: last.value, label: dec1(last.value), priority: 4, prefer: 'above', strong: true })
  return marks
}

// --- Treino --------------------------------------------------------------

export interface WeekMinutes {
  monday: string
  bike: number
  gym: number
}

const total = (w: WeekMinutes) => w.bike + w.gym

// Média das últimas 4 semanas acabadas (a desta ainda vai a meio) contra as
// 4 antes (1M) ou as 4 primeiras do período (3M, «Tudo»).
export function trainingReading(weeks: WeekMinutes[], currentMonday: string, period: Period, periodStart: string, asOf: string): string {
  const done = weeks.filter((w) => w.monday < currentMonday).sort((a, b) => a.monday.localeCompare(b.monday))
  const recent = done.slice(-4)
  if (recent.length < 2 || recent.every((w) => total(w) === 0)) return 'Ainda poucas semanas com treino: volta daqui a 1 semana'
  const avg = meanOf(recent.map(total))!
  const base = `Média de ${int(roundTo(avg, 5))} min por semana ${recent.length === 4 ? 'nas últimas 4 semanas' : `nas últimas ${recent.length} semanas`}`
  const firstRecent = recent[0]!.monday
  const before =
    period === '1M'
      ? done.filter((w) => w.monday < firstRecent).slice(-4)
      : done.filter((w) => w.monday >= periodStart && w.monday < firstRecent).slice(0, 4)
  if (before.length < 4) return base
  const diff = avg - meanOf(before.map(total))!
  const than = period === '1M' ? 'do que nas 4 antes' : `do que em ${monthOf(shiftDate(before[0]!.monday, 14), asOf)}`
  const like = period === '1M' ? 'como nas 4 antes' : `como em ${monthOf(shiftDate(before[0]!.monday, 14), asOf)}`
  if (Math.abs(diff) < 15) return `${base}, ${like}`
  return `${base}, ${diff > 0 ? 'mais' : 'menos'} ${int(roundTo(Math.abs(diff), 5))} ${than}`
}

// A melhor semana do período (mais minutos; num empate, a mais recente).
export function bestWeek(weeks: WeekMinutes[]): WeekMinutes | null {
  const withMinutes = weeks.filter((w) => total(w) > 0)
  if (withMinutes.length < 3) return null
  return withMinutes.reduce((best, w) => (total(w) >= total(best) ? w : best))
}

export interface FormPoint {
  date: string
  ctl: number
  atl: number
}

// A forma (carga de 42 dias) do início do período a hoje.
export function formReading(points: FormPoint[], period: Period, asOf: string): string {
  if (points.length < 7 || points.every((p) => p.ctl <= 0)) return 'Ainda poucos dias de treino: volta daqui a 1 semana'
  const first = points[0]!
  const last = points[points.length - 1]!
  const a = Math.round(first.ctl)
  const b = Math.round(last.ctl)
  const since = period === '1M' ? 'num mês' : `desde ${monthOf(first.date, asOf)}`
  if (Math.abs(b - a) < 2) return `Estável em ${b} ${since}`
  return `${b > a ? 'Subiu' : 'Desceu'} de ${a} para ${b} ${since}`
}

// O mês que mais fez subir a forma (pelo menos 2 pontos, com 2 meses ou
// mais no gráfico e 20 dias desse mês).
export function bestFormMonth(points: FormPoint[]): { month: string; from: string; to: string; gain: number } | null {
  const months = new Map<string, FormPoint[]>()
  for (const p of points) {
    const key = p.date.slice(0, 7)
    const list = months.get(key) ?? []
    list.push(p)
    months.set(key, list)
  }
  if (months.size < 2) return null
  let best: { month: string; from: string; to: string; gain: number } | null = null
  for (const [month, list] of months) {
    if (list.length < 20) continue
    const sorted = [...list].sort((x, y) => x.date.localeCompare(y.date))
    const gain = Math.round((sorted[sorted.length - 1]!.ctl - sorted[0]!.ctl) * 10) / 10
    if (gain >= 2 && (!best || gain >= best.gain)) best = { month, from: sorted[0]!.date, to: sorted[sorted.length - 1]!.date, gain }
  }
  return best
}

export function formMarks(points: FormPoint[]): Mark[] {
  const peak = highest(points.map((p) => ({ date: p.date, value: p.ctl })))
  if (!peak || points.length < 7) return []
  const last = points[points.length - 1]!
  const marks: Mark[] = []
  if (peak.date !== last.date && peak.value - last.ctl >= 1) {
    marks.push({ id: 'pico', date: peak.date, value: peak.value, label: `${Math.round(peak.value)} · a mais alta`, priority: 3, prefer: 'above' })
  }
  marks.push({ id: 'hoje', date: last.date, value: last.ctl, label: peak.date === last.date && points.length >= 14 ? `${Math.round(last.ctl)} · a mais alta` : String(Math.round(last.ctl)), priority: 4, prefer: 'above', strong: true })
  return marks
}

// --- Recuperação: marcos dia a dia ---------------------------------------

// HRV mais alta e FC em repouso mais baixa do período (dias inteiros).
export function bestDayMark(points: DatedValue[], kind: 'max' | 'min', label: string, unit: string): Mark | null {
  if (points.length < 7) return null
  const p = kind === 'max' ? highest(points) : lowest(points)
  if (!p) return null
  return { id: 'melhor', date: p.date, value: p.value, label: `${Math.round(p.value)}${unit ? `\u00a0${unit}` : ''} · ${label}`, priority: 3, prefer: kind === 'max' ? 'above' : 'below' }
}

// --- «Desde o início» ------------------------------------------------------

export interface SinceStart {
  since: string // a primeira pesagem
  start: DatedValue | null // o começo do peso: a média da 1.ª semana, no último dia dela
  kg: number | null
  kgGood: boolean
  cm: number | null
  cmSince: string | null
  cmGood: boolean
  fat: number | null // pontos de %G
  fatSince: string | null
  fatGood: boolean
}

// O começo de sempre do peso: a média das pesagens da primeira semana (sem
// as da semana de água, se houver outras), no último dia dessa semana — é
// aí que a linha do peso médio (7 dias) passa por esse valor. O resumo
// «Desde o início» e o gráfico em «Tudo» usam este mesmo número.
export function startWeight(firstWeighings: DatedValue[], waterDay?: (d: string) => boolean): { since: string; start: DatedValue } | null {
  const first = [...firstWeighings].sort((a, b) => a.date.localeCompare(b.date))
  const head = first[0]
  if (!head) return null
  const week = first.filter((w) => daysBetween(head.date, w.date) < 7)
  const dry = waterDay ? week.filter((w) => !waterDay(w.date)) : week
  const use = dry.length ? dry : week
  const value = Math.round(meanOf(use.map((w) => w.value))! * 100) / 100
  return { since: head.date, start: { date: use[use.length - 1]!.date, value } }
}

// Do primeiro registo a agora: o peso médio da primeira semana de pesagens
// contra o mais recente (sem a semana de água), a primeira cintura contra a
// última (no mesmo sítio) e a %G da primeira medição contra a da última. É
// «a melhorar» (verde) quando vai para o lado do alvo da pessoa.
export function sinceStart(input: {
  firstWeighings: DatedValue[] // as primeiras pesagens de sempre (a primeira semana chega)
  trend: DatedValue[] // o peso médio recente
  waist: DatedValue[] // medições da cintura no mesmo sítio, por data
  fat: DatedValue[] // %G de cada medição comparável, por data
  targetKg: number | null
  waterDay?: (d: string) => boolean
}): SinceStart | null {
  const sw = startWeight(input.firstWeighings, input.waterDay)
  if (!sw) return null
  const startKg = sw.start.value
  const clean = input.waterDay ? input.trend.filter((p) => !input.waterDay!(p.date)) : input.trend
  const end = (clean.length ? clean : input.trend).reduce<DatedValue | null>((a, p) => (a == null || p.date > a.date ? p : a), null)
  let kg: number | null = null
  if (end && daysBetween(sw.since, end.date) >= 7) kg = Math.round((end.value - startKg) * 10) / 10
  const goalDown = input.targetKg == null || input.targetKg < startKg
  const kgGood = kg != null && Math.abs(kg) >= 0.2 && (goalDown ? kg < 0 : kg > 0)

  const pair = (rows: DatedValue[]) => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const a = sorted[0]
    const b = sorted[sorted.length - 1]
    return a && b && daysBetween(a.date, b.date) >= 7 ? { from: a, change: Math.round((b.value - a.value) * 10) / 10 } : null
  }
  const w = pair(input.waist)
  const f = pair(input.fat)
  return {
    since: sw.since,
    start: sw.start,
    kg,
    kgGood,
    cm: w?.change ?? null,
    cmSince: w?.from.date ?? null,
    cmGood: w != null && w.change <= -0.5,
    fat: f?.change ?? null,
    fatSince: f?.from.date ?? null,
    fatGood: f != null && f.change <= -0.5,
  }
}
