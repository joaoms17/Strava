import type { SupabaseClient } from '@supabase/supabase-js'

// As pessoas da casa (no máximo 4): o nome que cada uma escolheu, senão o
// início do email. Com o cliente de serviço (os perfis dos outros não se
// leem com o RLS).

export async function personName(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId)
  const name = data.user?.user_metadata?.name
  return typeof name === 'string' && name.trim() ? name.trim() : (data.user?.email?.split('@')[0] ?? 'Outra pessoa')
}

// As outras pessoas da app, por ordem de criação.
export async function otherPeople(admin: SupabaseClient, userId: string): Promise<{ user_id: string; name: string }[]> {
  const { data } = await admin.from('profile').select('user_id').neq('user_id', userId).order('created_at')
  return Promise.all(
    (data ?? []).map(async (p) => ({ user_id: p.user_id as string, name: await personName(admin, p.user_id as string) })),
  )
}
