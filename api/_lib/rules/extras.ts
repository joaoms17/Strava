// Proteína por refeição, água e lista de compras: regras puras (o telemóvel
// usa-as diretamente). Sem supabase nem node.
import type { MealItem } from './meal-totals.js'
import type { Slot } from './momentos.js'

// --- Proteína por refeição -------------------------------------------------
// Média de proteína em cada refeição, nos dias em que essa refeição existiu.
export function proteinBySlot(
  meals: { date: string; slot: Slot | null; protein: number | null }[],
): { slot: Slot; avg: number; days: number }[] {
  const perDay = new Map<Slot, Map<string, number>>()
  for (const m of meals) {
    if (!m.slot) continue
    const days = perDay.get(m.slot) ?? new Map<string, number>()
    days.set(m.date, (days.get(m.date) ?? 0) + Number(m.protein ?? 0))
    perDay.set(m.slot, days)
  }
  return [...perDay.entries()].map(([slot, days]) => {
    const values = [...days.values()]
    return { slot, avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length), days: values.length }
  })
}

// --- Água -----------------------------------------------------------------
export const GLASS_ML = 250

// Meta diária: 35 ml por kg, a copos de 250 ml, entre 1,5 e 4 L (2 L sem peso).
export function waterGoalMl(weightKg: number | null): number {
  if (weightKg == null || !(weightKg > 0)) return 2000
  return Math.min(4000, Math.max(1500, Math.round((35 * weightKg) / GLASS_ML) * GLASS_ML))
}

// --- Lista de compras -----------------------------------------------------
export interface ShoppingLine {
  name: string
  grams: number // 0 quando o item não tem gramas (ex.: «1 ovo»)
  times: number // quantas vezes aparece
}

// Junta os alimentos das favoritas escolhidas (cada uma × vezes) pelo nome,
// soma as gramas (arredondadas a 10 g) e ordena por nome.
export function shoppingList(selection: { items: MealItem[]; times: number }[]): ShoppingLine[] {
  const lines = new Map<string, ShoppingLine>()
  for (const { items, times } of selection) {
    if (!(times > 0)) continue
    for (const item of items) {
      const name = item.name.trim()
      if (!name) continue
      const key = name.toLocaleLowerCase('pt')
      const line = lines.get(key) ?? { name, grams: 0, times: 0 }
      line.grams += Math.max(0, Number(item.grams) || 0) * times
      line.times += times
      lines.set(key, line)
    }
  }
  return [...lines.values()]
    .map((l) => ({ ...l, grams: Math.ceil(l.grams / 10) * 10 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
}

export function shoppingText(lines: ShoppingLine[]): string {
  return lines
    .map((l) => `• ${l.name}${l.grams > 0 ? ` — ${l.grams >= 1000 ? `${(l.grams / 1000).toFixed(1).replace('.', ',')} kg` : `${l.grams} g`}` : l.times > 1 ? ` × ${l.times}` : ''}`)
    .join('\n')
}
