// Regra 7: semana de manutenção a cada 6 semanas — kcal_target = tdee_est
// (ou 2000 sem estimativa). As semanas contam-se em semanas de calendário
// (segunda a domingo) desde a semana do primeiro dia registado.
import { shiftDate } from './nutritional-day'

export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = domingo
  return shiftDate(date, -((dow + 6) % 7))
}

export function isMaintenanceWeek(anchorDate: string, date: string): boolean {
  const anchor = mondayOf(anchorDate)
  const diffDays =
    (Date.parse(`${mondayOf(date)}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000
  if (diffDays < 0) return false
  const week = Math.round(diffDays / 7)
  // semanas 0-4 em défice, semana 5 (a 6.ª) em manutenção, e assim por diante
  return week % 6 === 5
}

export function maintenanceTarget(tdeeEst: number | null): number {
  return tdeeEst != null ? Math.round(tdeeEst) : 2000
}
