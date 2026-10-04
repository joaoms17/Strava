import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MealItemInputSchema } from '../_lib/schemas.js'
import { nutritionalDay } from '../_lib/rules/nutritional-day.js'
import { mealTotals, round1, type MealItem } from '../_lib/rules/meal-totals.js'
import { mealIsEstimate } from '../_lib/rules/estimativas.js'
import { SLOTS, SLOT_TIME, loggedAtFor, slotOf, type Slot } from '../_lib/rules/momentos.js'
import { aiLimitReached, claimAndAnalyse, correctItems, type MealRow } from '../_lib/meal-analysis.js'

// Comida sem espera (Fase 2): a captura responde 202 logo e a análise corre
// em segundo plano; o telemóvel pergunta pelo estado e, se preciso, pede
// outra tentativa com /api/meal/analyse.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const SLOT = z.enum(SLOTS as [Slot, ...Slot[]])
export const TAGS = ['comi_metade', 'azeite', 'sem_molho', 'porcao_grande', 'jantar_fora'] as const
const TAG = z.enum(TAGS)

const CaptureSchema = z.object({
  client_id: z.string().uuid(),
  photo_paths: z.array(z.string().min(3)).max(4).default([]),
  thumb_paths: z.array(z.string().min(3)).max(4).default([]),
  image_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(4).default([]),
  text: z.string().max(1000).optional(),
  note: z.string().max(500).optional(),
  tags: z.array(TAG).max(5).default([]),
  taken_at: z.string().nullable().optional(), // instante conhecido (câmara, EXIF)
  date: DATE.optional(), // dia nutricional, quando a hora é desconhecida ou é um dia passado
  slot: SLOT.optional(),
})

const MealIdSchema = z.object({ meal_id: z.string().uuid() })

const AnalyseSchema = MealIdSchema.extend({
  reset: z.boolean().optional(), // «Tentar de novo» e «Reanalisar foto»
  force: z.boolean().optional(), // «Analisar esta mesmo assim» (acima do limite)
})

// Juntar fotos a uma refeição que já existe (não carregou, erro ou faltava a
// foto do rótulo): ficam todas e a refeição volta a ser analisada.
const AttachSchema = MealIdSchema.extend({
  photo_paths: z.array(z.string().min(3)).min(1).max(4),
  thumb_paths: z.array(z.string().min(3)).max(4).default([]),
  image_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(4).default([]),
})

export const MAX_MEAL_PHOTOS = 4

const CorrectSchema = MealIdSchema.extend({ text: z.string().trim().min(1).max(500) })

const UpdateSchema = MealIdSchema.extend({
  items: z.array(MealItemInputSchema).min(1).max(30).optional(),
  date: DATE.optional(),
  slot: SLOT.optional(),
  logged_at: z.string().optional(), // só para Anular uma mudança de hora
  note: z.string().max(500).nullable().optional(),
  tags: z.array(TAG).max(5).optional(),
  confirm: z.boolean().optional(),
})

const QuickSchema = z.object({
  client_id: z.string().uuid().optional(),
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(0).max(400),
  carbs: z.number().min(0).max(800).optional(),
  fat: z.number().min(0).max(400).optional(),
  name: z.string().trim().max(80).optional(),
  date: DATE.optional(),
  slot: SLOT.optional(),
})

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

function post(run: (ctx: { db: SupabaseClient; userId: string; body: unknown; res: VercelResponse }) => Promise<void>): Handler {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
      const { user, db } = await requireUser(req)
      await run({ db, userId: user.id, body: req.body, res })
    } catch (err) {
      respondError(res, err)
    }
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new HttpError(400, 'Pedido inválido.')
  return result.data
}

async function cutoffHour(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
  return data?.nutrition_day_cutoff_hour ?? 4
}

// A análise continua depois da resposta (até aos 60 s da função).
function inBackground(task: Promise<unknown>) {
  const safe = task.catch((err) => console.error('Análise em segundo plano falhou:', err))
  waitUntil(safe)
}

