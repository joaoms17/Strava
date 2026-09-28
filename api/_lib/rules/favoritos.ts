// Favoritos de refeição: registar com 1 toque, sem IA. Os totais saem sempre
// dos itens (decisão 20), escalados pela porção escolhida (½ · 1 · 1½ · 2).
import { round1, type MealItem } from './meal-totals.js'
import type { Slot } from './momentos.js'

export const PORTION_FACTORS = [0.5, 1, 1.5, 2] as const

export function scaleItems(items: MealItem[], factor: number): MealItem[] {
  return items.map((item) => ({
    ...item,
    grams: round1(item.grams * factor),
    kcal: round1(item.kcal * factor),
    protein: round1(item.protein * factor),
    carbs: round1(item.carbs * factor),
    fat: round1(item.fat * factor),
  }))
}

// Mudar a porção de uma refeição já registada: volta à porção 1 e aplica a nova.
export function rescaleItems(items: MealItem[], fromFactor: number, toFactor: number): MealItem[] {
  if (fromFactor <= 0) return scaleItems(items, toFactor)
  return scaleItems(items, toFactor / fromFactor)
}

export interface RankableFavorite {
  id: string
  default_slot: Slot | null
  use_count: number
  last_used_at: string | null
}

// Os mais prováveis para a hora: primeiro os do momento atual, depois os mais
// usados, depois os usados mais recentemente.
export function rankFavorites<T extends RankableFavorite>(favorites: T[], slot: Slot): T[] {
  return [...favorites].sort((a, b) => {
    const slotA = a.default_slot === slot ? 0 : 1
    const slotB = b.default_slot === slot ? 0 : 1
    if (slotA !== slotB) return slotA - slotB
    if (a.use_count !== b.use_count) return b.use_count - a.use_count
    return (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '')
  })
}

// Nome curto para um favorito novo, a partir dos itens («Iogurte + aveia + banana»).
export function favoriteName(items: { name: string }[]): string {
  const names = items.map((i) => i.name.trim()).filter(Boolean)
  if (names.length === 0) return 'Refeição'
  const shown = names.slice(0, 3).join(' + ')
  return names.length > 3 ? `${shown} + …` : shown
}
