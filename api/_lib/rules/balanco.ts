// Balanço da semana: médias do que se comeu e do plano, só com os dias que
// contam — já acabados e completos pela regra 5 (2 refeições e 800 kcal, ou
// «Sim, foi tudo»; sem «faltou algo» nem fotos por contar), como o Mês, a
// Conta da gordura e o resumo da semana. Calcula-se a partir das refeições,
// por isso muda logo.

export interface BalanceDay {
  date: string
  eaten: number
  plan: number
  protein: number
  carbs: number
  fat: number
  meals: number
  complete: boolean
}

export interface WeekAverages {
  days: number
  eaten: number
  plan: number
  protein: number
  carbs: number
  fat: number
}

export function countedDays<T extends BalanceDay>(days: T[], today: string): T[] {
  return days.filter((d) => d.date < today && d.complete)
}

// Dias acabados com refeições que não contam (incompletos ou «faltou algo»):
// as datas (para os abrir no Hoje e responder «Foi tudo?») e quantos são.
export function leftOutDates(days: Pick<BalanceDay, 'date' | 'meals' | 'complete'>[], today: string): string[] {
  return days.filter((d) => d.date < today && d.meals > 0 && !d.complete).map((d) => d.date)
}

export function leftOutDays(days: Pick<BalanceDay, 'date' | 'meals' | 'complete'>[], today: string): number {
  return leftOutDates(days, today).length
}

export function weekAverages(days: BalanceDay[], today: string): WeekAverages | null {
  const counted = countedDays(days, today)
  if (counted.length === 0) return null
  const mean = (pick: (d: BalanceDay) => number) =>
    counted.reduce((acc, d) => acc + pick(d), 0) / counted.length
  return {
    days: counted.length,
    eaten: mean((d) => d.eaten),
    plan: mean((d) => d.plan),
    protein: mean((d) => d.protein),
    carbs: mean((d) => d.carbs),
    fat: mean((d) => d.fat),
  }
}

// Aviso âmbar: a média da semana abaixo do mínimo (regra 6, 1 400 por omissão).
export function belowFloor(averages: WeekAverages | null, floorKcal: number): boolean {
  return averages != null && averages.days >= 3 && averages.eaten < floorKcal
}

// Hoje: a semana até agora contra o plano — os dias completos desde
// segunda-feira (o que o fecho do dia guardou) mais hoje, ao vivo. `diff`
// positivo = abaixo do plano. Sem nenhum dia completo antes de hoje, não há.
export interface WeekSoFarDay {
  date: string
  kcal_in: number
  kcal_target: number
  is_complete: boolean
}

export function weekSoFar(
  days: WeekSoFarDay[],
  today: string,
  todayPlan: number,
  todayEaten: number,
): { days: number; diff: number } | null {
  const past = days.filter((d) => d.date < today && d.is_complete && Number(d.kcal_target) > 0)
  if (past.length === 0) return null
  const diff = past.reduce((a, d) => a + Number(d.kcal_target) - Number(d.kcal_in), todayPlan - todayEaten)
  return { days: past.length, diff: Math.round(diff) }
}
