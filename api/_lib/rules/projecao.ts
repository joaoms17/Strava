// «Projeção» (Corpo): quando chega ao peso e à cintura alvo, a este ritmo,
// com os dados da própria pessoa. Duas medidas do ritmo, que se juntam:
//  - pelas contas: média do que comeu (dias completos) − gasto medido, ÷ 7700;
//  - pelo peso: declive do peso médio (7 dias) nas últimas 4 semanas, sem as
//    pesagens da semana de água do ciclo.
// O centro é a média das duas; o intervalo, a distância entre elas (com um
// mínimo de 15 % do ritmo). O «E se…» soma kcal por dia ao ritmo pelas contas.
// Sem imports do servidor: o telemóvel corre tudo isto.
import { linearSlope, trend7, type DatedValue } from './weight.js'
import { shiftDate } from './nutritional-day.js'

export const KCAL_PER_KG = 7700
export const PROJ_WINDOW_DAYS = 28
export const PROJ_MIN_DAYS = 14 // dias completos e dias de pesagens
export const PROJ_MIN_WEIGHINGS = 8
export const PROJ_MAX_DAYS = 730
export const WAIST_WINDOW_DAYS = 120
export const MOVE_NOTE_DAYS = 5
const MIN_SPREAD_SHARE = 0.15
const STABLE_KG_DAY = 0.02 / 7 // menos de 20 g por semana: estável

export interface ProjDay {
  date: string
  kcal_in: number
  is_complete: boolean
  flags?: string[] | null
  tdee_est: number | null
}

export interface ProjWorkout {
  date: string
  kcal: number | null
}

export interface ProjInput {
  asOf: string // hoje: conta até ontem (o dia de hoje ainda não fechou)
  weights: DatedValue[]
  days: ProjDay[]
  workouts: ProjWorkout[]
  waist: DatedValue[] // cintura medida (cm), só no sítio certo
  targetKg: number | null
  targetWaistCm: number | null
  waterDay?: (date: string) => boolean // semana de água do ciclo
}

export interface Basis {
  from: string
  to: string
  countedDays: number
  weighings: number
  intake: number // kcal/dia, dias completos
  weekday: number | null
  weekend: number | null
  tdee: number
  workoutsPerWeek: number
  workoutKcal: number | null // média por treino
  workoutKcalDay: number // treino por dia (média na janela)
  energyKgDay: number // pelas contas
  observedKgDay: number // pelo peso
  rateKgDay: number // centro
  spreadKgDay: number
  currentKg: number
  waistCm: number | null
  waistDate: string | null
  waistCmDay: number | null
}

export type GoalEta =
  | { kind: 'reached' }
  | { kind: 'never' } // a este ritmo não chega (a subir, estável ou a mais de 2 anos)
  | { kind: 'date'; date: string; early: string; late: string | null }

export type Projection =
  | { status: 'insuficiente'; countedDays: number; weighingDays: number; missing: string }
  | { status: 'sem_alvo'; basis: Basis }
  | { status: 'ok'; basis: Basis; weight: GoalEta; waist: GoalEta | null }

