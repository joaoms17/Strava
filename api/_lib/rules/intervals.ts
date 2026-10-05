// Fase 7 — intervals.icu (relógio Garmin): de uma atividade ou de um registo
// de bem-estar para as linhas da app. Defensivo: os campos em falta ficam a
// null e uma atividade vinda do Strava (vazia por causa dos termos do
// Strava) não entra.
import { countedMinutes, durationsMatch, type WattsSource } from './treino.js'
import type { OtherSport, WorkoutType } from './targets.js'

export interface IcuActivity {
  id: string | number
  name?: string | null
  type?: string | null
  start_date?: string | null // UTC
  start_date_local?: string | null // hora local, sem fuso
  moving_time?: number | null
  elapsed_time?: number | null
  distance?: number | null // metros
  average_heartrate?: number | null
  max_heartrate?: number | null
  icu_average_watts?: number | null
  average_watts?: number | null
  icu_weighted_avg_watts?: number | null
  max_watts?: number | null
  average_cadence?: number | null
  max_cadence?: number | null
  calories?: number | null
  icu_training_load?: number | null
  trainer?: boolean | null
  source?: string | null
}

export interface IcuWellness {
  id: string // AAAA-MM-DD (o dia em que acordou)
  weight?: number | null
  bodyFat?: number | null // %
  restingHR?: number | null
  sleepSecs?: number | null
  sleepScore?: number | null // 0–100 (Garmin)
  sleepQuality?: number | null // 1 ótima … 4 fraca
  hrv?: number | null // rMSSD da noite, ms
  avgSleepingHR?: number | null
  steps?: number | null
}

// Ride, VirtualRide ou trainer=true → bicicleta; WeightTraining → ginásio;
// o resto → outro.
export function mapIcuType(type: string | null | undefined, trainer: boolean | null | undefined): {
  type: WorkoutType
  sport: OtherSport | null
} {
  const t = (type ?? '').toLowerCase()
  if (t === 'weighttraining' || t === 'workout' || t.includes('strength')) return { type: 'strength', sport: null }
  if (t.includes('ride') || t === 'cycling' || (trainer && !t.includes('run') && !t.includes('walk'))) {
    return { type: 'bike', sport: null }
  }
  if (t.includes('walk') || t.includes('hike')) return { type: 'other', sport: 'caminhada' }
  if (t.includes('run')) return { type: 'other', sport: 'corrida' }
  if (t.includes('elliptical')) return { type: 'other', sport: 'eliptica' }
  if (t.includes('swim')) return { type: 'other', sport: 'natacao' }
  if (t.includes('row')) return { type: 'other', sport: 'remo' }
  if (t.includes('soccer') || t.includes('football')) return { type: 'other', sport: 'futebol' }
  if (t.includes('padel')) return { type: 'other', sport: 'padel' }
  if (t.includes('tennis') || t.includes('squash') || t.includes('badminton')) return { type: 'other', sport: 'tenis' }
  if (t.includes('yoga')) return { type: 'other', sport: 'yoga' }
  if (t.includes('pilates')) return { type: 'other', sport: 'pilates' }
  if (t.includes('hiit') || t.includes('crossfit') || t.includes('highintensity')) return { type: 'other', sport: 'aula' }
  return { type: 'other', sport: 'outro' }
}

