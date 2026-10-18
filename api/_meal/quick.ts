import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MealItemInputSchema } from '../_lib/schemas.js'
import { personName } from '../_lib/people.js'
import { nutritionalDay } from '../_lib/rules/nutritional-day.js'
import { mealTotals, type MealItem } from '../_lib/rules/meal-totals.js'
import { rescaleItems, scaleItems } from '../_lib/rules/favoritos.js'
import {
  MAX_SLOT_MEALS,
  MAX_UNDO_ROWS,
  factorOf,
  isFactor,
  liveCopies,
  sameFactor,
  sameFoods,
  undoPlan,
  type FactorChange,
} from '../_lib/rules/porcoes.js'
import { SLOTS, SLOT_TIME, clockTime, loggedAtFor, slotOf, type Slot } from '../_lib/rules/momentos.js'

// Registos de 1 toque, sem IA: favorito, «Igual a ontem» / «Repetir hoje» /
// «Copiar para outro dia», mudar a porção, apagar e repor. Os totais e o dia
// nutricional calculam-se sempre aqui (decisão 20).

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// ½ · 1 · 1½ · 2 e as de uma divisão ao partilhar (0,6 · 0,4): de 0,1 a 3.
export const FACTOR = z.number().refine(isFactor)

const SLOT = z.enum(SLOTS as [Slot, ...Slot[]])

const LogFavoriteSchema = z.object({
  favorite_id: z.string().uuid(),
  factor: FACTOR.optional(),
  date: DATE.optional(), // dia nutricional; sem ele, agora
  slot: SLOT.optional(), // a refeição escolhida; sem ela, a do favorito ou a da hora
})

const RepeatSchema = z.object({
  meal_id: z.string().uuid(),
  date: DATE.optional(), // sem ele, hoje
  slot: SLOT.optional(), // sem ela, a mesma hora do original
})

const PortionSchema = z.object({
  meal_id: z.string().uuid(),
  factor: FACTOR,
  // «Todo o jantar»: mais refeições de quem pede, com a mesma porção.
  meal_ids: z.array(z.string().uuid()).max(MAX_SLOT_MEALS).optional(),
  // «Também na de …»: a mesma porção nas cópias que outras pessoas receberam.
  with_shared: z.boolean().optional(),
})
// Uma linha a voltar atrás: a porção de antes e, numa refeição de quem pede,
// os itens de antes (Anular exato, sem arredondar outra vez).
export const UndoChangeSchema = z.object({
  meal_id: z.string().uuid(),
  factor: FACTOR,
  items: z.array(MealItemInputSchema).min(1).max(30).optional(),
})
const PortionUndoSchema = z.object({
  changes: z.array(UndoChangeSchema).min(1).max(MAX_UNDO_ROWS),
})
const MealIdSchema = z.object({ meal_id: z.string().uuid() })

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

// Uma cópia partilhada noutra conta, lida com o cliente de serviço.
type CopyMeal = Record<string, unknown> & { id: string; user_id: string; source_meal_id: string | null; deleted_at: string | null }

