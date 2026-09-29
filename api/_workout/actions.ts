import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { painStatus } from '../_lib/rules/semaforo.js'
import { estimatedStart, exerciseKcal, mergePatch, type WattsSource } from '../_lib/rules/treino.js'
import type { OtherSport, WorkoutType } from '../_lib/rules/targets.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import { claimAndParse, type ImportRow } from '../_lib/workout-shot.js'
import { pairWorkout } from '../_lib/pairing.js'

// Treino (Fase 3): guardar em poucos toques (favorito, «Já fiz», rascunho de
// um print), juntar um print a uma sessão já registada sem duplicar, editar,
// apagar com Anular e ler os prints em segundo plano.

const TYPE = z.enum(['bike', 'strength', 'other'])
const SPORT = z.enum(['caminhada', 'eliptica', 'natacao', 'outro'])
const WATTS_SOURCE = z.enum(['device', 'console', 'manual', 'favorite', 'prefill'])
const int = (min: number, max: number) => z.number().int().min(min).max(max)

const SaveSchema = z.object({
  client_id: z.string().uuid(),
  type: TYPE,
  sport: SPORT.nullable().optional(),
  minutes: int(1, 600),
  started_at: z.string().nullable().optional(),
  watts: int(20, 700).nullable().optional(),
  watts_source: WATTS_SOURCE.nullable().optional(),
  avg_hr: int(35, 220).nullable().optional(),
  max_hr: int(35, 230).nullable().optional(),
  cadence: int(20, 200).nullable().optional(),
  kcal_device: int(0, 5000).nullable().optional(),
  pain_during: int(0, 10).nullable().optional(),
  favorite_id: z.string().uuid().nullable().optional(),
  import_id: z.string().uuid().nullable().optional(),
  merge_into: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
})

const UpdateSchema = z.object({
  workout_id: z.string().uuid(),
  type: TYPE.optional(),
  sport: SPORT.nullable().optional(),
  minutes: int(1, 600).optional(),
  started_at: z.string().optional(),
  watts: int(20, 700).nullable().optional(),
  avg_hr: int(35, 220).nullable().optional(),
  max_hr: int(35, 230).nullable().optional(),
  cadence: int(20, 200).nullable().optional(),
  pain_during: int(0, 10).nullable().optional(),
  pain_next_day: int(0, 10).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
})

const ShotSchema = z.object({
  client_id: z.string().uuid(),
  source_paths: z.array(z.string().min(3)).min(1).max(4),
  thumb_paths: z.array(z.string().min(3)).max(4).default([]),
  image_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(4).default([]),
})

const WorkoutIdSchema = z.object({ workout_id: z.string().uuid() })
const ImportIdSchema = z.object({ import_id: z.string().uuid(), reset: z.boolean().optional() })

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

function post(
  run: (ctx: { db: SupabaseClient; userId: string; body: unknown; res: VercelResponse }) => Promise<void>,
): Handler {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
      const { user, db } = await requireUser(req)
      await run({ db, userId: user.id, body: req.body, res })
    } catch (err) {
      respondError(res, err)
    }
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new HttpError(400, 'Pedido inválido.')
  return result.data
}

async function cutoffHour(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
  return data?.nutrition_day_cutoff_hour ?? 4
}

// Peso médio dos 7 dias até esta data (para as kcal de um «Outro» sem relógio).
async function weightNear(db: SupabaseClient, date: string): Promise<number | null> {
  const { data: recent } = await db
    .from('weights')
    .select('kg')
    .gte('date', shiftDate(date, -6))
    .lte('date', date)
  if (recent?.length) return recent.reduce((acc, w) => acc + Number(w.kg), 0) / recent.length
  const { data: last } = await db.from('weights').select('kg').lte('date', date).order('date', { ascending: false }).limit(1)
  return last?.[0] ? Number(last[0].kg) : null
}

// Últimos watts confirmados (não supostos) nos 30 dias antes desta data.
async function lastConfirmedWatts(db: SupabaseClient, date: string): Promise<number | null> {
  const { data } = await db
    .from('workouts_active')
    .select('watts')
    .eq('type', 'bike')
    .not('watts', 'is', null)
    // Em SQL, «<> 'prefill'» deixa de fora os nulos (treinos antigos).
    .or('watts_source.is.null,watts_source.neq.prefill')
    .gte('date', shiftDate(date, -30))
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(1)
  return data?.[0]?.watts ?? null
}

function instantOrNow(value: string | null | undefined, fallback: Date): Date {
  const ms = value ? Date.parse(value) : NaN
  // Um relógio adiantado nunca põe o treino no futuro.
  return Number.isFinite(ms) ? new Date(Math.min(ms, Date.now())) : fallback
}

