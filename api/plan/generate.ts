import type { VercelRequest, VercelResponse } from '@vercel/node'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { anthropic, MODELS, logApiCall, type Usage } from '../_lib/anthropic.js'
import { HttpError, adminClient, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { GeneratedPlanSchema, validatePlan, type GeneratedPlan } from '../_lib/schemas.js'
import { PROMPT_PLAN, promptVersion, readPrompt } from '../_lib/prompts.js'
import { mondayOnOrAfter } from '../_lib/rules/plan-dates.js'
import { nextBikeTarget } from '../_lib/rules/progressao-bike.js'
import type { Semaforo } from '../_lib/rules/semaforo.js'

function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const force = req.body?.force === true

    const { data: activeBlocks } = await db
      .from('plan_blocks')
      .select('id')
      .eq('status', 'active')
    if (activeBlocks?.length && !force) {
      throw new HttpError(409, 'Já existe um bloco ativo. Termina-o ou gera com force.')
    }

    const { data: profile, error: profileError } = await db.from('profile').select('*').single()
    if (profileError || !profile) throw new HttpError(500, 'Perfil não encontrado.')

    // Capítulo: o pedido pode indicar um; senão, o primeiro sem bloco.
    let chapterId = typeof req.body?.chapter_id === 'string' ? req.body.chapter_id : null
    if (!chapterId) {
      const [{ data: chapters }, { data: usedBlocks }] = await Promise.all([
        db.from('chapters').select('id,order_index').order('order_index'),
        db.from('plan_blocks').select('chapter_id'),
      ])
      const used = new Set((usedBlocks ?? []).map((b) => b.chapter_id))
      const next = (chapters ?? []).find((c) => !used.has(c.id)) ?? (chapters ?? []).at(-1)
      if (!next) throw new HttpError(500, 'Sem capítulos — corre os seeds.')
      chapterId = next.id
    }
    const { data: chapter } = await db.from('chapters').select('*').eq('id', chapterId).single()
    if (!chapter) throw new HttpError(404, 'Capítulo não encontrado.')

    const { data: catalog } = await db
      .from('exercise_catalog')
      .select('name,pattern,knee_safe,rep_min,rep_max,notes')
      .eq('knee_safe', true)
    if (!catalog?.length) throw new HttpError(500, 'Catálogo vazio — corre os seeds.')

    // Histórico de 8 semanas
    const since = new Date(Date.now() - 56 * 86_400_000).toISOString().slice(0, 10)
    const [{ data: workouts }, { data: logs }, { data: prevBlocks }] = await Promise.all([
      db.from('workouts').select('*').gte('date', since).order('date'),
      db
        .from('exercise_log')
        .select('exercise,set_index,reps,load_kg,rpe,workout_id,created_at')
        .order('created_at', { ascending: false })
        .limit(300),
      db
        .from('plan_blocks')
        .select('id,status,start_date')
        .neq('status', 'draft')
        .order('start_date', { ascending: false })
        .limit(2),
    ])

    const bikeSessions = (workouts ?? [])
      .filter((w) => w.type === 'bike')
      .map((w) => ({
        date: w.date as string,
        watts: w.watts as number | null,
        minutes: w.minutes as number | null,
        avg_hr: w.avg_hr as number | null,
        max_hr: w.max_hr as number | null,
        status: w.status as Semaforo | null,
      }))

    const semaforo = { green: 0, yellow: 0, red: 0 }
    for (const w of workouts ?? []) {
      if (w.status === 'green') semaforo.green++
      else if (w.status === 'yellow') semaforo.yellow++
      else if (w.status === 'red') semaforo.red++
    }

    const workoutDates = new Map((workouts ?? []).map((w) => [w.id as string, w.date as string]))
    const loadsByExercise: Record<string, { date: string | null; reps: number | null; load_kg: number | null; rpe: number | null }[]> = {}
    for (const log of logs ?? []) {
      const list = (loadsByExercise[log.exercise] ??= [])
      if (list.length < 6) {
        list.push({
          date: workoutDates.get(log.workout_id) ?? null,
          reps: log.reps,
          load_kg: log.load_kg,
          rpe: log.rpe,
        })
      }
    }

    let adesao: { planeadas: number; feitas: number } | null = null
    const lastBlock = (prevBlocks ?? []).find((b) => b.status !== 'active')
    if (lastBlock) {
      const { data: sessions } = await db
        .from('planned_sessions')
        .select('status')
        .eq('block_id', lastBlock.id)
      if (sessions?.length) {
        adesao = {
          planeadas: sessions.length,
          feitas: sessions.filter((s) => s.status === 'done').length,
        }
      }
    }

    const alvoBike = nextBikeTarget(bikeSessions, profile.bike_watts_options ?? [130, 140, 150], {
      avgHr: profile.bike_hr_avg_cap,
      maxHr: profile.bike_hr_max_cap,
    })

    const payload = {
      perfil: {
        height_cm: profile.height_cm,
        target_weight_kg: profile.target_weight_kg,
        constraints: profile.constraints,
        equipment: profile.equipment,
        goals: profile.goals,
        bike_watts_options: profile.bike_watts_options,
        bike_hr_avg_cap: profile.bike_hr_avg_cap,
        bike_hr_max_cap: profile.bike_hr_max_cap,
        bike_min_cadence: profile.bike_min_cadence,
      },
      catalogo: catalog,
      capitulo: {
        title: chapter.title,
        patron: chapter.patron,
        theme: chapter.theme,
        order_index: chapter.order_index,
      },
      historico: {
        bike: bikeSessions,
        cargas: loadsByExercise,
        semaforo,
        adesao_bloco_anterior: adesao,
      },
      alvo_bike: alvoBike,
    }

    const system = readPrompt(PROMPT_PLAN)
    const catalogNames = catalog.map((c) => c.name)
    const usage: Usage = { input_tokens: 0, output_tokens: 0 }
    let plan: GeneratedPlan | null = null
    let lastErrors: string[] = []

    // 2 tentativas: a segunda recebe os erros de validação da primeira.
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      const messages: { role: 'user'; content: string }[] = [
        { role: 'user', content: JSON.stringify(payload) },
      ]
      if (lastErrors.length) {
        messages.push({
          role: 'user',
          content: `O plano anterior foi rejeitado. Corrige: ${lastErrors.join(' ')}`,
        })
      }
      const response = await anthropic().messages.parse({
        model: MODELS.vision,
        max_tokens: 16000,
        system,
        messages,
        output_config: { format: zodOutputFormat(GeneratedPlanSchema) },
      })
      usage.input_tokens += response.usage.input_tokens
      usage.output_tokens += response.usage.output_tokens
      const candidate = response.parsed_output
      if (!candidate) {
        lastErrors = ['A resposta não era JSON válido.']
        continue
      }
      const errors = validatePlan(candidate, catalogNames)
      if (errors.length) {
        lastErrors = errors
        continue
      }
      plan = candidate
    }

    const cost = await logApiCall(adminClient(), {
      user_id: user.id,
      kind: 'plan_generate',
      model: MODELS.vision,
      usage,
    })
    if (!plan) {
      throw new HttpError(422, `O plano não passou na validação: ${lastErrors.join(' ')}`)
    }

    const startDate =
      typeof req.body?.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.start_date)
        ? req.body.start_date
        : mondayOnOrAfter(localToday())

    if (force && activeBlocks?.length) {
      await db
        .from('plan_blocks')
        .update({ status: 'cancelled' })
        .in(
          'id',
          activeBlocks.map((b) => b.id),
        )
    }

    const { data: block, error: blockError } = await db
      .from('plan_blocks')
      .insert({
        user_id: user.id,
        chapter_id: chapter.id,
        start_date: startDate,
        weeks: 4,
        status: 'active',
        plan,
        prompt_version: promptVersion(PROMPT_PLAN),
      })
      .select()
      .single()
    if (blockError) throw new HttpError(500, blockError.message)

    const sessionRows = plan.weeks.flatMap((week) =>
      week.sessions.map((s) => ({
        user_id: user.id,
        block_id: block.id,
        week: week.week,
        day_index: s.day_index,
        type: s.type,
        name: s.name,
        details: { bike: s.bike, exercises: s.exercises, notes: s.notes },
        status: 'planned',
      })),
    )
    const { error: sessionsError } = await db.from('planned_sessions').insert(sessionRows)
    if (sessionsError) throw new HttpError(500, sessionsError.message)

    res.status(200).json({ block, sessions: sessionRows.length, cost_usd: cost })
  } catch (err) {
    respondError(res, err)
  }
}
