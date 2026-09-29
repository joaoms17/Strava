import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftDate } from './rules/nutritional-day.js'
import { round1 } from './rules/meal-totals.js'
import { kcalTarget, storedExerciseKcal, type WorkoutType } from './rules/targets.js'
import { floorWarning, isDayComplete } from './rules/day-close.js'
import { tdeeRaw, smoothTdee } from './rules/adaptativo.js'
import { isMaintenanceWeek, maintenanceTarget } from './rules/manutencao.js'

// Fecho de um dia nutricional: kcal e macros das refeições contadas, kcal
// guardadas dos treinos, meta (plano ou semana de pausa), dia completo,
// peso médio, aviso do mínimo e gasto medido. Usado pela cron.

export interface CloseDayProfile {
  user_id: string
  base_kcal: number
  kcal_floor_week: number
  nutrition_day_cutoff_hour: number
  maintenance_enabled?: boolean | null
  maintenance_anchor?: string | null
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

  let tdee: number | null = null
  if (raw != null) {
    const { data: prevRows } = await admin
      .from('days')
      .select('tdee_est')
      .eq('user_id', userId)
      .lt('date', date)
      .not('tdee_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
    const previous = prevRows?.[0]?.tdee_est != null ? Number(prevRows[0].tdee_est) : null
    tdee = smoothTdee(previous, raw)
  }
  // Recalcular um dia antigo pode tirar-lhe a estimativa (ex.: «faltou algo»).
  await admin.from('days').update({ tdee_est: tdee }).eq('user_id', userId).eq('date', date)
}

export async function closeDay(
  admin: SupabaseClient,
  profile: CloseDayProfile,
  date: string,
  anchor: string | null,
) {
  const userId = profile.user_id

  const [mealsRes, workoutsRes, weightRes, existingRes, weightsRes, recentDaysRes, pendingRes] =
    await Promise.all([
      admin.from('meals_counted').select('kcal,protein,carbs,fat').eq('user_id', userId).eq('date', date),
      admin
        .from('workouts_active')
        .select('type,minutes,watts,raw,kcal_est')
        .eq('user_id', userId)
        .eq('date', date),
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
      // Fotos ainda por contar (a analisar ou acima do limite da IA).
      admin
        .from('meals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('date', date)
        .is('deleted_at', null)
        .in('status', ['a_analisar', 'sem_analise']),
    ])
  for (const res of [mealsRes, workoutsRes]) {
    if (res.error) throw new Error(`leitura (${date}): ${res.error.message}`)
  }

  const meals = mealsRes.data ?? []
  const sum = (pick: (m: Record<string, unknown>) => unknown) =>
    meals.reduce((acc, m) => acc + Number(pick(m)), 0)
  const kcalIn = Math.round(sum((m) => m.kcal))
  const protein = round1(sum((m) => m.protein))
  const carbs = round1(sum((m) => m.carbs))
  const fat = round1(sum((m) => m.fat))

  // Soma as kcal guardadas em cada treino (a regra 2 corre ao gravar).
  const kcalExercise = storedExerciseKcal(
    (workoutsRes.data ?? []).map((w) => ({
      type: w.type as WorkoutType,
      minutes: w.minutes as number | null,
      watts: w.watts as number | null,
      deviceCalories:
        typeof (w.raw as { calories?: unknown } | null)?.calories === 'number'
          ? (w.raw as { calories: number }).calories
          : null,
      kcal_est: w.kcal_est as number | null,
    })),
  )

  // Regra 7: na semana de pausa da dieta, a meta é o gasto estimado (ou 2000).
  const maintenance =
    profile.maintenance_enabled !== false && anchor != null && isMaintenanceWeek(anchor, date)
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
  const complete = isDayComplete({
    mealCount: meals.length,
    kcalIn,
    manuallyClosed: prevFlags.includes('dia_fechado'),
    missingSomething: prevFlags.includes('faltou_algo'),
  })

  // Peso médio (regra 3): média das pesagens na janela [date-6, date].
  const windowWeights = (weightsRes.data ?? []).map((w) => Number(w.kg))
  const weightTrend = windowWeights.length
    ? round2(windowWeights.reduce((a, b) => a + b, 0) / windowWeights.length)
    : null

  // Mínimo (regra 6): média dos últimos 7 dias completos, este incluído se completo.
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
      carbs,
      fat,
      kcal_exercise: kcalExercise,
      kcal_target: target,
      is_complete: complete,
      weight_kg: weightRes.data ? Number(weightRes.data.kg) : null,
      weight_trend: weightTrend,
      flags: [...flags],
      meals_pending: pendingRes.count ?? 0,
      dirty: false,
    },
    { onConflict: 'user_id,date' },
  )
  if (error) throw new Error(`days upsert (${date}): ${error.message}`)

  await computeAdaptive(admin, userId, date)

  return { date, kcal_in: kcalIn, is_complete: complete, chao, maintenance }
}

// Dias a recalcular numa noite: desde o dia sujo mais antigo (ou 3 dias
// atrás) até ontem, por ordem, no máximo `maxDays`. O peso médio e o gasto
// medido encadeiam de um dia para o outro, por isso vai-se sempre para a frente.
export function recomputeRange(
  today: string,
  oldestDirty: string | null,
  maxDays: number,
): { dates: string[]; next: string | null } {
  const yesterday = shiftDate(today, -1)
  const floor = shiftDate(today, -3)
  const start = oldestDirty != null && oldestDirty < floor ? oldestDirty : floor
  const dates: string[] = []
  for (let d = start; d <= yesterday && dates.length < maxDays; d = shiftDate(d, 1)) dates.push(d)
  const last = dates[dates.length - 1]
  const next = last != null && last < yesterday ? shiftDate(last, 1) : null
  return { dates, next }
}
