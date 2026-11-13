// Pequenas contas e constantes que várias regras usam (L20): estavam
// copiadas em 6–8 ficheiros, com o risco de uma cópia mudar e as outras não.

// Energia de 1 kg de gordura (kcal): o défice que vale um quilo.
export const KCAL_PER_KG = 7700

// Uma casa decimal (81,24 → 81,2).
export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Média dos números válidos (sem null, undefined nem NaN); sem nenhum, null.
export function mean(values: readonly (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

// Sem acentos («Pão» → «Pao»), para comparar nomes escritos à mão.
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// A chave de um nome: sem acentos, em minúsculas e sem espaços nas pontas.
export function fold(s: string): string {
  return stripAccents(s).toLowerCase().trim()
}
