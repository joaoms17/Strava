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