const DAY_MS = 86_400_000
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS
export const dayDiff = (a: string, b: string) => Math.round(dayNum(b) - dayNum(a))
const isWeekend = (d: string) => {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

export function counted(d: Pick<ProjDay, 'is_complete' | 'flags'>): boolean {
  return d.is_complete && !(d.flags ?? []).includes('faltou_algo')
}

export function projectionBasis(input: ProjInput): Basis | { missing: string; countedDays: number; weighingDays: number } {
  const to = shiftDate(input.asOf, -1)
  const from = shiftDate(input.asOf, -PROJ_WINDOW_DAYS)
  const inWin = (d: string) => d >= from && d <= to
  const days = input.days.filter((d) => inWin(d.date)).sort((a, b) => a.date.localeCompare(b.date))
  const good = days.filter(counted)
  const weights = input.weights.filter((w) => w.date >= from && w.date <= input.asOf)
  const weighDates = [...new Set(weights.map((w) => w.date))].sort()
  const span = weighDates.length ? dayDiff(weighDates[0]!, weighDates[weighDates.length - 1]!) + 1 : 0
  const tdees = days.filter((d) => d.tdee_est != null)
  const tdee = tdees.length ? Number(tdees[tdees.length - 1]!.tdee_est) : null
  const missingParts: string[] = []
  if (good.length < PROJ_MIN_DAYS) missingParts.push(`${PROJ_MIN_DAYS - good.length} dias completos`)
  if (weighDates.length < PROJ_MIN_WEIGHINGS || span < PROJ_MIN_DAYS) {
    missingParts.push(`pesagens em ${Math.max(PROJ_MIN_DAYS - span, PROJ_MIN_WEIGHINGS - weighDates.length, 1)} dias`)
  }
  if (!missingParts.length && tdee == null) missingParts.push('o gasto medido')
  if (missingParts.length) {
    return { missing: `Faltam ${missingParts.join(' e ')}.`, countedDays: good.length, weighingDays: weighDates.length }
  }

  const intake = mean(good.map((d) => d.kcal_in))!
  const wd = good.filter((d) => !isWeekend(d.date)).map((d) => d.kcal_in)
  const we = good.filter((d) => isWeekend(d.date)).map((d) => d.kcal_in)
  const trend = trend7(weights)
  const clean = input.waterDay ? trend.filter((p) => !input.waterDay!(p.date)) : trend
  const slopeOn = clean.length >= PROJ_MIN_WEIGHINGS ? clean : trend
  const observed = linearSlope(slopeOn)
  const energy = (intake - tdee!) / KCAL_PER_KG
  const rate = (energy + observed) / 2
  const spread = Math.max(Math.abs(energy - observed) / 2, Math.abs(rate) * MIN_SPREAD_SHARE)
  // O peso de hoje: o fim da reta (não a última pesagem, que salta com água).
  const lastDay = dayNum(slopeOn[slopeOn.length - 1]!.date)
  const meanX = slopeOn.reduce((a, p) => a + dayNum(p.date), 0) / slopeOn.length
  const meanY = slopeOn.reduce((a, p) => a + p.value, 0) / slopeOn.length
  const currentKg = Math.round((meanY + observed * (lastDay - meanX)) * 100) / 100

  const ws = input.workouts.filter((w) => inWin(w.date))
  const kcals = ws.filter((w) => w.kcal != null && w.kcal > 0).map((w) => Number(w.kcal))
  const workoutKcal = mean(kcals)

  const waistFrom = shiftDate(input.asOf, -WAIST_WINDOW_DAYS)
  const waist = input.waist.filter((w) => w.date >= waistFrom && w.date <= input.asOf).sort((a, b) => a.date.localeCompare(b.date))
  const lastWaist = waist[waist.length - 1] ?? null
  const waistSpan = waist.length >= 2 ? dayDiff(waist[0]!.date, lastWaist!.date) : 0

  return {
    from,
    to,
    countedDays: good.length,
    weighings: weighDates.length,
    intake: Math.round(intake),
    weekday: wd.length ? Math.round(mean(wd)!) : null,
    weekend: we.length ? Math.round(mean(we)!) : null,
    tdee: Math.round(tdee!),
    workoutsPerWeek: Math.round((ws.length / (PROJ_WINDOW_DAYS / 7)) * 10) / 10,
    workoutKcal: workoutKcal != null ? Math.round(workoutKcal) : null,
    workoutKcalDay: Math.round(kcals.reduce((a, b) => a + b, 0) / PROJ_WINDOW_DAYS),
    energyKgDay: energy,
    observedKgDay: observed,
    rateKgDay: rate,
    spreadKgDay: spread,
    currentKg,
    waistCm: lastWaist?.value ?? null,
    waistDate: lastWaist?.date ?? null,
    waistCmDay: waistSpan >= PROJ_MIN_DAYS ? linearSlope(waist) : null,
  }
}

// Dias até ao alvo a um ritmo (por dia); null se não chega.
function daysTo(from: number, target: number, rate: number): number | null {
  const need = target - from
  if (Math.abs(rate) < STABLE_KG_DAY / 2 || Math.sign(need) !== Math.sign(rate)) return null
  const days = Math.ceil(need / rate)
  return days <= PROJ_MAX_DAYS ? days : null
}

export function etaFor(asOf: string, current: number, target: number, rate: number, spread: number): GoalEta {
  // A app é para descer: no alvo ou abaixo dele, está atingido.
  if (current - target <= 0.05) return { kind: 'reached' }
  const central = daysTo(current, target, rate)
  if (central == null) return { kind: 'never' }
  const dir = -1
  const fast = daysTo(current, target, rate + dir * spread)
  const slow = daysTo(current, target, rate - dir * spread)
  return {
    kind: 'date',
    date: shiftDate(asOf, central),
    early: shiftDate(asOf, fast ?? central),
    late: slow != null ? shiftDate(asOf, slow) : null,
  }
}

// O ritmo com mais (ou menos) kcal por dia: só mexe na parte das contas.
export function simulate(basis: Basis, deltaKcalDay: number): { rate: number; waistRate: number | null } {
  const rate = basis.rateKgDay + deltaKcalDay / KCAL_PER_KG
  let waistRate = basis.waistCmDay
  // A cintura acompanha o peso: o mesmo fator (só com os dois a descer).
  if (waistRate != null && deltaKcalDay !== 0) {
    waistRate = basis.rateKgDay < -STABLE_KG_DAY && waistRate < 0 ? (waistRate * rate) / basis.rateKgDay : waistRate
  }
  return { rate, waistRate }
}

export function project(input: ProjInput, deltaKcalDay = 0): Projection {
  const basis = projectionBasis(input)
  if (!('tdee' in basis)) return { status: 'insuficiente', ...basis }
  if (input.targetKg == null || !(input.targetKg > 0)) return { status: 'sem_alvo', basis }
  const sim = simulate(basis, deltaKcalDay)
  const weight = etaFor(input.asOf, basis.currentKg, input.targetKg, sim.rate, basis.spreadKgDay)
  let waist: GoalEta | null = null
  if (input.targetWaistCm != null && basis.waistCm != null && basis.waistDate) {
    if (basis.waistCm <= input.targetWaistCm) waist = { kind: 'reached' }
    else if (sim.waistRate == null) waist = null
    else {
      // Da última medição: a cintura de hoje é a medida mais o que desceu desde.
      const since = dayDiff(basis.waistDate, input.asOf)
      const now = basis.waistCm + sim.waistRate * since
      waist = now <= input.targetWaistCm ? { kind: 'reached' } : etaFor(input.asOf, now, input.targetWaistCm, sim.waistRate, Math.abs(sim.waistRate) * 0.25)
    }
  }
  return { status: 'ok', basis, weight, waist }
}

// --- «E se…» ------------------------------------------------------------

export type Scenario = 'menos100' | 'menos200' | 'menos300' | 'treino' | 'fds'

export const SCENARIO_LABEL: Record<Scenario, string> = {
  menos100: '−100 kcal/dia',
  menos200: '−200 kcal/dia',
  menos300: '−300 kcal/dia',
  treino: '+1 treino/semana',
  fds: 'Fins de semana como a semana',
}

// kcal por dia de cada cenário; null quando não se aplica (sem treinos com
// kcal, ou o fim de semana já não é maior do que a semana).
export function scenarioDelta(basis: Basis, s: Scenario): number | null {
  if (s === 'menos100') return -100
  if (s === 'menos200') return -200
  if (s === 'menos300') return -300
  if (s === 'treino') return basis.workoutKcal != null ? -Math.round(basis.workoutKcal / 7) : null
  if (basis.weekday == null || basis.weekend == null || basis.weekend - basis.weekday < 50) return null
  return -Math.round(((basis.weekend - basis.weekday) * 2) / 7)
}

// Os cenários escolhidos somam-se (só um dos três de kcal de cada vez).
export function scenariosDelta(basis: Basis, chosen: Scenario[]): number {
  return chosen.reduce((acc, s) => acc + (scenarioDelta(basis, s) ?? 0), 0)
}

// --- Nota da semana -----------------------------------------------------

export interface MoveNote {
  days: number // + atrasou, − adiantou
  text: string
}

// Compara a data de hoje com a de há 7 dias (com os dados de então) e diz a
// causa maior, em kcal por dia de efeito no ritmo.
export function moveNote(now: Projection, before: Projection): MoveNote | null {
  if (now.status !== 'ok' || before.status !== 'ok') return null
  if (now.weight.kind !== 'date' || before.weight.kind !== 'date') return null
  const days = dayDiff(before.weight.date, now.weight.date)
  if (Math.abs(days) < MOVE_NOTE_DAYS) return null
  const a = before.basis
  const b = now.basis
  // Efeito no balanço (kcal/dia, + = engorda mais / perde menos).
  const drivers: { effect: number; text: (sign: number) => string }[] = []
  if (a.weekend != null && b.weekend != null) {
    const d = b.weekend - a.weekend
    drivers.push({ effect: (d * 2) / 7, text: () => `${d > 0 ? 'mais' : 'menos'} ${Math.abs(Math.round(d / 10) * 10)} kcal/dia ao fim de semana` })
  }
  if (a.weekday != null && b.weekday != null) {
    const d = b.weekday - a.weekday
    drivers.push({ effect: (d * 5) / 7, text: () => `${d > 0 ? 'mais' : 'menos'} ${Math.abs(Math.round(d / 10) * 10)} kcal/dia durante a semana` })
  }
  {
    const d = b.tdee - a.tdee
    drivers.push({ effect: -d, text: () => `o gasto medido ${d > 0 ? 'subiu' : 'desceu'} ${Math.abs(Math.round(d / 10) * 10)} kcal/dia` })
  }
  {
    const d = b.workoutKcalDay - a.workoutKcalDay
    drivers.push({ effect: -d, text: () => (d > 0 ? 'mais treino' : 'menos treino') + ` (${Math.abs(Math.round(d * 7 / 10) * 10)} kcal por semana)` })
  }
  {
    const d = (b.observedKgDay - a.observedKgDay) * KCAL_PER_KG / 2
    drivers.push({ effect: d, text: () => (d > 0 ? 'o peso médio desceu menos do que as contas diziam' : 'o peso médio desceu mais do que as contas diziam') })
  }
  // A causa que puxa no mesmo sentido da mudança (atrasou = efeito +).
  const losing = b.rateKgDay < 0 || a.rateKgDay < 0
  const wanted = (days > 0 ? 1 : -1) * (losing ? 1 : -1)
  const best = drivers
    .filter((d) => Math.sign(d.effect) === wanted && Math.abs(d.effect) >= 20)
    .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect))[0]
  const head = `${days > 0 ? 'atrasou' : 'adiantou'} ${Math.abs(days)} dias`
  return { days, text: best ? `${head}: ${best.text(wanted)}` : head }
}

