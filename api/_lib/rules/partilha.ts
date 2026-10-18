// Partilhar uma refeição com outra pessoa da casa (decisões 182 e 211): a
// cópia leva a nota «Partilhada por <nome>», que é por onde o Hoje e o Rever
// de quem recebe a reconhecem. Sem imports de servidor: o telemóvel usa este
// ficheiro diretamente.

const PREFIX = 'Partilhada por '

// A casa tem no máximo 4 pessoas: partilha-se com 3, no máximo.
export const MAX_SHARE_WITH = 3

export function sharedNote(fromName: string): string {
  return `${PREFIX}${fromName.trim() || 'outra pessoa'}`
}

// Quem partilhou esta refeição («João»), ou null se não é uma cópia.
export function sharedFrom(note: string | null | undefined): string | null {
  if (!note?.startsWith(PREFIX)) return null
  const name = note.slice(PREFIX.length).trim()
  return name || null
}

// «Também para …» ao registar: cada pessoa uma vez, nunca a própria.
export function shareTargets(ids: readonly string[] | null | undefined, selfId: string): string[] {
  const out: string[] = []
  for (const id of ids ?? []) {
    if (id && id !== selfId && !out.includes(id)) out.push(id)
  }
  return out.slice(0, MAX_SHARE_WITH)
}
