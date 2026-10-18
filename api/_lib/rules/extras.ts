// Proteína por refeição, água, lista de compras e o que se come depois de
// noites más ou com poucos passos: regras puras (o telemóvel usa-as
// diretamente). Sem supabase nem node.
import type { MealItem } from './meal-totals.js'
import type { Slot } from './momentos.js'
import { hasSleep, poorNight, type NightSleep } from './sono.js'

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

// Litros no cartão, sem zeros a mais: 0 → «0», 1250 → «1,25», 1500 → «1,5»,
// 2000 → «2», 10000 → «10» (antes o 0 ficava em branco: « de 3 L»).
export function litersText(ml: number): string {
  return (Math.max(0, ml) / 1000).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')
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

// --- Comer, sono e passos (Balanço › Mês) ----------------------------------
// Nos dias completos: o que se comeu depois de noites más (pontuação abaixo de
// 60, qualidade fraca ou menos de 6 h) contra os outros dias, e nos dias com
// menos passos (abaixo da mediana) contra os outros. Só com 4 dias ou mais em
// cada grupo. `diff` (a 10) positivo = comeu mais no primeiro grupo.
export const LINK_MIN_DAYS = 4

export interface IntakeLink {
  diff: number
  days: number
}

function compareIntake(rows: { kcal: number; inGroup: boolean }[]): IntakeLink | null {
  const group = rows.filter((r) => r.inGroup).map((r) => r.kcal)
  const others = rows.filter((r) => !r.inGroup).map((r) => r.kcal)
  if (group.length < LINK_MIN_DAYS || others.length < LINK_MIN_DAYS) return null
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  return { diff: Math.round((mean(group) - mean(others)) / 10) * 10, days: group.length }
}

export function intakeLinks(
  completeDays: { date: string; kcal_in: number }[],
  health: ({ date: string; steps?: number | null } & Partial<NightSleep>)[],
): { sleep: IntakeLink | null; steps: (IntakeLink & { below: number }) | null } {
  const byDate = new Map(health.map((h) => [h.date, h]))
  const nights = completeDays.flatMap((d) => {
    const h = byDate.get(d.date)
    return hasSleep(h) ? [{ kcal: Number(d.kcal_in), inGroup: poorNight(h) }] : []
  })
  const walked = completeDays.flatMap((d) => {
    const steps = byDate.get(d.date)?.steps
    return steps != null && steps > 0 ? [{ kcal: Number(d.kcal_in), steps }] : []
  })
  const sorted = walked.map((d) => d.steps).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const steps = compareIntake(walked.map((d) => ({ kcal: d.kcal, inGroup: d.steps < median })))
  return {
    sleep: compareIntake(nights),
    steps: steps ? { ...steps, below: Math.round(median / 100) * 100 } : null,
  }
}
