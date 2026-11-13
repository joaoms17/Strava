import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MealItemInputSchema } from '../_lib/schemas.js'
import { nutritionalDay } from '../_lib/rules/nutritional-day.js'
import { duplicatePhotoWindow } from '../_lib/rules/captura.js'
import { mealTotals, round1, type MealItem } from '../_lib/rules/meal-totals.js'
import { mealIsEstimate } from '../_lib/rules/estimativas.js'
import { analyseRequest, appliedText, correctionText, sameTags } from '../_lib/rules/analise.js'
import { splitStoredError } from '../_lib/rules/resposta-ia.js'
import { SLOTS, SLOT_TIME, loggedAtFor, slotOf, type Slot } from '../_lib/rules/momentos.js'
import { addingToItems, aiLimitReached, claimAndAnalyse, correctItems, estimateItems, type MealRow } from '../_lib/meal-analysis.js'
import { notifyMealAnalysed } from '../_lib/push.js'
import { recomputeDirtyPast } from '../_lib/meal-recompute.js'
import { shareAfterAnalysis } from './share.js'
import { learnFoods } from '../_lib/foods.js'
import { itemsToLearn } from '../_lib/rules/aprender.js'
import { MAX_SHARE_WITH, shareTargets } from '../_lib/rules/partilha.js'
import { isSplit, splitFor } from '../_lib/rules/porcoes.js'

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
  share_with: z.array(z.string().uuid()).max(MAX_SHARE_WITH).default([]), // «Também para …»: segue no fim da análise
  // A parte de quem regista ao partilhar (0,5 a meias); sem ela, cada um comeu isto tudo.
  share_split: z.number().refine(isSplit).nullable().optional(),
})

const MealIdSchema = z.object({ meal_id: z.string().uuid() })

const AnalyseSchema = MealIdSchema.extend({
  reset: z.boolean().optional(), // «Tentar de novo» e «Reanalisar foto»
  force: z.boolean().optional(), // «Analisar esta mesmo assim» (acima do limite)
  auto: z.boolean().optional(), // a outra tentativa que o telemóvel pede sozinho
  // «Analisar outra vez» numa foto lida pelo modelo de reserva (M2): relê as
  // fotos de raiz; devolve `previous` para o antes → depois e o Anular.
  reread: z.boolean().optional(),
})

// Juntar fotos a uma refeição que já existe (não carregou, erro ou faltava a
// foto do rótulo): ficam todas e a refeição volta a ser analisada.
const AttachSchema = MealIdSchema.extend({
  photo_paths: z.array(z.string().min(3)).min(1).max(4),
  thumb_paths: z.array(z.string().min(3)).max(4).default([]),
  image_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(4).default([]),
})

export const MAX_MEAL_PHOTOS = 4

// Anular «Juntar foto»: os itens, o estado e as fotos de antes. Só tira
// fotos (as que ficam têm de já lá estar).
const DetachSchema = MealIdSchema.extend({
  items: z.array(MealItemInputSchema).min(1).max(30),
  status: z.enum(['ok', 'por_rever']),
  photo_paths: z.array(z.string()).max(MAX_MEAL_PHOTOS),
  thumb_paths: z.array(z.string()).max(MAX_MEAL_PHOTOS),
  image_hashes: z.array(z.string()).max(MAX_MEAL_PHOTOS),
  // Anular «Analisar outra vez»: volta também o aviso da foto lida pela reserva.
  model_reserve: z.boolean().optional(),
})

const CorrectSchema = MealIdSchema.extend({ text: z.string().trim().min(1).max(500) })

// Analisar sem gravar (Nova favorita): o que leva, ou a foto (com o nome).
const EstimateSchema = z.object({
  text: z.string().max(1000).optional(),
  photo_path: z.string().min(3).optional(),
})

const UpdateSchema = MealIdSchema.extend({
  items: z.array(MealItemInputSchema).min(1).max(30).optional(),
  date: DATE.optional(),
  slot: SLOT.optional(),
  logged_at: z.string().optional(), // só para Anular uma mudança de hora
  note: z.string().max(500).nullable().optional(),
  tags: z.array(TAG).max(5).optional(),
  confirm: z.boolean().optional(),
  undo: z.boolean().optional(), // Anular uma edição: volta atrás sem ensinar a biblioteca
})

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

