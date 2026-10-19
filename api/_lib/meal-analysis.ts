import type { SupabaseClient } from '@supabase/supabase-js'
import { MODELS, NO_THINKING, REQUEST_TEXT, REQUEST_VISION, aiProvider, structuredCall } from './anthropic.js'
import { AiError, describeAiError, errorForStorage } from './rules/resposta-ia.js'
import { MealAnalysisSchema, MealPhotoAnalysisSchema, type MealAnalysis, type MealPhotoAnalysis } from './schemas.js'
import {
  PROMPT_MEAL_CORRECT,
  PROMPT_MEAL_PHOTO_ADD,
  PROMPT_MEAL_PHOTO_V3,
  PROMPT_MEAL_TEXT_V2,
  promptVersion,
  readPrompt,
} from './prompts.js'
import { mealTotals, type MealItem } from './rules/meal-totals.js'
import { analysedStatus, foodRefs, guardedWrite, mergeAdded, toMealItems } from './rules/analise.js'
import { mealIsEstimate } from './rules/estimativas.js'
import { clockTime, lisbonClock, lisbonInstant } from './rules/momentos.js'
import { VISION_KINDS, aiLimitsFor, dailyVisionCapReached, monthlyCapReached } from './rules/custos.js'
import { itemsToLearn } from './rules/aprender.js'
import { learnFoods } from './foods.js'
import { LEFTOVERS_ADD_HINT, mergeAfterLeftovers } from './rules/sobras.js'
import { dedupeOrderLines, dropNonFood, orderPeople, pendingSplit, type Order } from './rules/pedido.js'

// Análise de refeições em segundo plano (Fase 2): a refeição já existe com
// estado 'a_analisar'; aqui lê-se a foto e/ou o texto, e o resultado grava-se
// com a escrita protegida (a nota pode mudar a meio).

export interface MealRow {
  id: string
  user_id: string
  input_type: string
  raw_text: string | null
  note: string | null
  tags: string[] | null
  slot: string | null
  logged_at: string
  photo_paths: string[] | null
  items: MealItem[]
  status: string
  analysis_started_at: string | null
  analysis_attempts: number
  deleted_at: string | null
  model_reserve?: boolean // migração 20261018150002
  leftover_photo_path?: string | null // migração 20261018200000 («Sobrou comida?»)
  portion_factor?: number | null
  share_with?: string[] | null // migração 20261018160000
  share_split?: number | null // migração 20261018210000
  order_people?: number | null // migração 20261018220000 (pedido de entrega para 2 ou mais)
}

const ANALYSIS_BUDGET_MS = 50_000

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

function mediaTypeFor(path: string): ImageMediaType {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

// As fotos da refeição (Storage, com a service role) como blocos de imagem
// para a IA, pela ordem dada.
export async function photoContent(admin: SupabaseClient, paths: string[]) {
  return Promise.all(
    paths.map(async (path) => {
      const { data, error } = await admin.storage.from('meal-photos').download(path)
      if (error || !data) throw new AiError('Uma das fotos não foi encontrada. Junta-a outra vez.', `storage: ${path}: ${error?.message ?? 'sem dados'}`)
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: mediaTypeFor(path),
          data: Buffer.from(await data.arrayBuffer()).toString('base64'),
        },
      }
    }),
  )
}

export async function foodLibrary(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from('foods')
    .select('id,name,default_portion_g,kcal_100g,protein_100g,carbs_100g,fat_100g')
    .eq('user_id', userId)
    .order('use_count', { ascending: false })
    .limit(40)
  const foods = data ?? []
  const { refs, byId } = foodRefs(foods.map((f) => f.id as string))
  const forPrompt = foods.map((f) => ({
    ref: byId.get(f.id as string),
    nome: f.name,
    porcao_habitual_g: f.default_portion_g,
    kcal_100g: f.kcal_100g,
    proteina_100g: f.protein_100g,
    hidratos_100g: f.carbs_100g,
    gordura_100g: f.fat_100g,
  }))
  return { refs, forPrompt }
}