// As atividades importadas do Strava chegam vazias (sem tempo nem dados).
export function isEmptyStravaCopy(a: IcuActivity): boolean {
  return (a.source ?? '').toUpperCase() === 'STRAVA' && !a.moving_time && !a.elapsed_time
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown): number | null => {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

export interface MappedActivity {
  external_id: string
  type: WorkoutType
  sport: OtherSport | null
  sport_raw: string | null
  name: string | null
  started_at: string | null // instante UTC
  started_local: string | null // AAAA-MM-DDTHH:MM (Lisboa)
  minutes: number | null
  moving_s: number | null
  elapsed_s: number | null
  distance_km: number | null
  avg_hr: number | null
  max_hr: number | null
  watts: number | null
  watts_source: WattsSource | null
  np_w: number | null
  max_w: number | null
  cadence: number | null
  max_cadence: number | null
  kcal_device: number | null
  training_load: number | null
}

export function mapActivity(a: IcuActivity): MappedActivity {
  const { type, sport } = mapIcuType(a.type, a.trainer)
  const moving = int(a.moving_time)
  const elapsed = int(a.elapsed_time)
  const watts = int(a.icu_average_watts ?? a.average_watts)
  const hr = int(a.average_heartrate)
  const maxHr = int(a.max_heartrate)
  const distance = num(a.distance)
  return {
    external_id: String(a.id),
    type,
    sport,
    sport_raw: a.type ?? null,
    name: a.name ?? null,
    started_at: a.start_date ? new Date(a.start_date).toISOString() : null,
    started_local: a.start_date_local ? a.start_date_local.slice(0, 16) : null,
    minutes: countedMinutes(type, elapsed, moving),
    moving_s: moving,
    elapsed_s: elapsed,
    distance_km: distance == null || distance <= 0 ? null : Math.round(distance / 10) / 100,
    avg_hr: hr != null && hr >= 35 && hr <= 220 ? hr : null,
    max_hr: maxHr != null && maxHr >= 35 && maxHr <= 230 ? maxHr : null,
    watts: type === 'bike' && watts != null && watts >= 20 && watts <= 700 ? watts : null,
    watts_source: type === 'bike' && watts != null && watts >= 20 && watts <= 700 ? 'device' : null,
    np_w: int(a.icu_weighted_avg_watts),
    max_w: int(a.max_watts),
    cadence: int(a.average_cadence),
    max_cadence: int(a.max_cadence),
    kcal_device: int(a.calories),
    training_load: num(a.icu_training_load),
  }
}

// Fusão silenciosa com uma sessão já registada (Bicicleta habitual, foto da
// consola, «Já fiz»): mesmo tipo e dia, início a ±15 min quando os dois têm
// hora e duração a ±5 % (no mínimo ±2 min).
export const SYNC_START_WINDOW_MIN = 15

export function syncMatch<T extends { type: WorkoutType; date: string; minutes: number | null; started_at: string | null }>(
  activity: { type: WorkoutType; date: string; minutes: number | null; started_at: string | null },
  sessions: T[],
): T | null {
  for (const s of sessions) {
    if (s.type !== activity.type || s.date !== activity.date) continue
    if (s.minutes != null && activity.minutes != null) {
      const tolerance = Math.max(2, 0.05 * Math.max(s.minutes, activity.minutes))
      if (Math.abs(s.minutes - activity.minutes) > tolerance) continue
    } else if (!durationsMatch(s.minutes, activity.minutes)) continue
    if (s.started_at && activity.started_at) {
      const gap = Math.abs(Date.parse(s.started_at) - Date.parse(activity.started_at)) / 60_000
      if (gap > SYNC_START_WINDOW_MIN) continue
    }
    return s
  }
  return null
}

// Bem-estar: peso (só em dias sem pesagem do João), sono (horas, pontuação,
// qualidade, HRV e FC durante o sono), FC em repouso e passos.
export function mapWellness(w: IcuWellness): {
  date: string
  weightKg: number | null
  bodyFatPct: number | null
  restingHr: number | null
  sleepMinutes: number | null
  sleepScore: number | null
  sleepQuality: number | null
  hrv: number | null
  avgSleepHr: number | null
  steps: number | null
} {
  const weight = num(w.weight)
  const fat = num(w.bodyFat)
  const rhr = int(w.restingHR)
  const sleep = num(w.sleepSecs)
  const score = int(w.sleepScore)
  const quality = int(w.sleepQuality)
  const hrv = num(w.hrv)
  const sleepHr = int(w.avgSleepingHR)
  const steps = int(w.steps)
  return {
    date: w.id,
    weightKg: weight != null && weight >= 30 && weight <= 300 ? Math.round(weight * 10) / 10 : null,
    bodyFatPct: fat != null && fat >= 3 && fat <= 60 ? Math.round(fat * 10) / 10 : null,
    restingHr: rhr != null && rhr >= 20 && rhr <= 150 ? rhr : null,
    sleepMinutes: sleep != null && sleep > 0 && sleep <= 86_400 ? Math.round(sleep / 60) : null,
    sleepScore: score != null && score >= 1 && score <= 100 ? score : null,
    sleepQuality: quality != null && quality >= 1 && quality <= 4 ? quality : null,
    hrv: hrv != null && hrv >= 5 && hrv <= 300 ? Math.round(hrv * 10) / 10 : null,
    avgSleepHr: sleepHr != null && sleepHr >= 25 && sleepHr <= 150 ? sleepHr : null,
    steps: steps != null && steps >= 0 && steps <= 200_000 ? steps : null,
  }
}

// Junta o dia do relógio ao que já está gravado. Os passos vão-se somando ao
// longo do dia: fica o maior (a primeira sincronização da madrugada trazia
// 38 passos e ficava para sempre). As horas de sono e a FC em repouso do
// Atalho do iPhone mandam no que ele preencheu; as que vieram do próprio
// intervals.icu são substituídas pelo valor mais recente.
export interface DailyHealth {
  steps: number | null
  sleep_minutes: number | null
  resting_hr: number | null
  source: string
}
export function mergeDailyHealth(
  existing: Partial<DailyHealth> | null,
  incoming: { steps: number | null; sleepMinutes: number | null; restingHr: number | null },
): DailyHealth {
  const source = existing?.source ?? 'intervals'
  const shortcut = source !== 'intervals'
  const keep = (old: number | null | undefined, now: number | null) => (shortcut ? (old ?? now) : (now ?? old ?? null))
  const oldSteps = existing?.steps ?? null
  return {
    steps: oldSteps != null && incoming.steps != null ? Math.max(oldSteps, incoming.steps) : (incoming.steps ?? oldSteps),
    sleep_minutes: keep(existing?.sleep_minutes, incoming.sleepMinutes),
    resting_hr: keep(existing?.resting_hr, incoming.restingHr),
    source,
  }
}

// «Sincronizado há 4 min»
export function syncedAgo(lastSyncAt: string | null | undefined, now: Date): string | null {
  if (!lastSyncAt) return null
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(lastSyncAt)) / 60_000))
  if (minutes < 1) return 'agora mesmo'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.round(hours / 24)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}

