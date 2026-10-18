import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftDate } from './rules/nutritional-day.js'
import { round1 } from './rules/meal-totals.js'
import { kcalTarget, storedExerciseKcal, type WorkoutType } from './rules/targets.js'
import { floorWarning, isDayComplete } from './rules/day-close.js'
import { dayTdee, tdeeRaw, TDEE_WINDOW_DAYS } from './rules/adaptativo.js'
import { isMaintenanceWeek, maintenanceTarget, mondayOf } from './rules/manutencao.js'
import { dailyBase, formulaBase, kcalOut, trustedTdee } from './rules/gasto.js'

// Fecho de um dia nutricional: kcal e macros das refeições contadas, kcal
// guardadas dos treinos, meta (plano ou semana de pausa), dia completo,
// peso médio, aviso do mínimo e gasto medido. Usado pela cron e pelo
// recálculo (/api/day/recompute).

// Colunas do perfil de que o fecho do dia precisa (cron e recálculo).
export const CLOSE_DAY_PROFILE_COLUMNS =
  'user_id,base_kcal,kcal_floor_week,nutrition_day_cutoff_hour,maintenance_enabled,maintenance_anchor,height_cm,birth_year,sex,expected_tdee'

export interface CloseDayProfile {
  user_id: string
  base_kcal: number
  kcal_floor_week: number
  nutrition_day_cutoff_hour: number
  maintenance_enabled?: boolean | null
  maintenance_anchor?: string | null
  // Fase 6: para a fórmula do gasto (Mifflin × 1,2)
  height_cm?: number | null
  birth_year?: number | null
  sex?: string | null
  expected_tdee?: number | null
}

