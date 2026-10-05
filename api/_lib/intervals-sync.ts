import type { SupabaseClient } from '@supabase/supabase-js'
import { nutritionalDay, shiftDate } from './rules/nutritional-day.js'
import { lisbonInstant } from './rules/momentos.js'
import { exerciseKcal, mergePatch, type WattsSource } from './rules/treino.js'
import {
  isEmptyStravaCopy,
  mapActivity,
  mapWellness,
  mergeDailyHealth,
  syncMatch,
  type DailyHealth,
  type IcuActivity,
  type IcuWellness,
  type MappedActivity,
} from './rules/intervals.js'
import type { WorkoutType } from './rules/targets.js'
import { ciqExtras, hasCiq, type CiqExtras } from './rules/ciq.js'
import { fitDeveloperFields } from './fit.js'

// Fase 7 — intervals.icu. A chave vive em `integrations` (RLS sem
// políticas): só a service role a lê. Autenticação HTTP Basic com o
// utilizador 'API_KEY' e a chave como palavra-passe; o atleta é o «0» (o
// dono da chave).

const BASE = 'https://intervals.icu/api/v1/athlete/0'

export class IntervalsError extends Error {}

async function icuGet<T>(key: string, path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString('base64')}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) throw new IntervalsError('A chave do intervals.icu não é válida.')
    if (!res.ok) throw new IntervalsError(`O intervals.icu respondeu com erro (${res.status}).`)
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof IntervalsError) throw err
    if ((err as Error).name === 'AbortError') throw new IntervalsError('O intervals.icu demorou demasiado a responder.')
    throw new IntervalsError('Não consegui falar com o intervals.icu.')
  } finally {
    clearTimeout(timer)
  }
}