// Limites da IA: teto mensal em euros e limite diário de fotos (com o
// Gemini, as fotos de toda a casa, que partilha a chave; sem euros).
export async function aiLimitReached(
  admin: SupabaseClient,
  userId: string,
  withPhotos: boolean,
): Promise<boolean> {
  const now = new Date()
  const limits = aiLimitsFor(aiProvider())
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const dayStart = lisbonInstant(lisbonClock(now).date, '00:00').toISOString()
  let visionQuery = admin
    .from('api_calls')
    .select('id', { count: 'exact', head: true })
    .in('kind', VISION_KINDS)
    .gte('created_at', dayStart)
  if (!limits.sharedDaily) visionQuery = visionQuery.eq('user_id', userId)
  const [{ data: profile }, { data: monthCalls }, { count: visionToday }] = await Promise.all([
    admin.from('profile').select('ai_monthly_cap_eur,ai_daily_vision_cap').eq('user_id', userId).maybeSingle(),
    limits.monthlyEur
      ? admin.from('api_calls').select('cost_usd').eq('user_id', userId).gte('created_at', monthStart)
      : Promise.resolve({ data: [] as { cost_usd: number }[] }),
    withPhotos ? visionQuery : Promise.resolve({ count: 0 }),
  ])
  const monthUsd = (monthCalls ?? []).reduce((acc, c) => acc + Number(c.cost_usd), 0)
  if (limits.monthlyEur && monthlyCapReached(monthUsd, Number(profile?.ai_monthly_cap_eur ?? 10))) return true
  return withPhotos && dailyVisionCapReached(visionToday ?? 0, Number(profile?.ai_daily_vision_cap ?? 40))
}

// Correção por texto (Haiku, sem imagem): «o arroz era metade», «comi metade».
export async function correctItems(
  admin: SupabaseClient,
  userId: string,
  items: MealItem[],
  correction: string,
): Promise<{ items: MealItem[]; title: string; confidence: MealAnalysis['meal_confidence'] }> {
  const { refs, forPrompt } = await foodLibrary(admin, userId)
  const byFood = new Map(Object.entries(refs).map(([ref, id]) => [id, ref]))
  const payload = JSON.stringify({
    itens: items.map((i) => ({
      name: i.name,
      grams: i.grams,
      kcal: i.kcal,
      protein: i.protein,
      carbs: i.carbs,
      fat: i.fat,
      confidence: i.confidence ?? (i.estimated ? 'media' : 'alta'),
      food_ref: i.food_id ? (byFood.get(i.food_id) ?? null) : null,
    })),
    correcao: correction,
    alimentos: forPrompt,
  })
  const { output: parsed } = await structuredCall(
    admin,
    { userId, kind: 'meal_correct', request: REQUEST_TEXT },
    {
      model: MODELS.text,
      max_tokens: 4096,
      temperature: 0,
      system: readPrompt(PROMPT_MEAL_CORRECT),
      messages: [{ role: 'user', content: payload }],
    },
    MealAnalysisSchema,
  )
  if (parsed.items.length === 0) throw new AiError('Não consegui aplicar a correção.', 'correção sem itens')
  // Os itens que a correção não tocou mantêm o food_id original.
  const corrected = toMealItems(parsed.items, refs).map((item) => {
    const same = items.find((i) => i.name === item.name && i.food_id)
    return item.food_id || !same ? item : { ...item, food_id: same.food_id }
  })
  return { items: corrected, title: parsed.title, confidence: parsed.meal_confidence }
}

// Fotos juntas a uma refeição que já tinha itens («Juntar foto» numa refeição
// analisada, de código de barras, favorita…): os itens ficam e a IA só junta
// o que é novo.
export function addingToItems(meal: Pick<MealRow, 'items' | 'photo_paths'>): boolean {
  return (meal.items?.length ?? 0) > 0 && (meal.photo_paths?.length ?? 0) > 0
}

