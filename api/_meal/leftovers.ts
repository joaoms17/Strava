import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { adminClient, HttpError } from '../_lib/supabase.js'
import { LeftoversAnswerSchema, MealItemInputSchema } from '../_lib/schemas.js'
import { MODELS, NO_THINKING, REQUEST_VISION, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_MEAL_LEFTOVERS, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached, photoContent, type MealRow } from '../_lib/meal-analysis.js'
import { learnFoods } from '../_lib/foods.js'
import { mealTotals, round1, type MealItem } from '../_lib/rules/meal-totals.js'
import { mealIsEstimate } from '../_lib/rules/estimativas.js'
import { itemsToLearn } from '../_lib/rules/aprender.js'
import {
  applyLeftovers,
  canTakeLeftovers,
  eatenShares,
  leftoversOutcome,
  mealFolder,
  platePhotos,
  statusAfterLeftovers,
  type LeftoversAnswer,
  type PlateMeal,
} from '../_lib/rules/sobras.js'
import { inBackground, ownMeal, parse, post } from './async.js'

// «Sobrou comida?» (foto do antes e do depois): a pessoa fotografa o que
// sobrou de uma refeição por foto já analisada; a IA compara com as fotos do
// prato cheio e diz, por item, que parte foi comida. Os itens escalam nessa
// proporção (nada de novo entra) e a foto do depois fica na refeição, à
// parte das fotos do prato (nunca vai para a análise nem para o «Juntar
// foto»). Devolve `previous` para Anular, como o «Juntar foto».

export const LEFTOVERS_MIGRATION = '20261018200000_sobras.sql'
const MISSING_MIGRATION = `Falta um passo no Supabase: corre a migração ${LEFTOVERS_MIGRATION}.`

// Até 3 fotos do prato cheio com a do depois (no máximo 4 imagens por pedido).
const MAX_BEFORE_PHOTOS = 3

const LeftoversSchema = z.object({
  meal_id: z.string().uuid(),
  photo_path: z.string().min(3),
  thumb_path: z.string().min(3).optional(),
  image_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  note: z.string().max(500).optional(), // escrita com a foto do depois, no ＋
})

// Anular: os itens e o estado de antes, sem a foto do depois (só se ainda for
// a mesma foto).
const UndoSchema = z.object({
  meal_id: z.string().uuid(),
  photo_path: z.string().min(3),
  items: z.array(MealItemInputSchema).min(1).max(30),
  status: z.enum(['ok', 'por_rever']),
})

type Meal = MealRow & Record<string, unknown>

// As fotos do antes por ordem e a do depois em último, com os itens contados
// (pelo índice, que é como a resposta os refere).
async function readLeftovers(
  admin: SupabaseClient,
  meal: Meal,
  before: string[],
  after: string,
  afterNote: string | null,
): Promise<LeftoversAnswer> {
  const payload = JSON.stringify({
    fotos_antes: before.length,
    itens: meal.items.map((item, indice) => ({
      indice,
      name: item.name,
      grams: item.grams,
      kcal: item.kcal,
      confidence: item.confidence ?? (item.estimated ? 'media' : 'alta'),
    })),
    texto: meal.raw_text || null,
    nota: meal.note || null,
    nota_depois: afterNote,
  })
  const images = await photoContent(admin, [...before, after])
  const { output } = await structuredCall(
    admin,
    { userId: meal.user_id, kind: 'meal_leftovers', request: REQUEST_VISION },
    {
      model: MODELS.vision,
      max_tokens: 2048,
      thinking: NO_THINKING,
      system: readPrompt(PROMPT_MEAL_LEFTOVERS),
      messages: [{ role: 'user', content: [...images, { type: 'text', text: payload }] }],
    },
    LeftoversAnswerSchema,
  )
  return output
}

function estimateFor(meal: Meal, items: MealItem[]): boolean {
  const tags = (meal.tags ?? []) as string[]
  return mealIsEstimate(meal.input_type === 'photo' ? 'photo' : 'text', tags.includes('jantar_fora'), items)
}