// Uma linha de `meals` na porção `to`, a partir da que tem (os itens escalam
// e os totais saem deles). Numa cópia de outra pessoa, `copyOf` e `notUser`
// guardam que continua a ser cópia de uma refeição de quem pede; `once` só
// muda se a porção ainda for a lida (não divide duas vezes). Devolve a linha
// nova, ou null se não mudou.
export async function rescaleRow(
  client: SupabaseClient,
  row: Record<string, unknown>,
  to: number,
  guard: { copyOf?: string; notUser?: string; once?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const from = factorOf(row.portion_factor)
  const items = row.items as MealItem[] | null
  if (!items?.length || sameFactor(from, to)) return null
  const scaled = rescaleItems(items, from, to)
  let query = client
    .from('meals')
    .update({ items: scaled, portion_factor: to, ...mealTotals(scaled) })
    .eq('id', row.id as string)
  if (guard.copyOf) query = query.eq('source_meal_id', guard.copyOf)
  if (guard.notUser) query = query.neq('user_id', guard.notUser)
  if (guard.once) query = query.eq('portion_factor', from)
  const { data, error } = await query.select().maybeSingle()
  if (error) throw new HttpError(500, error.message)
  return (data as Record<string, unknown> | null) ?? null
}

async function cutoffHour(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
  return data?.nutrition_day_cutoff_hour ?? 4
}

// Hora a gravar: sem dia, agora (mesmo com a refeição escolhida); num dia,
// a hora habitual da refeição (hoje só quando a refeição foi escolhida),
// nunca no futuro.
function resolveLoggedAt(date: string | undefined, time: string, cutoff: number, now: Date, explicit = false): Date {
  if (!date) return now
  if (!explicit && date === nutritionalDay(now, cutoff)) return now
  return loggedAtFor(date, time, cutoff, now)
}

function post(run: (db: SupabaseClient, userId: string, body: unknown) => Promise<unknown>): Handler {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
      const { user, db } = await requireUser(req)
      res.status(200).json(await run(db, user.id, req.body))
    } catch (err) {
      respondError(res, err)
    }
  }
}

async function insertMeal(
  db: SupabaseClient,
  row: Record<string, unknown> & { items: MealItem[]; logged_at: Date; cutoff: number },
) {
  const { items, logged_at, cutoff, ...rest } = row
  const totals = mealTotals(items)
  const { data, error } = await db
    .from('meals')
    .insert({
      ...rest,
      date: nutritionalDay(logged_at, cutoff),
      logged_at: logged_at.toISOString(),
      // A refeição escolhida manda (a hora pode ter sido puxada para agora).
      slot: (rest.slot as Slot | undefined) ?? slotOf(logged_at),
      status: 'ok',
      confirmed_at: new Date().toISOString(),
      items,
      ...totals,
    })
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  return data
}

export const logFavorite = post(async (db, userId, rawBody) => {
  const body = LogFavoriteSchema.safeParse(rawBody)
  if (!body.success) throw new HttpError(400, 'Pedido inválido.')
  const { favorite_id, factor = 1, date, slot: chosenSlot } = body.data

  const { data: favorite } = await db
    .from('favorites')
    .select('*')
    .eq('id', favorite_id)
    .eq('kind', 'meal')
    .maybeSingle()
  if (!favorite) throw new HttpError(404, 'Favorito não encontrado.')
  const items = favorite.items as MealItem[]
  if (!items.length) throw new HttpError(422, 'Este favorito não tem itens.')

  const now = new Date()
  const cutoff = await cutoffHour(db)
  const slot = chosenSlot ?? (favorite.default_slot as Slot | null) ?? slotOf(now)
  const meal = await insertMeal(db, {
    user_id: userId,
    input_type: 'favorite',
    raw_text: favorite.name,
    photo_path: favorite.photo_path,
    photo_paths: favorite.photo_path ? [favorite.photo_path] : [],
    thumb_paths: favorite.photo_path ? [favorite.photo_path] : [],
    favorite_id,
    portion_factor: factor,
    is_estimate: false,
    items: scaleItems(items, factor),
    logged_at: resolveLoggedAt(date, SLOT_TIME[slot], cutoff, now, chosenSlot != null),
    ...(chosenSlot ? { slot: chosenSlot } : {}),
    cutoff,
  })

  await db
    .from('favorites')
    .update({ use_count: Number(favorite.use_count) + 1, last_used_at: now.toISOString() })
    .eq('id', favorite_id)
  return { meal }
})

