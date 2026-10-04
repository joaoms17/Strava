// Dieta feita com as refeições favoritas: para cada refeição do dia, uma ou
// mais favoritas (a primeira é a habitual). Sem imports de servidor: o
// telemóvel usa este ficheiro diretamente.
import { SLOTS, type Slot } from './momentos.js'

export type DietMeals = Partial<Record<Slot, string[]>>

export interface DietFavorite {
  id: string
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export const DIET_MAX_OPTIONS = 6

// O que vem da base de dados (jsonb) passa por aqui: só refeições conhecidas,
// só ids em texto, sem repetidos e, se houver lista, só favoritas que existem.
export function cleanDietMeals(raw: unknown, known?: Set<string>): DietMeals {
  const out: DietMeals = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const slot of SLOTS) {
    const list = (raw as Record<string, unknown>)[slot]
    if (!Array.isArray(list)) continue
    const ids = [...new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      .filter((id) => !known || known.has(id))
      .slice(0, DIET_MAX_OPTIONS)
    if (ids.length > 0) out[slot] = ids
  }
  return out
}

export function dietSlots(meals: DietMeals): Slot[] {
  return SLOTS.filter((slot) => (meals[slot]?.length ?? 0) > 0)
}

// O dia da dieta: a habitual (primeira) de cada refeição.
export function dietTotals(
  meals: DietMeals,
  favorites: Map<string, DietFavorite>,
): { kcal: number; protein: number; carbs: number; fat: number; meals: number } {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, meals: 0 }
  for (const slot of dietSlots(meals)) {
    const fav = favorites.get(meals[slot]![0]!)
    if (!fav) continue
    totals.kcal += Number(fav.kcal)
    totals.protein += Number(fav.protein)
    totals.carbs += Number(fav.carbs)
    totals.fat += Number(fav.fat)
    totals.meals += 1
  }
  return {
    kcal: Math.round(totals.kcal),
    protein: Math.round(totals.protein),
    carbs: Math.round(totals.carbs),
    fat: Math.round(totals.fat),
    meals: totals.meals,
  }
}

export interface DietSlotDay {
  slot: Slot
  options: string[]
  done: boolean // já há refeição registada nesta refeição do dia
  followed: string | null // a favorita da dieta que foi registada, se foi
}

// Como vai o dia: por cada refeição da dieta, se já foi registada e se foi
// uma das favoritas dela.
export function dietDay(
  meals: DietMeals,
  dayMeals: { slot: Slot; favorite_id: string | null }[],
): DietSlotDay[] {
  return dietSlots(meals).map((slot) => {
    const options = meals[slot]!
    const inSlot = dayMeals.filter((m) => m.slot === slot)
    const followed = inSlot.find((m) => m.favorite_id && options.includes(m.favorite_id))?.favorite_id ?? null
    return { slot, options, done: inSlot.length > 0, followed }
  })
}

// Juntar, tirar e passar a habitual numa refeição da dieta.
export function addOption(meals: DietMeals, slot: Slot, id: string): DietMeals {
  const list = meals[slot] ?? []
  if (list.includes(id) || list.length >= DIET_MAX_OPTIONS) return meals
  return { ...meals, [slot]: [...list, id] }
}

export function removeOption(meals: DietMeals, slot: Slot, id: string): DietMeals {
  const list = (meals[slot] ?? []).filter((x) => x !== id)
  const next = { ...meals }
  if (list.length > 0) next[slot] = list
  else delete next[slot]
  return next
}

export function makeHabitual(meals: DietMeals, slot: Slot, id: string): DietMeals {
  const list = meals[slot] ?? []
  if (!list.includes(id)) return meals
  return { ...meals, [slot]: [id, ...list.filter((x) => x !== id)] }
}
