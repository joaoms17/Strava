import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MODELS, REQUEST_TEXT, aiProvider, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_ASK, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import { otherPeople } from '../_lib/people.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { lisbonClock, lisbonInstant } from '../_lib/rules/momentos.js'
import { ASK_KIND, aiLimitsFor, dailyAskCapReached } from '../_lib/rules/custos.js'
import { cleanDietMeals } from '../_lib/rules/dieta.js'
import {
  ASK_DAYS,
  ASK_FAVORITES,
  ASK_MEAL_DAYS,
  ASK_WEIGHT_DAYS,
  ASK_WORKOUT_DAYS,
  buildAskContext,
  type AskDay,
  type AskFavorite,
  type AskHealth,
  type AskMeal,
  type AskWorkout,
} from '../_lib/rules/pergunta.js'
import {
  ASK_TURNS_SENT,
  AskAiSchema,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
  cleanReply,
  replyWithActions,
  sortActions,
} from '../_lib/rules/pergunta-acoes.js'
import type { MealDayStats } from '../_lib/rules/evolucao.js'

// «Pergunta à app» (Hoje e Balanço): uma conversa sobre os dados da própria
// pessoa. O contexto é só dela (RLS) e só com os números que a app já
// calcula; a IA responde curto e pode propor ações de uma lista fechada,
// validadas aqui (só ids que foram no contexto). Este endpoint nunca grava
// nada além da contagem em api_calls: o telemóvel mostra cada ação com
// «Fazer» / «Não» e corre-a pelos caminhos de sempre.

// A conversa e a lista são só contexto: se vierem estragadas, pergunta-se
// sem elas (em vez de recusar a pergunta).
const Body = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  history: z
    .array(z.object({ from: z.enum(['me', 'app']), text: z.string().max(MAX_TURN_CHARS) }))
    .max(ASK_TURNS_SENT)
    .catch([]),
  // A lista de compras vive no telemóvel: vai o que a pessoa já lá juntou.
  shopping: z
    .array(z.object({ name: z.string().trim().min(1).max(60), grams: z.number().nullable() }))
    .max(60)
    .catch([]),
})

