// Fase 3 — treino: de onde vêm os watts, que regra dá as kcal, quando um
// print é da mesma sessão que já está registada e como se juntam os dois.
import { NET_METS, isOtherSport, workoutKcal, type OtherSport, type WorkoutType } from './targets.js'

export type WattsSource = 'device' | 'console' | 'manual' | 'favorite' | 'prefill'
export type KcalRule = 'watts' | 'watts_prefill' | 'strength_flat' | 'device_x0.7' | 'met'

// Regra 2 revista: os watts vêm, por ordem, do dispositivo, da foto da
// consola, do valor à mão, do favorito e, por fim, dos últimos watts
// confirmados (suposto, «≈ com 140 W da última sessão»).
export function pickWatts(chain: {
  device?: number | null
  console?: number | null
  manual?: number | null
  favorite?: number | null
  lastConfirmed?: number | null
}): { watts: number | null; source: WattsSource | null } {
  const order: [WattsSource, number | null | undefined][] = [
    ['device', chain.device],
    ['console', chain.console],
    ['manual', chain.manual],
    ['favorite', chain.favorite],
    ['prefill', chain.lastConfirmed],
  ]
  for (const [source, watts] of order) {
    if (watts != null && watts > 0) return { watts: Math.round(watts), source }
  }
  return { watts: null, source: null }
}

export interface KcalInput {
  type: WorkoutType
  minutes: number | null
  watts: number | null
  wattsSource: WattsSource | null
  deviceCalories: number | null
  sport?: OtherSport | null
  weightKg?: number | null
}

// As kcal que o treino soma ao plano, a regra usada e se é uma estimativa.
// Na bicicleta contam os watts; sem potência, 70 % das calorias do relógio
// (estimativa). No ginásio, as calorias do relógio nunca contam.
export function exerciseKcal(w: KcalInput): { kcal: number; rule: KcalRule; estimated: boolean } {
  switch (w.type) {
    case 'bike': {
      if (w.watts == null && w.deviceCalories != null && w.deviceCalories > 0) {
        return { kcal: Math.round(w.deviceCalories * 0.7), rule: 'device_x0.7', estimated: true }
      }
      const kcal = workoutKcal({ type: 'bike', minutes: w.minutes, watts: w.watts, deviceCalories: null })
      const prefill = w.wattsSource === 'prefill'
      return { kcal, rule: prefill ? 'watts_prefill' : 'watts', estimated: prefill }
    }
    case 'strength':
      return {
        kcal: workoutKcal({ type: 'strength', minutes: w.minutes, watts: null, deviceCalories: null }),
        rule: 'strength_flat',
        estimated: false,
      }
    case 'other':
      if (w.deviceCalories != null) {
        return { kcal: Math.round(w.deviceCalories * 0.7), rule: 'device_x0.7', estimated: false }
      }
      return {
        kcal:
          w.weightKg == null || w.minutes == null
            ? 0
            : Math.round(NET_METS[isOtherSport(w.sport) ? w.sport : 'outro'] * w.weightKg * (w.minutes / 60)),
        rule: 'met',
        estimated: true,
      }
  }
}

// Explicação curta das kcal, para a folha do treino.
export function kcalExplanation(w: {
  type: WorkoutType
  minutes: number | null
  watts: number | null
  kcal: number
  rule: string | null
  deviceCalories: number | null
}): string {
  if (w.type === 'bike') {
    if (w.watts == null && w.rule === 'device_x0.7' && w.deviceCalories != null) {
      return `Sem potência: 70 % das ${w.deviceCalories} kcal do relógio. Com os watts (foto da consola) a conta é mais certa.`
    }
    if (w.watts == null) return 'Sem potência: junta uma foto da consola ou escreve os watts.'
    const base = `${w.watts} W × ${w.minutes ?? 0} min = ${w.kcal}`
    const device =
      w.deviceCalories != null
        ? `O relógio diz ${w.deviceCalories} kcal. Contamos ${w.kcal} pela potência (${w.watts} W × ${w.minutes ?? 0} min), porque os relógios exageram na bicicleta.`
        : null
    if (w.rule === 'watts_prefill') return `≈ com ${w.watts} W da última sessão: ${base}.`
    return device ?? `Pela potência: ${base}.`
  }
  if (w.type === 'strength') return w.kcal > 0 ? '150 fixas por ginásio de 30 min ou mais.' : 'Menos de 30 min de ginásio não soma.'
  if (w.rule === 'device_x0.7' && w.deviceCalories != null) {
    return `70 % das ${w.deviceCalories} kcal do relógio.`
  }
  return 'Estimado pelo tempo e pelo teu peso.'
}

// ---------------------------------------------------------------------
// Mesma sessão? Mesmo tipo e dia nutricional, duração dentro de
// max(3 min, 10 %) e, quando os dois têm hora de início, a menos de 30 min.
// ---------------------------------------------------------------------
export interface SessionLike {
  id: string
  type: WorkoutType
  date: string
  minutes: number | null
  started_at: string | null
}

export const MERGE_START_WINDOW_MIN = 30

export function durationsMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true
  const tolerance = Math.max(3, 0.1 * Math.max(a, b))
  return Math.abs(a - b) <= tolerance
}

