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
