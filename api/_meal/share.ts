import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { mealTotals, type MealItem } from '../_lib/rules/meal-totals.js'

// Partilhar uma refeição com outra pessoa da app (ex.: o João e a Joana a
// comer o mesmo): copia-a para a conta dela, no mesmo dia, refeição e hora,
// com as fotos copiadas para a pasta dela. Ela ajusta depois as quantidades.
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
        status: 'ok',
        confirmed_at: new Date().toISOString(),
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

    res.status(200).json({ ok: true, to: await personName(admin, body.data.to_user_id) })
  } catch (err) {
    respondError(res, err)
  }
}
