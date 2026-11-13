// G1: quem é «da casa». Com HOUSE_EMAILS (emails separados por vírgulas,
// espaços ou linhas) só entra quem está na lista ou já tem perfil (as pessoas
// criadas em Definições › Pessoas têm perfil logo). Sem a variável, qualquer
// conta do Supabase Auth do projeto, como sempre (o registo de contas tem de
// estar desligado no painel: README).

export function houseEmails(raw: string | undefined): Set<string> | null {
  const list = (raw ?? '')
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  return list.length ? new Set(list) : null
}

// Entra sem precisar de ver o perfil? (sem lista, ou com o email na lista)
export function houseByEmail(email: string | null | undefined, list: Set<string> | null): boolean {
  if (!list) return true
  return email != null && list.has(email.trim().toLowerCase())
}
