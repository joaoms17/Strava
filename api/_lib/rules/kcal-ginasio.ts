// Kcal do ginásio (regra 2 revista): as calorias do relógio (do print, do
// intervals.icu ou ditas) contam por inteiro, para quem as traz. Sem elas,
// estima-se pelos minutos: ao ritmo da própria pessoa (as kcal por minuto dos
// seus ginásios recentes com calorias do relógio) ou, sem esse ritmo, pelos
// METs do treino de força × peso × horas. Não há mínimo de 30 min nem valor
// fixo: uma sessão a sério nunca dá 0. Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'

export type StrengthRule = 'device' | 'strength_rate' | 'met' | 'strength_time'

// O ritmo vem dos ginásios dos últimos 120 dias (contados a partir de hoje,
// não do dia do treino) com calorias do relógio; são precisos pelo menos 2.
export const GYM_PACE_DAYS = 120
export const GYM_PACE_MIN_SESSIONS = 2
// Uma sessão só entra no ritmo com 10 a 240 min e 1,5 a 15 kcal por minuto:
// fora disto é engano da leitura ou uma parte de um treino partido.
export const GYM_PACE_MINUTES: readonly [number, number] = [10, 240]
export const GYM_PACE_RATE: readonly [number, number] = [1.5, 15]
// METs líquidos do treino de força (≈ 5 do Compêndio, menos o repouso, que já
// está no gasto medido).
export const GYM_NET_MET = 4
// Sem ritmo e sem nenhuma pesagem: 4 kcal por minuto (≈ 60 kg × 4 METs).
export const GYM_KCAL_PER_MIN = 4

export interface GymPaceSession {
  date: string
  minutes: number | null
  kcal_device: number | null
}

// Kcal por minuto da pessoa no ginásio: soma das calorias do relógio a dividir
// pela soma dos minutos (uma sessão longa pesa mais do que uma curta), só com
// as sessões que passam nos limites. Menos de 2 sessões: sem ritmo.
export function gymPace(sessions: GymPaceSession[], today: string): number | null {
  const from = shiftDate(today, -GYM_PACE_DAYS)
  let kcal = 0
  let minutes = 0
  let count = 0
  for (const s of sessions) {
    if (s.date < from || s.date > today) continue
    const m = Number(s.minutes)
    const k = Number(s.kcal_device)
    if (!Number.isFinite(m) || !Number.isFinite(k) || k <= 0) continue
    if (m < GYM_PACE_MINUTES[0] || m > GYM_PACE_MINUTES[1]) continue
    const rate = k / m
    if (rate < GYM_PACE_RATE[0] || rate > GYM_PACE_RATE[1]) continue
    kcal += k
    minutes += m
    count++
  }
  return count >= GYM_PACE_MIN_SESSIONS ? kcal / minutes : null
}

export interface StrengthKcalInput {
  minutes: number | null
  deviceCalories: number | null
  // Kcal por minuto da pessoa (`gymPace`), quando há.
  pace?: number | null
  // Peso perto do dia do treino, quando há.
  weightKg?: number | null
}

export function strengthKcal(w: StrengthKcalInput): { kcal: number; rule: StrengthRule; estimated: boolean } {
  if (w.deviceCalories != null && w.deviceCalories > 0) {
    return { kcal: Math.round(w.deviceCalories), rule: 'device', estimated: false }
  }
  const minutes = w.minutes != null && w.minutes > 0 ? w.minutes : 0
  if (w.pace != null && w.pace > 0) {
    return { kcal: Math.round(w.pace * minutes), rule: 'strength_rate', estimated: true }
  }
  if (w.weightKg != null && w.weightKg > 0) {
    return { kcal: Math.round(GYM_NET_MET * w.weightKg * (minutes / 60)), rule: 'met', estimated: true }
  }
  return { kcal: Math.round(GYM_KCAL_PER_MIN * minutes), rule: 'strength_time', estimated: true }
}

// Explicação curta, para a folha do treino e a de confirmar um print. As
// sessões antigas (`strength_flat`, ou sem regra) ficam com as 150 de antes.
export function strengthExplanation(w: {
  minutes: number | null
  kcal: number
  rule: string | null
  deviceCalories: number | null
}): string {
  const minutes = w.minutes ?? 0
  switch (w.rule) {
    case 'device':
      return `As ${w.deviceCalories ?? w.kcal} kcal do relógio.`
    case 'strength_rate':
      return `≈ ${w.kcal} kcal: ${minutes} min ao teu ritmo dos últimos ginásios.`
    case 'met':
      return `≈ ${w.kcal} kcal pelo tempo (${minutes} min) e pelo teu peso.`
    case 'strength_time':
      return `≈ ${w.kcal} kcal pelo tempo (${minutes} min): sem pesagens, ${GYM_KCAL_PER_MIN} kcal por minuto.`
    default:
      return w.kcal > 0
        ? '150 fixas por ginásio de 30 min ou mais (a regra de antes).'
        : 'Menos de 30 min de ginásio não somava (a regra de antes).'
  }
}

// A razão numa linha da folha «O plano de hoje» («Ginásio · ≈ +122 kcal ao
// teu ritmo dos últimos ginásios»; o «≈» vai antes do número).
export function strengthReason(rule: string | null | undefined): string {
  switch (rule) {
    case 'device':
      return 'as calorias do relógio'
    case 'strength_rate':
      return 'ao teu ritmo dos últimos ginásios'
    case 'met':
      return 'pelo tempo e pelo teu peso'
    case 'strength_time':
      return 'pelo tempo'
    default:
      return '150 fixas (a regra de antes)'
  }
}