// O que a análise lê de uma refeição (ou de um pedido sem refeição gravada).
type ModelInput = Pick<MealRow, 'user_id' | 'raw_text' | 'note' | 'tags' | 'slot' | 'logged_at' | 'photo_paths' | 'items'> &
  Partial<Pick<MealRow, 'leftover_photo_path'>>

async function runModel(
  admin: SupabaseClient,
  meal: ModelInput,
): Promise<{
  analysis: MealAnalysis
  order: Order | null
  refs: Record<string, string>
  model: string
  prompt: string
  cost: number
  reserve: boolean
}> {
  const { refs, forPrompt } = await foodLibrary(admin, meal.user_id)
  const photos = meal.photo_paths ?? []
  const adding = addingToItems(meal)
  const byFood = new Map(Object.entries(refs).map(([ref, id]) => [id, ref]))
  const payload = JSON.stringify({
    ...(adding
      ? {
          itens_atuais: meal.items.map((i) => ({
            name: i.name,
            grams: i.grams,
            kcal: i.kcal,
            protein: i.protein,
            carbs: i.carbs,
            fat: i.fat,
            confidence: i.confidence ?? (i.estimated ? 'media' : 'alta'),
            food_ref: i.food_id ? (byFood.get(i.food_id) ?? null) : null,
          })),
          ...(meal.leftover_photo_path ? { sobras: LEFTOVERS_ADD_HINT } : {}),
        }
      : {}),
    texto: meal.raw_text || null,
    nota: meal.note || null,
    etiquetas: meal.tags ?? [],
    hora_local: clockTime(new Date(meal.logged_at)),
    momento: meal.slot,
    alimentos: forPrompt,
  })
  const photoPrompt = adding ? PROMPT_MEAL_PHOTO_ADD : PROMPT_MEAL_PHOTO_V3

  if (photos.length > 0) {
    const images = await photoContent(admin, photos.slice(0, 4))
    const meta = { userId: meal.user_id, kind: 'meal_photo', request: REQUEST_VISION }
    const params = {
      model: MODELS.vision,
      max_tokens: 4096,
      thinking: NO_THINKING,
      system: readPrompt(photoPrompt),
      messages: [{ role: 'user' as const, content: [...images, { type: 'text' as const, text: payload }] }],
    }
    // A primeira análise lê também o pedido de entrega (captura do resumo do
    // Glovo, Uber Eats…), num schema só das fotos; o juntar fica como estava.
    let call: { output: MealPhotoAnalysis; cost: number; model: string; reserve: boolean }
    if (adding) {
      const added = await structuredCall(admin, meta, params, MealAnalysisSchema)
      call = { ...added, output: { ...added.output, order: null } }
    } else {
      call = await structuredCall(admin, meta, params, MealPhotoAnalysisSchema)
    }
    const { order, ...output } = call.output
    // Taxas, gorjeta, saco, talheres ou totais nunca contam, mesmo que a IA os
    // deixe passar; e a mesma linha de duas capturas sobrepostas conta uma vez.
    let items = dropNonFood(output.items)
    if (order && images.length > 1) items = dedupeOrderLines(items)
    const analysis: MealAnalysis = { ...output, items }
    // A juntar, «nada de novo» é uma resposta válida: ficam os itens que havia.
    if (analysis.items.length === 0 && !adding) {
      throw new AiError('Não vi comida nesta foto. Escreve o que comeste.', 'análise sem itens')
    }
    // A reserva das fotos é o modelo do texto, que acerta menos nas porções.
    return { analysis, order, refs, model: call.model, prompt: promptVersion(photoPrompt), cost: call.cost, reserve: call.reserve }
  }

  const { output: analysis, cost, model } = await structuredCall(
    admin,
    { userId: meal.user_id, kind: 'meal_text', request: REQUEST_TEXT },
    {
      model: MODELS.text,
      max_tokens: 4096,
      temperature: 0,
      system: readPrompt(PROMPT_MEAL_TEXT_V2),
      messages: [{ role: 'user', content: payload }],
    },
    MealAnalysisSchema,
  )
  if (analysis.items.length === 0) throw new AiError('Não percebi o que comeste. Escreve de outra forma.', 'análise sem itens')
  return { analysis, order: null, refs, model, prompt: promptVersion(PROMPT_MEAL_TEXT_V2), cost, reserve: false }
}

