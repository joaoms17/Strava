// Fase 3 — treino: de onde vêm os watts, que regra dá as kcal, quando um
// print é da mesma sessão que já está registada e como se juntam os dois.
import { NET_METS, isOtherSport, workoutKcal, type OtherSport, type WorkoutType } from './targets.js'
import { strengthExplanation, strengthKcal, type StrengthRule } from './kcal-ginasio.js'

export type WattsSource = 'device' | 'console' | 'manual' | 'favorite' | 'prefill'
// 'strength_flat' (150 fixas com 30 min ou mais) já não se grava: fica nas
// sessões antigas, que não se reescrevem (decisão 64).
export type KcalRule = 'watts' | 'watts_prefill' | 'strength_flat' | 'device' | 'device_x0.7' | 'met' | StrengthRule

// Regra 2 revista: os watts vêm, por ordem, do dispositivo, da foto da
// consola, do valor à mão, do favorito e, por fim, dos últimos watts
// confirmados (suposto, «≈ com 140 W da última sessão»). Com as calorias do
// relógio e sem potência medida não se supõem watts: contam as calorias
// (decisão 159; antes o servidor ia sempre buscar os últimos — T2).
export function pickWatts(chain: {
  device?: number | null
  console?: number | null
  manual?: number | null
  favorite?: number | null
  lastConfirmed?: number | null
  deviceCalories?: number | null
}): { watts: number | null; source: WattsSource | null } {
  const order: [WattsSource, number | null | undefined][] = [
    ['device', chain.device],
    ['console', chain.console],
    ['manual', chain.manual],
    ['favorite', chain.favorite],
  ]
  if (!(chain.deviceCalories != null && chain.deviceCalories > 0)) order.push(['prefill', chain.lastConfirmed])
  for (const [source, watts] of order) {
    if (watts != null && watts > 0) return { watts: Math.round(watts), source }
  }
  return { watts: null, source: null }
}

// Os watts que chegam no pedido (com a origem que o telemóvel diz, ou «à mão»
// / «do favorito» se não diz) na posição certa da cadeia.
export function wattsChain(input: {
  watts?: number | null
  wattsSource?: WattsSource | null
  favoriteWatts?: number | null
  deviceCalories?: number | null
}): Parameters<typeof pickWatts>[0] {
  const chain: Parameters<typeof pickWatts>[0] = {
    favorite: input.favoriteWatts ?? null,
    deviceCalories: input.deviceCalories ?? null,
  }
  if (input.watts != null) {
    const source =
      input.wattsSource ?? (input.favoriteWatts != null && input.watts === input.favoriteWatts ? 'favorite' : 'manual')
    const slot = source === 'prefill' ? 'lastConfirmed' : source
    chain[slot] = input.watts
  }
  return chain
}

export interface KcalInput {
  type: WorkoutType
  minutes: number | null
  watts: number | null
  wattsSource: WattsSource | null
  deviceCalories: number | null
  sport?: OtherSport | null
  weightKg?: number | null
  // Ginásio sem calorias do relógio: as kcal por minuto da pessoa (`gymPace`).
  gymPace?: number | null
}