export function post(run: (ctx: { db: SupabaseClient; userId: string; body: unknown; res: VercelResponse }) => Promise<void>): Handler {
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

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new HttpError(400, 'Pedido inválido.')
  return result.data
}

async function cutoffHour(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
  return data?.nutrition_day_cutoff_hour ?? 4
}

// A análise (e a aprendizagem dos alimentos) continua depois da resposta
// (até aos 60 s da função).
export function inBackground(task: Promise<unknown>) {
  const safe = task.catch((err) => console.error('Em segundo plano falhou:', err))
  waitUntil(safe)
}

// No fim da análise, a refeição segue para quem se escolheu em «Também para
// …» e o telemóvel avisa («Almoço analisado · 640 kcal») se a pessoa o quiser.
async function afterAnalysis(admin: SupabaseClient, meal: Record<string, unknown> | null, notify: boolean) {
  // Uma partilha que falhe não tira o aviso.
  // Numa divisão («A meias»), o aviso diz as kcal da parte de quem registou.
  const shared = await shareAfterAnalysis(admin, meal).catch((err) => {
    console.error('Partilhar falhou:', err)
    return meal
  })
  if (notify) await notifyMealAnalysed(admin, shared ?? meal)
}

// A análise de uma foto de ontem (ou de uma partilha para outro dia) acaba
// depois da resposta: recalcula aí os dias passados que mudaram (M8).
function analyseInBackground(admin: SupabaseClient, mealId: string) {
  inBackground(
    claimAndAnalyse(admin, mealId)
      .then((meal) => afterAnalysis(admin, meal, true))
      .then(() => recomputeDirtyPast(admin)),
  )
}

export async function ownMeal(db: SupabaseClient, mealId: string): Promise<MealRow & Record<string, unknown>> {
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
  const now = new Date()
  const cutoff = await cutoffHour(db)
  const takenMs = input.taken_at ? Date.parse(input.taken_at) : NaN
  let loggedAt: Date
  if (Number.isFinite(takenMs) && takenMs <= now.getTime()) loggedAt = new Date(takenMs)
  else if (input.date) loggedAt = loggedAtFor(input.date, SLOT_TIME[input.slot ?? slotOf(now)], cutoff, now)
  else loggedAt = now

  // A mesma foto já registada perto deste dia: não se analisa outra vez.
  // Noutro dia é o mesmo prato fotografado igual, e regista-se.
  if (input.image_hashes.length) {
    const near = duplicatePhotoWindow(nutritionalDay(loggedAt, cutoff))
    const { data: same } = await db
      .from('meals')
      .select('*')
      .is('deleted_at', null)
      .gte('date', near.from)
      .lte('date', near.to)
      .overlaps('image_hashes', input.image_hashes)
      .limit(1)
    if (same?.[0]) {
      res.status(200).json({ meal: same[0], duplicate: true })
      return
    }
  }

  const withPhotos = input.photo_paths.length > 0
  const admin = adminClient()
  const overLimit = await aiLimitReached(admin, userId, withPhotos)
  const shareWith = shareTargets(input.share_with, userId)
  const row: Record<string, unknown> = {
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
  }
  const split = splitFor(shareWith.length, input.share_split)
  const withShare: Record<string, unknown> = {
    ...row,
    ...(shareWith.length ? { share_with: shareWith } : {}),
    ...(split != null ? { share_split: split } : {}),
  }
  let { data: meal, error } = await db.from('meals').insert(withShare).select().single()
  // Sem a migração 20261018210000 não há `share_split`: partilha na mesma,
  // cada um com a refeição toda (a divisão faz-se depois, pela porção).
  if (error && split != null && /share_split/.test(error.message)) {
    delete withShare.share_split
    ;({ data: meal, error } = await db.from('meals').insert(withShare).select().single())
  }
  // Sem a migração 20261018160000 não há `share_with`: regista na mesma
  // (fica por partilhar à mão, na folha da refeição).
  if (error && shareWith.length && /share_with/.test(error.message)) {
    ;({ data: meal, error } = await db.from('meals').insert(row).select().single())
  }
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

  if (meal.status === 'a_analisar') analyseInBackground(admin, meal.id as string)
  res.status(202).json({ meal })
})

