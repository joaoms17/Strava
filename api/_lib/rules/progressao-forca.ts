// Regra 11: dupla progressão por exercício (rep_min a rep_max).
// Todas as séries no topo com RPE <= 8 em 2 sessões consecutivas: +2 kg.
// Deload na semana 4: -40% de volume.

export interface LoggedSet {
  reps: number | null
  load_kg: number | null
  rpe: number | null
}

// lastTwoSessions: séries das duas últimas sessões deste exercício,
// por ordem cronológica.
export function readyForIncrease(lastTwoSessions: LoggedSet[][], repMax: number): boolean {
  if (lastTwoSessions.length < 2) return false
  return lastTwoSessions
    .slice(-2)
    .every(
      (sets) =>
        sets.length > 0 &&
        sets.every((s) => (s.reps ?? 0) >= repMax && s.rpe != null && s.rpe <= 8),
    )
}

export function nextLoad(lastLoadKg: number, ready: boolean): number {
  return ready ? lastLoadKg + 2 : lastLoadKg
}

// Semana 4: -40% de volume (número de séries), nunca abaixo de 1.
export function deloadSets(plannedSets: number): number {
  return Math.max(1, Math.round(plannedSets * 0.6))
}

// ---------------------------------------------------------------------
// Fase 5 — ginásio livre. O esforço (RPE) fica escondido em «mais», por isso
// uma série sem esforço conta como «com folga»; só um esforço acima de 8
// trava a subida. Todas as séries no topo do teu treino (12 por omissão; 8
// num treino de 5–8, 20 num de 15–20) em 2 sessões seguidas: mais carga.
// ---------------------------------------------------------------------
export const FREE_REP_MIN = 8
export const FREE_REP_MAX = 12
export const LOAD_STEP_KG = 2
// Abaixo de 10 kg (halteres leves, elevações laterais) sobe-se 1 kg: 2 kg
// em 4 kg eram +50 %.
export const LIGHT_LOAD_KG = 10
export const LIGHT_STEP_KG = 1

export function loadStep(loadKg: number | null | undefined): number {
  return loadKg != null && loadKg < LIGHT_LOAD_KG ? LIGHT_STEP_KG : LOAD_STEP_KG
}

// A descer: de 10 kg para baixo já vai de 1 em 1.
export function loadStepDown(loadKg: number | null | undefined): number {
  return loadKg != null && loadKg <= LIGHT_LOAD_KG ? LIGHT_STEP_KG : LOAD_STEP_KG
}

export function readyForIncreaseFree(lastTwoSessions: LoggedSet[][], repMax = FREE_REP_MAX): boolean {
  if (lastTwoSessions.length < 2) return false
  return lastTwoSessions
    .slice(-2)
    .every(
      (sets) =>
        sets.length > 0 &&
        sets.every((s) => (s.reps ?? 0) >= repMax && (s.rpe == null || s.rpe <= 8)),
    )
}

export interface ExerciseSuggestion {
  firstTime: boolean
  lastSets: LoggedSet[]
  topLoad: number | null
  ready: boolean
  today: number | null // carga sugerida para hoje
  // Ao subir a carga, as repetições começam no mínimo (T7): sem isto o
  // «✓ Todas» gravava 42 × 12 sem as fazer. null: as da última vez.
  repsToday: number | null
}

const topLoadOf = (sets: LoggedSet[]) =>
  sets.reduce<number | null>((acc, s) => (s.load_kg != null && (acc == null || s.load_kg > acc) ? s.load_kg : acc), null)

// sessions: séries deste exercício por sessão, por ordem cronológica.
// Só se sugere subir com a mesma carga de topo nas duas sessões (30 × 12 e
// 40 × 12 não dão 42), com carga (peso do corpo, carga 0, não dá «Hoje: 1
// kg») e fora dos exercícios de tempo (12 segundos de prancha não são o
// topo) — T7.
export function suggestExercise(
  sessions: LoggedSet[][],
  repMax = FREE_REP_MAX,
  options: { repMin?: number; timed?: boolean } = {},
): ExerciseSuggestion {
  const withSets = sessions.filter((s) => s.length > 0)
  const lastSets = withSets[withSets.length - 1] ?? []
  if (!lastSets.length) return { firstTime: true, lastSets: [], topLoad: null, ready: false, today: null, repsToday: null }
  const topLoad = topLoadOf(lastSets)
  const previous = withSets[withSets.length - 2]
  const sameLoad = previous != null && topLoadOf(previous) === topLoad
  const ready =
    !options.timed && topLoad != null && topLoad > 0 && sameLoad && readyForIncreaseFree(withSets, repMax)
  return {
    firstTime: false,
    lastSets,
    topLoad,
    ready,
    today: topLoad == null || topLoad <= 0 ? null : ready ? topLoad + loadStep(topLoad) : topLoad,
    repsToday: ready ? (options.repMin ?? FREE_REP_MIN) : null,
  }
}

// «3 × 10 × 40 kg» (ou «10, 10, 8 × 40 kg» quando as repetições variam).
export function setsSummary(sets: LoggedSet[]): string {
  if (!sets.length) return ''
  const reps = sets.map((s) => s.reps ?? 0)
  const loads = [...new Set(sets.map((s) => s.load_kg))]
  const repsText = reps.every((r) => r === reps[0]) ? `${sets.length} × ${reps[0]}` : reps.join(', ')
  const load = loads.length === 1 && loads[0] != null ? ` × ${String(loads[0]).replace('.', ',')} kg` : ''
  return `${repsText}${load}`
}
