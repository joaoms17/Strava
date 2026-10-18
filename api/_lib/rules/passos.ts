// Passos no Hoje: os do dia (do relógio, pelo intervals.icu, ou do Atalho do
// iPhone) e a média dos 30 dias antes, para comparar. Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'

export const STEPS_AVG_DAYS = 30
// Com menos dias registados, a média não diz nada.
export const STEPS_AVG_MIN_DAYS = 3

type StepRow = { date: string; steps?: number | null }

// A média dos 30 dias antes deste (sem o próprio dia nem dias a 0 ou sem
// registo). É a mesma no Hoje e no Corpo › Do relógio.
export function stepsAverage(rows: StepRow[], date: string): number | null {
  const from = shiftDate(date, -STEPS_AVG_DAYS)
  const before = rows.filter((r) => r.date < date && r.date >= from && r.steps != null && r.steps > 0)
  return before.length >= STEPS_AVG_MIN_DAYS ? Math.round(before.reduce((a, r) => a + r.steps!, 0) / before.length) : null
}

export function daySteps(rows: StepRow[], date: string): { steps: number; avg: number | null } | null {
  const steps = rows.find((r) => r.date === date)?.steps
  if (steps == null || steps <= 0) return null
  return { steps, avg: stepsAverage(rows, date) }
}
