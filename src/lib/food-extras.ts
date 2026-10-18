import { fmt1, fmtInt } from './format'
import type { Food } from './types'

// O resto do rótulo de um produto (código de barras ou rótulo lido), para os
// gramas escolhidos: «Nutri-Score A · fibra 2 g · açúcares 5 g · saturada
// 1 g · sal 0,2 g». Vazio quando não se sabe nada disto.
export function foodExtrasText(food: Food, grams = 100): string {
  const at = (per100: number | null | undefined) => (per100 == null ? null : (Number(per100) * grams) / 100)
  const grams1 = (n: number) => (n < 10 ? fmt1(n) : fmtInt(n))
  const parts: string[] = []
  if (food.nutriscore) parts.push(`Nutri-Score ${food.nutriscore.toUpperCase()}`)
  for (const [label, value] of [
    ['fibra', at(food.fiber_100g)],
    ['açúcares', at(food.sugars_100g)],
    ['saturada', at(food.sat_fat_100g)],
    ['sal', at(food.salt_100g)],
  ] as const) {
    if (value != null) parts.push(`${label} ${grams1(value)} g`)
  }
  return parts.join(' · ')
}