export const repeat = post(async (db, userId, rawBody) => {
  const body = RepeatSchema.safeParse(rawBody)
  if (!body.success) throw new HttpError(400, 'Pedido inválido.')

  const { data: source } = await db
    .from('meals_counted')
    .select('*')
    .eq('id', body.data.meal_id)
    .maybeSingle()
  if (!source) throw new HttpError(404, 'Refeição não encontrada.')

  const now = new Date()
  const cutoff = await cutoffHour(db)
  const target = body.data.date ?? nutritionalDay(now, cutoff)
  // A refeição escolhida (hora habitual dela) ou a mesma hora do original,
  // no dia escolhido (nunca no futuro).
  const slot = body.data.slot
  const loggedAt = loggedAtFor(target, slot ? SLOT_TIME[slot] : clockTime(new Date(source.logged_at)), cutoff, now)
  const meal = await insertMeal(db, {
    user_id: userId,
    input_type: 'repeat',
    raw_text: source.raw_text,
    photo_path: source.photo_path,
    photo_paths: source.photo_paths ?? [],
    thumb_paths: source.thumb_paths ?? [],
    tags: source.tags ?? [],
    favorite_id: source.favorite_id,
    source_meal_id: source.id,
    portion_factor: source.portion_factor ?? 1,
    is_estimate: source.is_estimate,
    confidence: source.confidence,
    items: source.items as MealItem[],
    logged_at: loggedAt,
    ...(slot ? { slot } : {}),
    cutoff,
  })
  return { meal }
})

// A porção de uma refeição já registada (½ · 1 · 1½ · 2, ou a de uma
// divisão). Com `meal_ids`, também nas outras refeições de quem pede (lidas
// com o RLS); com `with_shared`, também nas cópias delas que outras pessoas
// receberam (cliente de serviço, só as que têm `source_meal_id` numa dessas
// refeições), cada uma a partir da sua porção. Não ensina a biblioteca: a
// porção não é uma correção dos alimentos. `previous` traz a porção de antes
// de cada linha que mudou, para o Anular (`portion-undo`).
export const portion = post(async (db, userId, rawBody) => {
  const body = PortionSchema.safeParse(rawBody)
  if (!body.success) throw new HttpError(400, 'Pedido inválido.')
  const { meal_id, factor, with_shared } = body.data
  const ids = [...new Set([meal_id, ...(body.data.meal_ids ?? [])])]
  const { data: rows } = await db.from('meals_counted').select('*').in('id', ids)
  const own = (rows ?? []) as Record<string, unknown>[]
  if (!own.some((m) => m.id === meal_id)) throw new HttpError(404, 'Refeição não encontrada.')

  const previous: (FactorChange & { copy?: boolean })[] = []
  const meals: Record<string, unknown>[] = []
  let kcalDelta = 0
  for (const meal of own) {
    const updated = await rescaleRow(db, meal, factor)
    // A aberta volta sempre (a resposta de antes); as outras só se mudaram.
    if (!updated) {
      if (meal.id === meal_id) meals.push(meal)
      continue
    }
    meals.push(updated)
    previous.push({ meal_id: meal.id as string, factor: factorOf(meal.portion_factor), items: meal.items as MealItem[] })
    kcalDelta += Number(updated.kcal) - Number(meal.kcal)
  }

  const sharedWith = new Set<string>()
  let copies = 0
  const admin = with_shared ? adminClient() : null
  if (admin) {
    const ownIds = own.map((m) => m.id as string)
    const { data: found } = await admin
      .from('meals')
      .select('id,user_id,source_meal_id,deleted_at,items,portion_factor')
      .in('source_meal_id', ownIds)
      .neq('user_id', userId)
      .is('deleted_at', null)
      .in('status', ['ok', 'por_rever'])
    for (const copy of liveCopies((found ?? []) as CopyMeal[], ownIds, userId)) {
      // A cópia continua por rever: quem a recebeu confirma. O trigger
      // mark_day_dirty marca o dia dela para recalcular (as kcal mudaram).
      const changed = await rescaleRow(admin, copy, factor, { copyOf: copy.source_meal_id!, notUser: userId })
      if (!changed) continue
      previous.push({ meal_id: copy.id, factor: factorOf(copy.portion_factor), copy: true })
      sharedWith.add(copy.user_id)
      copies++
    }
  }
  const names = admin ? await Promise.all([...sharedWith].map((id) => personName(admin, id))) : []
  return {
    meal: meals.find((m) => m.id === meal_id),
    meals,
    previous,
    copies,
    shared_with: names,
    kcal_delta: Math.round(kcalDelta),
  }
})

