// Cartão «Próximo passo» do Hoje: no máximo um, com regras fixas e sem IA.
// Fase 1: pesar (4), ontem (5), pouco (7) e proteína (8).
// «Agora não» esconde o cartão até ao dia seguinte; ignorado 2 vezes, pausa 3 dias.

export type NextStepId = 'pesar' | 'ontem' | 'pouco' | 'proteina'

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
  mealsToday: number
  kcalToday: number
  proteinToday: number
  proteinTarget: number
  nudges: NudgeState
}

export const LOW_DAY_KCAL = 1200

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
    ['pesar', input.minutesOfDay < 11 * 60 && !input.weighedToday],
    [
      'ontem',
      input.yesterdayMeals >= 1 && input.yesterdayMeals <= 2 && !input.yesterdayAnswered,
    ],
    ['pouco', input.minutesOfDay >= 20 * 60 && input.mealsToday >= 1 && input.kcalToday < LOW_DAY_KCAL],
    [
      'proteina',
      input.minutesOfDay >= 19 * 60 &&
        input.mealsToday >= 1 &&
        input.proteinToday < 0.6 * input.proteinTarget,
    ],
  ]
  for (const [id, applies] of candidates) {
    if (applies && !hidden(id)) return id
  }
  return null
}
