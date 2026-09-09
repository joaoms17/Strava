// Regra 12: is_estimate = true em foto e "jantar fora";
// % de estimados visível na semana.

export function mealIsEstimate(
  inputType: 'text' | 'photo' | 'barcode' | 'manual',
  jantarFora: boolean,
  items: { estimated: boolean }[],
): boolean {
  if (inputType === 'photo') return true
  return jantarFora || items.some((i) => i.estimated)
}

export function estimatePct(meals: { is_estimate: boolean }[]): number | null {
  if (meals.length === 0) return null
  return Math.round((meals.filter((m) => m.is_estimate).length / meals.length) * 100)
}
