import { decimalFromText } from './campo-numero'
import type { TypedLabel } from '../../api/_lib/rules/off'

// O rótulo escrito à mão, a partir do texto dos campos: o rótulo quando tudo
// o que é preciso está escrito, e uma explicação quando um número não pode
// ser (em vez de o botão ficar só cinzento).
export interface LabelText {
  name: string
  kcal: string
  protein: string
  carbs: string
  fat: string
}

const MACROS_TOO_HIGH = 'Por 100 g, os macros não passam de 100 g.'

export function typedLabelFromText(t: LabelText): { label: TypedLabel | null; problem: string | null } {
  const kcal = decimalFromText(t.kcal, 0, Number.MAX_VALUE)
  const protein = decimalFromText(t.protein, 0, Number.MAX_VALUE)
  const optional = (s: string) => (s.trim() ? decimalFromText(s, 0, Number.MAX_VALUE) : null)
  const carbs = optional(t.carbs)
  const fat = optional(t.fat)
  if (kcal != null && kcal > 900) return { label: null, problem: 'Máx. 900 kcal por 100 g — escreveste os kJ?' }
  if ([protein, carbs, fat].some((v) => v != null && v > 100)) return { label: null, problem: MACROS_TOO_HIGH }
  if (!t.name.trim() || kcal == null || protein == null) return { label: null, problem: null }
  return { label: { name: t.name, kcal_100g: kcal, protein_100g: protein, carbs_100g: carbs, fat_100g: fat }, problem: null }
}