export const analyse = post(async ({ db, userId, body, res }) => {
  const input = parse(AnalyseSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (meal.deleted_at) throw new HttpError(404, 'Refeição apagada.')
  // A outra tentativa pedida pelo telemóvel sozinho, com a refeição que já
  // não está a analisar (erro, sem análise, analisada): fica como está.
  if (input.reread) {
    await rereadMeal(db, userId, meal, res)
    return
  }
  const { skip, reset } = analyseRequest(input, meal.status as string)
  if (skip) {
    res.status(200).json({ meal })
    return
  }
  const admin = adminClient()
  if (!input.force && (await aiLimitReached(admin, userId, (meal.photo_paths ?? []).length > 0))) {
    // Uma foto junta a uma refeição com itens não a tira das contas: fica
    // por rever com os itens que tinha e o aviso de que a foto não foi lida.
    const adding = addingToItems(meal)
    const stopped = adding
      ? { status: 'por_rever', analysis_error: 'Chegaste ao limite da IA que definiste.' }
      : { status: 'sem_analise' }
    if (meal.status === 'a_analisar') await admin.from('meals').update(stopped).eq('id', meal.id)
    res.status(200).json({ meal: { ...meal, ...(!adding || meal.status === 'a_analisar' ? stopped : {}) }, limit: true })
    return
  }
  const result = await claimAndAnalyse(admin, meal.id, reset, { force: input.force === true })
  // «Também para …» que ficou à espera (limite da IA, erro): segue agora. A
  // outra tentativa que o telemóvel pediu sozinho acaba como a da captura,
  // com o aviso «Refeição analisada» (a pessoa pode já ter saído da app).
  if (result) inBackground(afterAnalysis(admin, result, input.auto === true && !reset))
  res.status(200).json({ meal: result ?? (await ownMeal(db, input.meal_id)) })
})

// «Analisar outra vez» (M2): lê as fotos de raiz, com o prompt da primeira
// análise (não o de juntar, que deixava as porções mal lidas como estavam). Só
// numa refeição analisada com fotos e sem o que sobrou descontado; conta para
// o limite diário das fotos e não há «mesmo assim» (S6). Se falhar, a refeição
// fica como estava (itens, estado e o aviso da reserva).
async function rereadMeal(db: SupabaseClient, userId: string, meal: MealRow & Record<string, unknown>, res: VercelResponse) {
  if (meal.status !== 'ok' && meal.status !== 'por_rever') throw new HttpError(409, 'Só se lê outra vez uma refeição já analisada.')
  if (!(meal.photo_paths ?? []).length) throw new HttpError(422, 'Esta refeição não tem fotos para ler outra vez.')
  if (meal.leftover_photo_path) {
    throw new HttpError(409, 'Esta refeição já tem o que sobrou descontado. Anula isso primeiro para a ler outra vez.')
  }
  const admin = adminClient()
  if (await aiLimitReached(admin, userId, true)) {
    res.status(200).json({ meal, limit: true })
    return
  }
  const previous = {
    items: meal.items,
    status: meal.status,
    model_reserve: meal.model_reserve === true,
    confirmed_at: (meal.confirmed_at as string | null) ?? null,
  }
  const result = await claimAndAnalyse(admin, meal.id, true, { reread: true })
  if (result) {
    res.status(200).json({ meal: result, previous })
    return
  }
  // Falhou: volta ao estado de antes, sem o aviso «a foto nova não foi analisada».
  const failed = await ownMeal(db, meal.id)
  const reason = failed.analysis_error ? splitStoredError(failed.analysis_error as string).message : null
  const { data: restored } = await admin
    .from('meals')
    .update({ status: previous.status, confirmed_at: previous.confirmed_at, analysis_error: null })
    .eq('id', meal.id)
    .eq('status', 'por_rever')
    .is('analysis_started_at', null)
    .select()
  res.status(200).json({ meal: restored?.[0] ?? failed, reread_error: reason ?? 'Não consegui ler a foto outra vez.' })
}

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
  // Numa refeição com itens (analisada, de código de barras, favorita, só
  // números…) os itens ficam: a IA só junta o que é novo nas fotos, e o tipo
  // de registo não muda. Acima do limite não se junta (os itens deixavam de
  // contar até haver análise).
  const keeping = (meal.status === 'ok' || meal.status === 'por_rever') && addingToItems({ items: meal.items, photo_paths: photoPaths })
  if (keeping && overLimit) throw new HttpError(429, 'Chegaste ao limite da IA que definiste. A foto não foi junta.')
  const previous = keeping
    ? { items: meal.items, status: meal.status, photo_paths: current, thumb_paths: thumbs, image_hashes: hashes }
    : null
  const { data, error } = await db
    .from('meals')
    .update({
      photo_paths: photoPaths,
      photo_path: photoPaths[0],
      thumb_paths: [...thumbs, ...input.thumb_paths.filter((p) => !thumbs.includes(p))],
      image_hashes: [...hashes, ...input.image_hashes.filter((h) => !hashes.includes(h))],
      ...(keeping ? {} : { input_type: 'photo', is_estimate: true }),
      status: overLimit ? 'sem_analise' : 'a_analisar',
      analysis_attempts: 0,
      analysis_started_at: null,
      analysis_error: null,
      // A confirmação de uma refeição «ok» fica: o que a foto junta de certo
      // não a põe por rever; numa por rever, só «Está certo» a confirma (M10).
      ...(keeping && meal.status === 'ok' ? {} : { confirmed_at: null }),
    })
    .eq('id', meal.id)
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  if (data.status === 'a_analisar') analyseInBackground(admin, meal.id)
  res.status(202).json({ meal: data, previous })
})

