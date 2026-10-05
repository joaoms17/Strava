// «Dizer o treino»: o que a IA percebeu de um texto ou de um áudio sobre um
// treino, arrumado para gravar (sessão, séries do ginásio) e para guardar
// como um dos teus treinos. Sem supabase nem node.
import { OTHER_SPORTS, isOtherSport, type OtherSport } from './targets.js'

export const SAID_TYPES = ['bike', 'strength', 'other'] as const
export type SaidType = (typeof SAID_TYPES)[number]
export const SAID_SPORTS = OTHER_SPORTS

export interface SaidSet {
  reps: number | null
  load_kg: number | null
}
export interface SaidExercise {
  name: string
  sets: SaidSet[]
}
export interface SaidWorkout {
  transcript: string | null
  type: SaidType
  sport: OtherSport | null
  title: string
  date: string | null
  minutes: number | null
  watts: number | null
  avg_hr: number | null
  kcal_device: number | null
  distance_km: number | null
  exercises: SaidExercise[]
  note: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
function num(v: unknown, min: number, max: number, digits = 0): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < min || n > max) return null
  const f = 10 ** digits
  return Math.round(n * f) / f
}

// A resposta da IA, arrumada: números fora do razoável saem, o desporto só se
// for «outro», no máximo 15 exercícios com 10 séries cada, e a data nunca no
// futuro nem com mais de 7 dias.
export function cleanSaid(raw: unknown, today: string): SaidWorkout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const type = SAID_TYPES.find((t) => t === r.tipo) ?? 'other'
  const sport = type === 'other' && isOtherSport(r.desporto) ? r.desporto : type === 'other' ? 'outro' : null
  const date = typeof r.data === 'string' && DATE.test(r.data) ? r.data : null
  const week = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10)
  const exercises: SaidExercise[] =
    type === 'strength'
      ? (Array.isArray(r.exercicios) ? r.exercicios : [])
          .map((e): SaidExercise => {
            const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
            return {
              name: text(x.nome, 80),
              sets: (Array.isArray(x.series) ? x.series : []).slice(0, 10).map((s) => {
                const y = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
                return { reps: num(y.reps, 0, 60), load_kg: num(y.carga_kg, 0, 300, 1) }
              }),
            }
          })
          .filter((e) => e.name)
          .slice(0, 15)
      : []
  return {
    transcript: text(r.transcricao, 1000) || null,
    type,
    sport,
    title: text(r.titulo, 60),
    date: date && date <= today && date >= week ? date : null,
    minutes: num(r.minutos, 1, 600),
    watts: type === 'bike' ? num(r.watts, 20, 700) : null,
    avg_hr: num(r.fc_media, 35, 220),
    kcal_device: num(r.kcal_relogio, 0, 5000),
    distance_km: num(r.distancia_km, 0, 500, 1),
    exercises,
    note: text(r.nota, 300) || null,
  }
}

// As séries para /api/workout/strength (uma série sem nada conta como 1).
export function strengthSets(exercises: SaidExercise[]) {
  return exercises.flatMap((e) =>
    (e.sets.length ? e.sets : [{ reps: null, load_kg: null }]).map((s, i) => ({
      exercise: e.name,
      set_index: i + 1,
      reps: s.reps,
      load_kg: s.load_kg,
      rpe: null,
    })),
  )
}

// Para guardar como um dos teus treinos: séries, repetições (mín.–máx. do que
// fizeste) e a carga mais alta.
export function favoriteExercises(exercises: SaidExercise[]) {
  return exercises.map((e) => {
    const reps = e.sets.map((s) => s.reps).filter((n): n is number => n != null && n > 0)
    const loads = e.sets.map((s) => s.load_kg).filter((n): n is number => n != null && n > 0)
    return {
      name: e.name,
      sets: Math.max(1, e.sets.length),
      rep_min: reps.length ? Math.min(...reps) : 8,
      rep_max: reps.length ? Math.max(...reps) : 12,
      load_kg: loads.length ? Math.max(...loads) : null,
    }
  })
}

// Uma linha curta do que foi percebido: «Ginásio · 4 exercícios · 50 min».
export function saidSummary(w: SaidWorkout, sportLabel: (s: OtherSport) => string): string {
  const head = w.type === 'bike' ? 'Bicicleta' : w.type === 'strength' ? 'Ginásio' : sportLabel(w.sport ?? 'outro')
  return [
    head,
    w.type === 'strength' && w.exercises.length
      ? `${w.exercises.length} ${w.exercises.length === 1 ? 'exercício' : 'exercícios'}`
      : null,
    w.minutes != null ? `${w.minutes} min` : null,
    w.watts != null ? `${w.watts} W` : null,
    w.distance_km != null ? `${String(w.distance_km).replace('.', ',')} km` : null,
    w.avg_hr != null ? `FC ${w.avg_hr}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
