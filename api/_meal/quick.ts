import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { nutritionalDay } from '../_lib/rules/nutritional-day.js'
import { mealTotals, type MealItem } from '../_lib/rules/meal-totals.js'
import { PORTION_FACTORS, rescaleItems, scaleItems } from '../_lib/rules/favoritos.js'
import { SLOT_TIME, clockTime, loggedAtFor, slotOf, type Slot } from '../_lib/rules/momentos.js'

// Registos de 1 toque, sem IA: favorito, «Igual a ontem» / «Repetir hoje» /
// «Copiar para outro dia», mudar a porção, apagar e repor. Os totais e o dia
// nutricional calculam-se sempre aqui (decisão 20).

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const FACTOR = z.number().refine((f) => (PORTION_FACTORS as readonly number[]).includes(f))

const LogFavoriteSchema = z.object({
  favorite_id: z.string().uuid(),
  factor: FACTOR.optional(),
  date: DATE.optional(), // dia nutricional; sem ele, agora
})

const RepeatSchema = z.object({
  meal_id: z.string().uuid(),
  date: DATE.optional(), // sem ele, hoje
})

const PortionSchema = z.object({ meal_id: z.string().uuid(), factor: FACTOR })
const MealIdSchema = z.object({ meal_id: z.string().uuid() })

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

async function cutoffHour(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
  return data?.nutrition_day_cutoff_hour ?? 4
}

// Hora a gravar: agora, ou a hora pedida no dia escolhido (nunca no futuro).
function resolveLoggedAt(date: string | undefined, time: string, cutoff: number, now: Date): Date {
  if (!date || date === nutritionalDay(now, cutoff)) return now
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
      slot: slotOf(logged_at),
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
  const { favorite_id, factor = 1, date } = body.data

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
  const slot = (favorite.default_slot as Slot | null) ?? slotOf(now)
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
    logged_at: resolveLoggedAt(date, SLOT_TIME[slot], cutoff, now),
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
  // A mesma hora do original, no dia escolhido (nunca no futuro).
  const loggedAt = loggedAtFor(target, clockTime(new Date(source.logged_at)), cutoff, now)
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
    cutoff,
  })
  return { meal }
})

export const portion = post(async (db, _userId, rawBody) => {
  const body = PortionSchema.safeParse(rawBody)
  if (!body.success) throw new HttpError(400, 'Pedido inválido.')
  const { data: meal } = await db
    .from('meals_counted')
    .select('id,items,portion_factor')
    .eq('id', body.data.meal_id)
    .maybeSingle()
  if (!meal) throw new HttpError(404, 'Refeição não encontrada.')

  const items = rescaleItems(meal.items as MealItem[], Number(meal.portion_factor ?? 1), body.data.factor)
  const { data: updated, error } = await db
    .from('meals')
    .update({ items, portion_factor: body.data.factor, ...mealTotals(items) })
    .eq('id', meal.id)
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  return { meal: updated }
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
