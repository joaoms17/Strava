import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftDate } from './rules/nutritional-day.js'
import {
  CLOSE_HISTORY_DAYS,
  CLOSE_WEIGHTS_DAYS,
  computeCloseDay,
  sameUserFlags,
  withUserFlags,
  type ClosedDayRow,
  type HistoryDay,
} from './rules/fecho.js'

// Fecho de um dia nutricional: kcal e macros das refeições contadas, kcal
// guardadas dos treinos, meta (plano ou semana de pausa), dia completo,
// peso médio e gasto medido. Usado pela cron e pelo recálculo
// (/api/day/recompute). As contas estão em rules/fecho.ts; aqui só se lê e
// grava.

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

// Colunas que podem faltar numa base sem as migrações: base_kcal e tdee_raw
// (20261018140000) e as do gasto (fase 6). O dia fecha sem elas.
const OPTIONAL_COLUMNS: { test: RegExp; keys: (keyof ClosedDayRow)[] }[] = [
  { test: /base_kcal|tdee_raw/, keys: ['base_kcal', 'tdee_raw'] },
  { test: /kcal_out_est|daily_base_est|formula_base/, keys: ['kcal_out_est', 'daily_base_est', 'formula_base'] },
]

const MAX_ATTEMPTS = 3

type Read<T> = { data: T | null; error: { message: string } | null; count?: number | null }

function must<T>(res: Read<T>, what: string, date: string): T | null {
  if (res.error) throw new Error(`leitura de ${what} (${date}): ${res.error.message}`)
  return res.data
}

// Uma passagem: lê tudo de uma vez (P3: uma ida, 6 consultas), faz as contas,
// volta a ler as marcas do dia e grava. Devolve null quando a pessoa
// respondeu «Foi tudo?» entretanto (as contas usaram as marcas velhas).
async function closeOnce(
  admin: SupabaseClient,
  profile: CloseDayProfile,
  date: string,
  anchor: string | null,
  lastAttempt: boolean,
) {
  const userId = profile.user_id
  const [mealsRes, workoutsRes, weightsRes, existingRes, historyRes, pendingRes] = await Promise.all([
    admin.from('meals_counted').select('kcal,protein,carbs,fat').eq('user_id', userId).eq('date', date),
    admin.from('workouts_active').select('type,minutes,watts,raw,kcal_est').eq('user_id', userId).eq('date', date),
    // As pesagens da janela do gasto medido (o peso do dia e o peso médio saem daqui).
    admin
      .from('weights')
      .select('date,kg')
      .eq('user_id', userId)
      .gte('date', shiftDate(date, -CLOSE_WEIGHTS_DAYS))
      .lte('date', date)
      .order('date'),
    // Tudo (`*`): sem a migração 20261018140000 não há base_kcal e a leitura não falha.
    admin.from('days').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    // Os dias antes deste (120): gasto congelado, base da semana anterior,
    // treino médio, gasto medido anterior e a janela do gasto medido.
    admin
      .from('days')
      .select('date,kcal_in,is_complete,weight_trend,kcal_exercise,formula_base,tdee_est,daily_base_est')
      .eq('user_id', userId)
      .gte('date', shiftDate(date, -CLOSE_HISTORY_DAYS))
      .lt('date', date)
      .order('date'),
    // Fotos ainda sem números (a analisar, com erro ou acima do limite da IA).
    admin
      .from('meals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('date', date)
      .is('deleted_at', null)
      .in('status', ['a_analisar', 'sem_analise', 'erro']),
  ])
  // S2: qualquer leitura que falhe pára o fecho (antes, sem a linha do dia,
  // regravava-se o dia sem as respostas «Foi tudo?» e com o plano de hoje).
  const meals = must(mealsRes, 'refeições', date) ?? []
  const workouts = must(workoutsRes, 'treinos', date) ?? []
  const weights = must(weightsRes, 'pesagens', date) ?? []
  const existing = must(existingRes, 'dia', date) as { flags?: unknown; base_kcal?: number | null } | null
  const history = (must(historyRes, 'dias anteriores', date) ?? []) as HistoryDay[]
  must(pendingRes, 'fotos por analisar', date)

  const result = computeCloseDay({
    profile,
    date,
    anchor,
    meals,
    workouts: workouts as { type: string; minutes: number | null; watts: number | null; raw: unknown; kcal_est: number | null }[],
    weights: weights.map((w) => ({ date: w.date as string, kg: Number(w.kg) })),
    existing,
    history,
    pendingMeals: pendingRes.count ?? 0,
  })

  // S5: a pessoa pode ter respondido «Foi tudo?» enquanto se faziam as
  // contas. Volta a ler as marcas mesmo antes de gravar; se mudaram, as
  // contas repetem-se com as novas.
  const fresh = await admin.from('days').select('flags').eq('user_id', userId).eq('date', date).maybeSingle()
  if (fresh.error) throw new Error(`leitura do dia (${date}): ${fresh.error.message}`)
  if (!lastAttempt && !sameUserFlags(existing?.flags, fresh.data?.flags)) return null

  // Sem `dirty`: o dia foi posto como limpo antes das leituras (closeDay); se
  // uma refeição, um treino ou uma pesagem mudou entretanto, o gatilho voltou
  // a marcá-lo e a próxima cron (ou o recálculo) fecha-o outra vez.
  // Na última tentativa, as respostas mais recentes ficam na mesma (o dia
  // continua marcado para recalcular, por isso as contas acertam depois).
  const values: Record<string, unknown> = {
    user_id: userId,
    ...result.row,
    flags: withUserFlags(result.row.flags, fresh.data?.flags ?? existing?.flags),
  }
  const upsert = () => admin.from('days').upsert(values, { onConflict: 'user_id,date' })
  let { error } = await upsert()
  const dropped = new Set<number>()
  for (;;) {
    const i = error ? OPTIONAL_COLUMNS.findIndex((o, k) => !dropped.has(k) && o.test.test(error!.message)) : -1
    if (i < 0) break
    dropped.add(i)
    for (const key of OPTIONAL_COLUMNS[i]!.keys) delete values[key]
    ;({ error } = await upsert())
  }
  if (error) throw new Error(`days upsert (${date}): ${error.message}`)

  return { date, kcal_in: result.row.kcal_in, is_complete: result.complete, maintenance: result.maintenance }
}

export async function closeDay(admin: SupabaseClient, profile: CloseDayProfile, date: string, anchor: string | null) {
  const userId = profile.user_id
  // S5: o dia fica limpo ANTES de se ler; uma escrita do telemóvel durante o
  // fecho volta a marcá-lo (gatilho ou `dirty: true` do «Foi tudo?») e essa
  // marca já não se apaga no fim.
  const claim = await admin.from('days').update({ dirty: false }).eq('user_id', userId).eq('date', date)
  if (claim.error) throw new Error(`days dirty (${date}): ${claim.error.message}`)
  try {
    for (let attempt = 1; ; attempt++) {
      const closed = await closeOnce(admin, profile, date, anchor, attempt >= MAX_ATTEMPTS)
      if (closed) return closed
    }
  } catch (e) {
    // Não fechou: o dia volta a ficar por recalcular (a próxima noite tenta outra vez).
    await Promise.resolve(
      admin.from('days').upsert({ user_id: userId, date, dirty: true }, { onConflict: 'user_id,date' }),
    ).catch(() => undefined)
    throw e
  }
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
