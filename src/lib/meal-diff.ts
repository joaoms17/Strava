import { fmtInt, fmtKcal } from './format'
import type { MealItem } from './types'

// «Arroz 180 → 90 g · menos 115 kcal»: o que uma correção mudou, numa linha.
export function diffText(before: MealItem[], after: MealItem[]): string {
  const parts: string[] = []
  for (const item of after) {
    const old = before.find((b) => b.name === item.name)
    if (old && Math.round(old.grams) !== Math.round(item.grams)) {
      parts.push(`${item.name} ${fmtInt(old.grams)} → ${fmtInt(item.grams)} g`)
    }
  }
  for (const item of before) if (!after.some((a) => a.name === item.name)) parts.push(`sem ${item.name.toLowerCase()}`)
  for (const item of after) if (!before.some((b) => b.name === item.name)) parts.push(`+ ${item.name.toLowerCase()}`)
  const total = (items: MealItem[]) => items.reduce((acc, i) => acc + i.kcal, 0)
  const delta = total(after) - total(before)
  const kcal =
    Math.abs(delta) < 5 ? 'as mesmas kcal' : delta < 0 ? `menos ${fmtKcal(-delta)} kcal` : `mais ${fmtKcal(delta)} kcal`
  return [...parts.slice(0, 2), kcal].join(' · ')
}

// Passos de 10 g num item: kcal e macros escalam na mesma proporção.
export function stepItem(item: MealItem, deltaGrams: number): MealItem {
  if (item.grams <= 0) return item
  const grams = Math.max(5, item.grams + deltaGrams)
  const k = grams / item.grams
  const r = (n: number) => Math.round(n * k * 10) / 10
  return { ...item, grams, kcal: r(item.kcal), protein: r(item.protein), carbs: r(item.carbs), fat: r(item.fat), estimated: false, confidence: 'alta' }
}
