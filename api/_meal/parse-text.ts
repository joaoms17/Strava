import type { VercelRequest, VercelResponse } from '@vercel/node'
import { MODELS, REQUEST_TEXT, structuredCall, timeLeftForRetry } from '../_lib/anthropic.js'
import { describeAiError } from '../_lib/rules/resposta-ia.js'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { ParsedMealSchema, type ParsedMeal } from '../_lib/schemas.js'
import { PROMPT_MEAL_TEXT, promptVersion, readPrompt } from '../_lib/prompts.js'
import { mealIsEstimate } from '../_lib/rules/estimativas.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    const jantarFora = req.body?.jantar_fora === true
    if (!text) throw new HttpError(400, 'Falta o texto da refeição.')

    const { data: foods, error: foodsError } = await db
      .from('foods')
      .select('id,name,aliases,default_portion_g,kcal_100g,protein_100g,carbs_100g,fat_100g')
      .order('use_count', { ascending: false })
      .limit(100)
    if (foodsError) throw new HttpError(500, foodsError.message)

    const system = readPrompt(PROMPT_MEAL_TEXT)
    const payload = JSON.stringify({
      texto: text,
      jantar_fora: jantarFora,
      alimentos_pessoais: foods ?? [],
    })

    let parsed: ParsedMeal | null = null
    let cost = 0
    const startedAt = Date.now()
    // JSON estrito; uma segunda tentativa só se o erro for passageiro e couber
    // no tempo da função
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      if (attempt > 0 && !timeLeftForRetry(startedAt, 25_000)) break
      try {
        const result = await structuredCall(
          adminClient(),
          { userId: user.id, kind: 'meal_parse_text', request: REQUEST_TEXT },
          {
            model: MODELS.text,
            max_tokens: 4096,
            temperature: 0,
            system,
            messages: [{ role: 'user', content: payload }],
          },
          ParsedMealSchema,
        )
        parsed = result.output
        cost += result.cost
      } catch (err) {
        const error = describeAiError(err)
        if (!error.transient || attempt > 0) throw new HttpError(502, `${error.message} Tenta outra vez.`)
      }
    }
    if (!parsed) throw new HttpError(502, 'Não consegui analisar a refeição. Tenta outra vez.')

    res.status(200).json({
      items: parsed.items,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      questions: parsed.questions,
      is_estimate: mealIsEstimate('text', jantarFora, parsed.items),
      prompt_version: promptVersion(PROMPT_MEAL_TEXT),
      model: MODELS.text,
      cost_usd: cost,
    })
  } catch (err) {
    respondError(res, err)
  }
}