async function ownMeal(db: SupabaseClient, mealId: string): Promise<MealRow & Record<string, unknown>> {
  const { data } = await db.from('meals').select('*').eq('id', mealId).maybeSingle()
  if (!data) throw new HttpError(404, 'Refeição não encontrada.')
  return data as MealRow & Record<string, unknown>
}

export const capture = post(async ({ db, userId, body, res }) => {
  const input = parse(CaptureSchema, body)
  const text = input.text?.trim() || null
  if (input.photo_paths.length === 0 && !text) throw new HttpError(400, 'Falta a foto ou o texto.')
  // As fotos são lidas com a service role: têm de estar na pasta desta captura.
  const prefix = `${userId}/${input.client_id}/`
  if ([...input.photo_paths, ...input.thumb_paths].some((p) => !p.startsWith(prefix) || p.includes('..'))) {
    throw new HttpError(403, 'Fotografia inválida.')
  }

  // Repetição do mesmo envio (a fila tenta outra vez): devolve o que já existe.
  const { data: existing } = await db.from('meals').select('*').eq('client_id', input.client_id).maybeSingle()
  if (existing) {
    res.status(202).json({ meal: existing })
    return
  }
  // A mesma foto já registada: não se analisa outra vez.
  if (input.image_hashes.length) {
    const { data: same } = await db
      .from('meals')
      .select('*')
      .is('deleted_at', null)
      .overlaps('image_hashes', input.image_hashes)
      .limit(1)
    if (same?.[0]) {
      res.status(200).json({ meal: same[0], duplicate: true })
      return
    }
  }

  const now = new Date()
  const cutoff = await cutoffHour(db)
  const takenMs = input.taken_at ? Date.parse(input.taken_at) : NaN
  let loggedAt: Date
  if (Number.isFinite(takenMs) && takenMs <= now.getTime()) loggedAt = new Date(takenMs)
  else if (input.date) loggedAt = loggedAtFor(input.date, SLOT_TIME[input.slot ?? slotOf(now)], cutoff, now)
  else loggedAt = now

  const withPhotos = input.photo_paths.length > 0
  const admin = adminClient()
  const overLimit = await aiLimitReached(admin, userId, withPhotos)
  const { data: meal, error } = await db
    .from('meals')
    .insert({
      user_id: userId,
      client_id: input.client_id,
      date: nutritionalDay(loggedAt, cutoff),
      logged_at: loggedAt.toISOString(),
      slot: input.slot ?? slotOf(loggedAt),
      input_type: withPhotos ? 'photo' : 'text',
      raw_text: text,
      note: input.note?.trim() || null,
      tags: input.tags,
      photo_paths: input.photo_paths,
      photo_path: input.photo_paths[0] ?? null,
      thumb_paths: input.thumb_paths,
      image_hashes: input.image_hashes,
      items: [],
      status: overLimit ? 'sem_analise' : 'a_analisar',
      is_estimate: withPhotos,
    })
    .select()
    .single()
  if (error) {
    // Dois envios em simultâneo com o mesmo client_id: o outro ganhou.
    if (error.code === '23505') {
      const { data: again } = await db.from('meals').select('*').eq('client_id', input.client_id).maybeSingle()
      if (again) {
        res.status(202).json({ meal: again })
        return
      }
    }
    throw new HttpError(500, error.message)
  }

  if (meal.status === 'a_analisar') inBackground(claimAndAnalyse(admin, meal.id as string))
  res.status(202).json({ meal })
})