// Analisar sem gravar (a «Nova favorita» escrita ou com foto): o mesmo
// caminho das refeições (biblioteca com referências curtas, confiança por
// item e as guardas dos números), sem linha em meals. Com foto, o texto é a
// descrição dela.
export async function estimateItems(
  admin: SupabaseClient,
  userId: string,
  input: { text: string | null; photo_paths: string[] },
): Promise<{ items: MealItem[]; title: string; confidence: MealAnalysis['meal_confidence'] }> {
  const { analysis, refs } = await runModel(admin, {
    user_id: userId,
    raw_text: input.text,
    note: null,
    tags: [],
    slot: null,
    logged_at: new Date().toISOString(),
    photo_paths: input.photo_paths,
    items: [],
  })
  return { items: toMealItems(analysis.items, refs), title: analysis.title, confidence: analysis.meal_confidence }
}

// Analisa uma refeição já reivindicada (claim_meal_analysis) e grava o
// resultado. Devolve a linha gravada, ou null se outra tentativa mandou.
export async function analyseClaimed(admin: SupabaseClient, meal: MealRow): Promise<Record<string, unknown> | null> {
  const claimedAt = meal.analysis_started_at
  if (!claimedAt) return null
  const startedAt = Date.now()
  try {
    const { analysis, order, refs, model, prompt, cost, reserve } = await runModel(admin, meal)
    const analysed = toMealItems(analysis.items, refs)
    const adding = addingToItems(meal)
    // Um pedido de entrega para 2 ou mais em que a pessoa não disse como o
    // dividiu fica por rever, com a dica «Pedido para 2» (rules/pedido.ts). A
    // juntar fotos, fica o que a primeira análise disse.
    const people = pendingSplit(orderPeople(adding ? meal.order_people : order?.people), meal)
    // Já descontado o que sobrou: só entra o que é novo (rules/sobras.ts).
    const items = !adding ? analysed : meal.leftover_photo_path ? mergeAfterLeftovers(meal.items, analysed) : mergeAdded(meal.items, analysed)
    const tags = meal.tags ?? []
    const inputType = meal.input_type === 'photo' ? 'photo' : 'text'

    const written = await guardedWrite(items, meal.note, claimedAt, {
      write: async (finalItems, noteUsed) => {
        // Uma nota que chegou a meio já foi aplicada pela correção e pode dizer
        // como dividiram («comemos a meias»): aí não há dica, para não cortar duas vezes.
        const split = noteUsed === (meal.note ?? null) ? people : null
        const status = split != null ? 'por_rever' : analysedStatus(finalItems, analysis.meal_confidence)
        const patch: Record<string, unknown> = {
          items: finalItems,
          ...mealTotals(finalItems),
          status,
          // Um pedido é comida de restaurante, como «jantar fora».
          is_estimate: mealIsEstimate(inputType, tags.includes('jantar_fora') || order != null, finalItems),
          confidence: analysis.meal_confidence === 'alta' ? 0.9 : analysis.meal_confidence === 'media' ? 0.6 : 0.3,
          raw_text: meal.raw_text ?? analysis.title,
          analysis_note: noteUsed,
          analysis_error: null,
          model,
          prompt_version: prompt,
          cost_usd: cost,
        }
        // Para quantas pessoas é o pedido (migração 20261018220000), na
        // primeira análise: uma análise nova limpa o que a de antes disse.
        if (!adding && (split != null || 'order_people' in meal)) patch.order_people = split
        const run = (values: Record<string, unknown>) => {
          let query = admin.from('meals').update(values).eq('id', meal.id).eq('analysis_started_at', claimedAt)
          query = noteUsed == null ? query.is('note', null) : query.eq('note', noteUsed)
          return query.select()
        }
        let { data, error } = await run(patch)
        // Sem a migração não há `order_people`: grava na mesma, sem a dica.
        if (error && 'order_people' in patch && /order_people/.test(error.message)) {
          delete patch.order_people
          ;({ data } = await run(patch))
        }
        return (data?.[0] as Record<string, unknown> | undefined) ?? null
      },
      reread: async () => {
        const { data } = await admin
          .from('meals')
          .select('note,analysis_started_at,deleted_at')
          .eq('id', meal.id)
          .maybeSingle()
        if (!data) return null
        return {
          note: data.note as string | null,
          startedAt: data.analysis_started_at as string | null,
          deleted: data.deleted_at != null,
        }
      },
      correct: async (current, note) => {
        if (Date.now() - startedAt > ANALYSIS_BUDGET_MS) return current
        return (await correctItems(admin, meal.user_id, current, note)).items
      },
    })
    // Foto lida pelo modelo de reserva: a folha da refeição diz porquê. À
    // parte e sem falhar (sem a migração 20261018150002 a coluna não existe).
    if (written && (reserve || meal.model_reserve)) {
      const { error } = await admin.from('meals').update({ model_reserve: reserve }).eq('id', meal.id)
      if (!error) written.model_reserve = reserve
    }
    // Uma refeição de texto ensina logo o que tem confiança alta (as fotos
    // e o que se juntou por foto só depois de confirmados).
    if (written && !adding && meal.input_type === 'text') {
      await learnFoods(admin, meal.user_id, itemsToLearn('analisada', 'text', written.items as MealItem[]), 'text')
    }
    return written
  } catch (err) {
    console.error('Análise falhou:', err)
    // Um erro passageiro (demora, sobrecarga) solta a análise para o telemóvel
    // pedir outra tentativa já; um erro que se ia repetir (chave, pedido
    // recusado, foto em falta) ou a 3.ª tentativa passam logo a «erro», com o
    // motivo e o botão «Tentar outra vez».
    // A juntar fotos a uma refeição com itens, a falha não a tira das contas:
    // volta a «por rever» com os itens que tinha e o motivo à vista.
    const retry = describeAiError(err).transient && meal.analysis_attempts < 3
    const failed = addingToItems(meal) ? { status: 'por_rever', analysis_started_at: null } : { status: 'erro' }
    await admin
      .from('meals')
      .update({
        analysis_error: errorForStorage(err),
        ...(retry ? { analysis_started_at: null } : failed),
      })
      .eq('id', meal.id)
      .eq('analysis_started_at', claimedAt)
    return null
  }
}

// Reivindica e analisa (usado em segundo plano pelo capture e pelo analyse).
// Um erro passageiro rápido (sobrecarga, formato) tenta outra vez na mesma
// função, enquanto houver tempo para uma segunda chamada.
const SECOND_TRY_BEFORE_MS = 15_000

export async function claimAndAnalyse(
  admin: SupabaseClient,
  mealId: string,
  reset = false,
): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now()
  for (let round = 0; round < 2; round++) {
    const { data, error } = await admin.rpc('claim_meal_analysis', {
      p_meal_id: mealId,
      p_reset: reset && round === 0,
    })
    if (error) throw new Error(error.message)
    const claimed = (Array.isArray(data) ? data[0] : data) as MealRow | undefined
    if (!claimed) return null
    const result = await analyseClaimed(admin, claimed)
    if (result || Date.now() - startedAt > SECOND_TRY_BEFORE_MS) return result
  }
  return null
}
