import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { aiProvider, MODELS, NO_THINKING, REQUEST_TEXT, REQUEST_VISION, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_WORKOUT_SAID, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import { nutritionalDay } from '../_lib/rules/nutritional-day.js'
import { SAID_SPORTS, SAID_TYPES, cleanSaid } from '../_lib/rules/treino-dito.js'

// «Dizer o treino» (Treino): a pessoa escreve ou grava o que fez e a IA passa
// isso para os campos do registo. Não grava nada: a app mostra o que foi
// percebido e grava com /api/workout/save ou /api/workout/strength.

// O áudio chega já em WAV (16 kHz, mono), até ~60 s: cabe no limite de 4,5 MB.
const MAX_AUDIO_B64 = 3_400_000

const Body = z
  .object({
    text: z.string().trim().max(2000).optional(),
    audio: z.string().max(MAX_AUDIO_B64).regex(/^[A-Za-z0-9+/=]+$/).optional(),
  })
  .refine((b) => (b.text && b.text.length > 0) || b.audio, 'Sem texto nem áudio.')

const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable()
const AiSchema = z.object({
  transcricao: nullable(z.string()),
  tipo: z.enum(SAID_TYPES),
  desporto: nullable(z.enum(SAID_SPORTS)),
  titulo: z.string(),
  data: nullable(z.string()),
  minutos: nullable(z.number()),
  watts: nullable(z.number()),
  fc_media: nullable(z.number()),
  kcal_relogio: nullable(z.number()),
  distancia_km: nullable(z.number()),
  exercicios: z.array(
    z.object({
      nome: z.string(),
      series: z.array(z.object({ reps: nullable(z.number()), carga_kg: nullable(z.number()) })),
    }),
  ),
  nota: nullable(z.string()),
})

export default async function said(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = Body.safeParse(req.body ?? {})
    if (!body.success) throw new HttpError(400, 'Escreve ou grava o que fizeste.')
    const { text, audio } = body.data
    if (audio && aiProvider() !== 'gemini') {
      throw new HttpError(400, 'O áudio só funciona com o Gemini. Escreve o que fizeste (podes usar o ditado do teclado).')
    }

    const admin = adminClient()
    if (await aiLimitReached(admin, user.id, false)) {
      throw new HttpError(429, 'Chegaste ao limite mensal da IA (Definições › Avançado).')
    }
    const { data: profile } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
    const today = nutritionalDay(new Date(), Number(profile?.nutrition_day_cutoff_hour ?? 4))

    const content = [
      { type: 'text', text: JSON.stringify({ hoje: today, texto: text || null }) },
      ...(audio ? [{ type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: audio } }] : []),
    ]
    const { output } = await structuredCall(
      admin,
      { userId: user.id, kind: audio ? 'workout_said_audio' : 'workout_said', request: audio ? REQUEST_VISION : REQUEST_TEXT },
      {
        // O áudio vai para o modelo das fotos (o mais capaz); o texto, para o rápido.
        model: audio ? MODELS.vision : MODELS.text,
        max_tokens: 2000,
        thinking: NO_THINKING,
        system: readPrompt(PROMPT_WORKOUT_SAID),
        messages: [{ role: 'user', content: content as unknown as MessageCreateParamsNonStreaming['messages'][number]['content'] }],
      },
      AiSchema,
    )
    const workout = cleanSaid(output, today)
    if (!workout.title && workout.minutes == null && workout.exercises.length === 0) {
      throw new HttpError(422, 'Não percebi o treino. Diz o que fizeste e quanto tempo (ex.: «45 min de bicicleta»).')
    }
    res.status(200).json({ workout, today })
  } catch (err) {
    respondError(res, err)
  }
}