async function ownWorkout(db: SupabaseClient, id: string): Promise<Record<string, unknown> & { id: string }> {
  const { data } = await db.from('workouts').select('*').eq('id', id).maybeSingle()
  if (!data) throw new HttpError(404, 'Treino não encontrado.')
  return data as Record<string, unknown> & { id: string }
}

async function ownImport(db: SupabaseClient, id: string): Promise<ImportRow> {
  const { data } = await db.from('workout_imports').select('*').eq('id', id).maybeSingle()
  if (!data) throw new HttpError(404, 'Print não encontrado.')
  return data as ImportRow
}

// O que o print traz além do essencial (só a partir do rascunho guardado
// no servidor, nunca do que o telemóvel manda).
function extrasFromImport(row: ImportRow): Record<string, unknown> {
  const a = row.parsed?.activity
  if (!a) return {}
  const round = (v: number | null | undefined) => (v == null ? null : Math.round(v))
  return {
    sport: a.sport,
    name: a.title ?? a.sport_label_raw,
    moving_s: round(a.moving_time_s),
    elapsed_s: round(a.total_time_s),
    distance_km: a.distance_km,
    np_w: round(a.np_w),
    max_w: round(a.max_power_w),
    max_cadence: round(a.max_cadence),
    training_load: a.training_load,
    aerobic_te: a.aerobic_te,
    anaerobic_te: a.anaerobic_te,
    rpe: round(a.rpe),
    hr_zones: a.hr_zones.length ? a.hr_zones : null,
    laps: a.laps.length ? a.laps : null,
  }
}

export const save = post(async ({ db, userId, body, res }) => {
  const input = parse(SaveSchema, body)

  // Repetição do mesmo envio: devolve o que já existe.
  const { data: existing } = await db.from('workouts').select('*').eq('client_id', input.client_id).maybeSingle()
  if (existing) {
    res.status(200).json({ workout: existing })
    return
  }

  const importRow = input.import_id ? await ownImport(db, input.import_id) : null
  if (importRow && importRow.status === 'guardado' && importRow.workout_id) {
    const { data: saved } = await db.from('workouts').select('*').eq('id', importRow.workout_id).maybeSingle()
    if (saved) {
      res.status(200).json({ workout: saved })
      return
    }
  }

  const now = new Date()
  const cutoff = await cutoffHour(db)
  const startedAt = instantOrNow(input.started_at, new Date(estimatedStart(now, input.minutes)))
  const date = nutritionalDay(startedAt, cutoff)
  const type = input.type as WorkoutType

  // Favorito: os valores dele, a não ser que o João os tenha mudado.
  let favoriteWatts: number | null = null
  if (input.favorite_id) {
    const { data: favorite } = await db
      .from('favorites')
      .select('id,workout,use_count')
      .eq('id', input.favorite_id)
      .eq('kind', 'workout')
      .maybeSingle()
    if (!favorite) throw new HttpError(404, 'Favorito não encontrado.')
    favoriteWatts = (favorite.workout as { watts?: number } | null)?.watts ?? null
    await db
      .from('favorites')
      .update({ use_count: (favorite.use_count ?? 0) + 1, last_used_at: now.toISOString() })
      .eq('id', favorite.id)
  }

  let watts: number | null = null
  let wattsSource: WattsSource | null = null
  if (type === 'bike') {
    if (input.watts != null) {
      watts = input.watts
      wattsSource = input.watts_source ?? (input.favorite_id && input.watts === favoriteWatts ? 'favorite' : 'manual')
    } else if (favoriteWatts != null) {
      watts = favoriteWatts
      wattsSource = 'favorite'
    } else {
      watts = await lastConfirmedWatts(db, date)
      wattsSource = watts != null ? 'prefill' : null
    }
  }

  const sport = (type === 'other' ? (input.sport ?? 'outro') : null) as OtherSport | null
  const weightKg = type === 'other' && input.kcal_device == null ? await weightNear(db, date) : null
  const kcal = exerciseKcal({
    type,
    minutes: input.minutes,
    watts,
    wattsSource,
    deviceCalories: input.kcal_device ?? null,
    sport,
    weightKg,
  })

  const fromShot = importRow?.parsed ? extrasFromImport(importRow) : {}
  const core = {
    avg_hr: input.avg_hr ?? null,
    max_hr: input.max_hr ?? null,
    cadence: input.cadence ?? null,
    kcal_device: input.kcal_device ?? null,
  }

  // Juntar a uma sessão que já existe: preenche o que falta, sem duplicar.
  if (input.merge_into) {
    const target = await ownWorkout(db, input.merge_into)
    if (target.deleted_at) throw new HttpError(409, 'Esse treino foi apagado.')
    const { patch, filled } = mergePatch(target as never, {
      ...fromShot,
      ...core,
      minutes: input.minutes,
      started_at: startedAt.toISOString(),
      watts: type === 'bike' ? watts : null,
      watts_source: wattsSource,
    })
    if (patch.watts != null) {
      const again = exerciseKcal({
        type: target.type as WorkoutType,
        minutes: (target.minutes as number | null) ?? input.minutes,
        watts: patch.watts as number,
        wattsSource: patch.watts_source as WattsSource,
        deviceCalories: null,
      })
      Object.assign(patch, { kcal_est: again.kcal, kcal_rule: again.rule, kcal_estimated: again.estimated })
    }
    if (importRow) {
      Object.assign(patch, {
        source_paths: [...((target.source_paths as string[]) ?? []), ...importRow.source_paths],
        image_hashes: [...((target.image_hashes as string[]) ?? []), ...importRow.image_hashes],
        merged_from: [
          ...(((target.merged_from as unknown[]) ?? []) as unknown[]),
          { import_id: importRow.id, at: now.toISOString(), filled },
        ],
      })
    }
    const { data: merged, error } = await db.from('workouts').update(patch).eq('id', target.id).select().single()
    if (error) throw new HttpError(500, error.message)
    if (importRow) {
      await db.from('workout_imports').update({ status: 'guardado', workout_id: target.id }).eq('id', importRow.id)
    }
    res.status(200).json({ workout: merged, merged: true, filled })
    return
  }

  const { data: workout, error } = await db
    .from('workouts')
    .insert({
      user_id: userId,
      client_id: input.client_id,
      date,
      started_at: startedAt.toISOString(),
      source: importRow ? 'screenshot' : 'manual',
      type,
      minutes: input.minutes,
      watts,
      watts_source: wattsSource,
      ...fromShot,
      ...core,
      sport: type === 'other' ? sport : ((fromShot.sport as string | undefined) ?? null),
      kcal_est: kcal.kcal,
      kcal_rule: kcal.rule,
      kcal_estimated: kcal.estimated,
      pain_during: input.pain_during ?? null,
      status: painStatus(input.pain_during ?? null, null),
      favorite_id: input.favorite_id ?? null,
      source_paths: importRow?.source_paths ?? [],
      image_hashes: importRow?.image_hashes ?? [],
      note: input.note?.trim() || null,
      raw: sport ? { sport } : null,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      const { data: again } = await db.from('workouts').select('*').eq('client_id', input.client_id).maybeSingle()
      if (again) {
        res.status(200).json({ workout: again })
        return
      }
    }
    throw new HttpError(500, error.message)
  }
  if (importRow) {
    await db.from('workout_imports').update({ status: 'guardado', workout_id: workout.id }).eq('id', importRow.id)
  }
  await pairWorkout(db, userId, workout)
  res.status(200).json({ workout })
})

