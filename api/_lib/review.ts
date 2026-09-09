import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { anthropic, MODELS, logApiCall, type Usage } from './anthropic'
import { PROMPT_REVIEW, readPrompt } from './prompts'
import { shiftDate } from './rules/nutritional-day'

const ReviewSchema = z.object({ text: z.string() })

// Review semanal em voz de narrador (Sonnet), gerado na cron de segunda
// para a semana que terminou. Idempotente por (user_id, week_start).
export async function generateWeeklyReview(
  admin: SupabaseClient,
  userId: string,
  weekStart: string, // segunda-feira da semana a rever
): Promise<boolean> {
  const { data: existing } = await admin
    .from('weekly_reviews')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle()
  if (existing) return false

  const weekEnd = shiftDate(weekStart, 6)
  const [
    { data: days },
    { data: meals },
    { data: workouts },
    { data: profile },
    { data: blocks },
  ] = await Promise.all([
    admin
      .from('days')
      .select('date,kcal_in,protein,kcal_target,kcal_exercise,is_complete,flags,weight_trend,tdee_est')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .order('date'),
    admin
      .from('meals')
      .select('is_estimate')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd),
    admin
      .from('workouts')
      .select('date,type,minutes,watts,avg_hr,max_hr,status,planned_session_id')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .order('date'),
    admin.from('profile').select('protein_g,base_kcal,expected_tdee,kcal_floor_week').eq('user_id', userId).single(),
    admin
      .from('plan_blocks')
      .select('id,chapter_id,start_date,status')
      .eq('user_id', userId)
      .in('status', ['active', 'completed'])
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  // Sem dados nenhuns, não há review a escrever.
  if ((days ?? []).length === 0 && (meals ?? []).length === 0 && (workouts ?? []).length === 0) {
    return false
  }

  const block = blocks?.[0] ?? null
  let capitulo: unknown = null
  let adesao: { planeadas: number; feitas: number } | null = null
  if (block) {
    const [{ data: chapter }, { data: sessions }] = await Promise.all([
      block.chapter_id
        ? admin.from('chapters').select('title,patron,theme,facts,honest_note').eq('id', block.chapter_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('planned_sessions').select('week,status').eq('block_id', block.id),
    ])
    capitulo = chapter ?? null
    if (sessions?.length) {
      adesao = {
        planeadas: sessions.length,
        feitas: sessions.filter((s) => s.status === 'done').length,
      }
    }
  }

  const trends = (days ?? []).map((d) => d.weight_trend).filter((t): t is number => t != null)
  const payload = {
    semana: { inicio: weekStart, fim: weekEnd },
    dias: days ?? [],
    refeicoes: {
      total: (meals ?? []).length,
      estimadas: (meals ?? []).filter((m) => m.is_estimate).length,
    },
    treinos: workouts ?? [],
    peso: {
      trend_inicio: trends[0] ?? null,
      trend_fim: trends[trends.length - 1] ?? null,
    },
    perfil: profile ?? null,
    adesao_ao_bloco: adesao,
    capitulo,
  }

  const usage: Usage = { input_tokens: 0, output_tokens: 0 }
  let text: string | null = null
  for (let attempt = 0; attempt < 2 && !text; attempt++) {
    const response = await anthropic().messages.parse({
      model: MODELS.vision,
      max_tokens: 2000,
      system: readPrompt(PROMPT_REVIEW),
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      output_config: { format: zodOutputFormat(ReviewSchema) },
    })
    usage.input_tokens += response.usage.input_tokens
    usage.output_tokens += response.usage.output_tokens
    text = response.parsed_output?.text?.trim() || null
  }
  await logApiCall(admin, { user_id: userId, kind: 'weekly_review', model: MODELS.vision, usage })
  if (!text) throw new Error('Review semanal sem texto válido.')

  const { error } = await admin.from('weekly_reviews').upsert(
    { user_id: userId, week_start: weekStart, text, data: payload },
    { onConflict: 'user_id,week_start' },
  )
  if (error) throw new Error(error.message)
  return true
}
