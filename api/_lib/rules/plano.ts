// Plano semanal com IA: quantas sessões de bicicleta e de ginásio por semana,
// o número da semana desde que começou (do zero), a carga e a forma (como o
// intervals.icu: CTL a 42 dias, ATL a 7, TSB = CTL − ATL), as semanas
// passadas, a eficiência na bicicleta e o bem-estar do relógio. Sem imports
// de servidor: o telemóvel usa este ficheiro diretamente.
import { mondayOf } from './manutencao.js'
import { shiftDate } from './nutritional-day.js'
import { mergeSessions } from './sessoes.js'

export interface PlanPrefs {
  ativo: boolean
  bicicleta: number
  ginasio: number
  inicio: string // segunda-feira da primeira semana do plano
}

export const MAX_SESSIONS = 6

const DATE = /^\d{4}-\d{2}-\d{2}$/
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  return Math.min(max, Math.max(min, n))
}

// Do perfil (goals.plano), sempre com valores válidos; null se nunca foi ligado.
export function cleanPrefs(raw: unknown): PlanPrefs | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const inicio = typeof r.inicio === 'string' && DATE.test(r.inicio) ? mondayOf(r.inicio) : null
  if (!inicio) return null
  return {
    ativo: r.ativo === true,
    bicicleta: clampInt(r.bicicleta, 0, MAX_SESSIONS, 3),
    ginasio: clampInt(r.ginasio, 0, MAX_SESSIONS, 3),
    inicio,
  }
}

// Semana 1 é a do início; nunca antes de 1.
export function weekNumber(inicio: string, weekStart: string): number {
  const days = (Date.parse(`${mondayOf(weekStart)}T00:00:00Z`) - Date.parse(`${mondayOf(inicio)}T00:00:00Z`)) / 86_400_000
  return Math.max(1, Math.floor(days / 7) + 1)
}

// Uma semana em cada quatro é mais leve (descarga).
export function isDeloadWeek(week: number): boolean {
  return week % 4 === 0
}

export interface PlanWorkout {
  id?: string
  date: string
  started_at?: string | null
  type: 'bike' | 'strength' | 'other'
  sport?: string | null
  minutes: number | null
  moving_s?: number | null
  elapsed_s?: number | null
  distance_km?: number | null
  training_load?: number | null
  watts?: number | null
  np_w?: number | null
  avg_hr?: number | null
  max_hr?: number | null
}

// Carga de uma sessão: a do intervals.icu; sem ela, uma estimativa pelos
// minutos (intensidade moderada).
const LOAD_PER_MIN = { bike: 0.75, strength: 0.5, other: 0.6 } as const
export function sessionLoad(w: PlanWorkout): number {
  if (w.training_load != null && Number.isFinite(Number(w.training_load))) return Number(w.training_load)
  return Math.round((w.minutes ?? 0) * LOAD_PER_MIN[w.type])
}

export interface FitnessPoint {
  date: string
  ctl: number // forma (42 dias)
  atl: number // fadiga (7 dias)
  tsb: number // frescura
}

// Médias exponenciais da carga diária, de `from` a `to` (inclusive).
export function fitnessSeries(workouts: PlanWorkout[], from: string, to: string): FitnessPoint[] {
  const byDay = new Map<string, number>()
  for (const w of workouts) byDay.set(w.date, (byDay.get(w.date) ?? 0) + sessionLoad(w))
  const out: FitnessPoint[] = []
  let ctl = 0
  let atl = 0
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const load = byDay.get(d) ?? 0
    ctl += (load - ctl) / 42
    atl += (load - atl) / 7
    out.push({ date: d, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10 })
  }
  return out
}

export interface WeekStats {
  start: string
  bike: { sessions: number; minutes: number; load: number; avgWatts: number | null; avgHr: number | null }
  gym: { sessions: number; minutes: number }
  other: { sessions: number; minutes: number }
}