// Gasto de um dia (Fase 6, só para mostrar): base sem treino + treino. A
// base usa o gasto medido congelado antes da segunda-feira da semana e a
// média das kcal de treino dos dias completos dessa janela; com menos de 10
// dias completos, a fórmula.
async function dayExpenditure(
  admin: SupabaseClient,
  profile: CloseDayProfile,
  date: string,
  weightTrend: number | null,
  kcalExercise: number,
) {
  const userId = profile.user_id
  const monday = mondayOf(date)
  const [{ data: frozen }, { data: window }, { count }, { data: lastTrend }] = await Promise.all([
    admin
      .from('days')
      .select('tdee_est')
      .eq('user_id', userId)
      .lt('date', monday)
      .not('tdee_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
    admin
      .from('days')
      .select('kcal_exercise')
      .eq('user_id', userId)
      .eq('is_complete', true)
      .lt('date', monday)
      .order('date', { ascending: false })
      .limit(14),
    admin
      .from('days')
      .select('date', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_complete', true)
      .lt('date', monday),
    weightTrend == null
      ? admin
          .from('days')
          .select('weight_trend')
          .eq('user_id', userId)
          .lte('date', date)
          .not('weight_trend', 'is', null)
          .order('date', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [{ weight_trend: weightTrend }] }),
  ])
  const trainings = (window ?? []).map((d) => Number(d.kcal_exercise ?? 0))
  const avgTraining = trainings.length ? trainings.reduce((a, b) => a + b, 0) / trainings.length : 0
  const formula = formulaBase({
    weightKg: lastTrend?.[0]?.weight_trend != null ? Number(lastTrend[0].weight_trend) : null,
    heightCm: profile.height_cm ?? null,
    birthYear: profile.birth_year ?? null,
    sex: profile.sex ?? 'm',
    date,
    fallback: Number(profile.expected_tdee ?? 2200),
  })
  const base = dailyBase({
    completeDays: count ?? 0,
    tdeeFrozen: trustedTdee(frozen?.[0]?.tdee_est != null ? Number(frozen[0].tdee_est) : null, formula + avgTraining),
    avgTrainingKcal: avgTraining,
    formula,
  })
  return { formula_base: formula, daily_base_est: base.base, kcal_out_est: kcalOut(base.base, kcalExercise) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Âncora da regra 7 (semana de pausa da dieta): fixa no perfil. Um perfil
// ainda sem ela fica com o dia da primeira refeição, gravado, para a cron, o
// recálculo e os ecrãs contarem as mesmas semanas (antes a cron usava o
// primeiro dia guardado, que mudava ao importar o histórico, e o recálculo
// nenhum). Sem refeições ainda não há dieta, nem âncora.
export async function maintenanceAnchor(admin: SupabaseClient, profile: CloseDayProfile): Promise<string | null> {
  if (profile.maintenance_anchor) return profile.maintenance_anchor
  const { data } = await admin
    .from('meals')
    .select('date')
    .eq('user_id', profile.user_id)
    .is('deleted_at', null)
    .order('date')
    .limit(1)
  const first = (data?.[0]?.date as string | undefined) ?? null
  if (first) {
    await admin
      .from('profile')
      .update({ maintenance_anchor: first })
      .eq('user_id', profile.user_id)
      .is('maintenance_anchor', null)
    profile.maintenance_anchor = first
  }
  return first
}

// Regra 4: sobre os últimos 28 dias completos até esta data; EMA sobre a
// estimativa anterior, um passo por dia completo (`dayTdee`). Guarda também o
// valor só pelo peso (`tdee_raw`), para o Balanço o mostrar. Corre depois do
// upsert do dia.
async function computeAdaptive(admin: SupabaseClient, userId: string, date: string, complete: boolean) {
  const [{ data: completeDays }, { data: prevRows }] = await Promise.all([
    admin
      .from('days')
      .select('date,kcal_in,weight_trend,kcal_exercise,formula_base')
      .eq('user_id', userId)
      .eq('is_complete', true)
      .lte('date', date)
      .order('date', { ascending: false })
      .limit(TDEE_WINDOW_DAYS),
    admin
      .from('days')
      .select('tdee_est')
      .eq('user_id', userId)
      .lt('date', date)
      .not('tdee_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
  ])
  const rows = (completeDays ?? []).reverse()
  const window = rows.map((d) => ({ date: d.date, kcal_in: Number(d.kcal_in), weight_trend: d.weight_trend }))
  const raw = tdeeRaw(window)
  // Referência para o limite: a fórmula mais recente da janela mais o treino médio.
  const formula = [...rows].reverse().find((d) => d.formula_base != null)?.formula_base
  const reference =
    formula != null
      ? Number(formula) + rows.reduce((a, d) => a + Number(d.kcal_exercise ?? 0), 0) / Math.max(1, rows.length)
      : null
  const previous = prevRows?.[0]?.tdee_est != null ? Number(prevRows[0].tdee_est) : null
  // Um dia incompleto fica com a estimativa anterior; sem dados para medir
  // (ex.: um dia antigo que passou a «faltou algo»), o dia fica sem estimativa.
  const tdee = dayTdee({ complete, previous, raw, reference })
  const { error } = await admin.from('days').update({ tdee_est: tdee, tdee_raw: raw }).eq('user_id', userId).eq('date', date)
  // Antes da migração 20261018140000 não há tdee_raw: guarda só a estimativa.
  if (error && /tdee_raw/.test(error.message)) {
    await admin.from('days').update({ tdee_est: tdee }).eq('user_id', userId).eq('date', date)
  }
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
      // Tudo (`*`): sem a migração 20261018140000 não há base_kcal e a leitura não falha.
      admin.from('days').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
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
      // Fotos ainda sem números (a analisar, com erro ou acima do limite da IA).
      admin
        .from('meals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('date', date)
        .is('deleted_at', null)
        .in('status', ['a_analisar', 'sem_analise', 'erro']),
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

  // O plano base em vigor nesse dia: o guardado no primeiro fecho fica, para
  // mudar o plano não reescrever os dias antigos (no ecrã e no recálculo).
  const existingBase = (existingRes.data as { base_kcal?: number | null } | null)?.base_kcal
  const base = existingBase != null ? Number(existingBase) : profile.base_kcal

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
    target = kcalTarget(base, kcalExercise)
  }

  const prevFlags: string[] = Array.isArray(existingRes.data?.flags) ? existingRes.data.flags : []
  const complete = isDayComplete({
    mealCount: meals.length,
    kcalIn,
    manuallyClosed: prevFlags.includes('dia_fechado'),
    missingSomething: prevFlags.includes('faltou_algo'),
    uncountedMeals: pendingRes.count ?? 0,
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

  const expenditure = await dayExpenditure(admin, profile, date, weightTrend, kcalExercise)
  const row = {
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
  }
  const upsert = (values: Record<string, unknown>) => admin.from('days').upsert(values, { onConflict: 'user_id,date' })
  let { error } = await upsert({ ...row, ...expenditure, base_kcal: base })
  // Antes da migração 20261018140000 não há base_kcal, e antes da 7 as
  // colunas do gasto: fecha o dia sem elas.
  if (error && /base_kcal/.test(error.message)) ({ error } = await upsert({ ...row, ...expenditure }))
  if (error && /kcal_out_est|daily_base_est|formula_base/.test(error.message)) ({ error } = await upsert(row))
  if (error) throw new Error(`days upsert (${date}): ${error.message}`)

  await computeAdaptive(admin, userId, date, complete)

  return { date, kcal_in: kcalIn, is_complete: complete, chao, maintenance }
}

// A ordem das pessoas na cron: fixa (por user_id) e a começar noutra pessoa
// em cada noite, para uma noite curta não deixar sempre a mesma para o fim.
export function nightOrder<T extends { user_id: string }>(profiles: T[], today: string): T[] {
  const sorted = [...profiles].sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0))
  if (sorted.length === 0) return sorted
  const start = Math.round(Date.parse(`${today}T00:00:00Z`) / 86_400_000) % sorted.length
  return [...sorted.slice(start), ...sorted.slice(0, start)]
}

// Dias a recalcular numa noite: desde o dia sujo mais antigo (ou 3 dias
// atrás) até ontem, por ordem, no máximo `maxDays`. O peso médio e o gasto
// medido encadeiam de um dia para o outro, por isso vai-se sempre para a frente.
// Se a cadeia não chega a ontem (dias sujos antigos), os últimos 3 dias fecham
// na mesma, primeiro: sem isso ficavam semanas a 0 kcal à espera da cadeia.
export function recomputeRange(
  today: string,
  oldestDirty: string | null,
  maxDays: number,
): { dates: string[]; next: string | null } {
  const yesterday = shiftDate(today, -1)
  const floor = shiftDate(today, -3)
  const start = oldestDirty != null && oldestDirty < floor ? oldestDirty : floor
  const chain: string[] = []
  for (let d = start; d <= yesterday && chain.length < maxDays; d = shiftDate(d, 1)) chain.push(d)
  const last = chain[chain.length - 1]
  const next = last != null && last < yesterday ? shiftDate(last, 1) : null
  if (next == null) return { dates: chain, next }
  const recent: string[] = []
  for (let d = floor; d <= yesterday; d = shiftDate(d, 1)) recent.push(d)
  return { dates: [...recent, ...chain], next }
}
