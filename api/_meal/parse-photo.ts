import type { VercelRequest, VercelResponse } from '@vercel/node'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { anthropic, MODELS, logApiCall, type Usage } from '../_lib/anthropic.js'
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

    const usage: Usage = { input_tokens: 0, output_tokens: 0 }
    let parsed: ParsedPhotoMeal | null = null
    // JSON estrito com retry 1x (Sonnet 5 não aceita temperature)
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const response = await anthropic().messages.parse({
        model: MODELS.vision,
        max_tokens: 4096,
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
        output_config: { format: zodOutputFormat(ParsedPhotoMealSchema) },
      })
      usage.input_tokens += response.usage.input_tokens
      usage.output_tokens += response.usage.output_tokens
      parsed = response.parsed_output
    }
    const cost = await logApiCall(adminClient(), {
      user_id: user.id,
      kind: 'meal_parse_photo',
      model: MODELS.vision,
      usage,
    })
    if (!parsed) throw new HttpError(502, 'Não consegui analisar a fotografia. Tenta outra vez.')

    res.status(200).json({
      items: parsed.items,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      questions: parsed.questions,
      assumed_portions: parsed.assumed_portions,
      // Regra 12: fotografia é sempre estimativa
      is_estimate: mealIsEstimate('photo', jantarFora, parsed.items),
      prompt_version: promptVersion(PROMPT_MEAL_PHOTO),
      model: MODELS.vision,
      cost_usd: cost,
    })
  } catch (err) {
    respondError(res, err)
  }
}