export function findMergeCandidate<T extends SessionLike>(
  draft: Omit<SessionLike, 'id'>,
  sessions: T[],
): T | null {
  const startMs = draft.started_at ? Date.parse(draft.started_at) : NaN
  let best: { session: T; score: number } | null = null
  for (const session of sessions) {
    if (session.type !== draft.type || session.date !== draft.date) continue
    if (!durationsMatch(session.minutes, draft.minutes)) continue
    const otherMs = session.started_at ? Date.parse(session.started_at) : NaN
    let score = Math.abs((session.minutes ?? 0) - (draft.minutes ?? 0))
    if (Number.isFinite(startMs) && Number.isFinite(otherMs)) {
      const gapMin = Math.abs(startMs - otherMs) / 60_000
      if (gapMin > MERGE_START_WINDOW_MIN) continue
      score += gapMin
    }
    if (!best || score < best.score) best = { session, score }
  }
  return best?.session ?? null
}

// Um treino registado à mão ou pelo favorito, no fim, começou «duração» antes.
export function estimatedStart(loggedAt: Date, minutes: number | null): string {
  return new Date(loggedAt.getTime() - (minutes ?? 0) * 60_000).toISOString()
}

// ---------------------------------------------------------------------
// Juntar um print a uma sessão existente: preenche o que falta e nunca
// mexe no treino escolhido, na duração nem nos watts que a pessoa deu.
// ---------------------------------------------------------------------
export const MERGE_FILL_FIELDS = [
  'avg_hr',
  'max_hr',
  'cadence',
  'max_cadence',
  'distance_km',
  'np_w',
  'max_w',
  'moving_s',
  'elapsed_s',
  'kcal_device',
  'training_load',
  'aerobic_te',
  'anaerobic_te',
  'hr_zones',
  'laps',
  'started_at',
  'sport',
  'name',
  'minutes',
] as const

export type MergeField = (typeof MERGE_FILL_FIELDS)[number]

export function mergePatch(
  existing: Record<string, unknown> & { watts: number | null; watts_source: string | null },
  incoming: Record<string, unknown> & { watts?: number | null; watts_source?: WattsSource | null },
): { patch: Record<string, unknown>; filled: string[] } {
  const patch: Record<string, unknown> = {}
  for (const field of MERGE_FILL_FIELDS) {
    const value = incoming[field]
    if (value == null) continue
    if (existing[field] == null) patch[field] = value
  }
  // Watts do dispositivo ou da consola só substituem os supostos (ou nenhuns).
  const incomingWatts = incoming.watts ?? null
  if (
    incomingWatts != null &&
    (existing.watts == null || existing.watts_source === 'prefill') &&
    (incoming.watts_source === 'device' || incoming.watts_source === 'console')
  ) {
    patch.watts = incomingWatts
    patch.watts_source = incoming.watts_source
  }
  return { patch, filled: Object.keys(patch) }
}

// ---------------------------------------------------------------------
// Leitura dos prints: verificações do servidor. Fora do intervalo, o campo
// fica vazio e marcado como pouco seguro (o João confirma).
// ---------------------------------------------------------------------
export const SHOT_RANGES = {
  avg_hr: [35, 220],
  max_hr: [35, 220],
  avg_power_w: [20, 700],
  max_power_w: [20, 2000],
  np_w: [20, 700],
  avg_cadence: [30, 150],
  max_cadence: [30, 200],
  total_time_s: [60, 24_000],
  moving_time_s: [60, 24_000],
  calories_device: [0, 5000],
  distance_km: [0, 300],
} as const

export type ShotNumbers = { -readonly [K in keyof typeof SHOT_RANGES]?: number | null }

export function checkShotNumbers<T extends ShotNumbers>(activity: T): { activity: T; low: string[] } {
  const out = { ...activity }
  const low: string[] = []
  for (const [field, [min, max]] of Object.entries(SHOT_RANGES) as [keyof ShotNumbers, readonly [number, number]][]) {
    const value = out[field]
    if (value == null) continue
    if (!Number.isFinite(value) || value < min || value > max) {
      ;(out as ShotNumbers)[field] = null
      low.push(field)
    }
  }
  if (out.avg_hr != null && out.max_hr != null && out.max_hr < out.avg_hr) {
    ;(out as ShotNumbers).max_hr = null
    low.push('max_hr')
  }
  return { activity: out, low }
}

export type ShotSport =
  | 'indoor_bike'
  | 'outdoor_bike'
  | 'strength'
  | 'walk'
  | 'run'
  | 'elliptical'
  | 'swim'
  | 'other'

export function typeOfSport(sport: ShotSport): { type: WorkoutType; sport: OtherSport | null } {
  switch (sport) {
    case 'indoor_bike':
    case 'outdoor_bike':
      return { type: 'bike', sport: null }
    case 'strength':
      return { type: 'strength', sport: null }
    case 'walk':
      return { type: 'other', sport: 'caminhada' }
    case 'run':
      return { type: 'other', sport: 'corrida' }
    case 'elliptical':
      return { type: 'other', sport: 'eliptica' }
    case 'swim':
      return { type: 'other', sport: 'natacao' }
    default:
      return { type: 'other', sport: 'outro' }
  }
}

// Minutos que contam: na bicicleta o tempo em movimento; no ginásio o tempo
// total; nos outros o tempo em movimento, se houver.
export function countedMinutes(
  type: WorkoutType,
  totalS: number | null | undefined,
  movingS: number | null | undefined,
): number | null {
  const seconds = type === 'strength' ? (totalS ?? movingS) : (movingS ?? totalS)
  return seconds == null ? null : Math.max(1, Math.round(seconds / 60))
}