export const AUTO_SYNC_AFTER_MIN = 20

// Importar o histórico: blocos de 30 dias, do mais recente para trás, até à
// data escolhida (o servidor aceita no máximo 31 dias por pedido).
export const HISTORY_WINDOW_DAYS = 30
// Em «Tudo»: pára depois de um ano seguido sem nada (antes do relógio).
export const HISTORY_EMPTY_WINDOWS_TO_STOP = 12

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function historyWindows(from: string, today: string): { oldest: string; newest: string }[] {
  const windows: { oldest: string; newest: string }[] = []
  let newest = shiftIso(today, 1)
  while (newest >= from) {
    const oldest = shiftIso(newest, -HISTORY_WINDOW_DAYS)
    windows.push({ oldest: oldest < from ? from : oldest, newest })
    newest = shiftIso(oldest, -1)
  }
  return windows
}

export function windowDays(w: { oldest: string; newest: string }): number {
  return Math.round((Date.parse(`${w.newest}T12:00:00Z`) - Date.parse(`${w.oldest}T12:00:00Z`)) / 86_400_000) + 1
}

// Um bloco que o servidor não aguenta divide-se ao meio (o mais recente primeiro).
export function splitWindow(w: { oldest: string; newest: string }): [{ oldest: string; newest: string }, { oldest: string; newest: string }] {
  const half = Math.floor(windowDays(w) / 2)
  const cut = shiftIso(w.newest, -(half - 1))
  return [
    { oldest: cut, newest: w.newest },
    { oldest: w.oldest, newest: shiftIso(cut, -1) },
  ]
}

// Erro que vale a pena repetir na importação: rede cortada («Load failed» no
// iPhone quando a app vai para segundo plano), servidor ocupado ou lento,
// limite do intervals.icu.
export function retryableImportError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const message = err instanceof Error ? err.message : String(err)
  return /load failed|failed to fetch|networkerror|network|erro 5\d\d|demorou|timeout|\(429\)|\(5\d\d\)|não consegui falar/i.test(message)
}
