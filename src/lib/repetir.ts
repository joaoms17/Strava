import { slotOf } from '../../api/_lib/rules/momentos'
import type { Meal } from './types'

// Refeições de outros dias para repetir: só as que têm conta (analisadas).
export type RepeatSource = Pick<
  Meal,
  'id' | 'date' | 'logged_at' | 'slot' | 'input_type' | 'raw_text' | 'items' | 'kcal' | 'protein' | 'status'
>

export function repeatable(meal: RepeatSource): boolean {
  return (meal.status === 'ok' || meal.status === 'por_rever') && meal.items.length > 0 && Number(meal.kcal) > 0
}

// O nome que se reconhece: o do favorito, senão os alimentos.
export function mealName(meal: Pick<Meal, 'input_type' | 'raw_text' | 'items'>): string {
  if (meal.input_type === 'favorite' && meal.raw_text) return meal.raw_text
  const names = meal.items.map((i) => i.name).filter(Boolean)
  return names.length > 0 ? names.join(', ') : (meal.raw_text ?? 'Refeição')
}

export function mealSlot(meal: Pick<Meal, 'slot' | 'logged_at'>) {
  return meal.slot ?? slotOf(new Date(meal.logged_at))
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Procura em todas as palavras («frango arroz» encontra «Arroz com frango»).
export function searchMeals<T extends RepeatSource>(meals: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return meals
  return meals.filter((meal) => {
    const haystack = fold(`${mealName(meal)} ${meal.raw_text ?? ''}`)
    return words.every((w) => haystack.includes(w))
  })
}

// Por dia, do mais recente para o mais antigo; dentro do dia pela hora.
export function groupByDay<T extends RepeatSource>(meals: T[]): { date: string; meals: T[] }[] {
  const byDay = new Map<string, T[]>()
  for (const meal of meals) {
    const list = byDay.get(meal.date) ?? []
    list.push(meal)
    byDay.set(meal.date, list)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({ date, meals: list.sort((a, b) => a.logged_at.localeCompare(b.logged_at)) }))
}

// As que mais se repetem (mesmo nome e mais ou menos as mesmas kcal), a
// mais recente de cada; só as que aparecem pelo menos 2 vezes.
export function frequentMeals<T extends RepeatSource>(meals: T[], limit = 6): { meal: T; count: number }[] {
  const groups = new Map<string, { meal: T; count: number }>()
  for (const meal of meals) {
    const key = `${fold(mealName(meal))}|${Math.round(Number(meal.kcal) / 50)}`
    const current = groups.get(key)
    if (!current) groups.set(key, { meal, count: 1 })
    else {
      current.count += 1
      if (meal.logged_at > current.meal.logged_at) current.meal = meal
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.meal.logged_at.localeCompare(a.meal.logged_at))
    .slice(0, limit)
}
