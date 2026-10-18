import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { mealTotals, type MealItem } from '../_lib/rules/meal-totals.js'
import { shareTargets, sharedNote } from '../_lib/rules/partilha.js'

// Partilhar uma refeição com outra pessoa da app (ex.: o João e a Joana a
// comer o mesmo): copia-a para a conta dela, no mesmo dia, refeição e hora,
// com as fotos copiadas para a pasta dela. A cópia entra por rever (com as
// quantidades de quem partilhou, que ela ajusta em «Rever») e guarda a
// refeição de origem: partilhar outra vez a mesma não a duplica.
// A app é de uma casa (no máximo 4 pessoas): quem tem sessão pode partilhar
// com qualquer outro perfil.

const ShareSchema = z.object({ meal_id: z.string().uuid(), to_user_id: z.string().uuid() })

async function personName(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId)
  const name = data.user?.user_metadata?.name
  return typeof name === 'string' && name.trim() ? name.trim() : (data.user?.email?.split('@')[0] ?? 'Outra pessoa')
}

// GET /api/meal/people: as outras pessoas da app, para «Partilhar com …».
// Com ?meal_id= (uma refeição de quem pede), diz também com quem já está
// partilhada, para a folha mostrar «Partilhada com … ✓» ao abrir.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function people(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const admin = adminClient()
    const { data } = await admin.from('profile').select('user_id').neq('user_id', user.id).order('created_at')
    const mealId = typeof req.query.meal_id === 'string' && UUID.test(req.query.meal_id) ? req.query.meal_id : null
    const sharedWith = new Set<string>()
    if (mealId) {
      // Só de uma refeição sua (RLS): as cópias são das outras pessoas.
      const { data: own } = await db.from('meals').select('id').eq('id', mealId).maybeSingle()
      if (own) {
        const { data: copies } = await admin
          .from('meals')
          .select('user_id')
          .eq('source_meal_id', mealId)
          .neq('user_id', user.id)
          .is('deleted_at', null)
        for (const copy of copies ?? []) sharedWith.add(copy.user_id as string)
      }
    }
    const list = await Promise.all(
      (data ?? []).map(async (p) => ({
        user_id: p.user_id as string,
        name: await personName(admin, p.user_id as string),
        shared: sharedWith.has(p.user_id as string),
      })),
    )
    res.status(200).json({ people: list })
  } catch (err) {
    respondError(res, err)
  }
}

// O caminho da foto copiada: a mesma, na pasta de quem recebe.
export function sharedPath(path: string, toUserId: string, newMealId: string): string {
  const name = path.split('/').pop() ?? 'foto.jpg'
  return `${toUserId}/partilhada-${newMealId}/${name}`
}

// Copia uma refeição analisada (linha de `meals`) para outra pessoa, por
// rever. Uma refeição já partilhada com essa pessoa não se copia outra vez.
export async function copyMealTo(
  admin: SupabaseClient,
  source: Record<string, unknown>,
  toUserId: string,
  fromName: string,
): Promise<{ already: boolean }> {
  const { data: already } = await admin
    .from('meals')
    .select('id')
    .eq('user_id', toUserId)
    .eq('source_meal_id', source.id as string)
    .is('deleted_at', null)
    .limit(1)
  if (already?.length) return { already: true }

  const items = source.items as MealItem[]
  const { data: meal, error } = await admin
    .from('meals')
    .insert({
      user_id: toUserId,
      input_type: 'repeat',
      raw_text: source.raw_text,
      note: sharedNote(fromName),
      tags: source.tags ?? [],
      portion_factor: source.portion_factor ?? 1,
      is_estimate: source.is_estimate,
      confidence: source.confidence,
      date: source.date,
      logged_at: source.logged_at,
      slot: source.slot,
      source_meal_id: source.id,
      status: 'por_rever',
      items,
      ...mealTotals(items),
    })
    .select()
    .single()
  if (error || !meal) throw new HttpError(500, error?.message ?? 'Não consegui partilhar.')

  // Fotos: copia para a pasta de quem recebe (as pastas são por pessoa).
  const copy = async (paths: string[] | null | undefined) => {
    const out: string[] = []
    for (const path of paths ?? []) {
      const dest = sharedPath(path, toUserId, meal.id as string)
      const { error: copyError } = await admin.storage.from('meal-photos').copy(path, dest)
      if (!copyError) out.push(dest)
    }
    return out
  }
  const photoPaths = await copy(source.photo_paths as string[] | null)
  const thumbPaths = await copy(source.thumb_paths as string[] | null)
  if (photoPaths.length || thumbPaths.length) {
    await admin
      .from('meals')
      .update({ photo_paths: photoPaths, thumb_paths: thumbPaths, photo_path: photoPaths[0] ?? null })
      .eq('id', meal.id)
  }
  return { already: false }
}