export const analyse = post(async ({ db, userId, body, res }) => {
  const input = parse(AnalyseSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (meal.deleted_at) throw new HttpError(404, 'Refeição apagada.')
  const admin = adminClient()
  const reset = input.reset === true || meal.status === 'sem_analise' || meal.status === 'erro'
  if (!input.force && (await aiLimitReached(admin, userId, (meal.photo_paths ?? []).length > 0))) {
    if (meal.status === 'a_analisar') await admin.from('meals').update({ status: 'sem_analise' }).eq('id', meal.id)
    res.status(200).json({ meal: { ...meal, status: 'sem_analise' }, limit: true })
    return
  }
  const result = await claimAndAnalyse(admin, meal.id, reset)
  res.status(200).json({ meal: result ?? (await ownMeal(db, input.meal_id)) })
})

export const attach = post(async ({ db, userId, body, res }) => {
  const input = parse(AttachSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (meal.deleted_at) throw new HttpError(404, 'Refeição apagada.')
  const startedAt = meal.analysis_started_at ? Date.parse(meal.analysis_started_at as string) : NaN
  if (meal.status === 'a_analisar' && Date.now() - startedAt < 90_000) {
    throw new HttpError(409, 'Ainda a analisar. Espera uns segundos e tenta outra vez.')
  }
  // As fotos são lidas com a service role: têm de estar na pasta desta refeição.
  const prefix = `${userId}/${(meal.client_id as string | null) ?? meal.id}/`
  if ([...input.photo_paths, ...input.thumb_paths].some((p) => !p.startsWith(prefix) || p.includes('..'))) {
    throw new HttpError(403, 'Fotografia inválida.')
  }
  const current = (meal.photo_paths ?? []) as string[]
  const added = input.photo_paths.filter((p) => !current.includes(p))
  if (added.length === 0) {
    res.status(200).json({ meal })
    return
  }
  if (current.length + added.length > MAX_MEAL_PHOTOS) {
    throw new HttpError(422, `Cada refeição leva no máximo ${MAX_MEAL_PHOTOS} fotos.`)
  }
  const thumbs = (meal.thumb_paths ?? []) as string[]
  const hashes = (meal.image_hashes ?? []) as string[]
  const photoPaths = [...current, ...added]
  const admin = adminClient()
  const overLimit = await aiLimitReached(admin, userId, true)
  const { data, error } = await db
    .from('meals')
    .update({
      photo_paths: photoPaths,
      photo_path: photoPaths[0],
      thumb_paths: [...thumbs, ...input.thumb_paths.filter((p) => !thumbs.includes(p))],
      image_hashes: [...hashes, ...input.image_hashes.filter((h) => !hashes.includes(h))],
      input_type: 'photo',
      is_estimate: true,
      status: overLimit ? 'sem_analise' : 'a_analisar',
      analysis_attempts: 0,
      analysis_started_at: null,
      analysis_error: null,
      confirmed_at: null,
    })
    .eq('id', meal.id)
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  if (data.status === 'a_analisar') inBackground(claimAndAnalyse(admin, meal.id))
  res.status(202).json({ meal: data })
})

export const correct = post(async ({ db, userId, body, res }) => {
  const input = parse(CorrectSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (meal.status === 'a_analisar') throw new HttpError(409, 'Ainda a analisar. Junta uma nota em vez disso.')
  if (!meal.items?.length) throw new HttpError(422, 'Esta refeição ainda não tem itens.')
  const previous = { items: meal.items, status: meal.status }
  const { items } = await correctItems(adminClient(), userId, meal.items, input.text)
  const tags = (meal.tags ?? []) as string[]
  const { data, error } = await db
    .from('meals')
    .update({
      items,
      ...mealTotals(items),
      is_estimate: mealIsEstimate(meal.input_type === 'photo' ? 'photo' : 'text', tags.includes('jantar_fora'), items),
      status: 'ok',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', meal.id)
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  res.status(200).json({ meal: data, previous })
})

export const update = post(async ({ db, userId, body, res }) => {
  const input = parse(UpdateSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  const patch: Record<string, unknown> = {}
  const previous: Record<string, unknown> = {
    items: meal.items,
    logged_at: meal.logged_at,
    slot: meal.slot,
    note: meal.note,
    tags: meal.tags,
    status: meal.status,
  }
  const tags = input.tags ?? ((meal.tags ?? []) as string[])
  let items: MealItem[] | null = input.items ? (input.items as MealItem[]) : null

  if (input.tags) patch.tags = input.tags
  if (input.logged_at !== undefined || input.date || input.slot) {
    const cutoff = await cutoffHour(db)
    const now = new Date()
    let loggedAt: Date
    const explicit = input.logged_at ? Date.parse(input.logged_at) : NaN
    if (Number.isFinite(explicit)) loggedAt = new Date(Math.min(explicit, now.getTime()))
    else {
      const day = input.date ?? (meal.date as string)
      const slot = input.slot ?? ((meal.slot as Slot | null) ?? slotOf(new Date(meal.logged_at)))
      loggedAt = loggedAtFor(day, SLOT_TIME[slot], cutoff, now)
    }
    patch.logged_at = loggedAt.toISOString()
    patch.date = nutritionalDay(loggedAt, cutoff)
    patch.slot = input.slot ?? slotOf(loggedAt)
  }

  if (input.note !== undefined) {
    const note = input.note?.trim() || null
    patch.note = note
    // Com a análise terminada, uma nota nova corrige os itens (Haiku, sem foto).
    // A correr, fica guardada e a escrita protegida da análise aplica-a.
    if (meal.status !== 'a_analisar' && note && note !== meal.analysis_note && !items && meal.items?.length) {
      items = (await correctItems(adminClient(), userId, meal.items, note)).items
      patch.analysis_note = note
    }
  }

  if (items) {
    Object.assign(patch, {
      items: items.map((i) => ({ ...i, grams: round1(i.grams) })),
      ...mealTotals(items),
      is_estimate: mealIsEstimate(meal.input_type === 'photo' ? 'photo' : 'text', tags.includes('jantar_fora'), items),
    })
  }
  if (input.confirm === true && (meal.status === 'por_rever' || meal.status === 'ok')) {
    patch.status = 'ok'
    patch.confirmed_at = new Date().toISOString()
  }
  // Anular um «Está certo».
  if (input.confirm === false && meal.status === 'ok') {
    patch.status = 'por_rever'
    patch.confirmed_at = null
  }
  if (Object.keys(patch).length === 0) {
    res.status(200).json({ meal, previous })
    return
  }
  const { data, error } = await db.from('meals').update(patch).eq('id', meal.id).select().single()
  if (error) throw new HttpError(500, error.message)
  res.status(200).json({ meal: data, previous })
})

// Só números: um item sintético «Registo rápido», para uma edição futura
// nunca pôr os totais a zero.
export const quick = post(async ({ db, userId, body, res }) => {
  const input = parse(QuickSchema, body)
  if (input.client_id) {
    const { data: existing } = await db.from('meals').select('*').eq('client_id', input.client_id).maybeSingle()
    if (existing) {
      res.status(200).json({ meal: existing })
      return
    }
  }
  const now = new Date()
  const cutoff = await cutoffHour(db)
  // Com uma refeição escolhida, a hora habitual dela (também hoje).
  const today = nutritionalDay(now, cutoff)
  const loggedAt =
    input.slot || (input.date && input.date !== today)
      ? loggedAtFor(input.date ?? today, SLOT_TIME[input.slot ?? slotOf(now)], cutoff, now)
      : now
  const items: MealItem[] = [
    {
      name: input.name || 'Registo rápido',
      grams: 0,
      kcal: round1(input.kcal),
      protein: round1(input.protein),
      carbs: round1(input.carbs ?? 0),
      fat: round1(input.fat ?? 0),
      food_id: null,
      estimated: false,
      confidence: 'alta',
    },
  ]
  const { data, error } = await db
    .from('meals')
    .insert({
      user_id: userId,
      client_id: input.client_id ?? null,
      date: nutritionalDay(loggedAt, cutoff),
      logged_at: loggedAt.toISOString(),
      slot: input.slot ?? slotOf(loggedAt),
      input_type: 'quick',
      raw_text: input.name || null,
      items,
      ...mealTotals(items),
      is_estimate: false,
      status: 'ok',
      confirmed_at: now.toISOString(),
    })
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  res.status(200).json({ meal: data })
})
