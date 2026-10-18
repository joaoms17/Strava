import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { MODELS, structuredCall } from './anthropic.js'
import { PROMPT_REVIEW_NEUTRAL, readPrompt } from './prompts.js'
import { shiftDate } from './rules/nutritional-day.js'
import { cleanStarts, waterWeekDuring } from './rules/ciclo.js'
import { mean } from './rules/sono.js'
import { dataFingerprint, weekHasData } from './rules/resumo.js'

const ReviewSchema = z.object({ text: z.string() })

// Resumo da semana (Fase 6): neutro, 4 a 6 frases, sem capítulos. A cron
// escreve-o na primeira noite depois de a semana acabar (segunda-feira, com
// o domingo já fechado) e, durante a semana seguinte, volta a escrevê-lo só
// se os dados mudarem (`data.fingerprint`): a resposta «Foi tudo?» de
// domingo, uma foto analisada mais tarde. Um por (user_id, week_start, kind).
export async function generateWeeklyReview(
  admin: SupabaseClient,
  userId: string,
  weekStart: string, // segunda-feira da semana a resumir
): Promise<boolean> {
  const weekEnd = shiftDate(weekStart, 6)
  const [{ data: existing }, { data: days }, { data: meals }, { data: workouts }, { data: health }, { data: profile }] =
    await Promise.all([
      admin
        .from('weekly_reviews')
        .select('data')
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .eq('kind', 'neutro')
        .maybeSingle(),
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
        .select('date,type,sport,minutes,watts,avg_hr')
        .eq('user_id', userId)
        .gte('date', weekStart)
        .lte('date', weekEnd)
        // Por ordem fixa (dois treinos no mesmo dia): a impressão digital só muda com os dados.
        .order('date')
        .order('id'),
      admin.from('health_daily').select('*').eq('user_id', userId).gte('date', weekStart).lte('date', weekEnd),
      admin.from('profile').select('protein_g,base_kcal,kcal_floor_week,sex,goals').eq('user_id', userId).single(),
    ])

  const complete = (days ?? []).filter((d) => d.is_complete)
  // Sem dados nenhuns, não há resumo a escrever.
  if (!weekHasData({ completeDays: complete.length, meals: (meals ?? []).length, workouts: (workouts ?? []).length })) {
    return false
  }

  const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null)
  const trends = (days ?? []).map((d) => d.weight_trend).filter((t): t is number => t != null)
  const wellness = (health ?? []) as { steps?: number | null; sleep_minutes?: number | null; hrv?: number | null }[]
  const roundTo = (v: number | null, step: number) => (v == null ? null : Math.round(v / step) * step)
  const steps = roundTo(mean(wellness.map((h) => h.steps)), 100)
  const sleep = roundTo(mean(wellness.map((h) => h.sleep_minutes)), 10)
  const hrv = roundTo(mean(wellness.map((h) => h.hrv)), 1)
  const goals = (profile?.goals ?? null) as Record<string, unknown> | null
  const payload = {
    semana: { inicio: weekStart, fim: weekEnd },
    dias: days ?? [],
    medias_dos_dias_completos: {
      dias: complete.length,
      comeu: average(complete.map((d) => Number(d.kcal_in))),
      gasto_estimado: average(complete.filter((d) => d.kcal_out_est != null).map((d) => Number(d.kcal_out_est))),
      proteina: average(complete.map((d) => Number(d.protein))),
    },
    refeicoes: {
      total: (meals ?? []).length,
      estimadas: (meals ?? []).filter((m) => m.is_estimate).length,
    },
    treinos: workouts ?? [],
    peso_medio: { inicio: trends[0] ?? null, fim: trends[trends.length - 1] ?? null },
    metas: profile
      ? { protein_g: profile.protein_g, base_kcal: profile.base_kcal, kcal_floor_week: profile.kcal_floor_week }
      : null,
    // Médias do relógio na semana (passos, minutos de sono, HRV), quando há.
    bem_estar: steps != null || sleep != null || hrv != null ? { passos: steps, sono_min: sleep, hrv } : null,
    // Na semana de água do ciclo, a subida do peso não é gordura.
    ciclo:
      profile?.sex === 'f' && cleanStarts(goals?.ciclo).length > 0
        ? { semana_de_agua: waterWeekDuring({ sex: profile.sex, goals }, weekStart, weekEnd) }
        : null,
  }
  const fingerprint = dataFingerprint(payload)
  if ((existing?.data as { fingerprint?: unknown } | null | undefined)?.fingerprint === fingerprint) return false

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
    { user_id: userId, week_start: weekStart, kind: 'neutro', text, data: { ...payload, fingerprint } },
    { onConflict: 'user_id,week_start,kind' },
  )
  if (error) throw new Error(error.message)
  return true
}
