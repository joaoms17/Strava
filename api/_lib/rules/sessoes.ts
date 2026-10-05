// Um treino partido em dois pelo relógio (parou e recomeçou) conta como um
// só: no mesmo dia, do mesmo tipo (e desporto), com menos de 30 min entre o
// fim de um e o início do seguinte. Junta-se só para mostrar e contar; na
// base de dados ficam as partes como vieram. Sem supabase nem node.

export const MERGE_GAP_MIN = 30

export interface SessionLike {
  id?: string
  date: string
  started_at?: string | null
  type: 'bike' | 'strength' | 'other'
  sport?: string | null
  minutes: number | null
  moving_s?: number | null
  elapsed_s?: number | null
  distance_km?: number | null
  watts?: number | null
  np_w?: number | null
  avg_hr?: number | null
  max_hr?: number | null
  training_load?: number | string | null
  kcal_est?: number | null
  kcal_device?: number | null
}

export type Merged<T> = T & { parts: T[] }

const startMs = (w: SessionLike) => (w.started_at ? Date.parse(w.started_at) : NaN)
const endMs = (w: SessionLike) => startMs(w) + (w.elapsed_s ?? (w.minutes ?? 0) * 60) * 1000
const sameKind = (a: SessionLike, b: SessionLike) =>
  a.type === b.type && (a.type !== 'other' || (a.sport ?? null) === (b.sport ?? null))

// Média pesada pelos minutos, só com as partes que têm o valor.
function weighted<T extends SessionLike>(parts: T[], key: 'avg_hr' | 'watts' | 'np_w'): number | null {
  const withValue = parts.filter((p) => p[key] != null && (p.minutes ?? 0) > 0)
  const minutes = withValue.reduce((a, p) => a + (p.minutes ?? 0), 0)
  if (minutes === 0) return null
  return Math.round(withValue.reduce((a, p) => a + Number(p[key]) * (p.minutes ?? 0), 0) / minutes)
}
function sum<T extends SessionLike>(parts: T[], key: 'minutes' | 'moving_s' | 'distance_km' | 'training_load' | 'kcal_est' | 'kcal_device') {
  const values = parts.map((p) => p[key]).filter((v) => v != null).map(Number)
  const f = key === 'distance_km' ? 100 : 10
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * f) / f : null
}

function combine<T extends SessionLike>(parts: T[]): Merged<T> {
  const first = parts[0]!
  if (parts.length === 1) return { ...first, parts }
  const maxHr = parts.map((p) => p.max_hr).filter((v): v is number => v != null)
  const last = parts[parts.length - 1]!
  return {
    ...first,
    minutes: sum(parts, 'minutes'),
    moving_s: sum(parts, 'moving_s'),
    elapsed_s: Number.isFinite(endMs(last)) ? Math.round((endMs(last) - startMs(first)) / 1000) : (first.elapsed_s ?? null),
    distance_km: sum(parts, 'distance_km'),
    training_load: sum(parts, 'training_load'),
    kcal_est: sum(parts, 'kcal_est'),
    kcal_device: sum(parts, 'kcal_device'),
    avg_hr: weighted(parts, 'avg_hr'),
    watts: weighted(parts, 'watts'),
    np_w: weighted(parts, 'np_w'),
    max_hr: maxHr.length ? Math.max(...maxHr) : null,
    parts,
  }
}

// As sessões por ordem de início, com as partes seguidas juntas.
export function mergeSessions<T extends SessionLike>(rows: T[]): Merged<T>[] {
  const sorted = [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.started_at ?? '').localeCompare(b.started_at ?? ''),
  )
  const groups: T[][] = []
  for (const w of sorted) {
    const group = groups[groups.length - 1]
    const prev = group?.[group.length - 1]
    const gap = prev ? (startMs(w) - endMs(prev)) / 60_000 : NaN
    if (prev && group && prev.date === w.date && sameKind(prev, w) && gap <= MERGE_GAP_MIN && gap >= -5) {
      group.push(w)
    } else {
      groups.push([w])
    }
  }
  return groups.map(combine)
}

// Bicicleta do relógio sem km nem potência (rolo sem sensor; a app da
// bicicleta não chegou pelo intervals.icu): fica «a faltar informação» até
// chegarem os prints. As partes curtas (aquecimento) não contam.
export const MIN_PENDING_MINUTES = 15
export function missingInfo(w: SessionLike & { source?: string | null }): string[] {
  if (w.type !== 'bike' || w.source !== 'intervals' || (w.minutes ?? 0) < MIN_PENDING_MINUTES) return []
  const missing: string[] = []
  if (w.distance_km == null) missing.push('os km')
  if (w.watts == null) missing.push('a potência')
  return missing.length === 2 ? missing : []
}
