import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { mealTotals, type MealItem } from '../_lib/rules/meal-totals.js'
import { rescaleItems } from '../_lib/rules/favoritos.js'
import { otherPeople, personName } from '../_lib/people.js'
import { shareTargets, sharedNote } from '../_lib/rules/partilha.js'
import {
  MAX_SLOT_MEALS,
  MAX_UNDO_ROWS,
  copyPhotos,
  factorOf,
  isSplit,
  liveCopies,
  sameFactor,
  splitFactors,
  splitFor,
  type FactorChange,
} from '../_lib/rules/porcoes.js'
import { FACTOR, rescaleRow, restoreFactors } from './quick.js'

// Partilhar uma refeição com outra pessoa da app (ex.: o João e a Joana a
// comer o mesmo): copia-a para a conta dela, no mesmo dia, refeição e hora,
// com as fotos copiadas para a pasta dela. A cópia entra por rever (com as
// quantidades de quem partilhou, que ela ajusta em «Rever») e guarda a
// refeição de origem: partilhar outra vez a mesma não a duplica.
// A app é de uma casa (no máximo 4 pessoas): quem tem sessão pode partilhar
// com qualquer outro perfil. Com `split` (a parte de quem partilha: 0,5 a
// meias, 0,6 = «João 60 · Joana 40»), a refeição dele fica com a sua parte e a
// cópia com o resto, cada uma a partir da porção que a refeição tinha. Com
// `meal_ids`, «Todo o jantar» segue de uma vez, com a mesma divisão.

const ShareSchema = z.object({
  meal_id: z.string().uuid(),
  to_user_id: z.string().uuid(),
  meal_ids: z.array(z.string().uuid()).max(MAX_SLOT_MEALS).optional(),
  split: z.number().refine(isSplit).nullable().optional(),
})

// Anular uma partilha: as cópias acabadas de fazer saem e as refeições de
// quem partilhou voltam à porção de antes.
const ShareUndoSchema = z.object({
  copies: z.array(z.string().uuid()).max(MAX_UNDO_ROWS),
  changes: z.array(z.object({ meal_id: z.string().uuid(), factor: FACTOR })).max(MAX_UNDO_ROWS).default([]),
})

// GET /api/meal/people: as outras pessoas da app, para «Partilhar com …».
// Com ?meal_id= (uma refeição de quem pede), diz também com quem já está
// partilhada, para a folha mostrar «Partilhada com … ✓» ao abrir.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function people(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const admin = adminClient()
    const mealId = typeof req.query.meal_id === 'string' && UUID.test(req.query.meal_id) ? req.query.meal_id : null
    // Com `meal_ids` (as outras do mesmo momento, «Todo o jantar»), `shared_in`
    // diz quais delas já têm cópia de cada pessoa.
    const extra = typeof req.query.meal_ids === 'string' ? req.query.meal_ids.split(',').filter((id) => UUID.test(id)) : []
    const asked = mealId ? [...new Set([mealId, ...extra])].slice(0, MAX_SLOT_MEALS + 1) : []
    const sharedIn = new Map<string, string[]>()
    // Quem partilhou esta refeição (é uma cópia): a ela não se partilha de volta.
    let fromUser: string | null = null
    if (asked.length) {
      // Só de refeições suas (RLS): as cópias são das outras pessoas.
      const { data: own } = await db.from('meals').select('id,source_meal_id').in('id', asked)
      const ownIds = (own ?? []).map((m) => m.id as string)
      const origin = (own ?? []).find((m) => m.id === mealId)?.source_meal_id as string | null | undefined
      if (origin) {
        const { data: source } = await admin.from('meals').select('user_id').eq('id', origin).maybeSingle()
        fromUser = (source?.user_id as string | undefined) ?? null
      }
      if (ownIds.length) {
        const { data: copies } = await admin
          .from('meals')
          .select('id,user_id,source_meal_id,deleted_at')
          .in('source_meal_id', ownIds)
          .neq('user_id', user.id)
          .is('deleted_at', null)
        for (const copy of liveCopies((copies ?? []) as CopyRow[], ownIds, user.id)) {
          const list = sharedIn.get(copy.user_id) ?? []
          if (!list.includes(copy.source_meal_id!)) list.push(copy.source_meal_id!)
          sharedIn.set(copy.user_id, list)
        }
      }
    }
    const people = await otherPeople(admin, user.id)
    res.status(200).json({
      people: people.map((p) => {
        const list = sharedIn.get(p.user_id) ?? []
        return {
          ...p,
          shared: mealId != null && list.includes(mealId),
          ...(extra.length ? { shared_in: list } : {}),
          ...(p.user_id === fromUser ? { from: true } : {}),
        }
      }),
    })
  } catch (err) {
    respondError(res, err)
  }
}

