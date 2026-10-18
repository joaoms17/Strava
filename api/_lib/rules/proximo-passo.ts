// Cartão «Próximo passo» do Hoje: no máximo um, com regras fixas e sem IA.
// Por ordem: refeição com erro (1), limite da IA (2), treino por confirmar
// (3, um print lido à espera de «Guardar»), pesar (4), ontem (5: fotos de
// ontem sem números, ou «Foi tudo?» com 1–2 refeições ou um dia incompleto),
// rever à noite (6), pouco (7), proteína (8) e medir (9, de manhã). Os cartões 1 e 2 resolvem-se
// com a ação; os outros têm «Agora não», que esconde até ao dia seguinte e,
// ignorado 2 vezes, pausa 3 dias.
import { isDayComplete } from './day-close.js'

export type NextStepId = 'erro' | 'limite' | 'treino' | 'pesar' | 'ontem' | 'rever' | 'pouco' | 'proteina' | 'medir'

export interface NudgeEntry {
  ignored: number
  hiddenOn?: string // dia em que se tocou em «Agora não»
  pausedUntil?: string // dia (inclusive) até ao qual não aparece
}

export type NudgeState = Partial<Record<NextStepId, NudgeEntry>>

export interface NextStepInput {
  today: string
  minutesOfDay: number // hora local em minutos
  weighedToday: boolean
  yesterdayMeals: number
  yesterdayAnswered: boolean // «Sim, foi tudo» ou «Não, faltou algo»
  yesterdayComplete?: boolean // regra 5, com as refeições contadas
  yesterdayUncounted?: number // fotos de ontem sem números (erro, limite, paradas)
  mealsToday: number
  kcalToday: number
  planKcal?: number // o plano de hoje (base + treino, ou o da semana de pausa)
  proteinToday: number
  proteinTarget: number
  mealsWithError?: number
  mealsOverLimit?: number
  mealsToReview?: number
  workoutsToConfirm?: number
  // Medidas (Fase 4): dias desde a última (null = nunca) e de quanto em quanto tempo.
  measureDaysSince?: number | null
  measureIntervalDays?: number
  weighings?: number
  nudges: NudgeState
}

// «Hoje comeste pouco»: abaixo de 1 200 e pelo menos 400 abaixo do plano (com
// um plano de 1 200, só abaixo de 800), depois das 21:30 (o jantar já foi).
export const LOW_DAY_KCAL = 1200
export const LOW_DAY_MARGIN_KCAL = 400
export const LOW_DAY_FROM_MIN = 21 * 60 + 30

export function lowDayKcal(planKcal?: number): number {
  return planKcal != null ? Math.min(LOW_DAY_KCAL, planKcal - LOW_DAY_MARGIN_KCAL) : LOW_DAY_KCAL
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function isNudgeHidden(nudges: NudgeState, id: NextStepId, today: string): boolean {
  const entry = nudges[id]
  if (!entry) return false
  if (entry.hiddenOn === today) return true
  return entry.pausedUntil != null && entry.pausedUntil >= today
}

export function dismissNudge(nudges: NudgeState, id: NextStepId, today: string): NudgeState {
  const ignored = (nudges[id]?.ignored ?? 0) + 1
  const entry: NudgeEntry =
    ignored >= 2
      ? { ignored: 0, hiddenOn: today, pausedUntil: addDays(today, 3) }
      : { ignored, hiddenOn: today }
  return { ...nudges, [id]: entry }
}

export function nextStep(input: NextStepInput): NextStepId | null {
  const hidden = (id: NextStepId) => isNudgeHidden(input.nudges, id, input.today)
  const candidates: [NextStepId, boolean][] = [
    ['erro', (input.mealsWithError ?? 0) > 0],
    ['limite', (input.mealsOverLimit ?? 0) > 0],
    ['treino', (input.workoutsToConfirm ?? 0) > 0],
    // Só de manhã (04:00–11:00): depois da meia-noite ainda é o dia anterior.
    ['pesar', input.minutesOfDay >= 4 * 60 && input.minutesOfDay < 11 * 60 && !input.weighedToday],
    [
      'ontem',
      !input.yesterdayAnswered &&
        ((input.yesterdayUncounted ?? 0) > 0 ||
          (input.yesterdayMeals >= 1 && (input.yesterdayMeals <= 2 || input.yesterdayComplete === false))),
    ],
    ['rever', input.minutesOfDay >= 20 * 60 && (input.mealsToReview ?? 0) > 0],
    [
      'pouco',
      input.minutesOfDay >= LOW_DAY_FROM_MIN && input.mealsToday >= 1 && input.kcalToday < lowDayKcal(input.planKcal),
    ],
    [
      'proteina',
      input.minutesOfDay >= 19 * 60 &&
        input.mealsToday >= 1 &&
        input.proteinToday < 0.6 * input.proteinTarget,
    ],
    [
      'medir',
      input.minutesOfDay >= 4 * 60 &&
        input.minutesOfDay < 13 * 60 &&
        (input.measureDaysSince === null
          ? (input.weighings ?? 0) >= 3
          : input.measureDaysSince !== undefined && input.measureDaysSince >= (input.measureIntervalDays ?? 14)),
    ],
  ]
  for (const [id, applies] of candidates) {
    const dismissible = id !== 'erro' && id !== 'limite'
    if (applies && !(dismissible && hidden(id))) return id
  }
  return null
}

// Hoje a ver um dia passado (ontem incluído, porque o cartão «Ontem» só
// aparece no dia de hoje): «Foi tudo neste dia?» quando o dia tem pelo menos
// uma refeição com números, nenhuma foto por contar (essas resolvem-se
// primeiro, com «Tentar»), nenhuma resposta e ainda não está completo pela
// regra 5 (ex.: um dia de jejum de há três dias).
export function askPastDay(input: {
  date: string
  today: string
  meals: number // refeições contadas (ok e por rever)
  kcalIn: number
  uncounted: number // fotos sem números (a analisar, com erro, acima do limite)
  flags: string[]
}): boolean {
  if (input.date >= input.today || input.meals < 1 || input.uncounted > 0) return false
  if (input.flags.includes('dia_fechado') || input.flags.includes('faltou_algo')) return false
  return !isDayComplete({ mealCount: input.meals, kcalIn: input.kcalIn, manuallyClosed: false })
}
