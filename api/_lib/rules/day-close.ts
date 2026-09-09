// Regra 5: dia completo = >= 2 refeições registadas ou marcado "dia fechado".
// Dias com kcal_in < 800 sem marca são incompletos (ficam fora do adaptativo).
export function isDayComplete(input: {
  mealCount: number
  kcalIn: number
  manuallyClosed: boolean
}): boolean {
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