export const leftovers = post(async ({ db, userId, body, res }) => {
  const input = parse(LeftoversSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (!('leftover_photo_path' in meal)) throw new HttpError(503, MISSING_MIGRATION)
  if (meal.deleted_at) throw new HttpError(404, 'Refeição apagada.')
  if (meal.status === 'a_analisar') throw new HttpError(409, 'Ainda a analisar. Espera uns segundos e tenta outra vez.')
  if (meal.leftover_photo_path) throw new HttpError(409, 'Esta refeição já tem a foto do que sobrou.')
  const plate = meal as unknown as PlateMeal
  const before = platePhotos(plate)
  if (!canTakeLeftovers(plate)) {
    throw new HttpError(
      422,
      before.length ? 'Esta refeição ainda não tem números para descontar.' : 'Para descontar o que sobrou, a refeição precisa da foto do prato cheio.',
    )
  }
  // As fotos são lidas com a service role: têm de estar na pasta desta refeição.
  const folder = mealFolder(plate)
  const paths = [input.photo_path, ...(input.thumb_path ? [input.thumb_path] : [])]
  if (paths.some((p) => !p.startsWith(folder) || p.includes('..'))) throw new HttpError(403, 'Fotografia inválida.')
  const hashes = (meal.image_hashes ?? []) as string[]
  if ((meal.photo_paths ?? []).includes(input.photo_path) || (input.image_hash && hashes.includes(input.image_hash))) {
    throw new HttpError(422, 'Esta é a foto do prato cheio. Tira uma do que sobrou.')
  }
  const admin = adminClient()
  if (await aiLimitReached(admin, userId, true)) {
    throw new HttpError(429, 'Chegaste ao limite da IA que definiste. Escreve o que sobrou em «Corrigir por texto».')
  }

  // Reivindica a refeição (como a análise, por analysis_started_at): um
  // «Juntar foto» ou uma análise que entretanto lhe mexa ganha, e esta
  // resposta já não grava por cima.
  const { data: claimed, error: claimError } = await db
    .from('meals')
    .update({ analysis_started_at: new Date().toISOString() })
    .eq('id', meal.id)
    .in('status', ['ok', 'por_rever'])
    .is('leftover_photo_path', null)
    .select('analysis_started_at')
  if (claimError) throw new HttpError(500, claimError.message)
  const claimedAt = claimed?.[0]?.analysis_started_at as string | undefined
  if (!claimedAt) throw new HttpError(409, 'A refeição mudou entretanto. Abre-a outra vez.')

  const items = meal.items as MealItem[]
  const answer = await readLeftovers(admin, meal, before.slice(0, MAX_BEFORE_PHOTOS), input.photo_path, input.note?.trim() || null)
  const shares = eatenShares(items, answer)
  const outcome = leftoversOutcome(answer, shares)
  // Outro prato, ou o prato como estava: não muda nada (no ＋, a foto fica
  // para registar como refeição nova).
  if (outcome === 'outro_prato' || outcome === 'igual') {
    res.status(200).json({ outcome, reason: answer.reason?.trim() || null, meal })
    return
  }

  // Comeu tudo: os números ficam, e a foto do depois guarda-se (já não se
  // pergunta outra vez).
  const applied = outcome === 'aplicado' ? applyLeftovers(items, shares) : { items, leftKcal: 0 }
  const status = statusAfterLeftovers(meal.status as 'ok' | 'por_rever', applied.items)
  const { data, error } = await db
    .from('meals')
    .update({
      items: applied.items,
      ...mealTotals(applied.items),
      is_estimate: estimateFor(meal, applied.items),
      status,
      ...(status === 'por_rever' ? { confirmed_at: null } : {}),
      leftover_photo_path: input.photo_path,
      leftover_thumb_path: input.thumb_path ?? null,
      leftover_kcal: applied.leftKcal,
    })
    .eq('id', meal.id)
    .eq('analysis_started_at', claimedAt)
    .in('status', ['ok', 'por_rever'])
    .is('leftover_photo_path', null)
    .select()
  if (error) throw new HttpError(500, error.message)
  const written = data?.[0]
  if (!written) throw new HttpError(409, 'A refeição mudou enquanto comparava as fotos. Abre-a outra vez e tenta de novo.')
  // O que sobrou corrige os gramas comidos: ensina como uma edição (decisão 210).
  if (outcome === 'aplicado') {
    inBackground(learnFoods(db, userId, itemsToLearn('editada', meal.input_type, applied.items, items), meal.input_type))
  }
  res.status(200).json({ outcome, meal: written, previous: { items, status: meal.status } })
})

export const leftoversUndo = post(async ({ db, body, res }) => {
  const input = parse(UndoSchema, body)
  const meal = await ownMeal(db, input.meal_id)
  if (!('leftover_photo_path' in meal)) throw new HttpError(503, MISSING_MIGRATION)
  if (meal.deleted_at) throw new HttpError(404, 'Refeição apagada.')
  const items = (input.items as MealItem[]).map((i) => ({ ...i, grams: round1(i.grams) }))
  // A foto do depois fica sem dono e sai na limpeza de domingo.
  const { data, error } = await db
    .from('meals')
    .update({
      items,
      ...mealTotals(items),
      is_estimate: estimateFor(meal, items),
      status: input.status,
      confirmed_at: input.status === 'ok' ? ((meal.confirmed_at as string | null) ?? new Date().toISOString()) : null,
      leftover_photo_path: null,
      leftover_thumb_path: null,
      leftover_kcal: null,
    })
    .eq('id', meal.id)
    .eq('leftover_photo_path', input.photo_path)
    .select()
  if (error) throw new HttpError(500, error.message)
  if (!data?.[0]) throw new HttpError(409, 'Já não dá para anular: a foto do que sobrou mudou.')
  res.status(200).json({ meal: data[0] })
})
