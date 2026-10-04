import { supabase } from './supabase'
import { cleanDietMeals, type DietMeals } from '../../api/_lib/rules/dieta'
import type { Diet } from './types'

// Dietas (migração 10). Sem a tabela, a app continua igual: a dieta só
// aparece depois de correr a migração.

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /diets/.test(error.message ?? '')
}

function normalize(row: Diet): Diet {
  return { ...row, meals: cleanDietMeals(row.meals) }
}

export async function loadDiets(): Promise<{ diets: Diet[]; missing: boolean }> {
  const { data, error } = await supabase
    .from('diets')
    .select('*')
    .eq('archived', false)
    .order('active', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) return { diets: [], missing: missingTable(error) }
  return { diets: ((data ?? []) as Diet[]).map(normalize), missing: false }
}

export async function loadActiveDiet(): Promise<Diet | null> {
  const { data, error } = await supabase
    .from('diets')
    .select('*')
    .eq('active', true)
    .eq('archived', false)
    .limit(1)
  if (error || !data?.[0]) return null
  return normalize(data[0] as Diet)
}

export async function loadDiet(id: string): Promise<Diet | null> {
  const { data } = await supabase.from('diets').select('*').eq('id', id).maybeSingle()
  return data ? normalize(data as Diet) : null
}

// Só uma seguida de cada vez: primeiro deixa de seguir as outras.
async function clearActive(exceptId: string | null) {
  let query = supabase.from('diets').update({ active: false }).eq('active', true)
  if (exceptId) query = query.neq('id', exceptId)
  const { error } = await query
  if (error) throw new Error(missingTable(error) ? MISSING_TEXT : 'Não consegui guardar a dieta.')
}

export const MISSING_TEXT = 'Falta correr a migração 10 (dietas) no Supabase.'

export async function saveDiet(input: { id: string | null; name: string; meals: DietMeals; active: boolean }): Promise<string> {
  if (input.active) await clearActive(input.id)
  const row = {
    name: input.name.trim().slice(0, 60) || 'A minha dieta',
    meals: input.meals,
    active: input.active,
    updated_at: new Date().toISOString(),
  }
  if (input.id) {
    const { error } = await supabase.from('diets').update(row).eq('id', input.id)
    if (error) throw new Error(missingTable(error) ? MISSING_TEXT : 'Não consegui guardar a dieta.')
    return input.id
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sessão expirada. Volta a entrar.')
  const id = crypto.randomUUID()
  const { error } = await supabase.from('diets').insert({ id, user_id: user.id, archived: false, ...row })
  if (error) throw new Error(missingTable(error) ? MISSING_TEXT : 'Não consegui guardar a dieta.')
  return id
}

export async function followDiet(id: string | null): Promise<void> {
  await clearActive(id)
  if (id) {
    const { error } = await supabase.from('diets').update({ active: true }).eq('id', id)
    if (error) throw new Error('Não consegui mudar a dieta.')
  }
}

export async function archiveDiet(id: string, archived = true): Promise<void> {
  const { error } = await supabase.from('diets').update({ archived, active: false }).eq('id', id)
  if (error) throw new Error('Não consegui apagar a dieta.')
}

// Rascunho da dieta enquanto se cria uma favorita nova a meio (a folha da
// dieta fecha e volta a abrir com a favorita já na refeição).
const DRAFT_KEY = 'regresso.dieta-rascunho'

export interface DietDraft {
  id: string | null
  name: string
  meals: DietMeals
  active: boolean
  slot: string | null
}

export function saveDietDraft(draft: DietDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // sem armazenamento: perde-se só o rascunho
  }
}

export function peekDietDraft(): DietDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as DietDraft) : null
  } catch {
    return null
  }
}

export function clearDietDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // nada a fazer
  }
}
