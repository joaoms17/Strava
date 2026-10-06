// Passos no Hoje: os do dia (do relógio, pelo intervals.icu, ou do Atalho do
// iPhone) e a média dos 30 dias antes, para comparar. Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'

export const STEPS_AVG_DAYS = 30
// Com menos dias registados, a média não diz nada.
export const STEPS_AVG_MIN_DAYS = 3

export function daySteps(
  rows: { date: string; steps: number | null }[],
  date: string,
): { steps: number; avg: number | null } | null {
  const steps = rows.find((r) => r.date === date)?.steps
  if (steps == null || steps <= 0) return null
  const from = shiftDate(date, -STEPS_AVG_DAYS)
  const before = rows.filter((r) => r.date < date && r.date >= from && r.steps != null && r.steps > 0)
  const avg =
    before.length >= STEPS_AVG_MIN_DAYS ? Math.round(before.reduce((a, r) => a + r.steps!, 0) / before.length) : null
  return { steps, avg }
}
