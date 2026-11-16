// Os alimentos mais usados, para juntar a uma refeição com um toque: primeiro
// os que aparecem mais vezes nas refeições do mesmo momento (ceia, pequeno-
// -almoço…), com as gramas habituais nesse momento; depois os restantes pelo
// uso geral. Os itens sem food_id (foto, texto) ligam-se pelo nome.
import { slotOf, type Slot } from './momentos.js'

export interface UsedFood<F> {
  food: F
  grams: number
  inSlot: number
}

interface RankableFood {
  id: string
  name: string
  use_count: number
  default_portion_g: number | null
}

interface MealForRanking {
  slot: Slot | null
  logged_at: string
  items: { name: string; grams: number; food_id: string | null }[] | null
}

export function normalizeFoodName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function rankFoodsForSlot<F extends RankableFood>(
  foods: F[],
  meals: MealForRanking[],
  slot: Slot,
  max = 30,
): UsedFood<F>[] {
  const ids = new Set(foods.map((f) => f.id))
  const byName = new Map(foods.map((f) => [normalizeFoodName(f.name), f.id]))
  // Gramas por refeição (somadas quando o alimento aparece duas vezes).
  const grams = new Map<string, number[]>()
  for (const meal of meals) {
    if ((meal.slot ?? slotOf(new Date(meal.logged_at))) !== slot) continue
    const inMeal = new Map<string, number>()
    for (const it of meal.items ?? []) {
      const id = it.food_id && ids.has(it.food_id) ? it.food_id : byName.get(normalizeFoodName(it.name))
      if (!id || !(it.grams > 0)) continue
      inMeal.set(id, (inMeal.get(id) ?? 0) + it.grams)
    }
    for (const [id, g] of inMeal) grams.set(id, [...(grams.get(id) ?? []), g])
  }
  return foods
    .map((food) => {
      const used = grams.get(food.id) ?? []
      const usual = used.length ? median(used) : Number(food.default_portion_g) || 100
      return { food, grams: Math.round(usual), inSlot: used.length }
    })
    .sort((a, b) => b.inSlot - a.inSlot || b.food.use_count - a.food.use_count)
    .slice(0, max)
}

// Um alimento com o mesmo nome (sem acentos nem maiúsculas): escrever o rótulo
// de algo que já existe atualiza-o em vez de criar outro igual.
export function sameNameFood<F extends { name: string }>(foods: F[], name: string): F | undefined {
  const wanted = normalizeFoodName(name)
  return foods.find((f) => normalizeFoodName(f.name) === wanted)
}
