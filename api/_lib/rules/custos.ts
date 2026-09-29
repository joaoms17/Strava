// Limites da IA: um teto mensal suave em euros e um limite diário de
// análises de fotos (proteção contra repetições em ciclo).

// Taxa fixa para mostrar e comparar em euros (aproximado).
export const USD_TO_EUR = 0.92
export const DEFAULT_MONTHLY_CAP_EUR = 10
export const DEFAULT_DAILY_VISION_CAP = 40

export function monthlyCapReached(monthUsd: number, capEur: number): boolean {
  return capEur > 0 && monthUsd * USD_TO_EUR >= capEur
}

export function dailyVisionCapReached(visionCallsToday: number, cap: number): boolean {
  return cap > 0 && visionCallsToday >= cap
}

// Aviso nas Definições › Avançado a partir de 80 % do teto.
export function nearMonthlyCap(monthUsd: number, capEur: number): boolean {
  return capEur > 0 && monthUsd * USD_TO_EUR >= 0.8 * capEur
}
