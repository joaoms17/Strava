import { supabase } from './supabase'
import { useReadyProfile } from './profile'
import { emitDataChanged } from './events'
import { parsePlanoTreino, planFavorite, type PlanoDia, type PlanoTreino } from '../../api/_lib/rules/plano-treino'
import type { Favorite } from './types'

// O plano de treino da pessoa (profile.goals.plano_treino; decisão 305). Vem
// com o perfil, que fica guardado no telemóvel: lê-se no ginásio sem rede.
// Quem não tem plano (a Joana) recebe null e não vê nada.
export function usePlanoTreino(): PlanoTreino | null {
  const profile = useReadyProfile()
  return parsePlanoTreino(profile.goals?.plano_treino)
}

// «Começar Dia N»: o teu treino «Fase 1 · Dia N» (o mesmo nome e os mesmos
// exercícios do SQL que o semeia). Se ainda não existir, cria-o — uma vez só:
// procura-se pelo nome antes de criar. Devolve o id para abrir o Ginásio.
export async function ensurePlanFavorite(day: PlanoDia): Promise<string> {
  const { data: found, error } = await supabase
    .from('favorites')
    .select('id,name,workout')
    .eq('kind', 'workout')
    .eq('archived', false)
    .eq('name', day.favorito)
    .limit(1)
  if (error) throw new Error('Não consegui abrir o treino. Vê a rede e tenta outra vez.')
  const existing = (found ?? []) as Pick<Favorite, 'id' | 'name' | 'workout'>[]
  if (existing[0]) return existing[0].id
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sem sessão. Entra outra vez.')
  const row = planFavorite(day)
  const { data, error: insertError } = await supabase
    .from('favorites')
    .insert({ user_id: user.id, kind: 'workout', name: row.name, kcal: row.kcal, workout: row.workout })
    .select('id')
    .single()
  if (insertError || !data) throw new Error('Não consegui criar o treino. Tenta outra vez.')
  emitDataChanged()
  return (data as { id: string }).id
}
