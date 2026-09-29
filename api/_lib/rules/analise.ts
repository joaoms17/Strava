// Resultado de uma análise de refeição → itens, estado e estimativa.
import { round1, type MealItem } from './meal-totals.js'

export type Confidence = 'alta' | 'media' | 'baixa'
export type MealStatus = 'a_analisar' | 'por_rever' | 'ok' | 'erro' | 'sem_analise'

export interface AnalysedItem {
  name: string
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  confidence: Confidence
  food_ref: string | null
}

// Os alimentos pessoais vão para o prompt com referências curtas (a1…a40).
export function foodRefs(foodIds: string[]): { refs: Record<string, string>; byId: Map<string, string> } {
  const refs: Record<string, string> = {}
  const byId = new Map<string, string>()
  foodIds.forEach((id, i) => {
    refs[`a${i + 1}`] = id
    byId.set(id, `a${i + 1}`)
  })
  return { refs, byId }
}

const nonNegative = (n: number) => (Number.isFinite(n) && n > 0 ? round1(n) : 0)

export function toMealItems(items: AnalysedItem[], refs: Record<string, string>): MealItem[] {
  return items
    .filter((item) => item.name.trim())
    .map((item) => ({
      name: item.name.trim(),
      grams: nonNegative(item.grams),
      kcal: nonNegative(item.kcal),
      protein: nonNegative(item.protein),
      carbs: nonNegative(item.carbs),
      fat: nonNegative(item.fat),
      food_id: item.food_ref ? (refs[item.food_ref] ?? null) : null,
      estimated: item.confidence !== 'alta',
      confidence: item.confidence,
    }))
}

// Por rever quando algum item tem confiança baixa ou a refeição não é «alta».
// Contam as duas (ok e por_rever); as por rever aparecem com ≈ e «confirma».
export function analysedStatus(items: { confidence?: Confidence }[], mealConfidence: Confidence): MealStatus {
  if (items.length === 0) return 'erro'
  if (mealConfidence !== 'alta' || items.some((i) => i.confidence === 'baixa')) return 'por_rever'
  return 'ok'
}

// Escrita final protegida: só grava se a análise ainda for a mesma
// (analysis_started_at) e a nota não tiver mudado entretanto. Se a nota mudou,
// aplica a correção com a nota nova e tenta outra vez (no máximo 2 vezes).
export interface GuardedWriteDeps<T> {
  write: (items: MealItem[], noteUsed: string | null) => Promise<T | null>
  reread: () => Promise<{ note: string | null; startedAt: string | null; deleted: boolean } | null>
  correct: (items: MealItem[], note: string) => Promise<MealItem[]>
}

export async function guardedWrite<T>(
  items: MealItem[],
  noteUsed: string | null,
  claimedAt: string,
  deps: GuardedWriteDeps<T>,
  maxCorrections = 2,
): Promise<T | null> {
  let current = items
  let note = noteUsed
  for (let attempt = 0; attempt <= maxCorrections; attempt++) {
    const written = await deps.write(current, note)
    if (written) return written
    const fresh = await deps.reread()
    // Apagada, ou outra tentativa reivindicou a análise: essa é que manda.
    if (!fresh || fresh.deleted || fresh.startedAt !== claimedAt) return null
    if (fresh.note === note) return null
    note = fresh.note
    if (note) current = await deps.correct(current, note)
  }
  return null
}
