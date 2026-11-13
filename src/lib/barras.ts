import type { MealItem } from './types'

// H17: os produtos lidos no código de barras ficam guardados no telemóvel
// até se gravarem: fechar a folha (ou o gesto de voltar) já não os perde.
// Ao fim de 12 horas deixam de valer (já não são desta refeição).
export const BASKET_KEY = 'regresso.cesto-barras'
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export function basketToStore(items: MealItem[], now: Date): string | null {
  return items.length ? JSON.stringify({ at: now.getTime(), items }) : null
}

export function basketFromStore(raw: string | null, now: Date): MealItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { at?: unknown; items?: unknown }
    if (typeof parsed.at !== 'number' || now.getTime() - parsed.at > MAX_AGE_MS || parsed.at > now.getTime() + 60_000) return []
    if (!Array.isArray(parsed.items)) return []
    return parsed.items.filter(
      (i): i is MealItem =>
        !!i && typeof i === 'object' && typeof (i as MealItem).name === 'string' && Number.isFinite((i as MealItem).kcal),
    )
  } catch {
    return []
  }
}

// As gramas escritas à mão: de 1 em 1, entre 1 e 5 000 (vazio ou lixo: null).
export function gramsFromInput(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null
  return Math.min(5000, Math.max(1, Math.round(n)))
}
