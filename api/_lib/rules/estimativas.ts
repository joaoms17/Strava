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
