import type { SupabaseClient } from '@supabase/supabase-js'
import { MODELS, NO_THINKING, REQUEST_TEXT, REQUEST_VISION, structuredCall } from './anthropic.js'
import { AiError, describeAiError, errorForStorage } from './rules/resposta-ia.js'
import { MealAnalysisSchema, type MealAnalysis } from './schemas.js'
import {
  PROMPT_MEAL_CORRECT,
  PROMPT_MEAL_PHOTO_V2,
  PROMPT_MEAL_TEXT_V2,
  promptVersion,
  readPrompt,
} from './prompts.js'
import { mealTotals, type MealItem } from './rules/meal-totals.js'
import { analysedStatus, foodRefs, guardedWrite, toMealItems } from './rules/analise.js'
import { mealIsEstimate } from './rules/estimativas.js'
import { clockTime, lisbonClock, lisbonInstant } from './rules/momentos.js'
import { dailyVisionCapReached, monthlyCapReached } from './rules/custos.js'

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
}

const VISION_KINDS = ['meal_photo', 'meal_parse_photo', 'workout_shot', 'menu_pick']
const ANALYSIS_BUDGET_MS = 50_000

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

function mediaTypeFor(path: string): ImageMediaType {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

async function foodLibrary(admin: SupabaseClient, userId: string) {
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

// Limites da IA: teto mensal em euros e limite diário de fotos.
export async function aiLimitReached(
  admin: SupabaseClient,
  userId: string,
  withPhotos: boolean,
): Promise<boolean> {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const dayStart = lisbonInstant(lisbonClock(now).date, '00:00').toISOString()
  const [{ data: profile }, { data: monthCalls }, { count: visionToday }] = await Promise.all([
    admin.from('profile').select('ai_monthly_cap_eur,ai_daily_vision_cap').eq('user_id', userId).maybeSingle(),
    admin.from('api_calls').select('cost_usd').eq('user_id', userId).gte('created_at', monthStart),
    admin
      .from('api_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('kind', VISION_KINDS)
      .gte('created_at', dayStart),
  ])
  const monthUsd = (monthCalls ?? []).reduce((acc, c) => acc + Number(c.cost_usd), 0)
  if (monthlyCapReached(monthUsd, Number(profile?.ai_monthly_cap_eur ?? 10))) return true
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

async function runModel(
  admin: SupabaseClient,
  meal: MealRow,
): Promise<{ analysis: MealAnalysis; refs: Record<string, string>; model: string; prompt: string; cost: number }> {
  const { refs, forPrompt } = await foodLibrary(admin, meal.user_id)
  const photos = meal.photo_paths ?? []
  const payload = JSON.stringify({
    texto: meal.raw_text || null,
    nota: meal.note || null,
    etiquetas: meal.tags ?? [],
    hora_local: clockTime(new Date(meal.logged_at)),
    momento: meal.slot,
    alimentos: forPrompt,
  })

  if (photos.length > 0) {
    const images = await Promise.all(
      photos.slice(0, 4).map(async (path) => {
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
    const { output: analysis, cost, model } = await structuredCall(
      admin,
      { userId: meal.user_id, kind: 'meal_photo', request: REQUEST_VISION },
      {
        model: MODELS.vision,
        max_tokens: 4096,
        thinking: NO_THINKING,
        system: readPrompt(PROMPT_MEAL_PHOTO_V2),
        messages: [{ role: 'user', content: [...images, { type: 'text', text: payload }] }],
      },
      MealAnalysisSchema,
    )
    if (analysis.items.length === 0) throw new AiError('Não vi comida nesta foto. Escreve o que comeste.', 'análise sem itens')
    return { analysis, refs, model, prompt: promptVersion(PROMPT_MEAL_PHOTO_V2), cost }
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
  return { analysis, refs, model, prompt: promptVersion(PROMPT_MEAL_TEXT_V2), cost }
}

// Analisa uma refeição já reivindicada (claim_meal_analysis) e grava o
// resultado. Devolve a linha gravada, ou null se outra tentativa mandou.
export async function analyseClaimed(admin: SupabaseClient, meal: MealRow): Promise<Record<string, unknown> | null> {
  const claimedAt = meal.analysis_started_at
  if (!claimedAt) return null
  const startedAt = Date.now()
  try {
    const { analysis, refs, model, prompt, cost } = await runModel(admin, meal)
    const items = toMealItems(analysis.items, refs)
    const tags = meal.tags ?? []
    const inputType = meal.input_type === 'photo' ? 'photo' : 'text'

    return await guardedWrite(items, meal.note, claimedAt, {
      write: async (finalItems, noteUsed) => {
        const status = analysedStatus(finalItems, analysis.meal_confidence)
        let query = admin
          .from('meals')
          .update({
            items: finalItems,
            ...mealTotals(finalItems),
            status,
            is_estimate: mealIsEstimate(inputType, tags.includes('jantar_fora'), finalItems),
            confidence: analysis.meal_confidence === 'alta' ? 0.9 : analysis.meal_confidence === 'media' ? 0.6 : 0.3,
            raw_text: meal.raw_text ?? analysis.title,
            analysis_note: noteUsed,
            analysis_error: null,
            model,
            prompt_version: prompt,
            cost_usd: cost,
          })
          .eq('id', meal.id)
          .eq('analysis_started_at', claimedAt)
        query = noteUsed == null ? query.is('note', null) : query.eq('note', noteUsed)
        const { data } = await query.select()
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
  } catch (err) {
    console.error('Análise falhou:', err)
    // Um erro passageiro (demora, sobrecarga) solta a análise para o telemóvel
    // pedir outra tentativa já; um erro que se ia repetir (chave, pedido
    // recusado, foto em falta) ou a 3.ª tentativa passam logo a «erro», com o
    // motivo e o botão «Tentar outra vez».
    const retry = describeAiError(err).transient && meal.analysis_attempts < 3
    await admin
      .from('meals')
      .update({
        analysis_error: errorForStorage(err),
        ...(retry ? { analysis_started_at: null } : { status: 'erro' }),
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