export const update = post(async ({ db, body, res }) => {
  const input = parse(UpdateSchema, body)
  const workout = await ownWorkout(db, input.workout_id)
  const previous = { ...workout }
  const patch: Record<string, unknown> = {}
  for (const key of ['type', 'minutes', 'avg_hr', 'max_hr', 'cadence', 'pain_during', 'pain_next_day'] as const) {
    if (input[key] !== undefined) patch[key] = input[key]
  }
  if (input.note !== undefined) patch.note = input.note?.trim() || null
  if (input.watts !== undefined) {
    patch.watts = input.watts
    patch.watts_source = input.watts == null ? null : 'manual'
  }
  if (input.started_at) {
    const startedAt = instantOrNow(input.started_at, new Date())
    patch.started_at = startedAt.toISOString()
    patch.date = nutritionalDay(startedAt, await cutoffHour(db))
  }
  const type = (patch.type ?? workout.type) as WorkoutType
  const sport = (type === 'other' ? (input.sport ?? (workout.raw as { sport?: OtherSport } | null)?.sport ?? 'outro') : null) as
    | OtherSport
    | null
  if (input.sport !== undefined && type === 'other') patch.raw = { ...((workout.raw as object) ?? {}), sport }

  // Editar o que entra nas contas recalcula as kcal deste treino.
  if (['type', 'minutes', 'watts', 'sport'].some((k) => (input as Record<string, unknown>)[k] !== undefined)) {
    const date = (patch.date ?? workout.date) as string
    const deviceCalories =
      (workout.kcal_device as number | null) ??
      (typeof (workout.raw as { calories?: unknown } | null)?.calories === 'number'
        ? (workout.raw as { calories: number }).calories
        : null)
    const kcal = exerciseKcal({
      type,
      minutes: (patch.minutes ?? workout.minutes) as number | null,
      watts: type === 'bike' ? ((patch.watts !== undefined ? patch.watts : workout.watts) as number | null) : null,
      wattsSource: ((patch.watts_source !== undefined ? patch.watts_source : workout.watts_source) as WattsSource | null) ?? null,
      deviceCalories: type === 'other' ? deviceCalories : null,
      sport,
      weightKg: type === 'other' && deviceCalories == null ? await weightNear(db, date) : null,
    })
    Object.assign(patch, { kcal_est: kcal.kcal, kcal_rule: kcal.rule, kcal_estimated: kcal.estimated })
  }
  if (input.pain_during !== undefined || input.pain_next_day !== undefined) {
    patch.status = painStatus(
      (input.pain_during !== undefined ? input.pain_during : workout.pain_during) as number | null,
      (input.pain_next_day !== undefined ? input.pain_next_day : workout.pain_next_day) as number | null,
    )
  }
  if (Object.keys(patch).length === 0) {
    res.status(200).json({ workout, previous })
    return
  }
  const { data, error } = await db.from('workouts').update(patch).eq('id', workout.id).select().single()
  if (error) throw new HttpError(500, error.message)
  res.status(200).json({ workout: data, previous })
})