export default async function ask(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = Body.safeParse(req.body ?? {})
    if (!body.success) throw new HttpError(400, 'Escreve a pergunta (até 500 letras).')

    const admin = adminClient()
    const now = new Date()
    const shared = aiLimitsFor(aiProvider()).sharedDaily
    let asksQuery = admin
      .from('api_calls')
      .select('id', { count: 'exact', head: true })
      .eq('kind', ASK_KIND)
      .gte('created_at', lisbonInstant(lisbonClock(now).date, '00:00').toISOString())
    if (!shared) asksQuery = asksQuery.eq('user_id', user.id)
    const [overLimit, { count: asksToday }] = await Promise.all([aiLimitReached(admin, user.id, false), asksQuery])
    if (overLimit) throw new HttpError(429, 'Chegaste ao limite mensal da IA (Definições › Avançado).')
    if (dailyAskCapReached(asksToday ?? 0)) {
      throw new HttpError(429, shared ? 'A casa já fez muitas perguntas hoje. Amanhã há mais.' : 'Já fizeste muitas perguntas hoje. Amanhã há mais.')
    }

    const { data: profile } = await db.from('profile').select('*').single()
    if (!profile) throw new HttpError(400, 'Perfil não encontrado.')
    const today = nutritionalDay(now, Number(profile.nutrition_day_cutoff_hour ?? 4))
    const since = shiftDate(today, -ASK_DAYS)

    const [days, weights, meals, stats, uncounted, favorites, diet, workouts, health, people] = await Promise.all([
      // Tudo (`*`): base_kcal e tdee_raw só existem com a migração 20261018140000.
      db.from('days').select('*').gte('date', since).lte('date', today),
      db.from('weights').select('date,kg').gte('date', shiftDate(today, -ASK_WEIGHT_DAYS)).lte('date', today),
      db
        .from('meals_counted')
        .select('id,date,logged_at,slot,input_type,raw_text,items,kcal,protein')
        .gte('date', shiftDate(today, -ASK_MEAL_DAYS))
        .lte('date', today)
        .order('logged_at')
        .limit(120),
      db.from('meals_counted').select('date,kcal').gte('date', since).lt('date', today),
      // Fotos de hoje ainda sem números (a analisar, com erro ou acima do limite).
      db
        .from('meals')
        .select('id', { count: 'exact', head: true })
        .eq('date', today)
        .is('deleted_at', null)
        .in('status', ['a_analisar', 'sem_analise', 'erro']),
      db
        .from('favorites')
        .select('id,name,kcal,protein,carbs,fat,default_slot,items')
        .eq('kind', 'meal')
        .eq('archived', false)
        .order('use_count', { ascending: false })
        .limit(ASK_FAVORITES),
      // Sem a migração 10 a tabela não existe: fica sem dieta.
      db.from('diets').select('name,meals').eq('active', true).eq('archived', false).limit(1),
      db
        .from('workouts_active')
        .select('date,started_at,type,sport,minutes,elapsed_s,watts,avg_hr,kcal_est,raw')
        .gte('date', shiftDate(today, -ASK_WORKOUT_DAYS))
        .lte('date', today),
      db
        .from('health_daily')
        .select('date,sleep_minutes,sleep_score,steps,resting_hr')
        .gte('date', shiftDate(today, -ASK_WORKOUT_DAYS))
        .lte('date', today),
      otherPeople(admin, user.id).catch(() => []),
    ])
    if (days.error || meals.error) throw new HttpError(500, 'Não consegui ler os teus dados. Tenta outra vez.')

    const mealStats: Record<string, MealDayStats> = {}
    for (const m of stats.data ?? []) {
      const day = (mealStats[m.date as string] ??= { refeicoes: 0, kcal: 0 })
      day.refeicoes++
      day.kcal += Number(m.kcal ?? 0)
    }
    const activeDiet = diet.data?.[0]
    const clock = lisbonClock(now)
    const { context, refs } = buildAskContext({
      today,
      clock: { hour: clock.hour, minute: clock.minute },
      profile,
      days: (days.data ?? []) as AskDay[],
      weights: (weights.data ?? []) as { date: string; kg: number }[],
      meals: ((meals.data ?? []) as AskMeal[]).map((m) => ({ ...m, items: Array.isArray(m.items) ? m.items : [] })),
      mealStats,
      uncountedToday: uncounted.count ?? 0,
      favorites: ((favorites.data ?? []) as AskFavorite[]).map((f) => ({ ...f, items: Array.isArray(f.items) ? f.items : [] })),
      diet: activeDiet ? { name: String(activeDiet.name), meals: cleanDietMeals(activeDiet.meals) } : null,
      workouts: (workouts.data ?? []) as AskWorkout[],
      health: (health.data ?? []) as AskHealth[],
      people: people.map((p) => ({ id: p.user_id, name: p.name })),
      shopping: body.data.shopping,
    })

    const { output } = await structuredCall(
      admin,
      { userId: user.id, kind: ASK_KIND, request: REQUEST_TEXT },
      {
        model: MODELS.text,
        max_tokens: 1500,
        system: readPrompt(PROMPT_ASK),
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ contexto: context, conversa: body.data.history, pergunta: body.data.question }),
          },
        ],
      },
      AskAiSchema,
    )
    const { actions, dropped } = sortActions(output.actions, refs)
    const reply = replyWithActions(cleanReply(output.reply), actions, dropped)
    if (!reply) throw new HttpError(502, 'A IA não respondeu. Tenta outra vez.')
    res.status(200).json({ reply, actions, today })
  } catch (err) {
    respondError(res, err)
  }
}