const mean = (values: number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null

// As semanas pedidas (segundas-feiras), com o que se fez em cada uma.
export function weeklyStats(all: PlanWorkout[], mondays: string[]): WeekStats[] {
  // Um treino partido em dois pelo relógio conta como uma sessão.
  const workouts = mergeSessions(all)
  return mondays.map((start) => {
    const end = shiftDate(start, 6)
    const week = workouts.filter((w) => w.date >= start && w.date <= end)
    const bikes = week.filter((w) => w.type === 'bike')
    const gyms = week.filter((w) => w.type === 'strength')
    const others = week.filter((w) => w.type === 'other')
    const minutes = (list: PlanWorkout[]) => list.reduce((a, w) => a + (w.minutes ?? 0), 0)
    return {
      start,
      bike: {
        sessions: bikes.length,
        minutes: minutes(bikes),
        load: Math.round(bikes.reduce((a, w) => a + sessionLoad(w), 0)),
        avgWatts: mean(bikes.map((w) => w.watts).filter((v): v is number => v != null)),
        avgHr: mean(bikes.map((w) => w.avg_hr).filter((v): v is number => v != null)),
      },
      gym: { sessions: gyms.length, minutes: minutes(gyms) },
      other: { sessions: others.length, minutes: minutes(others) },
    }
  })
}

// As segundas-feiras das `count` semanas até à de `today` (a mais antiga primeiro).
export function lastMondays(today: string, count: number): string[] {
  const current = mondayOf(today)
  return Array.from({ length: count }, (_, i) => shiftDate(current, -7 * (count - 1 - i)))
}

// Eficiência na bicicleta, só com o que se pode comparar: sessões de 20 min
// ou mais (as partes seguidas juntas), com batimentos e com a mesma medida de
// esforço em todas: watts por batimento quando há potência; sem ela, metros
// por batimento (distância ÷ batimentos), só entre sessões do mesmo tipo
// (rolo/indoor com rolo, estrada com estrada). Sessões só com batimentos não
// se comparam (o ritmo de cada uma é outro).
export interface EfficiencyPoint {
  date: string
  value: number
  minutes: number
  avg_hr: number
  watts: number | null
  speed_kmh: number | null
}
export interface BikeEfficiency {
  metric: 'watts' | 'distance' | null
  points: EfficiencyPoint[]
  left_out: number // sessões de bicicleta que não entram (curtas, sem batimentos ou sem medida)
}
export const MIN_EFFICIENCY_MINUTES = 20

const indoor = (sport: string | null | undefined) => /virtual|indoor|trainer/i.test(sport ?? '')

export function bikeEfficiency(workouts: PlanWorkout[]): BikeEfficiency {
  const bikes = mergeSessions(workouts.filter((w) => w.type === 'bike'))
  const usable = bikes.filter((w) => (w.minutes ?? 0) >= MIN_EFFICIENCY_MINUTES && (w.avg_hr ?? 0) > 0)
  const withWatts = usable.filter((w) => w.watts != null && w.watts > 0)
  // Na distância contam só as partes com km e batimentos (um aquecimento
  // sem km não pode baixar a velocidade do treino), com 20 min ou mais.
  const distanceOf = (w: (typeof usable)[number]) => {
    const parts = w.parts.filter((p) => (p.distance_km ?? 0) > 0 && (p.avg_hr ?? 0) > 0)
    const seconds = parts.reduce((a, p) => a + (p.moving_s ?? (p.minutes ?? 0) * 60), 0)
    return {
      km: parts.reduce((a, p) => a + p.distance_km!, 0),
      seconds,
      beats: parts.reduce((a, p) => a + p.avg_hr! * ((p.moving_s ?? (p.minutes ?? 0) * 60) / 60), 0),
    }
  }
  const withDistance = usable.filter((w) => distanceOf(w).km > 0 && distanceOf(w).seconds >= MIN_EFFICIENCY_MINUTES * 60)
  let metric: BikeEfficiency['metric'] = null
  let chosen: typeof usable = []
  if (withWatts.length >= 2) {
    metric = 'watts'
    chosen = withWatts
  } else if (withDistance.length >= 2) {
    // Rolo e estrada não se comparam: fica o tipo com mais sessões.
    const inside = withDistance.filter((w) => indoor(w.sport))
    const outside = withDistance.filter((w) => !indoor(w.sport))
    chosen = inside.length >= outside.length ? inside : outside
    metric = chosen.length >= 2 ? 'distance' : null
    if (!metric) chosen = []
  }
  const points = chosen.map((w): EfficiencyPoint => {
    const d = distanceOf(w)
    const speed = d.km > 0 && d.seconds > 0 ? Math.round((d.km / (d.seconds / 3600)) * 10) / 10 : null
    const value =
      metric === 'watts'
        ? Math.round((w.watts! / w.avg_hr!) * 100) / 100
        : Math.round(((d.km * 1000) / d.beats) * 100) / 100
    return { date: w.date, value, minutes: w.minutes ?? 0, avg_hr: w.avg_hr!, watts: w.watts ?? null, speed_kmh: speed }
  })
  return { metric, points, left_out: bikes.length - points.length }
}

export interface WellnessRow {
  date: string
  hrv?: number | null
  resting_hr?: number | null
  sleep_score?: number | null
  sleep_quality?: number | null // 1 ótima … 4 fraca
  sleep_minutes?: number | null
  steps?: number | null
}

export interface WellnessTrend {
  hrv7: number | null
  hrv28: number | null
  rhr7: number | null
  rhr28: number | null
  sleepScore7: number | null
  sleepScore28: number | null
  sleepQuality7: number | null // média 1–4 (com uma casa decimal)
  sleepMinutes7: number | null
  steps7: number | null
  steps28: number | null
}

// A FC em repouso só vale nos dias com noite registada: sem o relógio a
// dormir, a Garmin calcula-a durante o dia e sai alta (ex.: 74 em vez de 57).
export function cleanWellness<T extends WellnessRow>(rows: T[]): T[] {
  return rows.map((r) =>
    r.resting_hr != null && r.sleep_minutes == null && r.sleep_score == null && r.sleep_quality == null
      ? { ...r, resting_hr: null }
      : r,
  )
}

// Média dos últimos 7 dias contra a dos últimos 28 (até `today`).
export function wellnessTrend(all: WellnessRow[], today: string): WellnessTrend {
  const rows = cleanWellness(all)
  const since = (days: number) => rows.filter((r) => r.date > shiftDate(today, -days) && r.date <= today)
  const values = (list: WellnessRow[], key: keyof WellnessRow) =>
    list.map((r) => r[key]).filter((v): v is number => typeof v === 'number')
  const pick = (list: WellnessRow[], key: keyof WellnessRow) => mean(values(list, key))
  const w7 = since(7)
  const w28 = since(28)
  // Passos: hoje ainda vai a meio, contam os 7 e 28 dias completos antes.
  const full = (days: number) =>
    rows.filter((r) => r.date > shiftDate(today, -days - 1) && r.date < today)
  const quality = values(w7, 'sleep_quality')
  return {
    hrv7: pick(w7, 'hrv'),
    hrv28: pick(w28, 'hrv'),
    rhr7: pick(w7, 'resting_hr'),
    rhr28: pick(w28, 'resting_hr'),
    sleepScore7: pick(w7, 'sleep_score'),
    sleepScore28: pick(w28, 'sleep_score'),
    sleepQuality7: quality.length ? Math.round((quality.reduce((a, b) => a + b, 0) / quality.length) * 10) / 10 : null,
    sleepMinutes7: pick(w7, 'sleep_minutes'),
    steps7: pick(full(7), 'steps'),
    steps28: pick(full(28), 'steps'),
  }
}

// O plano da semana, como a IA o devolve (e como fica guardado).
export const BIKE_KINDS = ['resistencia', 'tempo', 'limiar', 'intervalos', 'recuperacao', 'forca', 'teste'] as const
export const GYM_FOCUS = ['corpo_inteiro', 'superior', 'inferior', 'empurrar', 'puxar', 'pernas', 'core'] as const

export const BIKE_KIND_LABEL: Record<(typeof BIKE_KINDS)[number], string> = {
  resistencia: 'Resistência',
  tempo: 'Tempo',
  limiar: 'Limiar',
  intervalos: 'Intervalos',
  recuperacao: 'Recuperação',
  forca: 'Força (cadência baixa)',
  teste: 'Teste',
}

export const GYM_FOCUS_LABEL: Record<(typeof GYM_FOCUS)[number], string> = {
  corpo_inteiro: 'Corpo inteiro',
  superior: 'Parte de cima',
  inferior: 'Parte de baixo',
  empurrar: 'Empurrar (peito, ombros, tríceps)',
  puxar: 'Puxar (costas, bíceps)',
  pernas: 'Pernas e glúteos',
  core: 'Core',
}

export interface BikeSession {
  titulo: string
  tipo: (typeof BIKE_KINDS)[number]
  minutos: number
  alvo: string
  estrutura: string
  porque: string
}

export interface GymSession {
  titulo: string
  foco: (typeof GYM_FOCUS)[number]
  minutos: number
  nota: string
}

export interface WeekPlan {
  kind: 'semana'
  semana: number
  fase: string
  resumo: string
  evolucao: string
  bicicleta: BikeSession[]
  ginasio: GymSession[]
}

const text = (v: unknown, max: number, fallback = '') =>
  typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : fallback

// O que vem da IA (ou da base de dados) fica sempre com a forma certa e com
// o número de sessões pedido (no máximo; a IA pode propor menos).
export function cleanPlan(raw: unknown, prefs: Pick<PlanPrefs, 'bicicleta' | 'ginasio'>, week: number): WeekPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []) as Record<string, unknown>[]
  const bicicleta = list(r.bicicleta)
    .slice(0, prefs.bicicleta)
    .map((b) => ({
      titulo: text(b.titulo, 60, 'Bicicleta'),
      tipo: (BIKE_KINDS as readonly string[]).includes(b.tipo as string) ? (b.tipo as BikeSession['tipo']) : 'resistencia',
      minutos: clampInt(b.minutos, 10, 240, 45),
      alvo: text(b.alvo, 120),
      estrutura: text(b.estrutura, 240),
      porque: text(b.porque, 200),
    }))
  const ginasio = list(r.ginasio)
    .slice(0, prefs.ginasio)
    .map((g) => ({
      titulo: text(g.titulo, 60, 'Ginásio'),
      foco: (GYM_FOCUS as readonly string[]).includes(g.foco as string) ? (g.foco as GymSession['foco']) : 'corpo_inteiro',
      minutos: clampInt(g.minutos, 15, 150, 45),
      nota: text(g.nota, 240),
    }))
  return {
    kind: 'semana',
    semana: week,
    fase: text(r.fase, 40, isDeloadWeek(week) ? 'Descarga' : 'Base'),
    resumo: text(r.resumo, 400),
    evolucao: text(r.evolucao, 400),
    bicicleta,
    ginasio,
  }
}

// O que já foi feito da semana: os treinos de cada tipo, por ordem, vão
// riscando as sessões do plano pela ordem em que estão.
export function planProgress<T extends PlanWorkout>(
  plan: Pick<WeekPlan, 'bicicleta' | 'ginasio'>,
  weekWorkouts: T[],
): { bike: (T | null)[]; gym: (T | null)[] } {
  // Por ordem de início, com as partes seguidas de um treino juntas (os
  // minutos passam a ser os do treino todo).
  const sorted = mergeSessions(weekWorkouts)
  const bikes = sorted.filter((w) => w.type === 'bike')
  const gyms = sorted.filter((w) => w.type === 'strength')
  return {
    bike: plan.bicicleta.map((_, i) => bikes[i] ?? null),
    gym: plan.ginasio.map((_, i) => gyms[i] ?? null),
  }
}
