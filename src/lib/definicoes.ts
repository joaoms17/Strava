// Regras pequenas das Definições, separadas do ecrã para se poderem testar.

// H14: um campo numérico está «por guardar» quando o que está escrito já não
// é o valor gravado (1,5 e 1.5 contam como iguais; vazio = sem valor).
export function campoMudou(escrito: string | undefined, gravado: unknown): boolean {
  const raw = (escrito ?? '').trim().replace(',', '.')
  if (gravado == null || gravado === '') return raw !== ''
  if (raw === '') return true
  const n = Number(raw)
  return !Number.isFinite(n) || n !== Number(gravado)
}

// As potências da bicicleta escritas («130 · 140 · 150») contra as gravadas.
export function lerPotencias(escrito: string): number[] {
  return [...new Set(escrito.split(/[^\d]+/).map(Number).filter((n) => n >= 30 && n <= 500))].sort((a, b) => a - b)
}

export function potenciasMudaram(escrito: string, gravadas: number[] | null | undefined): boolean {
  const lidas = lerPotencias(escrito)
  const antes = [...(gravadas ?? [])].sort((a, b) => a - b)
  return lidas.length !== antes.length || lidas.some((n, i) => n !== antes[i])
}

// H14 e ideia 7: a secção Bicicleta só aparece a quem anda de bicicleta (tem
// potências escritas ou algum treino de bicicleta) e o Atalho do iPhone só a
// quem já mandou dados por ele. Quem não os usa encontra-os em «Mais».
export function usaBicicleta(input: { potencias?: number[] | null; treinosBicicleta: number }): boolean {
  return (input.potencias?.length ?? 0) > 0 || input.treinosBicicleta > 0
}
