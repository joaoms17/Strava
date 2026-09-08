export interface MealItem {
  name: string
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  food_id: string | null
  estimated: boolean
}

export interface MealTotals {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Os macros de cada item já vêm em valores absolutos (para os gramas do item).
export function mealTotals(items: MealItem[]): MealTotals {
  const sum = (pick: (i: MealItem) => number) =>
    round1(items.reduce((acc, item) => acc + pick(item), 0))
  return {
    kcal: sum((i) => i.kcal),
    protein: sum((i) => i.protein),
    carbs: sum((i) => i.carbs),
    fat: sum((i) => i.fat),
  }
}