type CopyRow = { id: string; user_id: string; source_meal_id: string | null; deleted_at: string | null }

// O caminho da foto copiada: a mesma, na pasta de quem recebe.
export function sharedPath(path: string, toUserId: string, newMealId: string): string {
  const name = path.split('/').pop() ?? 'foto.jpg'
  return `${toUserId}/partilhada-${newMealId}/${name}`
}

// Copia uma refeição analisada (linha de `meals`) para outra pessoa, por
// rever. Uma refeição já partilhada com essa pessoa não se copia outra vez.
// Com `copyFactor` (a parte dela numa divisão), a cópia fica nessa porção,
// a partir da porção que a refeição tinha.
export async function copyMealTo(
  admin: SupabaseClient,
  source: Record<string, unknown>,
  toUserId: string,
  fromName: string,
  copyFactor?: number,
): Promise<{ already: boolean; id?: string }> {
  const { data: already } = await admin
    .from('meals')
    .select('id')
    .eq('user_id', toUserId)
    .eq('source_meal_id', source.id as string)
    .is('deleted_at', null)
    .limit(1)
  if (already?.length) return { already: true }
  // Uma cópia não volta para quem a partilhou (já lá está a refeição dele).
  if (source.source_meal_id) {
    const { data: origin } = await admin.from('meals').select('user_id').eq('id', source.source_meal_id as string).maybeSingle()
    if (origin?.user_id === toUserId) return { already: true }
  }

  const sourceFactor = factorOf(source.portion_factor)
  const factor = copyFactor ?? sourceFactor
  const sourceItems = source.items as MealItem[]
  const items = sameFactor(factor, sourceFactor) ? sourceItems : rescaleItems(sourceItems, sourceFactor, factor)
  const { data: meal, error } = await admin
    .from('meals')
    .insert({
      user_id: toUserId,
      input_type: 'repeat',
      raw_text: source.raw_text,
      note: sharedNote(fromName),
      tags: source.tags ?? [],
      portion_factor: factor,
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
  return { already: false, id: meal.id as string }
}

export async function share(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = ShareSchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')
    const { meal_id, to_user_id } = body.data
    if (to_user_id === user.id) throw new HttpError(400, 'Escolhe outra pessoa.')
    const split = body.data.split ?? null

    // As refeições têm de ser de quem partilha (RLS) e estar analisadas.
    const ids = [...new Set([meal_id, ...(body.data.meal_ids ?? [])])]
    const { data: rows } = await db.from('meals_counted').select('*').in('id', ids)
    const found = (rows ?? []) as Record<string, unknown>[]
    const main = found.find((m) => m.id === meal_id)
    if (!main) throw new HttpError(404, 'Refeição não encontrada.')
    // A aberta primeiro; as outras do momento só com itens.
    const sources = [
      main,
      ...found
        .filter((m) => m.id !== meal_id && (m.items as MealItem[] | null)?.length)
        .sort((a, b) => String(a.logged_at).localeCompare(String(b.logged_at))),
    ]

    const admin = adminClient()
    const { data: target } = await admin.from('profile').select('user_id').eq('user_id', to_user_id).maybeSingle()
    if (!target) throw new HttpError(404, 'Pessoa não encontrada.')

    const toName = await personName(admin, to_user_id)
    const fromName = await personName(admin, user.id)
    const copies: string[] = []
    const changes: FactorChange[] = []
    const meals: Record<string, unknown>[] = []
    let already = 0
    let kcalDelta = 0
    for (const source of sources) {
      const factors = splitFactors(factorOf(source.portion_factor), split)
      const copied = await copyMealTo(admin, source, to_user_id, fromName, factors.copy)
      if (copied.already || !copied.id) {
        // Já partilhada: não se divide outra vez (muda-se pela porção).
        already++
        continue
      }
      copies.push(copied.id)
      // A parte de quem partilha (uma vez só: se a porção mudou entretanto, fica).
      const updated = split != null ? await rescaleRow(db, source, factors.own, { once: true }) : null
      if (updated) {
        changes.push({ meal_id: source.id as string, factor: factorOf(source.portion_factor) })
        meals.push(updated)
        kcalDelta += Number(updated.kcal) - Number(source.kcal)
      }
    }
    res.status(200).json({
      ok: true,
      to: toName,
      shared: copies.length,
      ...(copies.length === 0 ? { already: true } : {}),
      already_count: already,
      split,
      meals,
      kcal_delta: Math.round(kcalDelta),
      // Para o Anular (`share-undo`): as cópias novas e a porção de antes.
      undo: { copies, changes },
    })
  } catch (err) {
    respondError(res, err)
  }
}

// Anular «Partilhar com …»: apaga as cópias acabadas de fazer (só se ainda
// forem cópias de refeições de quem pede, noutra conta, dos últimos 15 min),
// com as fotos copiadas para a pasta delas, e volta a porção das refeições de
// quem partilhou (`restoreFactors`, revalidado pelo RLS).
export async function shareUndo(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = ShareUndoSchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')
    const { copies, changes } = body.data
    let removed = 0
    if (copies.length) {
      const admin = adminClient()
      const { data: found } = await admin
        .from('meals')
        .select('id,user_id,source_meal_id,deleted_at,photo_path,photo_paths,thumb_paths')
        .in('id', copies)
        .neq('user_id', user.id)
        .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
      const rows = (found ?? []) as (CopyRow & { photo_path: string | null; photo_paths: string[] | null; thumb_paths: string[] | null })[]
      const sources = [...new Set(rows.map((r) => r.source_meal_id).filter((id): id is string => !!id))]
      const { data: mine } = sources.length ? await db.from('meals').select('id').in('id', sources) : { data: [] }
      for (const copy of liveCopies(rows, (mine ?? []).map((m) => m.id as string), user.id)) {
        const { error } = await admin
          .from('meals')
          .delete()
          .eq('id', copy.id)
          .eq('source_meal_id', copy.source_meal_id as string)
          .neq('user_id', user.id)
        if (error) throw new HttpError(500, error.message)
        removed++
        const photos = copyPhotos(copy, [copy.photo_path, ...(copy.photo_paths ?? []), ...(copy.thumb_paths ?? [])])
        if (photos.length) await admin.storage.from('meal-photos').remove(photos)
      }
    }
    const { meals } = changes.length ? await restoreFactors(db, user.id, changes) : { meals: [] }
    res.status(200).json({ ok: true, removed, meals })
  } catch (err) {
    respondError(res, err)
  }
}