export async function share(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = ShareSchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')
    if (body.data.to_user_id === user.id) throw new HttpError(400, 'Escolhe outra pessoa.')

    // A refeição tem de ser de quem partilha (RLS) e estar analisada.
    const { data: source } = await db.from('meals_counted').select('*').eq('id', body.data.meal_id).maybeSingle()
    if (!source) throw new HttpError(404, 'Refeição não encontrada.')

    const admin = adminClient()
    const { data: target } = await admin
      .from('profile')
      .select('user_id')
      .eq('user_id', body.data.to_user_id)
      .maybeSingle()
    if (!target) throw new HttpError(404, 'Pessoa não encontrada.')

    const toName = await personName(admin, body.data.to_user_id)
    const { already } = await copyMealTo(admin, source, body.data.to_user_id, await personName(admin, user.id))
    res.status(200).json(already ? { ok: true, to: toName, already: true } : { ok: true, to: toName })
  } catch (err) {
    respondError(res, err)
  }
}

// «Também para …» ao registar (`meals.share_with`, migração
// 20261018160000): no fim de uma análise que correu bem (captura, juntar
// foto, «Tentar outra vez», «Analisar mesmo assim»), a refeição segue para
// essas pessoas, uma vez. Apagada entretanto, não segue. Nunca faz falhar a
// análise; sem a migração não há `share_with` e não faz nada.
export async function shareAfterAnalysis(admin: SupabaseClient, meal: Record<string, unknown> | null): Promise<void> {
  const pending = (meal?.share_with as string[] | null | undefined) ?? []
  if (!meal || pending.length === 0) return
  if (meal.status !== 'ok' && meal.status !== 'por_rever') return
  try {
    const { data: source } = await admin
      .from('meals')
      .select('*')
      .eq('id', meal.id as string)
      .is('deleted_at', null)
      .in('status', ['ok', 'por_rever'])
      .maybeSingle()
    if (source) {
      const owner = source.user_id as string
      const fromName = await personName(admin, owner)
      for (const to of shareTargets(pending, owner)) {
        const { data: target } = await admin.from('profile').select('user_id').eq('user_id', to).maybeSingle()
        if (target) await copyMealTo(admin, source, to, fromName)
      }
    }
  } catch (err) {
    console.error('Partilhar depois da análise falhou:', err)
  } finally {
    // Uma vez só: uma análise depois desta (juntar foto) já não partilha.
    await admin.from('meals').update({ share_with: [] }).eq('id', meal.id as string)
  }
}

// Uma favorita nova (por exemplo uma receita importada) também nas
// favoritas de outra pessoa da casa: copia o nome, os itens por dose, as
// contas, a refeição habitual e a foto (para a pasta dela). Os food_id ficam
// de fora (são da biblioteca de quem a criou). Com `undo_id`, Anular apaga
// essa cópia acabada de criar.
const FavoriteCopySchema = z.object({
  favorite_id: z.string().uuid(),
  to_user_id: z.string().uuid(),
  undo_id: z.string().uuid().optional(),
})

export async function favoriteCopy(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = FavoriteCopySchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')
    const { favorite_id, to_user_id, undo_id } = body.data
    if (to_user_id === user.id) throw new HttpError(400, 'Escolhe outra pessoa.')
    const admin = adminClient()

    // A favorita tem de ser de quem a copia (RLS).
    const { data: source } = await db.from('favorites').select('*').eq('id', favorite_id).eq('kind', 'meal').maybeSingle()
    if (!source) throw new HttpError(404, 'Favorita não encontrada.')

    if (undo_id) {
      // Só uma cópia desta favorita acabada de fazer (nos últimos 15 min): o
      // admin client não apaga outra favorita da outra pessoa.
      const { data: removed } = await admin
        .from('favorites')
        .delete()
        .eq('id', undo_id)
        .eq('user_id', to_user_id)
        .eq('name', source.name as string)
        .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
        .select('photo_path')
      const photo = removed?.[0]?.photo_path as string | null | undefined
      if (photo) await admin.storage.from('meal-photos').remove([photo])
      res.status(200).json({ ok: true })
      return
    }
    const { data: target } = await admin.from('profile').select('user_id').eq('user_id', to_user_id).maybeSingle()
    if (!target) throw new HttpError(404, 'Pessoa não encontrada.')

    const id = crypto.randomUUID()
    let photoPath: string | null = null
    if (source.photo_path) {
      const dest = `${to_user_id}/fav/${id}.jpg`
      const { error: copyError } = await admin.storage.from('meal-photos').copy(source.photo_path as string, dest)
      if (!copyError) photoPath = dest
    }
    const items = ((source.items ?? []) as MealItem[]).map((i) => ({ ...i, food_id: null }))
    const { error } = await admin.from('favorites').insert({
      id,
      user_id: to_user_id,
      kind: 'meal',
      name: source.name,
      items,
      kcal: source.kcal,
      protein: source.protein,
      carbs: source.carbs,
      fat: source.fat,
      photo_path: photoPath,
      default_slot: source.default_slot,
    })
    if (error) throw new HttpError(500, error.message)
    res.status(200).json({ id, to: await personName(admin, to_user_id) })
  } catch (err) {
    respondError(res, err)
  }
}
