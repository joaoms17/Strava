import type { VercelRequest, VercelResponse } from '@vercel/node'
import { MODELS, NO_THINKING, REQUEST_VISION, structuredCall, timeLeftForRetry } from '../_lib/anthropic.js'
import { describeAiError } from '../_lib/rules/resposta-ia.js'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { ParsedPhotoMealSchema, type ParsedPhotoMeal } from '../_lib/schemas.js'
import { PROMPT_MEAL_PHOTO, promptVersion, readPrompt } from '../_lib/prompts.js'
import { mealIsEstimate } from '../_lib/rules/estimativas.js'

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

function mediaTypeFor(path: string): ImageMediaType {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)

    const photoPath = typeof req.body?.photo_path === 'string' ? req.body.photo_path : ''
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
    const jantarFora = req.body?.jantar_fora === true
    if (!photoPath) throw new HttpError(400, 'Falta o caminho da fotografia.')
    // O download usa service role (o bucket é privado), por isso o caminho
    // tem de pertencer mesmo ao utilizador autenticado.
    if (!photoPath.startsWith(`${user.id}/`)) throw new HttpError(403, 'Fotografia inválida.')

    const admin = adminClient()
    const { data: blob, error: downloadError } = await admin.storage
      .from('meal-photos')
      .download(photoPath)
    if (downloadError || !blob) throw new HttpError(404, 'Fotografia não encontrada.')
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')

    const { data: foods, error: foodsError } = await db
      .from('foods')
      .select('id,name,aliases,default_portion_g,kcal_100g,protein_100g,carbs_100g,fat_100g')
      .order('use_count', { ascending: false })
      .limit(100)
    if (foodsError) throw new HttpError(500, foodsError.message)

    const system = readPrompt(PROMPT_MEAL_PHOTO)
    const payload = JSON.stringify({
      nota: note || null,
      jantar_fora: jantarFora,
      alimentos_pessoais: foods ?? [],
    })

    let parsed: ParsedPhotoMeal | null = null
    let cost = 0
    let usedModel: string = MODELS.vision
    const startedAt = Date.now()
    // JSON estrito; uma segunda tentativa só se o erro for passageiro e couber
    // no tempo da função (Sonnet 5 não aceita temperature)
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      if (attempt > 0 && !timeLeftForRetry(startedAt, 12_000)) break
      try {
        const result = await structuredCall(
          adminClient(),
          { userId: user.id, kind: 'meal_parse_photo', request: REQUEST_VISION },
          {
            model: MODELS.vision,
            max_tokens: 4096,
            thinking: NO_THINKING,
            system,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: mediaTypeFor(photoPath),
                      data: base64,
                    },
                  },
                  { type: 'text', text: payload },
                ],
              },
            ],
          },
          ParsedPhotoMealSchema,
        )
        parsed = result.output
        cost += result.cost
        usedModel = result.model
      } catch (err) {
        const error = describeAiError(err)
        if (!error.transient || attempt > 0) throw new HttpError(502, `${error.message} Tenta outra vez.`)
      }
    }
    if (!parsed) throw new HttpError(502, 'Não consegui analisar a fotografia. Tenta outra vez.')

    res.status(200).json({
      items: parsed.items,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      questions: parsed.questions,
      assumed_portions: parsed.assumed_portions,
      // Regra 12: fotografia é sempre estimativa
      is_estimate: mealIsEstimate('photo', jantarFora, parsed.items),
      prompt_version: promptVersion(PROMPT_MEAL_PHOTO),
      model: usedModel,
      cost_usd: cost,
    })
  } catch (err) {
    respondError(res, err)
  }
}
