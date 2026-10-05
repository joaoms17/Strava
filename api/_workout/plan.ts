import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MODELS, NO_THINKING, REQUEST_VISION, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_TRAINING_WEEK, promptVersion, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import { mergeSessions } from '../_lib/rules/sessoes.js'
import {
  BIKE_KINDS,
  GYM_FOCUS,
  cleanPlan,
  cleanPrefs,
  fitnessSeries,
  isDeloadWeek,
  lastMondays,
  planProgress,
  sessionLoad,
  weekNumber,
  weeklyStats,
  wellnessTrend,
  type PlanWorkout,
  type WeekPlan,
} from '../_lib/rules/plano.js'

// Plano da semana pela IA (bicicleta e ginásio, do zero e a progredir) com os
// dados do relógio: treinos, carga e forma, HRV, FC em repouso, sono e passos.
// Guarda-se em plan_blocks (weeks = 1, plan.kind = 'semana'), um por semana.

const Body = z.object({
  refazer: z.boolean().optional(),
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

// O schema pedido à IA (os enum vão no JSON schema; o resto limpa-se depois).
const AiPlanSchema = z.object({
  fase: z.string(),
  resumo: z.string(),
  evolucao: z.string(),
  bicicleta: z.array(
    z.object({
      titulo: z.string(),
      tipo: z.enum(BIKE_KINDS),
      minutos: z.number(),
      alvo: z.string(),
      estrutura: z.string(),
      porque: z.string(),
    }),
  ),
  ginasio: z.array(
    z.object({
      titulo: z.string(),
      foco: z.enum(GYM_FOCUS),
      minutos: z.number(),
      nota: z.string(),
    }),
  ),
})

export default async function planWeek(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = Body.safeParse(req.body ?? {})
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')

    const { data: profile } = await db.from('profile').select('*').single()
    const prefs = cleanPrefs((profile?.goals as Record<string, unknown> | null)?.plano)
    if (!profile || !prefs?.ativo) throw new HttpError(400, 'Liga primeiro o plano semanal no Treino.')

    const now = new Date()
    const today = nutritionalDay(now, Number(profile.nutrition_day_cutoff_hour ?? 4))
    const weekStart = mondayOf(body.data.week_start ?? today)
    const week = weekNumber(prefs.inicio, weekStart)

    const { data: existing } = await db
      .from('plan_blocks')
      .select('*')
      .eq('start_date', weekStart)
      .eq('weeks', 1)
      .order('created_at', { ascending: false })
      .limit(1)
    const current = existing?.[0] ?? null
    if (current && !body.data.refazer) {
      res.status(200).json({ block: current })
      return
    }

    const admin = adminClient()
    if (await aiLimitReached(admin, user.id, false)) {
      throw new HttpError(429, 'Chegaste ao limite mensal da IA (Definições › Avançado).')
    }

    const since = shiftDate(weekStart, -84)
    const [{ data: workoutRows }, { data: healthRows }, { data: weights }, { data: previous }] = await Promise.all([
      db
        .from('workouts_active')
        .select('id,date,started_at,type,sport,minutes,moving_s,elapsed_s,distance_km,watts,np_w,avg_hr,max_hr,training_load')
        .gte('date', since)
        .lte('date', today)
        .order('date'),
      db
        .from('health_daily')
        .select('date,hrv,resting_hr,sleep_score,sleep_quality,sleep_minutes,steps')
        .gte('date', shiftDate(today, -28))
        .lte('date', today),
      db.from('weights').select('date,kg').order('date', { ascending: false }).limit(1),
      db
        .from('plan_blocks')
        .select('start_date,plan')
        .eq('weeks', 1)
        .lt('start_date', weekStart)
        .order('start_date', { ascending: false })
        .limit(4),
    ])
    const workouts = (workoutRows ?? []) as (PlanWorkout & { sport?: string | null })[]
    const fitness = fitnessSeries(workouts, since, today)
    const last = fitness[fitness.length - 1] ?? null
    const fourWeeksAgo = fitness[fitness.length - 29] ?? null

    const payload = {
      pessoa: {
        sexo: profile.sex === 'f' ? 'mulher' : 'homem',
        idade: profile.birth_year ? Number(today.slice(0, 4)) - Number(profile.birth_year) : null,
        altura_cm: profile.height_cm ?? null,
        peso_kg: weights?.[0]?.kg != null ? Number(weights[0].kg) : null,
        peso_alvo_kg: profile.target_weight_kg != null ? Number(profile.target_weight_kg) : null,
      },
      preferencias: { bicicleta: prefs.bicicleta, ginasio: prefs.ginasio },
      semana: { numero: week, inicio: weekStart, descarga: isDeloadWeek(week) },
      historico_semanas: weeklyStats(workouts, lastMondays(shiftDate(weekStart, -1), 6)),
      // Ao refazer a meio da semana, o que já se fez conta.
      esta_semana: weeklyStats(workouts, [weekStart])[0] ?? null,
      // As partes seguidas de um treino (o relógio às vezes divide) juntas.
      bicicleta_recentes: mergeSessions(workouts)
        .filter((w) => w.type === 'bike')
        .slice(-12)
        .map((w) => ({
          data: w.date,
          minutos: w.minutes,
          watts: w.watts ?? null,
          np: w.np_w ?? null,
          fc_media: w.avg_hr ?? null,
          fc_max: w.max_hr ?? null,
          carga: Math.round(sessionLoad(w)),
        })),
      forma: {
        hoje: last ? { ctl: last.ctl, atl: last.atl, tsb: last.tsb } : null,
        ha_4_semanas: fourWeeksAgo ? { ctl: fourWeeksAgo.ctl } : null,
      },
      bem_estar: wellnessTrend(healthRows ?? [], today),
      planos_anteriores: (previous ?? []).map((p) => {
        const plan = cleanPlan(p.plan, { bicicleta: 7, ginasio: 7 }, 1)
        const end = shiftDate(p.start_date as string, 6)
        const done = planProgress(
          plan,
          workouts.filter((w) => w.date >= (p.start_date as string) && w.date <= end),
        )
        return {
          semana: p.start_date,
          fase: plan.fase,
          bicicleta: { planeadas: plan.bicicleta.length, feitas: done.bike.filter(Boolean).length },
          ginasio: { planeadas: plan.ginasio.length, feitas: done.gym.filter(Boolean).length },
        }
      }),
    }

    const { output, model } = await structuredCall(
      admin,
      { userId: user.id, kind: 'training_week', request: REQUEST_VISION },
      {
        model: MODELS.vision,
        max_tokens: 3000,
        thinking: NO_THINKING,
        system: readPrompt(PROMPT_TRAINING_WEEK),
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      },
      AiPlanSchema,
    )
    const plan: WeekPlan & { gerado: string; modelo: string } = {
      ...cleanPlan(output, prefs, week),
      gerado: now.toISOString(),
      modelo: model,
    }

    const row = { plan, prompt_version: promptVersion(PROMPT_TRAINING_WEEK), status: 'active' }
    const { data: saved, error } = current
      ? await db.from('plan_blocks').update(row).eq('id', current.id).select().single()
      : await db
          .from('plan_blocks')
          .insert({ user_id: user.id, start_date: weekStart, weeks: 1, ...row })
          .select()
          .single()
    if (error) throw new HttpError(500, error.message)
    res.status(200).json({ block: saved })
  } catch (err) {
    respondError(res, err)
  }
}
