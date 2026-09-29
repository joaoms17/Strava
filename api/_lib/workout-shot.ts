import type { SupabaseClient } from '@supabase/supabase-js'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { anthropic, MODELS, NO_THINKING, REQUEST_VISION, logApiCall, usableOutput } from './anthropic.js'
import { WorkoutShotSchema, type WorkoutShot } from './schemas.js'
import { PROMPT_WORKOUT_SHOT, readPrompt } from './prompts.js'
import { lisbonClock } from './rules/momentos.js'
import { shiftDate } from './rules/nutritional-day.js'
import { checkShotNumbers } from './rules/treino.js'

// Leitura dos prints do relógio em segundo plano (Fase 3): o rascunho já
// existe em workout_imports com estado 'a_ler'; aqui o Sonnet lê as imagens,
// o servidor verifica os intervalos e o rascunho passa a 'por_confirmar'.
// Nada disto conta em nenhum total até o João guardar.

export interface ImportRow {
  id: string
  user_id: string
  status: string
  source_paths: string[]
  thumb_paths: string[]
  image_hashes: string[]
  parsed: StoredShot | null
  edited_fields: string[]
  analysis_started_at: string | null
  analysis_attempts: number
  analysis_error: string | null
  workout_id: string | null
}

// O que fica guardado: a leitura já verificada e os campos a confirmar.
export type StoredShot = WorkoutShot & { low_fields: string[] }

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

function mediaTypeFor(path: string): ImageMediaType {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

// Datas fora de [hoje − 60 dias, hoje] são quase de certeza mal lidas.
export function checkShotDate(date: string | null, today: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (date > today || date < shiftDate(today, -60)) return null
  return date
}

export function checkShot(shot: WorkoutShot, today: string): StoredShot {
  const { activity, low } = checkShotNumbers(shot.activity)
  const date = checkShotDate(activity.date, today)
  const startOk = activity.start_time != null && /^\d{1,2}:\d{2}$/.test(activity.start_time)
  const lowFields = new Set([
    ...low,
    ...shot.field_confidence.filter((f) => f.confidence === 'baixa').map((f) => f.field),
  ])
  if (activity.date && !date) lowFields.add('date')
  return {
    ...shot,
    activity: { ...activity, date, start_time: startOk ? activity.start_time : null },
    low_fields: [...lowFields],
  }
}

async function readShot(admin: SupabaseClient, row: ImportRow): Promise<StoredShot> {
  const images = await Promise.all(
    row.source_paths.slice(0, 4).map(async (path) => {
      const { data, error } = await admin.storage.from('workout-shots').download(path)
      if (error || !data) throw new Error('Print não encontrado.')
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
  const today = lisbonClock(new Date()).date
  const payload = JSON.stringify({
    hoje: today,
    valores_atuais: row.parsed?.activity ?? null,
    campos_editados: row.edited_fields ?? [],
  })
  const response = await anthropic().messages.parse(
    {
      model: MODELS.vision,
      max_tokens: 4096,
      thinking: NO_THINKING,
      system: readPrompt(PROMPT_WORKOUT_SHOT),
      messages: [{ role: 'user', content: [...images, { type: 'text', text: payload }] }],
      output_config: { format: zodOutputFormat(WorkoutShotSchema) },
    },
    REQUEST_VISION,
  )
  await logApiCall(admin, { user_id: row.user_id, kind: 'workout_shot', model: MODELS.vision, usage: response.usage })
  const shot = usableOutput(response)
  if (!shot) throw new Error('Não consegui ler este print.')
  if (shot.images.length > 0 && shot.images.every((i) => i.app === 'not_workout')) {
    throw new Error('Isto não parece um treino.')
  }
  return checkShot(shot, today)
}

// Lê um rascunho já reivindicado e grava o resultado, só se a reivindicação
// ainda for a mesma (outra tentativa pode ter tomado o lugar).
async function parseClaimed(admin: SupabaseClient, row: ImportRow): Promise<ImportRow | null> {
  const claimedAt = row.analysis_started_at
  try {
    const parsed = await readShot(admin, row)
    const { data } = await admin
      .from('workout_imports')
      .update({ parsed, status: 'por_confirmar', analysis_error: null })
      .eq('id', row.id)
      .eq('status', 'a_ler')
      .eq('analysis_started_at', claimedAt)
      .select()
      .maybeSingle()
    return (data as ImportRow | null) ?? null
  } catch (err) {
    const message = err instanceof Error && /print|treino/i.test(err.message) ? err.message : 'Não consegui ler este print.'
    console.error('Leitura do print falhou:', err)
    // Falhou: fica 'erro' com «Tentar de novo» e «Preencher à mão».
    const { data } = await admin
      .from('workout_imports')
      .update({ status: 'erro', analysis_error: message })
      .eq('id', row.id)
      .eq('analysis_started_at', claimedAt)
      .select()
      .maybeSingle()
    return (data as ImportRow | null) ?? null
  }
}

export async function claimAndParse(
  admin: SupabaseClient,
  importId: string,
  reset = false,
): Promise<ImportRow | null> {
  const { data, error } = await admin.rpc('claim_workout_parse', { p_import_id: importId, p_reset: reset })
  if (error) throw new Error(error.message)
  const claimed = ((data ?? []) as ImportRow[])[0]
  if (!claimed) return null
  return parseClaimed(admin, claimed)
}