export const remove = post(async ({ db, body, res }) => {
  const { workout_id } = parse(WorkoutIdSchema, body)
  const { data, error } = await db
    .from('workouts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', workout_id)
    .select()
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(404, 'Treino não encontrado.')
  res.status(200).json({ workout: data })
})

export const restore = post(async ({ db, body, res }) => {
  const { workout_id } = parse(WorkoutIdSchema, body)
  const { data, error } = await db
    .from('workouts')
    .update({ deleted_at: null })
    .eq('id', workout_id)
    .select()
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(404, 'Treino não encontrado.')
  res.status(200).json({ workout: data })
})

// Print do relógio: o rascunho fica logo guardado e é lido em segundo plano.
export const shot = post(async ({ db, userId, body, res }) => {
  const input = parse(ShotSchema, body)
  const prefix = `${userId}/${input.client_id}/`
  if ([...input.source_paths, ...input.thumb_paths].some((p) => !p.startsWith(prefix) || p.includes('..'))) {
    throw new HttpError(403, 'Imagem inválida.')
  }
  const { data: again } = await db.from('workout_imports').select('*').eq('client_id', input.client_id).maybeSingle()
  if (again) {
    res.status(202).json({ import: again })
    return
  }
  // O mesmo print outra vez abre o treino que já existe, sem custo.
  if (input.image_hashes.length) {
    const { data: sameWorkout } = await db
      .from('workouts_active')
      .select('*')
      .overlaps('image_hashes', input.image_hashes)
      .limit(1)
    if (sameWorkout?.[0]) {
      res.status(200).json({ workout: sameWorkout[0], duplicate: true })
      return
    }
    const { data: sameImport } = await db
      .from('workout_imports')
      .select('*')
      .in('status', ['a_ler', 'por_confirmar'])
      .overlaps('image_hashes', input.image_hashes)
      .limit(1)
    if (sameImport?.[0]) {
      res.status(200).json({ import: sameImport[0], duplicate: true })
      return
    }
  }

  const admin = adminClient()
  const overLimit = await aiLimitReached(admin, userId, true)
  const { data: row, error } = await db
    .from('workout_imports')
    .insert({
      user_id: userId,
      client_id: input.client_id,
      source_paths: input.source_paths,
      thumb_paths: input.thumb_paths,
      image_hashes: input.image_hashes,
      status: overLimit ? 'erro' : 'a_ler',
      analysis_error: overLimit ? 'Chegaste ao limite da IA que definiste. Preenche à mão ou sobe o limite.' : null,
    })
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  if (row.status === 'a_ler') {
    waitUntil(claimAndParse(admin, row.id as string).catch((err) => console.error('Print em segundo plano falhou:', err)))
  }
  res.status(202).json({ import: row })
})

// «Tentar de novo» (ou o telemóvel a pedir outra vez um rascunho parado).
export const parseShot = post(async ({ db, userId, body, res }) => {
  const input = parse(ImportIdSchema, body)
  const row = await ownImport(db, input.import_id)
  if (row.status === 'guardado' || row.status === 'descartado') {
    res.status(200).json({ import: row })
    return
  }
  const admin = adminClient()
  if (await aiLimitReached(admin, userId, true)) {
    throw new HttpError(429, 'Chegaste ao limite da IA que definiste. Preenche à mão ou sobe o limite.')
  }
  const result = await claimAndParse(admin, row.id, input.reset === true || row.status === 'erro')
  res.status(200).json({ import: result ?? (await ownImport(db, row.id)) })
})

export const discard = post(async ({ db, body, res }) => {
  const input = parse(ImportIdSchema, body)
  const { data, error } = await db
    .from('workout_imports')
    .update({ status: 'descartado' })
    .eq('id', input.import_id)
    .in('status', ['a_ler', 'por_confirmar', 'erro'])
    .select()
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  res.status(200).json({ import: data })
})
