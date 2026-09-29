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
// trava a subida. Todas as séries no topo (12) em 2 sessões seguidas: +2 kg.
// ---------------------------------------------------------------------
export const FREE_REP_MIN = 8
export const FREE_REP_MAX = 12
export const LOAD_STEP_KG = 2

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
}

// sessions: séries deste exercício por sessão, por ordem cronológica.
export function suggestExercise(sessions: LoggedSet[][], repMax = FREE_REP_MAX): ExerciseSuggestion {
  const withSets = sessions.filter((s) => s.length > 0)
  const lastSets = withSets[withSets.length - 1] ?? []
  if (!lastSets.length) return { firstTime: true, lastSets: [], topLoad: null, ready: false, today: null }
  const topLoad = lastSets.reduce<number | null>(
    (acc, s) => (s.load_kg != null && (acc == null || s.load_kg > acc) ? s.load_kg : acc),
    null,
  )
  const ready = readyForIncreaseFree(withSets, repMax)
  return {
    firstTime: false,
    lastSets,
    topLoad,
    ready,
    today: topLoad == null ? null : ready ? topLoad + LOAD_STEP_KG : topLoad,
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
