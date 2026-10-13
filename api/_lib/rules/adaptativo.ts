// Regra 4: gasto adaptativo (tdee_est), no fecho do dia, sobre os últimos
// 28 dias completos: tdee = média(kcal_in) + (trend_inicio - trend_fim) x 7700
// / n_dias, suavizado devagar: EMA alfa 0,1 e no máximo 30 kcal por dia, a
// partir da fórmula (o peso que cai no início é água, não gordura). Só
// mostrar com >= 10 dias completos.
// Se |tdee_est - expected_tdee| > 250, propor ajustar base_kcal.

export interface ClosedDay {
  date: string
  kcal_in: number
  weight_trend: number | null
}

const KCAL_PER_KG = 7700
export const TDEE_ALPHA = 0.1
export const TDEE_MAX_STEP_KCAL = 30
export const TDEE_WINDOW_DAYS = 28
export const MIN_COMPLETE_DAYS = 10

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// window: até 14 dias completos, por ordem cronológica.
// n_dias é o intervalo de calendário entre a primeira e a última tendência
// (o peso muda em dias de calendário, não só nos dias completos).
export function tdeeRaw(window: ClosedDay[]): number | null {
  if (window.length < MIN_COMPLETE_DAYS) return null
  const kcalMean = window.reduce((acc, d) => acc + d.kcal_in, 0) / window.length

  const withTrend = window.filter((d) => d.weight_trend != null)
  const first = withTrend[0]
  const last = withTrend[withTrend.length - 1]
  if (!first || !last || first.date === last.date) return null

  const spanDays =
    (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 86_400_000
  return round1(kcalMean + ((first.weight_trend! - last.weight_trend!) * KCAL_PER_KG) / spanDays)
}

export function smoothTdee(previous: number | null, raw: number, alpha = TDEE_ALPHA): number {
  if (previous == null) return round1(raw)
  const step = Math.max(-TDEE_MAX_STEP_KCAL, Math.min(TDEE_MAX_STEP_KCAL, alpha * (raw - previous)))
  return round1(previous + step)
}

export function shouldAdjustBase(tdeeEst: number, expectedTdee: number): boolean {
  return Math.abs(tdeeEst - expectedTdee) > 250
}

// Ritmo em kg/semana para um dado gasto: negativo = a perder peso.
export function paceKgPerWeek(kcalMeanIn: number, tdee: number): number {
  return Math.round((((kcalMeanIn - tdee) * 7) / KCAL_PER_KG) * 100) / 100
}
