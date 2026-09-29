import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { MODELS, structuredCall } from './anthropic.js'
import { PROMPT_REVIEW_NEUTRAL, readPrompt } from './prompts.js'
import { shiftDate } from './rules/nutritional-day.js'

const ReviewSchema = z.object({ text: z.string() })

// Resumo da semana (Fase 6): neutro, 4 a 6 frases, pelo Haiku, sem
// capítulos. Gerado pela cron na primeira noite em que falte para a semana
// que terminou. Idempotente por (user_id, week_start, kind).
export async function generateWeeklyReview(
  admin: SupabaseClient,
  userId: string,
  weekStart: string, // segunda-feira da semana a resumir
): Promise<boolean> {
  const { data: existing } = await admin
    .from('weekly_reviews')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .eq('kind', 'neutro')
    .maybeSingle()
  if (existing) return false

  const weekEnd = shiftDate(weekStart, 6)
  const [{ data: days }, { data: meals }, { data: workouts }, { data: profile }] = await Promise.all([
    admin
      .from('days')
      .select('date,kcal_in,protein,kcal_target,kcal_exercise,kcal_out_est,is_complete,flags,weight_trend')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .order('date'),
    admin
      .from('meals_counted')
      .select('is_estimate')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd),
    admin
      .from('workouts_active')
      .select('date,type,minutes,watts,avg_hr,status')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .order('date'),
    admin.from('profile').select('protein_g,base_kcal,kcal_floor_week').eq('user_id', userId).single(),
  ])

  // Sem dados nenhuns, não há resumo a escrever.
  if ((days ?? []).length === 0 && (meals ?? []).length === 0 && (workouts ?? []).length === 0) return false

  const complete = (days ?? []).filter((d) => d.is_complete)
  const mean = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null)
  const trends = (days ?? []).map((d) => d.weight_trend).filter((t): t is number => t != null)
  const payload = {
    semana: { inicio: weekStart, fim: weekEnd },
    dias: days ?? [],
    medias_dos_dias_completos: {
      dias: complete.length,
      comeu: mean(complete.map((d) => Number(d.kcal_in))),
      gasto_estimado: mean(complete.filter((d) => d.kcal_out_est != null).map((d) => Number(d.kcal_out_est))),
      proteina: mean(complete.map((d) => Number(d.protein))),
    },
    refeicoes: {
      total: (meals ?? []).length,
      estimadas: (meals ?? []).filter((m) => m.is_estimate).length,
    },
    treinos: workouts ?? [],
    peso_medio: { inicio: trends[0] ?? null, fim: trends[trends.length - 1] ?? null },
    metas: profile ?? null,
  }

  // Corre dentro da cron (60 s no total): uma só chamada.
  const { output } = await structuredCall(
    admin,
    { userId, kind: 'weekly_review', request: { maxRetries: 0, timeout: 20_000 } },
    {
      model: MODELS.text,
      max_tokens: 1200,
      temperature: 0.2,
      system: readPrompt(PROMPT_REVIEW_NEUTRAL),
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    },
    ReviewSchema,
  )
  const text = output.text?.trim() || null
  if (!text) throw new Error('Resumo semanal sem texto válido.')

  const { error } = await admin.from('weekly_reviews').upsert(
    { user_id: userId, week_start: weekStart, kind: 'neutro', text, data: payload },
    { onConflict: 'user_id,week_start,kind' },
  )
  if (error) throw new Error(error.message)
  return true
}