// As kcal que o treino soma ao plano, a regra usada e se é uma estimativa.
// Na bicicleta contam os watts; sem a potência média, as calorias do relógio
// por inteiro (a bicicleta de casa manda os watts ao relógio, que já os usa
// na conta). No ginásio, as calorias do relógio por inteiro e, sem elas, os
// minutos ao ritmo da pessoa ou pelo peso (`rules/kcal-ginasio.ts`).
export function exerciseKcal(w: KcalInput): { kcal: number; rule: KcalRule; estimated: boolean } {
  switch (w.type) {
    case 'bike': {
      if (w.watts == null && w.deviceCalories != null && w.deviceCalories > 0) {
        return { kcal: Math.round(w.deviceCalories), rule: 'device', estimated: false }
      }
      const kcal = workoutKcal({ type: 'bike', minutes: w.minutes, watts: w.watts, deviceCalories: null })
      const prefill = w.wattsSource === 'prefill'
      return { kcal, rule: prefill ? 'watts_prefill' : 'watts', estimated: prefill }
    }
    case 'strength':
      return strengthKcal({
        minutes: w.minutes,
        deviceCalories: w.deviceCalories,
        pace: w.gymPace ?? null,
        weightKg: w.weightKg ?? null,
      })
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
    if (w.watts == null && (w.rule === 'device' || w.rule === 'device_x0.7') && w.deviceCalories != null) {
      // Sem potência, as calorias do relógio contam (numa volta de estrada não
      // há watts; no rolo, a app da bicicleta pode mandá-los ao relógio) — T15.
      return `As ${w.deviceCalories} kcal do relógio: sem potência, são elas que contam.`
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
  if (w.type === 'strength') return strengthExplanation(w)
  if (w.rule === 'device_x0.7' && w.deviceCalories != null) {
    return `70 % das ${w.deviceCalories} kcal do relógio.`
  }
  return 'Estimado pelo tempo e pelo teu peso.'
}

// ---------------------------------------------------------------------
// Mesma sessão? Mesmo tipo e dia nutricional (nos «outros», o mesmo
// desporto: o pilates dito não é a caminhada do relógio — T4) e, quando os
// dois têm hora de início, a menos de 30 min; a duração dentro de
// max(3 min, 10 %), ou qualquer uma se os dois intervalos se sobrepõem (o
// ginásio do cronómetro da app com 62 min e o do relógio com 55 — T1).
// ---------------------------------------------------------------------
export interface SessionLike {
  id: string
  type: WorkoutType
  date: string
  minutes: number | null
  started_at: string | null
  // Só nos «outros»: o desporto (na sessão guardada pode estar em raw.sport).
  sport?: string | null
  raw?: unknown
}

export const MERGE_START_WINDOW_MIN = 30

export function durationsMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true
  const tolerance = Math.max(3, 0.1 * Math.max(a, b))
  return Math.abs(a - b) <= tolerance
}

// O desporto de um «outro» (coluna, raw.sport ou «outro»).
export function sportOf(w: { sport?: string | null; raw?: unknown }): string {
  const raw = w.raw && typeof w.raw === 'object' ? (w.raw as { sport?: unknown }).sport : null
  return w.sport ?? (typeof raw === 'string' ? raw : null) ?? 'outro'
}

// Os dois treinos estiveram a decorrer ao mesmo tempo (horas conhecidas).
export function timesOverlap(
  a: { started_at: string | null; minutes: number | null },
  b: { started_at: string | null; minutes: number | null },
): boolean {
  const x = a.started_at ? Date.parse(a.started_at) : NaN
  const y = b.started_at ? Date.parse(b.started_at) : NaN
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  const xEnd = x + Math.max(1, a.minutes ?? 0) * 60_000
  const yEnd = y + Math.max(1, b.minutes ?? 0) * 60_000
  return x < yEnd && y < xEnd
}

export function findMergeCandidate<T extends SessionLike>(
  draft: Omit<SessionLike, 'id'>,
  sessions: T[],
): T | null {
  const startMs = draft.started_at ? Date.parse(draft.started_at) : NaN
  let best: { session: T; score: number } | null = null
  for (const session of sessions) {
    if (session.type !== draft.type || session.date !== draft.date) continue
    if (draft.type === 'other' && draft.sport !== undefined && sportOf(session) !== sportOf(draft)) continue
    const overlap = timesOverlap(session, draft)
    if (!overlap && !durationsMatch(session.minutes, draft.minutes)) continue
    const otherMs = session.started_at ? Date.parse(session.started_at) : NaN
    let score = Math.abs((session.minutes ?? 0) - (draft.minutes ?? 0))
    if (Number.isFinite(startMs) && Number.isFinite(otherMs)) {
      const gapMin = Math.abs(startMs - otherMs) / 60_000
      if (gapMin > MERGE_START_WINDOW_MIN && !overlap) continue
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

// A hora de início foi suposta (sem hora: «agora − duração», ou as 18:00 de
// um dia passado): fica em raw.hora_estimada e não serve para comparar com o
// relógio (o «Já fiz» das 21:00 pode ser a bicicleta das 07:00).
export function startGuessed(w: object): boolean {
  const raw = (w as { raw?: unknown }).raw
  return !!raw && typeof raw === 'object' && (raw as { hora_estimada?: unknown }).hora_estimada === true
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
  'rpe',
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
  // Watts confirmados (do dispositivo, da consola, à mão ou do teu treino) só
  // substituem os supostos (ou nenhuns): o relógio sem potência ganha os
  // watts do «Já fiz».
  const incomingWatts = incoming.watts ?? null
  if (
    incomingWatts != null &&
    (existing.watts == null || existing.watts_source === 'prefill') &&
    incoming.watts_source != null &&
    incoming.watts_source !== 'prefill'
  ) {
    patch.watts = incomingWatts
    patch.watts_source = incoming.watts_source
  }
  return { patch, filled: Object.keys(patch) }
}

// As contas depois de juntar dados a uma sessão (print, relógio ou o outro
// treino com «Juntar os dois»): só mudam quando entra o que muda a regra.
// - Bicicleta: watts confirmados novos contam pela potência; sem eles, as
//   calorias do relógio novas contam numa bicicleta sem watts ou com os watts
//   supostos («≈ da última sessão», que saem — T2).
// - Outro desporto: as calorias do relógio novas (70 %), em vez da estimativa
//   pelo peso (T9).
// - Ginásio: as calorias do relógio novas contam por inteiro.
// Devolve o que juntar ao patch, ou null se as contas ficam.
export function kcalAfterMerge(
  target: {
    type: WorkoutType
    minutes: number | null
    watts: number | null
    watts_source: string | null
    kcal_device: number | null
    sport?: string | null
    raw?: unknown
  },
  patch: Record<string, unknown>,
  fallbackMinutes: number | null = null,
): Record<string, unknown> | null {
  const minutes = target.minutes ?? fallbackMinutes
  const newDevice = patch.kcal_device != null ? Number(patch.kcal_device) : null
  const deviceCalories = newDevice ?? (target.kcal_device != null ? Number(target.kcal_device) : null)
  const result = (k: { kcal: number; rule: KcalRule; estimated: boolean }, extra: Record<string, unknown> = {}) => ({
    ...extra,
    kcal_est: k.kcal,
    kcal_rule: k.rule,
    kcal_estimated: k.estimated,
  })
  if (target.type === 'bike') {
    if (patch.watts != null) {
      return result(
        exerciseKcal({
          type: 'bike',
          minutes,
          watts: Number(patch.watts),
          wattsSource: (patch.watts_source as WattsSource | null) ?? null,
          deviceCalories: null,
        }),
      )
    }
    const supposed = target.watts == null || target.watts_source === 'prefill'
    if (newDevice != null && newDevice > 0 && supposed) {
      return result(
        exerciseKcal({ type: 'bike', minutes, watts: null, wattsSource: null, deviceCalories: newDevice }),
        target.watts != null ? { watts: null, watts_source: null } : {},
      )
    }
    return null
  }
  if (target.type === 'other') {
    if (newDevice == null) return null
    const sport = sportOf(target)
    return result(
      exerciseKcal({
        type: 'other',
        minutes,
        watts: null,
        wattsSource: null,
        deviceCalories,
        sport: isOtherSport(sport) ? sport : null,
      }),
    )
  }
  if (newDevice == null || !(newDevice > 0)) return null
  return result(exerciseKcal({ type: 'strength', minutes, watts: null, wattsSource: null, deviceCalories: newDevice }))
}

// ---------------------------------------------------------------------
// «Juntar os dois» (T1): o mesmo treino registado à mão (ou por print) e
// vindo do relógio. Fica o do relógio, com o que só o outro tem (as séries do
// ginásio, o teu treino, a nota, os watts confirmados, os batimentos que
// faltem); o outro é apagado (com marca) e as kcal e o dia refazem-se.
// ---------------------------------------------------------------------
export interface JoinableWorkout {
  id: string
  type: WorkoutType
  source?: string | null
  external_id?: string | null
  deleted_at?: string | null
}

export function fromWatch(w: { source?: string | null; external_id?: string | null }): boolean {
  return w.external_id != null || w.source === 'intervals'
}

// Qual fica: o do relógio (se só um é); senão o primeiro que foi pedido.
export function pickJoinTarget<T extends JoinableWorkout>(
  first: T,
  second: T,
): { keep: T; drop: T } | { error: string } {
  if (first.id === second.id) return { error: 'É o mesmo treino.' }
  if (first.deleted_at || second.deleted_at) return { error: 'Um dos treinos foi apagado.' }
  if (first.type !== second.type) return { error: 'São treinos de tipos diferentes: não se juntam.' }
  if (fromWatch(first) && fromWatch(second)) return { error: 'Os dois vieram do relógio: não se juntam.' }
  return fromWatch(second) ? { keep: second, drop: first } : { keep: first, drop: second }
}

// O que passa do que sai para o que fica (sem as kcal nem o dia, que se
// refazem depois com os valores juntos).
export function joinPatch(
  keep: Record<string, unknown> & { watts: number | null; watts_source: string | null },
  drop: Record<string, unknown>,
): { patch: Record<string, unknown>; filled: string[] } {
  const { minutes: _m, started_at: _s, ...incoming } = Object.fromEntries(
    MERGE_FILL_FIELDS.map((f) => [f, drop[f]]),
  ) as Record<string, unknown>
  const { patch, filled } = mergePatch(keep, {
    ...incoming,
    // Watts confirmados do que sai só substituem nenhuns ou supostos.
    watts: (drop.watts as number | null) ?? null,
    watts_source: (drop.watts_source as WattsSource | null) ?? null,
  })
  // Os minutos e a hora: os do relógio (os do que fica), a não ser que a
  // hora do que fica seja suposta e a do outro não.
  if ((keep.minutes == null || keep.minutes === 0) && drop.minutes != null) {
    patch.minutes = drop.minutes
    filled.push('minutes')
  }
  if (startGuessed(keep) && !startGuessed(drop) && drop.started_at) {
    patch.started_at = drop.started_at
    const { hora_estimada: _h, ...raw } = (keep.raw && typeof keep.raw === 'object' ? keep.raw : {}) as Record<string, unknown>
    patch.raw = Object.keys(raw).length ? raw : null
    filled.push('started_at')
  }
  if (drop.favorite_id && !keep.favorite_id) {
    patch.favorite_id = drop.favorite_id
    if (drop.name) patch.name = drop.name
    filled.push('favorite_id')
  } else if (drop.source === 'manual' && drop.name && !keep.favorite_id && keep.source !== 'manual') {
    // O nome dado ao dizer o treino («Pernas»), em vez do do relógio.
    patch.name = drop.name
    filled.push('name')
  }
  const note = typeof drop.note === 'string' ? drop.note.trim() : ''
  if (note) {
    const current = typeof keep.note === 'string' ? keep.note.trim() : ''
    if (!current) patch.note = note
    else if (!current.includes(note)) patch.note = `${current}\n${note}`.slice(0, 500)
    if (patch.note !== undefined) filled.push('note')
  }
  for (const field of ['source_paths', 'image_hashes'] as const) {
    const extra = Array.isArray(drop[field]) ? (drop[field] as string[]) : []
    if (extra.length) {
      const current = Array.isArray(keep[field]) ? (keep[field] as string[]) : []
      patch[field] = [...current, ...extra.filter((x) => !current.includes(x))]
    }
  }
  return { patch, filled: [...new Set(filled)] }
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

