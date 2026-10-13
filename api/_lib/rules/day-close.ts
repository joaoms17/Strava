// Regra 5: dia completo = >= 2 refeições registadas ou marcado "dia fechado"
// («Sim, foi tudo»). Dias com kcal_in < 800 sem marca são incompletos (ficam
// fora do adaptativo), e «Não, faltou algo» tira sempre o dia das contas.
export function isDayComplete(input: {
  mealCount: number
  kcalIn: number
  manuallyClosed: boolean
  missingSomething?: boolean
}): boolean {
  if (input.missingSomething) return false
  if (input.manuallyClosed) return true
  return input.mealCount >= 2 && input.kcalIn >= 800
}

// Regra 6: média dos últimos 7 dias completos < kcal_floor_week gera aviso.
// Com menos de 7 dias completos ainda não há aviso (dados a menos).
export function floorWarning(lastCompleteDaysKcal: number[], floorKcal: number): boolean {
  if (lastCompleteDaysKcal.length < 7) return false
  const last7 = lastCompleteDaysKcal.slice(-7)
  const mean = last7.reduce((a, b) => a + b, 0) / last7.length
  return mean < floorKcal
}

// Sequência de dias com tudo registado (Hoje): dias seguidos, para trás a
// partir de ontem, que contam como completos pela regra 5 — 2 refeições e
// 800 kcal, ou «Sim, foi tudo» (jejum, refeições saltadas); «Não, faltou
// algo» ou um dia sem nada quebra. Hoje ainda vai a meio: soma 1 se já
// estiver completo, mas não quebra. Conta a partir das refeições (não do dia
// guardado, que pode estar por recalcular).
export interface StreakDay {
  mealCount: number
  kcalIn: number
  flags?: string[] | null
}
export function completeStreak(byDate: Record<string, StreakDay>, today: string, maxDays = 365): number {
  const done = (date: string) => {
    const d = byDate[date]
    const flags = d?.flags ?? []
    return isDayComplete({
      mealCount: d?.mealCount ?? 0,
      kcalIn: d?.kcalIn ?? 0,
      manuallyClosed: flags.includes('dia_fechado'),
      missingSomething: flags.includes('faltou_algo'),
    })
  }
  let streak = 0
  let day = new Date(`${today}T00:00:00Z`)
  for (let i = 0; i < maxDays; i++) {
    day = new Date(day.getTime() - 86_400_000)
    if (!done(day.toISOString().slice(0, 10))) break
    streak++
  }
  return streak + (done(today) ? 1 : 0)
}
