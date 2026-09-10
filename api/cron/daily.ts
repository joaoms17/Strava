import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../_lib/supabase.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { round1 } from '../_lib/rules/meal-totals.js'
import { dayExerciseKcal, kcalTarget, type WorkoutType } from '../_lib/rules/targets.js'
import { floorWarning, isDayComplete } from '../_lib/rules/day-close.js'
import { tdeeRaw, smoothTdee } from '../_lib/rules/adaptativo.js'
import { isMaintenanceWeek, maintenanceTarget, mondayOf } from '../_lib/rules/manutencao.js'
import { reconcileStrava } from '../_lib/strava.js'
import { generateWeeklyReview } from '../_lib/review.js'

// Cron diária às 04:30 UTC (sempre depois das 04:00 em Lisboa, com ou sem DST):
// reconcilia o Strava das últimas 48 h (os webhooks falham), fecha os últimos
// 3 dias nutricionais (idempotente — cobre falhas da cron), calcula o gasto
// adaptativo, aplica a semana de manutenção e, à segunda, gera o review da
// semana anterior.

interface ProfileRow {
  user_id: string
  base_kcal: number
  kcal_floor_week: number
  nutrition_day_cutoff_hour: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Regra 4: sobre os últimos 14 dias completos até esta data; EMA sobre a
// estimativa anterior. Corre depois do upsert do dia.
async function computeAdaptive(admin: SupabaseClient, userId: string, date: string) {
  const { data: completeDays } = await admin
    .from('days')
    .select('date,kcal_in,weight_trend')
    .eq('user_id', userId)
    .eq('is_complete', true)
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(14)
  const window = (completeDays ?? [])
    .reverse()
    .map((d) => ({ date: d.date, kcal_in: Number(d.kcal_in), weight_trend: d.weight_trend }))
  const raw = tdeeRaw(window)
  if (raw == null) return

  const { data: prevRows } = await admin
    .from('days')
    .select('tdee_est')
    .eq('user_id', userId)
    .lt('date', date)
    .not('tdee_est', 'is', null)
    .order('date', { ascending: false })
    .limit(1)
  const previous = prevRows?.[0]?.tdee_est != null ? Number(prevRows[0].tdee_est) : null
  await admin
    .from('days')
    .update({ tdee_est: smoothTdee(previous, raw) })
    .eq('user_id', userId)
    .eq('date', date)
}

async function closeDay(
  admin: SupabaseClient,
  profile: ProfileRow,
  date: string,
  anchor: string | null,
) {
  const userId = profile.user_id

  const [mealsRes, workoutsRes, weightRes, existingRes, weightsRes, recentDaysRes] =
    await Promise.all([
      admin.from('meals').select('kcal,protein').eq('user_id', userId).eq('date', date),
      admin.from('workouts').select('type,minutes,watts,raw').eq('user_id', userId).eq('date', date),
      admin.from('weights').select('kg').eq('user_id', userId).eq('date', date).maybeSingle(),
      admin.from('days').select('flags').eq('user_id', userId).eq('date', date).maybeSingle(),
      admin
        .from('weights')
        .select('date,kg')
        .eq('user_id', userId)
        .gte('date', shiftDate(date, -6))
        .lte('date', date),
      admin
        .from('days')
        .select('kcal_in,is_complete')
        .eq('user_id', userId)
        .lt('date', date)
        .order('date', { ascending: false })
        .limit(21),
    ])

  const meals = mealsRes.data ?? []
  const kcalIn = Math.round(meals.reduce((acc, m) => acc + Number(m.kcal), 0))
  const protein = round1(meals.reduce((acc, m) => acc + Number(m.protein), 0))

  const kcalExercise = dayExerciseKcal(
    (workoutsRes.data ?? []).map((w) => ({
      type: w.type as WorkoutType,
      minutes: w.minutes as number | null,
      watts: w.watts as number | null,
      stravaCalories:
        typeof (w.raw as { calories?: unknown } | null)?.calories === 'number'
          ? ((w.raw as { calories: number }).calories)
          : null,
    })),
  )

  // Regra 7: na semana de manutenção, a meta é o gasto estimado (ou 2000).
  const maintenance = anchor != null && isMaintenanceWeek(anchor, date)
  let target: number
  if (maintenance) {
    const { data: tdeeRows } = await admin
      .from('days')
      .select('tdee_est')
      .eq('user_id', userId)
      .lt('date', date)
      .not('tdee_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
    target = maintenanceTarget(tdeeRows?.[0]?.tdee_est != null ? Number(tdeeRows[0].tdee_est) : null)
  } else {
    target = kcalTarget(profile.base_kcal, kcalExercise)
  }

  const prevFlags: string[] = Array.isArray(existingRes.data?.flags) ? existingRes.data.flags : []
  const manuallyClosed = prevFlags.includes('dia_fechado')
  const complete = isDayComplete({ mealCount: meals.length, kcalIn, manuallyClosed })

  // Tendência (regra 3): média das pesagens na janela [date-6, date].
  const windowWeights = (weightsRes.data ?? []).map((w) => Number(w.kg))
  const weightTrend = windowWeights.length
    ? round2(windowWeights.reduce((a, b) => a + b, 0) / windowWeights.length)
    : null

  // Chão (regra 6): média dos últimos 7 dias completos, este incluído se completo.
  const completeKcals = (recentDaysRes.data ?? [])
    .filter((d) => d.is_complete)
    .map((d) => Number(d.kcal_in))
    .reverse()
  if (complete) completeKcals.push(kcalIn)
  const chao = floorWarning(completeKcals, profile.kcal_floor_week)

  const flags = new Set(prevFlags)
  if (chao) flags.add('chao')
  else flags.delete('chao')
  if (complete) flags.delete('dia_incompleto')
  else flags.add('dia_incompleto')
  if (maintenance) flags.add('manutencao')
  else flags.delete('manutencao')

  const { error } = await admin.from('days').upsert(
    {
      user_id: userId,
      date,
      kcal_in: kcalIn,
      protein,
      kcal_exercise: kcalExercise,
      kcal_target: target,
      is_complete: complete,
      weight_kg: weightRes.data ? Number(weightRes.data.kg) : null,
      weight_trend: weightTrend,
      flags: [...flags],
    },
    { onConflict: 'user_id,date' },
  )
  if (error) throw new Error(`days upsert (${date}): ${error.message}`)

  await computeAdaptive(admin, userId, date)

  return { date, kcal_in: kcalIn, is_complete: complete, chao, maintenance }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Não autorizado.' })
    return
  }

  try {
    const admin = adminClient()

    // Primeiro o Strava, para o fecho do dia já contar os treinos.
    const reconciled = await reconcileStrava(admin)

    const { data: profiles, error } = await admin
      .from('profile')
      .select('user_id,base_kcal,kcal_floor_week,nutrition_day_cutoff_hour')
    if (error) throw new Error(error.message)

    const closed = []
    let reviews = 0
    for (const profile of (profiles ?? []) as ProfileRow[]) {
      const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

      // Âncora da regra 7: a semana do primeiro dia registado.
      const { data: firstDay } = await admin
        .from('days')
        .select('date')
        .eq('user_id', profile.user_id)
        .order('date')
        .limit(1)
      const anchor = firstDay?.[0]?.date ?? null

      for (let back = 3; back >= 1; back--) {
        closed.push(await closeDay(admin, profile, shiftDate(today, -back), anchor))
      }

      // À segunda-feira, o review da semana que terminou.
      if (new Date(`${today}T00:00:00Z`).getUTCDay() === 1) {
        try {
          if (await generateWeeklyReview(admin, profile.user_id, mondayOf(shiftDate(today, -7)))) {
            reviews++
          }
        } catch (err) {
          console.error('Review semanal falhou:', err)
        }
      }

      // Blocos ativos que já passaram as 4 semanas ficam concluídos.
      const { data: expired } = await admin
        .from('plan_blocks')
        .select('id,start_date')
        .eq('user_id', profile.user_id)
        .eq('status', 'active')
        .lt('start_date', shiftDate(today, -27))
      for (const block of expired ?? []) {
        await admin.from('plan_blocks').update({ status: 'completed' }).eq('id', block.id)
        await admin
          .from('planned_sessions')
          .update({ status: 'skipped' })
          .eq('block_id', block.id)
          .eq('status', 'planned')
      }
    }
    res.status(200).json({ ok: true, reconciled, closed, reviews })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha no fecho do dia.' })
  }
}
