import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MODELS, NO_THINKING, REQUEST_VISION, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_EVOLUTION, promptVersion, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import { AREAS, ESTADOS, cleanAnalysis, foodWeeks, weightSummary, wellnessMonths } from '../_lib/rules/evolucao.js'
import {
  cleanPlan,
  efficiencySeries,
  fitnessSeries,
  lastMondays,
  planProgress,
  weeklyStats,
  type PlanWorkout,
  type WellnessRow,
} from '../_lib/rules/plano.js'

// Corpo › Evolução › «Analisar a minha evolução»: a IA olha para tudo (peso,
// medidas, comida, treino e relógio) e diz como está a correr. Uma análise por
// dia em weekly_reviews (kind 'evolucao', week_start = o dia); «Analisar
// outra vez» substitui a desse dia.

const Body = z.object({ refazer: z.boolean().optional() })

const AiSchema = z.object({
  titulo: z.string(),
  resumo: z.string(),
  areas: z.array(z.object({ area: z.enum(AREAS), estado: z.enum(ESTADOS), texto: z.string() })),
  foco: z.array(z.string()),
})

export default async function evolution(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = Body.safeParse(req.body ?? {})
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')

    const { data: profile } = await db.from('profile').select('*').single()
    if (!profile) throw new HttpError(400, 'Perfil não encontrado.')
    const today = nutritionalDay(new Date(), Number(profile.nutrition_day_cutoff_hour ?? 4))

    const { data: existing } = await db
      .from('weekly_reviews')
      .select('week_start,text,data,created_at')
      .eq('kind', 'evolucao')
      .eq('week_start', today)
      .maybeSingle()
    if (existing && !body.data.refazer) {
      res.status(200).json({ review: existing })
      return
    }

    const admin = adminClient()
    if (await aiLimitReached(admin, user.id, false)) {
      throw new HttpError(429, 'Chegaste ao limite mensal da IA (Definições › Avançado).')
    }

    const since = shiftDate(today, -90)
    const [weights, measurements, days, workouts, health, plans] = await Promise.all([
      db.from('weights').select('date,kg').gte('date', since).order('date'),
      db
        .from('body_measurements')
        .select('date,waist_cm,neck_cm,chest_cm,hips_cm,arm_cm,thigh_cm,calf_cm')
        .order('date', { ascending: false })
        .limit(4),
      db
        .from('days')
        .select('date,kcal_in,protein,kcal_target,kcal_out_est,is_complete')
        .gte('date', shiftDate(today, -29))
        .lte('date', today),
      db
        .from('workouts_active')
        .select('date,type,minutes,watts,np_w,avg_hr,max_hr,training_load')
        .gte('date', shiftDate(today, -125))
        .lte('date', today)
        .order('date'),
      db
        .from('health_daily')
        .select('date,hrv,resting_hr,sleep_score,sleep_quality,sleep_minutes,steps')
        .gte('date', shiftDate(today, -61))
        .lte('date', today),
      db
        .from('plan_blocks')
        .select('start_date,plan')
        .eq('weeks', 1)
        .order('start_date', { ascending: false })
        .limit(4),
    ])

    const allWorkouts = (workouts.data ?? []) as PlanWorkout[]
    const efficiency = efficiencySeries(allWorkouts)
    const form = fitnessSeries(allWorkouts, shiftDate(today, -125), today)
    const goals = (profile.goals ?? {}) as Record<string, unknown>
    const payload = {
      pessoa: {
        sexo: profile.sex === 'f' ? 'mulher' : 'homem',
        idade: profile.birth_year ? Number(today.slice(0, 4)) - Number(profile.birth_year) : null,
        altura_cm: profile.height_cm ?? null,
        peso_alvo_kg: profile.target_weight_kg != null ? Number(profile.target_weight_kg) : null,
        calorias_base: profile.base_kcal ?? null,
        proteina_g: profile.protein_g ?? null,
      },
      peso: weightSummary((weights.data ?? []) as { date: string; kg: number }[], today),
      medidas: measurements.data ?? [],
      comida: foodWeeks((days.data ?? []) as Parameters<typeof foodWeeks>[0], today),
      treino: {
        semanas: weeklyStats(allWorkouts, lastMondays(today, 8)).map((w) => ({
          semana: w.start,
          bicicleta: w.bike,
          ginasio: w.gym,
          outros: w.other,
        })),
        watts_por_batimento: efficiency.length
          ? { primeiras: efficiency.slice(0, 3), ultimas: efficiency.slice(-3) }
          : null,
        forma: {
          hoje: form[form.length - 1]?.ctl ?? null,
          ha_4_semanas: form[form.length - 29]?.ctl ?? null,
        },
        plano_semanal: goals.plano ?? null,
        semanas_do_plano: (plans.data ?? []).map((p) => {
          const plan = cleanPlan(p.plan, { bicicleta: 7, ginasio: 7 }, 1)
          const end = shiftDate(p.start_date as string, 6)
          const done = planProgress(
            plan,
            allWorkouts.filter((w) => w.date >= (p.start_date as string) && w.date <= end),
          )
          return {
            semana: p.start_date,
            atual: p.start_date === mondayOf(today),
            bicicleta: { planeadas: plan.bicicleta.length, feitas: done.bike.filter(Boolean).length },
            ginasio: { planeadas: plan.ginasio.length, feitas: done.gym.filter(Boolean).length },
          }
        }),
      },
      relogio: wellnessMonths((health.data ?? []) as WellnessRow[], today),
    }

    const { output, model } = await structuredCall(
      admin,
      { userId: user.id, kind: 'evolution', request: REQUEST_VISION },
      {
        model: MODELS.vision,
        max_tokens: 2500,
        thinking: NO_THINKING,
        system: readPrompt(PROMPT_EVOLUTION),
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      },
      AiSchema,
    )
    const analysis = cleanAnalysis(output)
    if (!analysis.resumo && analysis.areas.length === 0) throw new HttpError(502, 'A IA não devolveu uma análise. Tenta outra vez.')

    const row = {
      week_start: today,
      text: analysis.resumo,
      data: { analise: analysis, gerado: new Date().toISOString(), modelo: model, prompt: promptVersion(PROMPT_EVOLUTION) },
    }
    const { data: saved, error } = await db
      .from('weekly_reviews')
      .upsert({ ...row, user_id: user.id, kind: 'evolucao' }, { onConflict: 'user_id,week_start,kind' })
      .select('week_start,text,data,created_at')
      .single()
    // Sem a migração 11 não se guarda, mas a análise (já paga) mostra-se.
    if (error) console.error('evolucao:', error.message)
    res.status(200).json({ review: saved ?? { ...row, created_at: row.data.gerado }, saved: !error })
  } catch (err) {
    respondError(res, err)
  }
}
