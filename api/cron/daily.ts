import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../_lib/supabase'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day'
import { round1 } from '../_lib/rules/meal-totals'
import { dayExerciseKcal, kcalTarget, type WorkoutType } from '../_lib/rules/targets'
import { floorWarning, isDayComplete } from '../_lib/rules/day-close'
import { reconcileStrava } from '../_lib/strava'

// Cron diária às 04:30 UTC (sempre depois das 04:00 em Lisboa, com ou sem DST):
// reconcilia o Strava das últimas 48 h (os webhooks falham) e fecha os
// últimos 3 dias nutricionais (idempotente — cobre falhas da cron).
// O adaptativo e o review chegam no M5.

interface ProfileRow {
  user_id: string
  base_kcal: number
  kcal_floor_week: number
  nutrition_day_cutoff_hour: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function closeDay(admin: SupabaseClient, profile: ProfileRow, date: string) {
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
  const target = kcalTarget(profile.base_kcal, kcalExercise)

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

  return { date, kcal_in: kcalIn, is_complete: complete, chao }
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
    for (const profile of (profiles ?? []) as ProfileRow[]) {
      const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
      for (let back = 3; back >= 1; back--) {
        closed.push(await closeDay(admin, profile, shiftDate(today, -back)))
      }
    }
    res.status(200).json({ ok: true, reconciled, closed })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha no fecho do dia.' })
  }
}