// O ficheiro original de uma atividade (FIT, às vezes comprimido).
async function icuFile(key: string, activityId: string, kind: 'file' | 'fit-file', timeoutMs: number): Promise<Uint8Array> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/${kind}`, {
      headers: { Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString('base64')}` },
      signal: controller.signal,
    })
    if (!res.ok) throw new IntervalsError(`Ficheiro da atividade: erro ${res.status}.`)
    return new Uint8Array(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

// Os campos das apps Connect IQ (km, velocidade, potência, calorias da app da
// bicicleta) só estão no ficheiro FIT. Lê-se no máximo MAX_FIT_READS por
// sincronização, para caber no tempo; um erro não pára a sincronização.
const MAX_FIT_READS = 4
async function readCiq(key: string, activityId: string, timeoutMs: number): Promise<CiqExtras | null> {
  try {
    // O ficheiro original (o que veio do Garmin); se não for um FIT, o FIT
    // que o intervals.icu gera.
    const fields =
      fitDeveloperFields(await icuFile(key, activityId, 'file', timeoutMs)) ??
      fitDeveloperFields(await icuFile(key, activityId, 'fit-file', timeoutMs)) ??
      []
    return ciqExtras(fields)
  } catch (err) {
    console.error('FIT', activityId, err instanceof Error ? err.message : err)
    return null
  }
}

// Valida a chave e devolve o atleta (id e nome), sem nunca a devolver.
export async function testKey(key: string): Promise<{ id: string | null; name: string | null }> {
  const athlete = await icuGet<{ id?: string | number; name?: string }>(key, '', 8000)
  return { id: athlete.id != null ? String(athlete.id) : null, name: athlete.name ?? null }
}

export interface SyncResult {
  activities: number // atividades que o intervals.icu devolveu (novas ou não)
  known: number // dessas, as que já estavam na app
  updated: number // das que já estavam, as que ganharam km ou kcal novas
  weightDays: number // dias com peso no intervals.icu (entrados ou não)
  inserted: number
  merged: number
  weights: number
  // Bem-estar: dias que o intervals.icu devolveu, noites com sono gravadas
  // e o erro, se não foi possível ler (antes ficava calado).
  wellnessDays: number
  nights: number
  wellnessError: string | null
  oldestChanged: string | null
}

export async function setStatus(
  admin: SupabaseClient,
  userId: string,
  status: Record<string, unknown> | null,
): Promise<void> {
  const { data } = await admin.from('profile').select('integration_status').eq('user_id', userId).maybeSingle()
  const current = (data?.integration_status ?? {}) as Record<string, unknown>
  const next = { ...current }
  if (status) next.intervals = { ...((current.intervals as object) ?? {}), ...status }
  else delete next.intervals
  await admin.from('profile').update({ integration_status: next }).eq('user_id', userId)
}

// Intervalo a sincronizar: os últimos `days` dias, ou um bloco do
// histórico (`oldest`…`newest`, no máximo 31 dias por chamada).
export type SyncWindow = { days: number; timeoutMs: number } | { oldest: string; newest: string; timeoutMs: number }

type SameDayRow = Record<string, unknown> & {
  id: string
  type: WorkoutType
  date: string
  minutes: number | null
  started_at: string | null
  watts: number | null
  watts_source: string | null
}

// Atividades (fusão silenciosa com uma sessão já registada ou treino novo)
// e bem-estar (peso só em dias sem pesagem do João; sono, FC em repouso e
// passos em health_daily). As consultas são feitas em lote por bloco, para
// um mês de histórico caber folgado nos 60 s da função.
export async function syncIntervals(
  admin: SupabaseClient,
  userId: string,
  key: string,
  options: SyncWindow,
): Promise<SyncResult> {
  const { data: profile } = await admin
    .from('profile')
    .select('nutrition_day_cutoff_hour')
    .eq('user_id', userId)
    .maybeSingle()
  const cutoff = profile?.nutrition_day_cutoff_hour ?? 4
  const today = nutritionalDay(new Date(), cutoff)
  const oldest = 'days' in options ? shiftDate(today, -options.days) : options.oldest
  const newest = 'days' in options ? shiftDate(today, 1) : options.newest
  const range = `oldest=${oldest}&newest=${newest}`
  const [activities, wellnessRead] = await Promise.all([
    icuGet<IcuActivity[]>(key, `/activities?${range}`, options.timeoutMs),
    icuGet<IcuWellness[]>(key, `/wellness?${range}`, options.timeoutMs).then(
      (rows) => ({ rows: Array.isArray(rows) ? rows : [], error: null as string | null }),
      (err: unknown) => ({ rows: [] as IcuWellness[], error: err instanceof Error ? err.message : String(err) }),
    ),
  ])
  const wellness = wellnessRead.rows

  const result: SyncResult = {
    activities: Array.isArray(activities) ? activities.length : 0,
    known: 0,
    updated: 0,
    weightDays: 0,
    inserted: 0,
    merged: 0,
    weights: 0,
    wellnessDays: wellness.length,
    nights: 0,
    wellnessError: wellnessRead.error,
    oldestChanged: null,
  }
  const touch = (date: string) => {
    if (!result.oldestChanged || date < result.oldestChanged) result.oldestChanged = date
  }

  // --- Atividades -------------------------------------------------------
  const mapped = (Array.isArray(activities) ? activities : [])
    .filter((activity) => !isEmptyStravaCopy(activity))
    .map((activity) => {
      const a = mapActivity(activity)
      const startedAt =
        a.started_at ??
        (a.started_local ? lisbonInstant(a.started_local.slice(0, 10), a.started_local.slice(11, 16)).toISOString() : null)
      return { a, startedAt, date: startedAt ? nutritionalDay(new Date(startedAt), cutoff) : null }
    })
    .filter((x): x is { a: MappedActivity; startedAt: string; date: string } => x.startedAt != null && x.a.minutes != null)

  if (mapped.length > 0) {
    // Já entraram (como treino próprio ou fundidas numa sessão, mesmo apagadas).
    const { data: knownRows } = await admin
      .from('workouts')
      .select('external_id')
      .eq('user_id', userId)
      .in('external_id', mapped.map((m) => m.a.external_id))
    const known = new Set((knownRows ?? []).map((r) => r.external_id as string))
    const fresh = mapped.filter((m) => !known.has(m.a.external_id))
    result.known = mapped.length - fresh.length

    // Bicicletas sem distância (rolo com uma app Connect IQ): o ficheiro FIT.
    const started = Date.now()
    let fitReads = 0
    const fitTimeout = Math.min(6000, options.timeoutMs)
    const canReadFit = () => fitReads < MAX_FIT_READS && Date.now() - started < options.timeoutMs
    const fitByActivity = new Map<string, CiqExtras | null>()
    for (const { a } of fresh) {
      if (a.type !== 'bike' || a.distance_km != null || !canReadFit()) continue
      fitReads++
      const ciq = await readCiq(key, a.external_id, fitTimeout)
      fitByActivity.set(a.external_id, ciq)
      if (!ciq) continue
      a.distance_km = ciq.distance_km
      if (a.watts == null && ciq.power_w != null) {
        a.watts = ciq.power_w
        a.watts_source = 'device'
      }
      if (a.kcal_device == null && ciq.calories != null) a.kcal_device = ciq.calories
    }
    const fitRaw = (id: string) => {
      if (!fitByActivity.has(id)) return {}
      const ciq = fitByActivity.get(id)
      return { fit: ciq && hasCiq(ciq) ? 'lido' : ciq ? 'sem_dados' : 'erro', ...(ciq && hasCiq(ciq) ? { ciq } : {}) }
    }

    // As que já entraram: ganham os km do ficheiro (uma vez) e as kcal pela
    // regra atual (bicicleta sem potência: 70 % das calorias do relógio).
    if (known.size > 0) {
      const { data: knownFull } = await admin
        .from('workouts')
        .select('id,date,type,source,minutes,watts,watts_source,kcal_device,kcal_est,kcal_rule,distance_km,raw,deleted_at,external_id')
        .eq('user_id', userId)
        .eq('type', 'bike')
        .is('deleted_at', null)
        .in('external_id', [...known])
      const fromApi = new Map(mapped.map((m) => [m.a.external_id, m.a]))
      for (const row of (knownFull ?? []) as Record<string, unknown>[]) {
        const raw = (row.raw ?? {}) as Record<string, unknown>
        const patch: Record<string, unknown> = {}
        let watts = row.watts as number | null
        let wattsSource = row.watts_source as WattsSource | null
        let deviceCalories = row.kcal_device as number | null
        // A distância pela velocidade média do intervals.icu (rolo).
        const apiDistance = fromApi.get(row.external_id as string)?.distance_km ?? null
        if (row.distance_km == null && apiDistance != null) patch.distance_km = apiDistance
        if (row.distance_km == null && apiDistance == null && raw.fit !== 'lido' && raw.fit !== 'sem_dados' && canReadFit()) {
          fitReads++
          const ciq = await readCiq(key, row.external_id as string, fitTimeout)
          patch.raw = { ...raw, fit: ciq && hasCiq(ciq) ? 'lido' : ciq ? 'sem_dados' : 'erro', ...(ciq && hasCiq(ciq) ? { ciq } : {}) }
          if (ciq?.distance_km != null) patch.distance_km = ciq.distance_km
          if (watts == null && ciq?.power_w != null) {
            watts = ciq.power_w
            wattsSource = 'device'
            Object.assign(patch, { watts, watts_source: wattsSource })
          }
          if (deviceCalories == null && ciq?.calories != null) {
            deviceCalories = ciq.calories
            patch.kcal_device = deviceCalories
          }
        }
        // As kcal só se refazem nas que vieram do relógio (as registadas à mão
        // e depois juntadas ficam com as contas de quando foram guardadas).
        const kcal = exerciseKcal({
          type: 'bike',
          minutes: row.minutes as number | null,
          watts,
          wattsSource,
          deviceCalories,
        })
        if (row.source === 'intervals' && (kcal.kcal !== Number(row.kcal_est ?? 0) || kcal.rule !== row.kcal_rule)) {
          Object.assign(patch, { kcal_est: kcal.kcal, kcal_rule: kcal.rule, kcal_estimated: kcal.estimated })
        }
        if (Object.keys(patch).length === 0) continue
        const { error } = await admin.from('workouts').update(patch).eq('id', row.id as string)
        if (error) console.error('workouts (atualizar):', error.message)
        else {
          result.updated++
          touch(row.date as string)
        }
      }
    }

    const dates = [...new Set(fresh.map((m) => m.date))]
    const { data: sameDayRows } = dates.length
      ? await admin
          .from('workouts_active')
          .select('*')
          .eq('user_id', userId)
          .in('date', dates)
          .neq('source', 'intervals')
      : { data: [] }
    const candidates = (sameDayRows ?? []) as SameDayRow[]
    const used = new Set<string>()
    const inserts: Record<string, unknown>[] = []

    for (const { a, startedAt, date } of fresh) {
      const extras = {
        moving_s: a.moving_s,
        elapsed_s: a.elapsed_s,
        distance_km: a.distance_km,
        np_w: a.np_w,
        max_w: a.max_w,
        max_cadence: a.max_cadence,
        training_load: a.training_load,
        name: a.name,
      }
      const match = syncMatch(
        { type: a.type, date, minutes: a.minutes, started_at: startedAt },
        candidates.filter((c) => !used.has(c.id)),
      )
      if (match) {
        used.add(match.id)
        const { patch, filled } = mergePatch(match, {
          ...extras,
          avg_hr: a.avg_hr,
          max_hr: a.max_hr,
          cadence: a.cadence,
          kcal_device: a.kcal_device,
          sport: a.sport_raw,
          started_at: startedAt,
          watts: a.watts,
          watts_source: a.watts_source,
        })
        if (patch.watts != null) {
          const kcal = exerciseKcal({
            type: a.type,
            minutes: match.minutes ?? a.minutes,
            watts: patch.watts as number,
            wattsSource: patch.watts_source as WattsSource,
            deviceCalories: null,
          })
          Object.assign(patch, { kcal_est: kcal.kcal, kcal_rule: kcal.rule, kcal_estimated: kcal.estimated })
        }
        await admin
          .from('workouts')
          .update({
            ...patch,
            external_id: a.external_id,
            merged_from: [
              ...(((match.merged_from as unknown[]) ?? []) as unknown[]),
              { intervals_id: a.external_id, at: new Date().toISOString(), filled },
            ],
          })
          .eq('id', match.id)
        result.merged++
        touch(date)
        continue
      }

      const kcal = exerciseKcal({
        type: a.type,
        minutes: a.minutes,
        watts: a.watts,
        wattsSource: a.watts_source,
        deviceCalories: a.type === 'strength' ? null : a.kcal_device,
        sport: a.sport,
        weightKg: null,
      })
      inserts.push({
        user_id: userId,
        date,
        started_at: startedAt,
        source: 'intervals',
        external_id: a.external_id,
        type: a.type,
        sport: a.type === 'other' ? a.sport : a.sport_raw,
        minutes: a.minutes,
        watts: a.watts,
        watts_source: a.watts_source,
        avg_hr: a.avg_hr,
        max_hr: a.max_hr,
        cadence: a.cadence,
        kcal_device: a.kcal_device,
        kcal_est: kcal.kcal,
        kcal_rule: kcal.rule,
        kcal_estimated: kcal.estimated,
        raw: a.type === 'other' ? { sport: a.sport } : a.type === 'bike' && fitByActivity.has(a.external_id) ? fitRaw(a.external_id) : null,
        ...extras,
      })
    }

    if (inserts.length > 0) {
      const { error } = await admin.from('workouts').insert(inserts)
      if (!error) {
        result.inserted += inserts.length
        for (const row of inserts) touch(row.date as string)
      } else if (error.code === '23505') {
        // Outra sincronização ao mesmo tempo já inseriu alguns: um a um.
        for (const row of inserts) {
          const { error: one } = await admin.from('workouts').insert(row)
          if (one && one.code !== '23505') throw new Error(one.message)
          if (!one) {
            result.inserted++
            touch(row.date as string)
          }
        }
      } else {
        throw new Error(error.message)
      }
    }
  }

  // --- Bem-estar --------------------------------------------------------
  const days = wellness.map((w) => mapWellness(w)).filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date))
  if (days.length > 0) {
    const first = days.reduce((min, m) => (m.date < min ? m.date : min), days[0]!.date)
    const last = days.reduce((max, m) => (m.date > max ? m.date : max), days[0]!.date)
    const [{ data: weightRows }, { data: healthRows }] = await Promise.all([
      admin.from('weights').select('date').eq('user_id', userId).gte('date', first).lte('date', last),
      admin.from('health_daily').select('*').eq('user_id', userId).gte('date', first).lte('date', last),
    ])

    result.weightDays = days.filter((m) => m.weightKg != null).length
    // Peso: só em dias sem pesagem do João (nunca substitui).
    const weighed = new Set((weightRows ?? []).map((r) => r.date as string))
    const newWeights = days
      .filter((m) => m.weightKg != null && !weighed.has(m.date))
      .map((m) => ({
        user_id: userId,
        date: m.date,
        kg: m.weightKg,
        source: 'intervals',
        ...(m.bodyFatPct != null ? { body_fat_pct: m.bodyFatPct } : {}),
      }))
    if (newWeights.length > 0) {
      const { error } = await admin
        .from('weights')
        .upsert(newWeights, { onConflict: 'user_id,date', ignoreDuplicates: true })
      if (error) console.error('weights:', error.message)
      else {
        result.weights += newWeights.length
        for (const w of newWeights) touch(w.date)
      }
    }

    // Sono, FC em repouso e passos (regras em mergeDailyHealth: os passos
    // ficam com o maior, o Atalho manda nas horas e na FC que preencheu); a
    // pontuação, a qualidade, o HRV e a FC do sono só vêm do relógio (o valor
    // mais recente manda).
    const byDate = new Map((healthRows ?? []).map((r) => [r.date as string, r as Record<string, unknown>]))
    const rows: { base: Record<string, unknown>; extras: Record<string, unknown>; night: boolean }[] = []
    for (const m of days) {
      const sleepExtras = {
        sleep_score: m.sleepScore,
        sleep_quality: m.sleepQuality,
        hrv: m.hrv,
        avg_sleep_hr: m.avgSleepHr,
      }
      const hasExtras = Object.values(sleepExtras).some((v) => v != null)
      if (m.restingHr == null && m.sleepMinutes == null && m.steps == null && !hasExtras) continue
      const health = byDate.get(m.date) ?? null
      rows.push({
        base: {
          user_id: userId,
          date: m.date,
          ...mergeDailyHealth(health as Partial<DailyHealth> | null, m),
        },
        extras: Object.fromEntries(Object.entries(sleepExtras).map(([k, v]) => [k, v ?? health?.[k] ?? null])),
        night: m.sleepMinutes != null || m.sleepScore != null || m.sleepQuality != null,
      })
    }
    if (rows.length > 0) {
      let { error } = await admin
        .from('health_daily')
        .upsert(rows.map((r) => ({ ...r.base, ...r.extras })), { onConflict: 'user_id,date' })
      // Antes da migração 9 as colunas do sono não existem: grava o resto.
      if (error && /sleep_score|sleep_quality|hrv|avg_sleep_hr|column/i.test(error.message)) {
        ;({ error } = await admin.from('health_daily').upsert(rows.map((r) => r.base), { onConflict: 'user_id,date' }))
      }
      if (error) console.error('health_daily:', error.message)
      else result.nights += rows.filter((r) => r.night).length
    }
  }

  const now = new Date().toISOString()
  await admin
    .from('integrations')
    .update({ last_sync_at: now, last_error: null })
    .eq('user_id', userId)
    .eq('provider', 'intervals')
  await setStatus(admin, userId, {
    connected: true,
    last_sync_at: now,
    last_error: null,
    wellness_error: wellnessRead.error,
  })
  return result
}

// Para a cron e para a ação: lê a chave e sincroniza; um erro fica no estado.
export async function syncUser(
  admin: SupabaseClient,
  userId: string,
  options: SyncWindow,
): Promise<SyncResult | null> {
  const { data: integration } = await admin
    .from('integrations')
    .select('api_key')
    .eq('user_id', userId)
    .eq('provider', 'intervals')
    .maybeSingle()
  if (!integration?.api_key) return null
  try {
    return await syncIntervals(admin, userId, integration.api_key as string, options)
  } catch (err) {
    const message = err instanceof IntervalsError ? err.message : 'A sincronização falhou. Tenta outra vez mais tarde.'
    console.error('intervals.icu:', err)
    await admin.from('integrations').update({ last_error: message }).eq('user_id', userId).eq('provider', 'intervals')
    await setStatus(admin, userId, { connected: true, last_error: message })
    throw err
  }
}
