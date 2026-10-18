// Favoritos de refeição: registar com 1 toque, sem IA. Os totais saem sempre
// dos itens (decisão 20), escalados pela porção escolhida (½ · 1 · 1½ · 2).
import { round1, type MealItem } from './meal-totals.js'
import { rankDishes } from './menu.js'
import type { Slot } from './momentos.js'

export const PORTION_FACTORS = [0.5, 1, 1.5, 2] as const

// «½», «1», «1½», «2» (o que se mostra nos botões e nos avisos).
export function portionLabel(factor: number): string {
  const whole = Math.floor(factor)
  const half = factor - whole === 0.5
  if (!half) return String(factor).replace('.', ',')
  return whole === 0 ? '½' : `${whole}½`
}

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

// A grelha das favoritas do ＋: as mais prováveis para a hora, sem as que já
// aparecem em cima («Da tua dieta»), para os lugares não se repetirem.
export function favoritesGrid<T extends RankableFavorite>(
  favorites: T[],
  slot: Slot,
  shownAbove: readonly string[] = [],
  max = 6,
): T[] {
  const above = new Set(shownAbove)
  return rankFavorites(favorites.filter((f) => !above.has(f.id)), slot).slice(0, max)
}

// O cartão da proteína no Hoje: as favoritas com proteína (15 g ou mais) que
// cabem no que falta comer hoje, pela proteína por caloria (como os pratos do
// menu, rankDishes); as que passam só entram depois, das mais leves.
export const PROTEIN_PICK_MIN_G = 15

export function proteinPicks<T extends { kcal: number; protein: number; carbs: number; fat: number }>(
  favorites: T[],
  kcalLeft: number | null,
  max = 3,
): T[] {
  const pool = favorites.filter((f) => Number(f.protein) >= PROTEIN_PICK_MIN_G && Number(f.kcal) > 0)
  const dishes = pool.map((f, i) => ({
    name: String(i),
    type: 'prato' as const,
    description: null,
    grams: null,
    kcal: Number(f.kcal),
    protein: Number(f.protein),
    carbs: Number(f.carbs),
    fat: Number(f.fat),
    price: null,
  }))
  return rankDishes(dishes, kcalLeft)
    .slice(0, max)
    .map((d) => pool[Number(d.name)]!)
}

// Nome curto para um favorito novo, a partir dos itens («Iogurte + aveia + banana»).
export function favoriteName(items: { name: string }[]): string {
  const names = items.map((i) => i.name.trim()).filter(Boolean)
  if (names.length === 0) return 'Refeição'
  const shown = names.slice(0, 3).join(' + ')
  return names.length > 3 ? `${shown} + …` : shown
}

// O nome que se reconhece de uma refeição registada: o da favorita, senão os
// alimentos, senão o texto escrito.
export function mealName(meal: { input_type: string; raw_text: string | null; items: { name: string }[] }): string {
  if (meal.input_type === 'favorite' && meal.raw_text) return meal.raw_text
  const names = meal.items.map((i) => i.name).filter(Boolean)
  return names.length > 0 ? names.join(', ') : (meal.raw_text ?? 'Refeição')
}

// Sugestão de favorito: a 3.ª refeição parecida no mesmo momento do dia em
// 30 dias (Jaccard ≥ 70 % nos nomes dos itens).
export const SIMILAR_THRESHOLD = 0.7
export const SIMILAR_MIN_COUNT = 3

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function itemNameSet(items: { name: string }[]): Set<string> {
  return new Set(items.map((i) => normalize(i.name)).filter(Boolean))
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let common = 0
  for (const x of a) if (b.has(x)) common++
  return common / (a.size + b.size - common)
}

// Quantas refeições (a própria incluída) se parecem com esta.
export function similarCount(target: { name: string }[], others: { name: string }[][]): number {
  const set = itemNameSet(target)
  return 1 + others.filter((items) => jaccard(set, itemNameSet(items)) >= SIMILAR_THRESHOLD).length
}

// Chave estável do padrão, para «Não voltar a perguntar».
export function patternKey(items: { name: string }[]): string {
  return `fav:${[...itemNameSet(items)].sort().join('|')}`
}
