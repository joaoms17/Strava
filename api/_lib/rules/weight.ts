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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Para cada dia com pesagem, média das pesagens na janela [dia-6, dia].
// Dias sem pesagem não entram na média (não são zeros). Janela deslizante
// sobre a lista ordenada (P4): cada data converte-se uma vez e a janela só
// anda para a frente; a soma faz-se pela mesma ordem de antes.
export function trend7(weights: DatedValue[]): DatedValue[] {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date))
  const days = sorted.map((w) => dayNumber(w.date))
  const out: DatedValue[] = []
  let lo = 0
  let hi = 0
  for (let i = 0; i < sorted.length; i++) {
    const day = days[i]!
    while (hi < sorted.length && days[hi]! <= day) hi++
    while (days[lo]! < day - 6) lo++
    let sum = 0
    for (let k = lo; k < hi; k++) sum += sorted[k]!.value
    out.push({ date: sorted[i]!.date, value: round2(sum / (hi - lo)) })
  }
  return out
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

// O ritmo de uma semana (Balanço) só com uma pesagem recente: a última a 4
// dias ou menos do fim da semana (ou de hoje). Depois de 2–3 semanas sem
// pesar, o ritmo antigo aparecia como o desta semana.
export const RATE_MAX_AGE_DAYS = 4

export function weeklyRateAsOf(weights: DatedValue[], asOf: string): number | null {
  const upTo = weights.filter((w) => w.date <= asOf)
  const last = upTo.reduce((a, w) => (w.date > a ? w.date : a), '')
  if (!last || dayNumber(asOf) - dayNumber(last) > RATE_MAX_AGE_DAYS) return null
  return weeklyRate(upTo)
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

// Pesagem apagada (ex.: outra pessoa na balança): a mesma pesagem não volta
// pela sincronização nem pelo Atalho. Uma pesagem nova nesse dia (outro peso)
// entra como antes.
export function isDeletedWeighing(kg: number, deleted: { kg: number | string | null } | undefined): boolean {
  if (!deleted) return false
  if (deleted.kg == null) return true
  return Math.abs(kg - Number(deleted.kg)) < 0.15
}