// --- Texto --------------------------------------------------------------

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function fmtDayMon(date: string, asOf?: string): string {
  const y = date.slice(0, 4)
  const base = `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`
  return asOf && y !== asOf.slice(0, 4) ? `${base} ${y}` : base
}

export function fmtMon(date: string, asOf?: string): string {
  const y = date.slice(0, 4)
  const base = MONTHS[Number(date.slice(5, 7)) - 1]!
  return asOf && y !== asOf.slice(0, 4) ? `${base} ${y}` : base
}

const kg1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '')

// «A este ritmo: 78 kg a 14 dez · cintura 88 cm em fev»
export function projectionLine(p: Projection, targetKg: number | null, targetWaistCm: number | null, asOf: string): string | null {
  if (p.status !== 'ok' || targetKg == null) return null
  const parts: string[] = []
  const w = p.weight
  if (w.kind === 'reached') parts.push(`${kg1(targetKg)} kg atingido`)
  else if (w.kind === 'never') parts.push(`${kg1(targetKg)} kg: a este ritmo não chega`)
  else parts.push(`${kg1(targetKg)} kg a ${fmtDayMon(w.date, asOf)}`)
  if (p.waist && targetWaistCm != null) {
    const cm = Math.round(targetWaistCm)
    if (p.waist.kind === 'reached') parts.push(`cintura ${cm} cm atingida`)
    else if (p.waist.kind === 'date') parts.push(`cintura ${cm} cm em ${fmtMon(p.waist.date, asOf)}`)
  }
  return `A este ritmo: ${parts.join(' · ')}`
}

export function rangeText(eta: GoalEta, asOf: string): string | null {
  if (eta.kind !== 'date') return null
  if (eta.late == null) return `a partir de ${fmtDayMon(eta.early, asOf)} (no ritmo mais lento, não chega)`
  if (eta.early === eta.late) return null
  return `entre ${fmtDayMon(eta.early, asOf)} e ${fmtDayMon(eta.late, asOf)}`
}
