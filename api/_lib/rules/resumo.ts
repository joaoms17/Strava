// Resumo da semana (cron): só se escreve com dados e volta a escrever-se
// quando os dados da semana mudam depois de escrito (a resposta «Foi tudo?»
// de domingo, uma foto analisada mais tarde). Sem supabase nem node.
import { leftOutDates } from './balanco.js'
import { round10 } from './gasto.js'
import { shiftDate } from './nutritional-day.js'
import { weeklyRateAsOf } from './weight.js'

// Sem dias completos, refeições nem treinos não há nada a resumir (o fecho
// do dia cria as linhas dos dias mesmo sem nada registado).
export function weekHasData(input: { completeDays: number; meals: number; workouts: number }): boolean {
  return input.completeDays > 0 || input.meals > 0 || input.workouts > 0
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// Impressão digital dos dados enviados à IA: o JSON com as chaves por ordem
// (o jsonb do Postgres reordena-as) num hash curto (FNV-1a de 32 bits).
export function dataFingerprint(value: unknown): string {
  const text = stableJson(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// O que o topo do Balanço diz da semana (já acabada), para o resumo dizer o
// mesmo com os mesmos números: a diferença entre o que se comeu e o gasto
// (médias dos dias completos, a 10, como `weekSentence`), o ritmo do peso
// médio (só com uma pesagem a 4 dias ou menos do domingo, `weeklyRateAsOf`,
// das pesagens dos 40 dias até ao domingo) e os dias que ficaram de fora
// (`leftOutDates`: com refeições, mas incompletos ou com «faltou algo»).
export interface ReviewDay {
  date: string
  kcal_in: number | null
  kcal_out_est: number | null
  is_complete: boolean
}

export const REVIEW_WEIGHT_DAYS = 40

export function reviewHeadline(input: {
  weekStart: string
  days: ReviewDay[]
  mealDates: string[] // a data de cada refeição contada da semana
  weights: { date: string; kg: number }[]
}): { comeuMenosGasto: number | null; ritmoKgSemana: number | null; diasDeFora: string[] } {
  const weekEnd = shiftDate(input.weekStart, 6)
  const counted = input.days.filter((d) => d.is_complete && d.kcal_out_est != null)
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  const meals = new Map<string, number>()
  for (const date of input.mealDates) meals.set(date, (meals.get(date) ?? 0) + 1)
  const from = shiftDate(weekEnd, -REVIEW_WEIGHT_DAYS)
  return {
    comeuMenosGasto: counted.length
      ? round10(mean(counted.map((d) => Number(d.kcal_in ?? 0))) - mean(counted.map((d) => Number(d.kcal_out_est))))
      : null,
    ritmoKgSemana: weeklyRateAsOf(
      input.weights.filter((w) => w.date >= from && w.date <= weekEnd).map((w) => ({ date: w.date, value: Number(w.kg) })),
      weekEnd,
    ),
    diasDeFora: leftOutDates(
      Array.from({ length: 7 }, (_, i) => {
        const date = shiftDate(input.weekStart, i)
        return { date, meals: meals.get(date) ?? 0, complete: input.days.find((d) => d.date === date)?.is_complete === true }
      }),
      shiftDate(weekEnd, 1),
    ),
  }
}
