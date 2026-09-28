// Regra 3: weight_trend = média móvel de 7 dias sobre as pesagens.
// Projeção linear a 4 semanas sobre a tendência dos últimos 21 dias
// e data prevista para o peso alvo.

export interface DatedValue {
  date: string // YYYY-MM-DD
  value: number
}

const DAY_MS = 86_400_000

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS
}

function dateFromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Para cada dia com pesagem, média das pesagens na janela [dia-6, dia].
// Dias sem pesagem não entram na média (não são zeros).
export function trend7(weights: DatedValue[]): DatedValue[] {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((entry) => {
    const day = dayNumber(entry.date)
    const window = sorted.filter((w) => {
      const d = dayNumber(w.date)
      return d >= day - 6 && d <= day
    })
    const mean = window.reduce((acc, w) => acc + w.value, 0) / window.length
    return { date: entry.date, value: round2(mean) }
  })
}

// Declive (kg/dia) por regressão linear simples sobre pontos datados.
export function linearSlope(points: DatedValue[]): number {
  if (points.length < 2) return 0
  const xs = points.map((p) => dayNumber(p.date))
  const ys = points.map((p) => p.value)
  const n = points.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY)
    den += (xs[i]! - meanX) ** 2
  }
  return den === 0 ? 0 : num / den
}

export interface WeightProjection {
  slopePerDay: number
  projected: DatedValue[] // 4 semanas a partir do último ponto da tendência
  targetDate: string | null // data prevista para o alvo (null se não converge)
}

export function projectWeight(
  trend: DatedValue[],
  targetKg: number,
  horizonDays = 28,
): WeightProjection {
  const last = trend[trend.length - 1]
  if (!last) return { slopePerDay: 0, projected: [], targetDate: null }

  const lastDay = dayNumber(last.date)
  const recent = trend.filter((p) => dayNumber(p.date) >= lastDay - 20)
  const slope = linearSlope(recent)

  const projected: DatedValue[] = []
  for (let i = 1; i <= horizonDays; i++) {
    projected.push({ date: dateFromDayNumber(lastDay + i), value: round2(last.value + slope * i) })
  }

  let targetDate: string | null = null
  if (last.value <= targetKg) {
    targetDate = last.date
  } else if (slope < 0) {
    const days = (targetKg - last.value) / slope
    if (days <= 365) targetDate = dateFromDayNumber(lastDay + Math.ceil(days))
  }

  return { slopePerDay: slope, projected, targetDate }
}

// O peso médio só aparece a partir de 3 pesagens.
export const MIN_WEIGHINGS_FOR_TREND = 3

// «a descer 0,4 kg por semana»: declive do peso médio nos últimos 14 dias,
// só com pelo menos 8 pesagens nessa janela e 14 dias de história.
export const RATE_WINDOW_DAYS = 14
export const RATE_MIN_WEIGHINGS = 8

export function weeklyRate(weights: DatedValue[]): number | null {
  if (weights.length === 0) return null
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date))
  const lastDay = dayNumber(sorted[sorted.length - 1]!.date)
  if (lastDay - dayNumber(sorted[0]!.date) < RATE_WINDOW_DAYS - 1) return null
  const inWindow = sorted.filter((w) => dayNumber(w.date) > lastDay - RATE_WINDOW_DAYS)
  if (inWindow.length < RATE_MIN_WEIGHINGS) return null
  const trend = trend7(sorted).filter((p) => dayNumber(p.date) > lastDay - RATE_WINDOW_DAYS)
  return Math.round(linearSlope(trend) * 7 * 100) / 100
}

// Faixa segura: perder mais de 0,85 kg por semana gasta músculo.
export const FAST_LOSS_KG_WEEK = 0.85

// Uma pesagem a mais de 3 kg do peso médio é quase sempre um erro a teclar:
// falta a vírgula (854 → 85,4) ou dois algarismos trocados (48,5 → 84,5).
export const TYPO_THRESHOLD_KG = 3

export type WeightCheck =
  | { kind: 'ok' }
  | { kind: 'suggest'; value: number }
  | { kind: 'confirm' }

export function checkWeighing(value: number, reference: number | null): WeightCheck {
  if (reference == null || Math.abs(value - reference) <= TYPO_THRESHOLD_KG) return { kind: 'ok' }
  const candidates = [value / 10, value / 100, value * 10]
  const [intPart, decPart] = value.toFixed(1).split('.') as [string, string]
  if (intPart.length === 2) candidates.push(Number(`${intPart[1]}${intPart[0]}.${decPart}`))
  const near = candidates
    .map((c) => Math.round(c * 10) / 10)
    .filter((c) => Math.abs(c - reference) <= TYPO_THRESHOLD_KG)
    .sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference))
  return near[0] != null ? { kind: 'suggest', value: near[0] } : { kind: 'confirm' }
}
