import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { mealTotals, type MealItem } from '../_lib/rules/meal-totals.js'

// Partilhar uma refeição com outra pessoa da app (ex.: o João e a Joana a
// comer o mesmo): copia-a para a conta dela, no mesmo dia, refeição e hora,
// com as fotos copiadas para a pasta dela. A cópia entra por rever (com as
// quantidades de quem partilhou, que ela ajusta em «Rever») e guarda a
// refeição de origem: partilhar outra vez a mesma não a duplica.
// A app é de uma casa (no máximo 4 pessoas): quem tem sessão pode partilhar
// com qualquer outro perfil.

const ShareSchema = z.object({ meal_id: z.string().uuid(), to_user_id: z.string().uuid() })

async function personName(admin: ReturnType<typeof adminClient>, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId)
  const name = data.user?.user_metadata?.name
  return typeof name === 'string' && name.trim() ? name.trim() : (data.user?.email?.split('@')[0] ?? 'Outra pessoa')
}

// GET /api/meal/people: as outras pessoas da app, para «Partilhar com …».
export async function people(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const admin = adminClient()
    const { data } = await admin.from('profile').select('user_id').neq('user_id', user.id).order('created_at')
    const list = await Promise.all(
      (data ?? []).map(async (p) => ({ user_id: p.user_id as string, name: await personName(admin, p.user_id as string) })),
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
    const { data: already } = await admin
      .from('meals')
      .select('id')
      .eq('user_id', body.data.to_user_id)
      .eq('source_meal_id', source.id)
      .is('deleted_at', null)
      .limit(1)
    if (already?.length) {
      res.status(200).json({ ok: true, to: toName, already: true })
      return
    }

    const items = source.items as MealItem[]
    const fromName = await personName(admin, user.id)
    const { data: meal, error } = await admin
      .from('meals')
      .insert({
        user_id: body.data.to_user_id,
        input_type: 'repeat',
        raw_text: source.raw_text,
        note: `Partilhada por ${fromName}`,
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
        const dest = sharedPath(path, body.data.to_user_id, meal.id)
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

    res.status(200).json({ ok: true, to: toName })
  } catch (err) {
    respondError(res, err)
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
