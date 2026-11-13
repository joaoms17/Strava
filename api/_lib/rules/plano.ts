// Treino ao longo das semanas: as preferências antigas do plano (ainda lidas
// pelas notificações), a carga e a forma (como o intervals.icu: CTL a 42
// dias, ATL a 7, TSB = CTL − ATL), as semanas passadas, a eficiência na
// bicicleta e o bem-estar do relógio. O plano semanal com IA foi para
// archive/plano-semanal (L5). Sem imports de servidor: o telemóvel usa este
// ficheiro diretamente.
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

// Médias exponenciais da carga diária, de `from` a `to` (inclusive). Não
// arrancam do zero (com um treino igual todas as semanas a linha subia
// sozinha): partem da carga média dos primeiros 42 dias, como se antes de
// `from` se treinasse ao mesmo ritmo.
export function fitnessSeries(workouts: PlanWorkout[], from: string, to: string): FitnessPoint[] {
  const byDay = new Map<string, number>()
  for (const w of workouts) byDay.set(w.date, (byDay.get(w.date) ?? 0) + sessionLoad(w))
  const out: FitnessPoint[] = []
  let first = 0
  let days = 0
  for (let d = from; d <= to && days < 42; d = shiftDate(d, 1), days++) first += byDay.get(d) ?? 0
  let ctl = days ? first / days : 0
  let atl = ctl
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const load = byDay.get(d) ?? 0
    ctl += (load - ctl) / 42
    atl += (load - atl) / 7
    out.push({ date: d, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10 })
  }
  return out
}

// A forma do intervals.icu (calculada com o histórico todo) quando cobre o
// período (90 % dos dias; os que faltam ficam com o valor do dia antes);
// senão a da app. Nunca se misturam as duas na mesma linha. Se o
// intervals.icu deixar de mandar estes campos, fica a da app.
export interface IcuForm {
  date: string
  ctl: number | null
  atl: number | null
}
export function preferIcuForm(
  local: FitnessPoint[],
  icu: IcuForm[],
): { points: FitnessPoint[]; source: 'intervals' | 'app' } {
  const byDate = new Map<string, { ctl: number; atl: number }>()
  for (const r of icu) {
    const ctl = r.ctl != null ? Number(r.ctl) : NaN
    const atl = r.atl != null ? Number(r.atl) : NaN
    if (Number.isFinite(ctl) && Number.isFinite(atl)) byDate.set(r.date, { ctl, atl })
  }
  const covered = local.filter((p) => byDate.has(p.date)).length
  if (!local.length || covered < 0.9 * local.length) return { points: local, source: 'app' }
  const firstKnown = local.find((p) => byDate.has(p.date))!
  let last = byDate.get(firstKnown.date)!
  const points = local.map((p) => {
    last = byDate.get(p.date) ?? last
    return { date: p.date, ctl: last.ctl, atl: last.atl, tsb: Math.round((last.ctl - last.atl) * 10) / 10 }
  })
  return { points, source: 'intervals' }
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

// A FC em repouso só vale nos dias com noite registada: sem o relógio a
// dormir, a Garmin calcula-a durante o dia e sai alta (ex.: 74 em vez de 57).
export function cleanWellness<T extends WellnessRow>(rows: T[]): T[] {
  return rows.map((r) =>
    r.resting_hr != null && r.sleep_minutes == null && r.sleep_score == null && r.sleep_quality == null
      ? { ...r, resting_hr: null }
      : r,
  )
}