// Anular uma porção (ou a divisão de uma partilha): cada linha volta à porção
// de antes. Revalida tudo: as refeições de quem pede pelo RLS; as outras só se
// ainda forem cópias de uma refeição de quem pede, noutra conta.
export async function restoreFactors(db: SupabaseClient, userId: string, changes: readonly FactorChange[]) {
  const ids = [...new Set(changes.map((c) => c.meal_id))]
  const { data: ownRows } = await db.from('meals_counted').select('*').in('id', ids)
  const own = (ownRows ?? []) as Record<string, unknown>[]
  const others = ids.filter((id) => !own.some((m) => m.id === id))
  const admin = others.length ? adminClient() : null
  let copyRows: CopyMeal[] = []
  if (admin) {
    const { data: found } = await admin
      .from('meals')
      .select('id,user_id,source_meal_id,deleted_at,items,portion_factor')
      .in('id', others)
      .neq('user_id', userId)
      .is('deleted_at', null)
    const rows = (found ?? []) as CopyMeal[]
    const sources = [...new Set(rows.map((r) => r.source_meal_id).filter((id): id is string => !!id))]
    // As refeições de origem têm de ser de quem pede (RLS; também as apagadas).
    const { data: mine } = sources.length ? await db.from('meals').select('id').in('id', sources) : { data: [] }
    copyRows = liveCopies(rows, (mine ?? []).map((m) => m.id as string), userId)
  }
  const plan = undoPlan(changes, own.map((m) => m.id as string), copyRows.map((r) => r.id))

  const meals: Record<string, unknown>[] = []
  for (const change of plan.own) {
    const row = own.find((m) => m.id === change.meal_id)!
    const before = change.items as MealItem[] | undefined
    // Os mesmos alimentos: os itens de antes, exatamente (RLS: é de quem pede).
    if (before && sameFoods(row.items as MealItem[] | null, before)) {
      const { data, error } = await db
        .from('meals')
        .update({ items: before, portion_factor: change.factor, ...mealTotals(before) })
        .eq('id', row.id as string)
        .select()
        .maybeSingle()
      if (error) throw new HttpError(500, error.message)
      if (data) meals.push(data as Record<string, unknown>)
      continue
    }
    const updated = await rescaleRow(db, row, change.factor)
    if (updated) meals.push(updated)
  }
  for (const change of plan.copies) {
    const copy = copyRows.find((r) => r.id === change.meal_id)!
    if (admin) await rescaleRow(admin, copy, change.factor, { copyOf: copy.source_meal_id!, notUser: userId })
  }
  return { meals }
}

export const portionUndo = post(async (db, userId, rawBody) => {
  const body = PortionUndoSchema.safeParse(rawBody)
  if (!body.success) throw new HttpError(400, 'Pedido inválido.')
  const { meals } = await restoreFactors(db, userId, body.data.changes)
  return { meals }
})

// Apagar é reversível: a linha fica com deleted_at e sai das contas.
export const remove = post(async (db, _userId, rawBody) => {
  const body = MealIdSchema.safeParse(rawBody)
  if (!body.success) throw new HttpError(400, 'Pedido inválido.')
  const { data, error } = await db
    .from('meals')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', body.data.meal_id)
    .select('id,date')
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(404, 'Refeição não encontrada.')
  return { meal: data }
})

export const restore = post(async (db, _userId, rawBody) => {
  const body = MealIdSchema.safeParse(rawBody)
  if (!body.success) throw new HttpError(400, 'Pedido inválido.')
  const { data, error } = await db
    .from('meals')
    .update({ deleted_at: null })
    .eq('id', body.data.meal_id)
    .select()
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(404, 'Refeição não encontrada.')
  return { meal: data }
})
