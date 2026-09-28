// Balanço da semana: médias do que se comeu e do plano, só com os dias que
// contam — já acabados, com refeições e sem «faltou algo».

export interface BalanceDay {
  date: string
  eaten: number
  plan: number
  protein: number
  carbs: number
  fat: number
  meals: number
  missingSomething: boolean
}

export interface WeekAverages {
  days: number
  eaten: number
  plan: number
  protein: number
  carbs: number
  fat: number
}

export function countedDays(days: BalanceDay[], today: string): BalanceDay[] {
  return days.filter((d) => d.date < today && d.meals > 0 && !d.missingSomething)
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
