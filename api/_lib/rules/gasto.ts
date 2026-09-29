// Fase 6 — Gasto (docs/redesenho-2026-09.md › Comer e Gasto). Três camadas
// que a interface nunca mistura: o plano (o que pode comer), o gasto de hoje
// (base sem treino + treino, só para mostrar) e o gasto medido pelo peso
// (tdee_est, regra 4). Sem imports: o telemóvel usa as mesmas funções.

export const KCAL_PER_KG = 7700
export const SEDENTARY_FACTOR = 1.2
export const MIN_COMPLETE_DAYS_FOR_MEASURED = 10
export const COHERENCE_KG_WEEK = 0.25
export const FORMULA_GAP_KCAL = 300
export const PLAN_DEFICIT_KCAL = 550
export const MIN_BASE_KCAL = 1500
export const BASE_SUGGESTION_MIN_CHANGE = 100

// Mifflin-St Jeor × 1,2 (sedentário: o treino soma à parte).
export function mifflinBase(input: {
  weightKg: number
  heightCm: number
  age: number
  sex: 'm' | 'f' | string
}): number {
  const bmr = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.sex === 'f' ? -161 : 5)
  return Math.round(bmr * SEDENTARY_FACTOR)
}

// Base pela fórmula; sem ano de nascimento fica o valor fixo (2 200).
export function formulaBase(input: {
  weightKg: number | null
  heightCm: number | null
  birthYear: number | null
  sex: string | null
  date: string
  fallback: number
}): number {
  if (input.weightKg == null || input.heightCm == null || input.birthYear == null) return input.fallback
  const age = Number(input.date.slice(0, 4)) - input.birthYear
  return mifflinBase({ weightKg: input.weightKg, heightCm: input.heightCm, age, sex: input.sex ?? 'm' })
}

// Base sem treino: com 10 ou mais dias completos, o gasto medido (congelado
// antes da semana) menos a média das kcal de treino na mesma janela; antes
// disso, a fórmula («a aprender»).
export function dailyBase(input: {
  completeDays: number
  tdeeFrozen: number | null
  avgTrainingKcal: number
  formula: number
}): { base: number; learning: boolean } {
  if (input.completeDays >= MIN_COMPLETE_DAYS_FOR_MEASURED && input.tdeeFrozen != null) {
    return { base: Math.round(input.tdeeFrozen - input.avgTrainingKcal), learning: false }
  }
  return { base: input.formula, learning: true }
}

export function kcalOut(base: number, exerciseKcal: number): number {
  return Math.round(base + exerciseKcal)
}

// kg por semana para uma diferença média diária (negativo = a perder).
export function paceFromDiff(diffKcalPerDay: number): number {
  return Math.round(((diffKcalPerDay * 7) / KCAL_PER_KG) * 100) / 100
}

export function round10(n: number): number {
  return Math.round(n / 10) * 10
}

function fmtThousands(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  return s.length > 3 ? `${s.slice(0, -3)} ${s.slice(-3)}` : s
}

function fmtKg(n: number): string {
  return (Math.round(Math.abs(n) * 10) / 10).toFixed(1).replace('.', ',')
}

// Frase da semana: comer contra gasto (média dos dias completos) e o peso.
export function weekSentence(avgEaten: number, avgOut: number, rateKgWeek: number | null): string {
  const diff = round10(avgEaten - avgOut)
  const first =
    Math.abs(diff) < 50
      ? 'Esta semana comeste cerca do que gastaste.'
      : `Esta semana comeste cerca de ${fmtThousands(Math.abs(diff))} kcal por dia ${diff < 0 ? 'menos' : 'mais'} do que gastaste.`
  if (rateKgWeek == null) return first
  const second =
    Math.abs(rateKgWeek) < 0.05
      ? 'O peso médio está estável.'
      : `O peso médio está a ${rateKgWeek < 0 ? 'descer' : 'subir'} ${fmtKg(rateKgWeek)} kg por semana.`
  return `${first} ${second}`
}

// Coerência (a partir da 3.ª semana): o ritmo previsto pelas contas, com o
// gasto medido até ao início da semana, contra o ritmo do peso.
export function coherence(avgEaten: number, tdeeBeforeWeek: number, rateKgWeek: number): 'bate_certo' | 'ainda_nao' {
  const predicted = paceFromDiff(avgEaten - tdeeBeforeWeek)
  return Math.abs(predicted - rateKgWeek) <= COHERENCE_KG_WEEK ? 'bate_certo' : 'ainda_nao'
}

export const COHERENCE_TEXT = {
  bate_certo: 'Bate certo.',
  ainda_nao:
    'As contas e o peso ainda não coincidem esta semana. É normal: água e sal mexem no peso, e a app ajusta o gasto sozinha.',
} as const

// Gasto medido contra a fórmula (que não depende do que se come).
export function measuredVsFormula(tdee: number, formula: number, avgTrainingKcal: number): number {
  return Math.round(tdee - (formula + avgTrainingKcal))
}

// A nota neutra só aparece com 3 verificações semanais seguidas abaixo de 300.
export function persistentGap(weeklyGaps: number[]): boolean {
  const lastThree = weeklyGaps.slice(-3)
  return lastThree.length === 3 && lastThree.every((g) => g < -FORMULA_GAP_KCAL)
}

// Sugestão de plano base: gasto medido − treino médio − 550, a 50, nunca
// abaixo de 1 500; só quando muda pelo menos 100.
export function baseSuggestion(tdee: number, avgTrainingKcal: number, currentBase: number): number | null {
  const y = Math.max(MIN_BASE_KCAL, Math.round((tdee - avgTrainingKcal - PLAN_DEFICIT_KCAL) / 50) * 50)
  return Math.abs(y - currentBase) >= BASE_SUGGESTION_MIN_CHANGE ? y : null
}

// «Qualidade da perda» (Corpo): que parte do peso perdido foi gordura; só
// com 3 medições ou mais e 3 kg ou mais de diferença de peso.
export function lossQuality(
  measurements: { weight_used_kg: number; fatKg: number }[],
): { fatShare: number; weightKg: number } | null {
  if (measurements.length < 3) return null
  const first = measurements[0]!
  const last = measurements[measurements.length - 1]!
  const dWeight = last.weight_used_kg - first.weight_used_kg
  if (Math.abs(dWeight) < 3) return null
  const dFat = last.fatKg - first.fatKg
  return { fatShare: Math.round((dFat / dWeight) * 100), weightKg: Math.round(dWeight * 10) / 10 }
}