// «Também para …» ao registar (`meals.share_with`, migração
// 20261018160000): no fim de uma análise que correu bem (captura, juntar
// foto, «Tentar outra vez», «Analisar mesmo assim»), a refeição segue para
// essas pessoas, uma vez. Apagada entretanto, não segue. Nunca faz falhar a
// análise; sem a migração não há `share_with` e não faz nada. Com
// `share_split` (migração 20261018210000; só com uma pessoa a receber), a
// refeição fica com a parte de quem a registou e a cópia com o resto.
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
      const targets = shareTargets(pending, owner)
      const split = splitFor(targets.length, source.share_split)
      const factors = splitFactors(factorOf(source.portion_factor), split)
      let copied = false
      for (const to of targets) {
        const { data: target } = await admin.from('profile').select('user_id').eq('user_id', to).maybeSingle()
        if (target && !(await copyMealTo(admin, source, to, fromName, factors.copy)).already) copied = true
      }
      // A parte de quem registou, só quando a cópia acabou de ser feita.
      if (copied && split != null) await rescaleRow(admin, source, factors.own, { once: true })
    }
  } catch (err) {
    console.error('Partilhar depois da análise falhou:', err)
  } finally {
    // Uma vez só: uma análise depois desta (juntar foto) já não partilha nem divide.
    const done = 'share_split' in meal ? { share_with: [], share_split: null } : { share_with: [] }
    await admin.from('meals').update(done).eq('id', meal.id as string)
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
