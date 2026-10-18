// Limites da IA: um teto mensal suave em euros e um limite diário de
// análises de fotos (proteção contra repetições em ciclo).

// Taxa fixa para mostrar e comparar em euros (aproximado).
export const USD_TO_EUR = 0.92
export const DEFAULT_MONTHLY_CAP_EUR = 10
export const DEFAULT_DAILY_VISION_CAP = 40

// O que conta como «análise de foto» para o limite diário: os pedidos ao
// modelo das fotos (também o áudio do «Dizer o treino», que vai para ele).
export const VISION_KINDS = ['meal_photo', 'meal_parse_photo', 'workout_shot', 'menu_pick', 'label_read', 'workout_said_audio']

// Com o Gemini (plano gratuito) a chave e a quota são uma só para a casa:
// o limite diário de fotos conta as de todas as pessoas, e não há custos em
// euros (o teto mensal não se aplica). Com o Claude, cada pessoa tem os
// seus limites e o teto mensal.
export function aiLimitsFor(provider: 'anthropic' | 'gemini'): { sharedDaily: boolean; monthlyEur: boolean } {
  return provider === 'gemini' ? { sharedDaily: true, monthlyEur: false } : { sharedDaily: false, monthlyEur: true }
}

export function monthlyCapReached(monthUsd: number, capEur: number): boolean {
  return capEur > 0 && monthUsd * USD_TO_EUR >= capEur
}

export function dailyVisionCapReached(visionCallsToday: number, cap: number): boolean {
  return cap > 0 && visionCallsToday >= cap
}

// «Pergunta à app»: no máximo 60 perguntas por dia (com o Gemini, as de toda
// a casa, como as fotos; com o Claude, por pessoa). Uma conversa a correr
// não pode gastar a quota gratuita do dia nem o teto do mês.
export const ASK_KIND = 'ask'
export const ASK_DAILY_CAP = 60

export function dailyAskCapReached(asksToday: number, cap = ASK_DAILY_CAP): boolean {
  return cap > 0 && asksToday >= cap
}

// Aviso nas Definições › Avançado a partir de 80 % do teto.
export function nearMonthlyCap(monthUsd: number, capEur: number): boolean {
  return capEur > 0 && monthUsd * USD_TO_EUR >= 0.8 * capEur
}