export const detach = post(async ({ db, body, res }) => {
  const input = parse(DetachSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (meal.deleted_at) throw new HttpError(404, 'Refeição apagada.')
  const keep = (list: string[] | null | undefined, wanted: string[]) => (list ?? []).filter((x) => wanted.includes(x))
  const photoPaths = keep(meal.photo_paths, input.photo_paths)
  const items = (input.items as MealItem[]).map((i) => ({ ...i, grams: round1(i.grams) }))
  const tags = (meal.tags ?? []) as string[]
  // Sem a reivindicação, uma análise ainda a correr já não grava por cima.
  const { data, error } = await db
    .from('meals')
    .update({
      items,
      ...mealTotals(items),
      is_estimate: mealIsEstimate(meal.input_type === 'photo' ? 'photo' : 'text', tags.includes('jantar_fora'), items),
      photo_paths: photoPaths,
      photo_path: photoPaths[0] ?? null,
      thumb_paths: keep(meal.thumb_paths as string[] | null, input.thumb_paths),
      image_hashes: keep(meal.image_hashes as string[] | null, input.image_hashes),
      status: input.status,
      confirmed_at: input.status === 'ok' ? new Date().toISOString() : null,
      analysis_started_at: null,
      analysis_error: null,
    })
    .eq('id', meal.id)
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  // À parte e sem falhar (sem a migração 20261018150002 a coluna não existe).
  if (input.model_reserve != null && 'model_reserve' in meal) {
    const { error: reserveError } = await db.from('meals').update({ model_reserve: input.model_reserve }).eq('id', meal.id)
    if (!reserveError) data.model_reserve = input.model_reserve
  }
  res.status(200).json({ meal: data })
})

export const correct = post(async ({ db, userId, body, res }) => {
  const input = parse(CorrectSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (meal.status === 'a_analisar') throw new HttpError(409, 'Ainda a analisar. Junta uma nota em vez disso.')
  if (!meal.items?.length) throw new HttpError(422, 'Esta refeição ainda não tem itens.')
  const previous = { items: meal.items, status: meal.status }
  const admin = adminClient()
  // As correções também gastam IA: respeitam o teto do mês (M20).
  if (await aiLimitReached(admin, userId, false)) throw new HttpError(429, 'Chegaste ao limite da IA (Definições › Avançado).')
  const { items } = await correctItems(admin, userId, meal.items, input.text)
  const tags = (meal.tags ?? []) as string[]
  const { data, error } = await db
    .from('meals')
    .update({
      items,
      ...mealTotals(items),
      is_estimate: mealIsEstimate(meal.input_type === 'photo' ? 'photo' : 'text', tags.includes('jantar_fora'), items),
      status: 'ok',
      confirmed_at: new Date().toISOString(),
      analysis_error: null,
    })
    .eq('id', meal.id)
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  inBackground(learnFoods(db, userId, itemsToLearn('editada', meal.input_type, items, meal.items), meal.input_type))
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

  if (input.note !== undefined) patch.note = input.note?.trim() || null

  // Uma nota ou etiqueta nova (M1): com a análise terminada, corrige os itens
  // (Haiku, sem foto) com o que mudou, a dizer o que já estava aplicado para
  // não cortar duas vezes (M4). A correr, fica guardada e a escrita protegida
  // da análise aplica-a. Itens escritos à mão com a nota (Anular) dizem que
  // essa nota e essas etiquetas são as que estão nos números.
  const hasTagsColumn = 'analysis_tags' in meal
  const applied = {
    note: (meal.analysis_note as string | null | undefined) ?? null,
    tags: (hasTagsColumn ? (meal.analysis_tags as string[] | null) : null) ?? ((meal.tags ?? []) as string[]),
  }
  const next = {
    note: input.note !== undefined ? (patch.note as string | null) : ((meal.note as string | null) ?? null),
    tags,
  }
  let corrected = false
  const touched = input.note !== undefined || input.tags !== undefined
  if (touched && !items && meal.status !== 'a_analisar' && meal.items?.length) {
    const correction = correctionText(applied, next)
    if (correction) {
      const admin = adminClient()
      // As correções também gastam IA: respeitam o teto do mês (M20).
      if (await aiLimitReached(admin, userId, false)) {
        throw new HttpError(429, 'Chegaste ao limite da IA: a nota não foi aplicada. Acerta os gramas à mão.')
      }
      items = (await correctItems(admin, userId, meal.items, correction, undefined, appliedText(applied))).items
      corrected = true
      // A nota pode dizer como dividiram o pedido: sai o «Pedido para 2», para
      // a porção não ser cortada duas vezes (só com a migração 20261018220000).
      if (meal.order_people != null) patch.order_people = null
    }
  }
  if (touched && (corrected || items)) {
    if (next.note !== applied.note) patch.analysis_note = next.note
    if (hasTagsColumn && !sameTags(next.tags, applied.tags)) patch.analysis_tags = next.tags
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
  // Mexer nos itens ou confirmar dá por visto o aviso da foto que não foi analisada.
  if ((items || input.confirm === true) && meal.status !== 'a_analisar' && meal.analysis_error) patch.analysis_error = null
  // Anular um «Está certo».
  if (input.confirm === false && meal.status === 'ok') {
    patch.status = 'por_rever'
    patch.confirmed_at = null
  }
  if (Object.keys(patch).length === 0) {
    res.status(200).json({ meal, previous, corrected })
    return
  }
  const { data, error } = await db.from('meals').update(patch).eq('id', meal.id).select().single()
  if (error) throw new HttpError(500, error.message)
  // O que a pessoa corrigiu, ou confirmou com «Está certo», ensina a biblioteca
  // (Anular não ensina outra vez o que já lá estava).
  let learned: MealItem[] = []
  if (input.undo) learned = []
  else if (items) learned = itemsToLearn('editada', meal.input_type, patch.items as MealItem[], meal.items)
  else if (input.confirm === true && meal.status === 'por_rever') learned = itemsToLearn('confirmada', meal.input_type, meal.items)
  if (learned.length) inBackground(learnFoods(db, userId, learned, meal.input_type))
  res.status(200).json({ meal: data, previous, corrected })
})

export const estimate = post(async ({ userId, body, res }) => {
  const input = parse(EstimateSchema, body)
  const text = input.text?.trim() || null
  const photo = input.photo_path ?? null
  if (!text && !photo) throw new HttpError(400, 'Falta a foto ou o texto.')
  // A foto é lida com a service role: tem de estar na pasta de quem pede.
  if (photo && (!photo.startsWith(`${userId}/`) || photo.includes('..'))) throw new HttpError(403, 'Fotografia inválida.')
  const admin = adminClient()
  if (await aiLimitReached(admin, userId, photo != null)) {
    throw new HttpError(429, 'Chegaste ao limite da IA (Definições › Avançado).')
  }
  const result = await estimateItems(admin, userId, { text, photo_paths: photo ? [photo] : [] })
  res.status(200).json(result)
})
