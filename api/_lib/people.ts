import type { SupabaseClient } from '@supabase/supabase-js'

// As pessoas da casa (no máximo 4): o nome que cada uma escolheu, senão o
// início do email. Com o cliente de serviço (os perfis dos outros não se
// leem com o RLS).
//
// P7: o nome vem de `profile.display_name` (migração 20261113000040, mantido
// pela base de dados a partir da conta) e fica lembrado 5 min nesta
// instância da função; só sem a coluna, ou sem nome lá, se pergunta à API de
// Auth, como antes (uma ida por pessoa em cada partilha e pergunta).

const NAME_CACHE_MS = 5 * 60_000
const names = new Map<string, { name: string; until: number }>()

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function remember(userId: string, name: string): string {
  names.set(userId, { name, until: Date.now() + NAME_CACHE_MS })
  return name
}

async function nameFromAuth(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId)
  return clean(data.user?.user_metadata?.name) ?? data.user?.email?.split('@')[0] ?? 'Outra pessoa'
}

export async function personName(admin: SupabaseClient, userId: string): Promise<string> {
  const hit = names.get(userId)
  if (hit && hit.until > Date.now()) return hit.name
  // Sem a migração a coluna não existe: a leitura falha e vai-se ao Auth.
  const { data, error } = await admin.from('profile').select('display_name').eq('user_id', userId).maybeSingle()
  const stored = error ? null : clean((data as { display_name?: unknown } | null)?.display_name)
  return remember(userId, stored ?? (await nameFromAuth(admin, userId)))
}

// As outras pessoas da app, por ordem de criação.
export async function otherPeople(admin: SupabaseClient, userId: string): Promise<{ user_id: string; name: string }[]> {
  const withNames = await admin
    .from('profile')
    .select('user_id,display_name')
    .neq('user_id', userId)
    .order('created_at')
  const rows = withNames.error
    ? (await admin.from('profile').select('user_id').neq('user_id', userId).order('created_at')).data
    : withNames.data
  return Promise.all(
    ((rows ?? []) as { user_id: string; display_name?: unknown }[]).map(async (p) => {
      const stored = clean(p.display_name)
      return { user_id: p.user_id, name: stored ? remember(p.user_id, stored) : await personName(admin, p.user_id) }
    }),
  )
}
