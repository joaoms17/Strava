import type { SupabaseClient } from '@supabase/supabase-js'
import { nutritionalDay, shiftDate } from './rules/nutritional-day.js'
import { lisbonInstant } from './rules/momentos.js'
import { exerciseKcal, mergePatch, type WattsSource } from './rules/treino.js'
import {
  isEmptyStravaCopy,
  mapActivity,
  mapWellness,
  syncMatch,
  type IcuActivity,
  type IcuWellness,
} from './rules/intervals.js'
import type { WorkoutType } from './rules/targets.js'

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

// Valida a chave e devolve o atleta (id e nome), sem nunca a devolver.
export async function testKey(key: string): Promise<{ id: string | null; name: string | null }> {
  const athlete = await icuGet<{ id?: string | number; name?: string }>(key, '', 8000)
  return { id: athlete.id != null ? String(athlete.id) : null, name: athlete.name ?? null }
}

export interface SyncResult {
  inserted: number
  merged: number
  weights: number
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

// Sincroniza os últimos `days` dias: atividades (fusão silenciosa com uma
// sessão já registada ou treino novo) e bem-estar (peso só em dias sem
// pesagem do João; sono (horas, pontuação, HRV), FC em repouso e passos em
// health_daily).
export async function syncIntervals(
  admin: SupabaseClient,
  userId: string,
  key: string,
  options: { days: number; timeoutMs: number },
): Promise<SyncResult> {
  const { data: profile } = await admin
    .from('profile')
    .select('nutrition_day_cutoff_hour')
    .eq('user_id', userId)
    .maybeSingle()
  const cutoff = profile?.nutrition_day_cutoff_hour ?? 4
  const today = nutritionalDay(new Date(), cutoff)
  const oldest = shiftDate(today, -options.days)
  const newest = shiftDate(today, 1)
  const range = `oldest=${oldest}&newest=${newest}`
  const [activities, wellness] = await Promise.all([
    icuGet<IcuActivity[]>(key, `/activities?${range}`, options.timeoutMs),
    icuGet<IcuWellness[]>(key, `/wellness?${range}`, options.timeoutMs).catch(() => [] as IcuWellness[]),
  ])

  const result: SyncResult = { inserted: 0, merged: 0, weights: 0, oldestChanged: null }
  const touch = (date: string) => {
    if (!result.oldestChanged || date < result.oldestChanged) result.oldestChanged = date
  }

  for (const activity of activities ?? []) {
    if (isEmptyStravaCopy(activity)) continue
    const a = mapActivity(activity)
    const startedAt =
      a.started_at ?? (a.started_local ? lisbonInstant(a.started_local.slice(0, 10), a.started_local.slice(11, 16)).toISOString() : null)
    if (!startedAt || a.minutes == null) continue
    const date = nutritionalDay(new Date(startedAt), cutoff)

    // Já entrou (como treino próprio ou fundido numa sessão).
    const { data: known } = await admin
      .from('workouts')
      .select('id')
      .eq('user_id', userId)
      .eq('external_id', a.external_id)
      .limit(1)
    if (known?.length) continue

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

    const { data: sameDay } = await admin
      .from('workouts_active')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .eq('type', a.type)
      .neq('source', 'intervals')
    const match = syncMatch(
      { type: a.type, date, minutes: a.minutes, started_at: startedAt },
      ((sameDay ?? []) as { id: string; type: WorkoutType; date: string; minutes: number | null; started_at: string | null }[]),
    )
    if (match) {
      const target = match as unknown as Record<string, unknown> & { id: string; watts: number | null; watts_source: string | null }
      const { patch, filled } = mergePatch(target, {
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
          minutes: (target.minutes as number | null) ?? a.minutes,
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
            ...(((target.merged_from as unknown[]) ?? []) as unknown[]),
            { intervals_id: a.external_id, at: new Date().toISOString(), filled },
          ],
        })
        .eq('id', target.id)
      result.merged++
      touch(date)
      continue
    }

    const kcal = exerciseKcal({
      type: a.type,
      minutes: a.minutes,
      watts: a.watts,
      wattsSource: a.watts_source,
      deviceCalories: a.type === 'other' ? a.kcal_device : null,
      sport: a.sport,
      weightKg: null,
    })
    const { error } = await admin.from('workouts').insert({
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
      raw: a.type === 'other' ? { sport: a.sport } : null,
      ...extras,
    })
    // Duas sincronizações ao mesmo tempo: a outra já inseriu.
    if (error && error.code !== '23505') throw new Error(error.message)
    if (!error) {
      result.inserted++
      touch(date)
    }
  }

  for (const w of wellness ?? []) {
    const m = mapWellness(w)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) continue
    if (m.weightKg != null) {
      const { data: existing } = await admin
        .from('weights')
        .select('date')
        .eq('user_id', userId)
        .eq('date', m.date)
        .maybeSingle()
      // Uma pesagem do João nunca é substituída.
      if (!existing) {
        const { error } = await admin
          .from('weights')
          .insert({ user_id: userId, date: m.date, kg: m.weightKg, source: 'intervals' })
        if (!error) {
          result.weights++
          touch(m.date)
        }
      }
    }
    const sleepExtras = {
      sleep_score: m.sleepScore,
      sleep_quality: m.sleepQuality,
      hrv: m.hrv,
      avg_sleep_hr: m.avgSleepHr,
    }
    const hasSleepExtras = Object.values(sleepExtras).some((v) => v != null)
    if (m.restingHr != null || m.sleepMinutes != null || m.steps != null || hasSleepExtras) {
      const { data: health } = await admin
        .from('health_daily')
        .select('*')
        .eq('user_id', userId)
        .eq('date', m.date)
        .maybeSingle()
      const row = {
        user_id: userId,
        date: m.date,
        // O Atalho do iPhone, quando existe, manda nos campos que já preencheu.
        steps: health?.steps ?? m.steps,
        sleep_minutes: health?.sleep_minutes ?? m.sleepMinutes,
        resting_hr: health?.resting_hr ?? m.restingHr,
        ...(health ? {} : { source: 'intervals' }),
      }
      // A pontuação, a qualidade, o HRV e a FC do sono só vêm do relógio: o
      // valor mais recente do intervals.icu manda (a Garmin revê a noite).
      const extras = Object.fromEntries(
        Object.entries(sleepExtras).map(([k, v]) => [k, v ?? (health as Record<string, unknown> | null)?.[k] ?? null]),
      )
      const { error } = await admin.from('health_daily').upsert({ ...row, ...extras }, { onConflict: 'user_id,date' })
      // Antes da migração 9 as colunas do sono não existem: grava o resto.
      if (error && /sleep_score|sleep_quality|hrv|avg_sleep_hr|column/i.test(error.message)) {
        await admin.from('health_daily').upsert(row, { onConflict: 'user_id,date' })
      }
    }
  }

  const now = new Date().toISOString()
  await admin
    .from('integrations')
    .update({ last_sync_at: now, last_error: null })
    .eq('user_id', userId)
    .eq('provider', 'intervals')
  await setStatus(admin, userId, { connected: true, last_sync_at: now, last_error: null })
  return result
}

// Para a cron e para a ação: lê a chave e sincroniza; um erro fica no estado.
export async function syncUser(
  admin: SupabaseClient,
  userId: string,
  options: { days: number; timeoutMs: number },
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
