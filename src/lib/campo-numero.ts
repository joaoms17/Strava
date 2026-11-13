// Campos de números escritos à mão (a carga e as repetições no Ginásio, as
// séries e as repetições dos teus treinos). O campo guarda o texto enquanto
// se escreve e só o número válido passa para o registo: «12,» fica no campo
// até se escrever o 5 (antes voltava a «12» e o 5 dava «125»), e apagar tudo
// deixa o campo vazio em vez de saltar para 1 (8 → apagar → 6 dava 16) — T6, T23.

// Só algarismos e um separador decimal (vírgula ou ponto), com `decimals`
// casas no máximo.
export function cleanDecimalText(text: string, decimals = 2): string {
  const kept = text.replace(/[^\d,.]/g, '')
  const at = kept.search(/[,.]/)
  if (at < 0) return kept
  const whole = kept.slice(0, at)
  const fraction = kept.slice(at + 1).replace(/[,.]/g, '').slice(0, decimals)
  return `${whole}${kept[at]}${fraction}`
}

// O número do texto, dentro de [min, max]; vazio ou fora dele dá null.
export function decimalFromText(text: string, min: number, max: number): number | null {
  const clean = text.trim().replace(',', '.')
  if (!clean || clean === '.') return null
  const n = Number(clean)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

export function intFromText(text: string, min: number, max: number): number | null {
  const digits = text.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

// Como se mostra um número guardado: com vírgula.
export function decimalText(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',')
}
