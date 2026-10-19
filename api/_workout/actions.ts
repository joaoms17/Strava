import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { painStatus } from '../_lib/rules/semaforo.js'
import { estimatedStart, exerciseKcal, mergePatch, startGuessed, type WattsSource } from '../_lib/rules/treino.js'
import { OTHER_SPORTS, isOtherSport, type OtherSport, type WorkoutType } from '../_lib/rules/targets.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import { strengthContext, weightNear } from '../_lib/kcal-context.js'
import { claimAndParse, type ImportRow } from '../_lib/workout-shot.js'

// Treino (Fase 3): guardar em poucos toques (favorito, «Já fiz», rascunho de
// um print), juntar um print a uma sessão já registada sem duplicar, editar,
// apagar com Anular e ler os prints em segundo plano.

const TYPE = z.enum(['bike', 'strength', 'other'])
const SPORT = z.enum(OTHER_SPORTS)
const WATTS_SOURCE = z.enum(['device', 'console', 'manual', 'favorite', 'prefill'])
const int = (min: number, max: number) => z.number().int().min(min).max(max)

const SaveSchema = z.object({
  client_id: z.string().uuid(),
  type: TYPE,
  sport: SPORT.nullable().optional(),
  minutes: int(1, 600),
  started_at: z.string().nullable().optional(),
  // A hora foi suposta pelo telemóvel (as 18:00 de um dia passado).
  started_at_estimated: z.boolean().optional(),
  // «Não, é outro»: havia um parecido nesse dia e a pessoa disse que não é o mesmo.
  not_duplicate: z.boolean().optional(),
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
  // Nome da sessão quando não é um dos teus treinos (ex.: «Dizer o treino»).
  name: z.string().trim().max(80).nullable().optional(),
})

const UpdateSchema = z.object({
  workout_id: z.string().uuid(),
  type: TYPE.optional(),
  sport: SPORT.nullable().optional(),
  minutes: int(1, 600).optional(),
  started_at: z.string().optional(),
  started_at_estimated: z.boolean().optional(),
  watts: int(20, 700).nullable().optional(),
  avg_hr: int(35, 220).nullable().optional(),
  max_hr: int(35, 230).nullable().optional(),
  cadence: int(20, 200).nullable().optional(),
  pain_during: int(0, 10).nullable().optional(),
  pain_next_day: int(0, 10).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  // «Que treino foi?»: liga a sessão (do relógio, por exemplo) a um dos
  // teus treinos; o nome passa a ser o desse treino.
  favorite_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().max(80).nullable().optional(),
})

const ShotSchema = z.object({
  client_id: z.string().uuid(),
  source_paths: z.array(z.string().min(3)).min(1).max(4),
  thumb_paths: z.array(z.string().min(3)).max(4).default([]),
  image_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(4).default([]),
})

const StrengthSchema = z.object({
  client_id: z.string().uuid(),
  workout_id: z.string().uuid().nullable().optional(), // editar uma sessão antiga
  started_at: z.string().nullable().optional(),
  started_at_estimated: z.boolean().optional(),
  minutes: int(1, 600),
  sets: z
    .array(
      z.object({
        exercise: z.string().trim().min(1).max(80),
        set_index: int(1, 20),
        // Nos exercícios de tempo («Prancha (segundos)») são os segundos.
        reps: int(0, 600).nullable(),
        load_kg: z.number().min(0).max(300).nullable(),
        rpe: z.number().min(1).max(10).nullable(),
      }),
    )
    .max(120),
  pain_during: int(0, 10).nullable().optional(),
  favorite_id: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  name: z.string().trim().max(80).nullable().optional(),
  // As calorias do relógio ditas («Dizer ou escrever»): contam por inteiro.
  kcal_device: int(0, 5000).nullable().optional(),
})

const ShotAddSchema = z.object({
  import_id: z.string().uuid(),
  source_paths: z.array(z.string().min(3)).min(1).max(4),
  thumb_paths: z.array(z.string().min(3)).max(4).default([]),
  image_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(4).default([]),
  edited_fields: z.array(z.string().max(40)).max(30).default([]),
})

const MAX_SHOTS = 4

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

// O primeiro campo que falhou, numa frase que se perceba (antes era sempre
// «Pedido inválido.» e uma sessão de ginásio inteira não gravava sem se saber
// porquê).
const FIELD_ERROR: Record<string, string> = {
  minutes: 'A duração tem de ser entre 1 e 600 min.',
  reps: 'As repetições (ou os segundos) têm de ser até 600 por série.',
  load_kg: 'A carga tem de ser até 300 kg.',
  set_index: 'São no máximo 20 séries por exercício.',
  sets: 'São no máximo 120 séries por sessão.',
  watts: 'A potência tem de ser entre 20 e 700 W.',
  avg_hr: 'Os batimentos médios têm de ser entre 35 e 220.',
  max_hr: 'Os batimentos máximos têm de ser entre 35 e 230.',
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    const path = result.error.issues[0]?.path ?? []
    const field = [...path].reverse().find((p): p is string => typeof p === 'string' && p in FIELD_ERROR)
    throw new HttpError(400, field ? FIELD_ERROR[field]! : 'Pedido inválido.')
  }
  return result.data
}

// raw do treino com ou sem a marca «hora suposta».
function withGuess(raw: unknown, guessed: boolean): Record<string, unknown> | null {
  const { hora_estimada: _, ...rest } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const next = guessed ? { ...rest, hora_estimada: true } : rest
  return Object.keys(next).length ? next : null
}

async function cutoffHour(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
  return data?.nutrition_day_cutoff_hour ?? 4
}

// As calorias do relógio guardadas num treino (as do Strava antigo ficam em raw).
function storedDeviceKcal(w: Record<string, unknown>): number | null {
  if (w.kcal_device != null) return Number(w.kcal_device)
  const calories = (w.raw as { calories?: unknown } | null)?.calories
  return typeof calories === 'number' ? calories : null
}

// O que um ginásio sem calorias do relógio precisa (o ritmo da pessoa ou o
// peso); com elas, nada.
async function strengthNeeds(
  db: SupabaseClient,
  cutoff: number,
  date: string,
  deviceCalories: number | null,
): Promise<{ gymPace: number | null; weightKg: number | null }> {
  if (deviceCalories != null && deviceCalories > 0) return { gymPace: null, weightKg: null }
  return strengthContext(db, nutritionalDay(new Date(), cutoff), date)
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
  // Sem hora (ou com a das 18:00 de um dia passado), a hora é suposta: a
  // sincronização compara-a só pelo dia e pela duração.
  const guessed = !input.started_at || input.started_at_estimated === true
  const date = nutritionalDay(startedAt, cutoff)
  const type = input.type as WorkoutType

  // Favorito: os valores dele, a não ser que o João os tenha mudado.
  let favoriteWatts: number | null = null
  let favoriteName: string | null = null
  if (input.favorite_id) {
    const { data: favorite } = await db
      .from('favorites')
      .select('id,name,workout,use_count')
      .eq('id', input.favorite_id)
      .eq('kind', 'workout')
      .maybeSingle()
    if (!favorite) throw new HttpError(404, 'Favorito não encontrado.')
    favoriteWatts = (favorite.workout as { watts?: number } | null)?.watts ?? null
    favoriteName = (favorite.name as string | null) ?? null
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
  // Ginásio sem calorias do relógio: o ritmo da pessoa (ou o peso). Junto a
  // uma sessão que já existe, as contas são as dela (abaixo).
  const gym =
    type === 'strength' && !input.merge_into
      ? await strengthNeeds(db, cutoff, date, input.kcal_device ?? null)
      : { gymPace: null, weightKg: null }
  const weightKg = type === 'other' && input.kcal_device == null ? await weightNear(db, date) : gym.weightKg
  const kcal = exerciseKcal({
    type,
    minutes: input.minutes,
    watts,
    wattsSource,
    deviceCalories: input.kcal_device ?? null,
    sport,
    weightKg,
    gymPace: gym.gymPace,
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
    // O teu treino («Pernas A») e a nota, se o que lá está não os tem.
    if (input.favorite_id && favoriteName && !target.favorite_id) {
      Object.assign(patch, { favorite_id: input.favorite_id, name: favoriteName })
    }
    if (input.note?.trim() && !target.note) patch.note = input.note.trim()
    // Uma hora a sério (print) substitui uma suposta.
    if (startGuessed(target) && !guessed) {
      Object.assign(patch, { started_at: startedAt.toISOString(), raw: withGuess(target.raw, false) })
    }
    // As calorias do print (o que o Garmin mostra) mandam sobre as que o
    // intervals.icu calculou.
    if (target.source === 'intervals' && input.kcal_device != null && input.kcal_device !== target.kcal_device) {
      patch.kcal_device = input.kcal_device
    }
    // Novas contas quando chegam watts, ou calorias numa bicicleta sem watts,
    // noutro desporto (as do «Já fiz» numa caminhada do relógio) ou no ginásio
    // (o print junto ao ginásio dito ou com séries: contam as do relógio).
    const wattsNow = (patch.watts ?? target.watts) as number | null
    const newDeviceKcal =
      patch.kcal_device != null &&
      ((target.type === 'bike' && wattsNow == null) ||
        target.type === 'other' ||
        (target.type === 'strength' && Number(patch.kcal_device) > 0))
    if (patch.watts != null || newDeviceKcal) {
      const targetSport = (target.sport ?? (target.raw as { sport?: unknown } | null)?.sport) as string | null | undefined
      const again = exerciseKcal({
        type: target.type as WorkoutType,
        minutes: (target.minutes as number | null) ?? input.minutes,
        watts: target.type === 'bike' ? wattsNow : null,
        wattsSource: (patch.watts_source ?? target.watts_source) as WattsSource,
        deviceCalories: (patch.kcal_device ?? target.kcal_device) as number | null,
        sport: target.type === 'other' && isOtherSport(targetSport) ? targetSport : null,
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
      // O nome do teu treino («Pernas A»), ou o do print.
      ...(favoriteName ? { name: favoriteName } : input.name ? { name: input.name } : {}),
      source_paths: importRow?.source_paths ?? [],
      image_hashes: importRow?.image_hashes ?? [],
      note: input.note?.trim() || null,
      raw: withGuess({ ...(sport ? { sport } : {}), ...(input.not_duplicate ? { outro_treino: true } : {}) }, guessed),
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
  res.status(200).json({ workout })
})

// Sessão de ginásio livre (Fase 5): cria (ou, com workout_id, edita) o
// treino e grava as séries em exercise_log. As kcal são as calorias do
// relógio, quando as há, ou os minutos ao ritmo da pessoa (ou pelo peso).
export const strength = post(async ({ db, userId, body, res }) => {
  const input = parse(StrengthSchema, body)
  const cutoff = await cutoffHour(db)
  const kcalFor = async (date: string, deviceCalories: number | null) =>
    exerciseKcal({
      type: 'strength',
      minutes: input.minutes,
      watts: null,
      wattsSource: null,
      deviceCalories,
      ...(await strengthNeeds(db, cutoff, date, deviceCalories)),
    })
  const rows = (workoutId: string) =>
    input.sets.map((s) => ({
      user_id: userId,
      workout_id: workoutId,
      exercise: s.exercise,
      set_index: s.set_index,
      reps: s.reps,
      load_kg: s.load_kg,
      rpe: s.rpe,
    }))

  // O teu treino («Pernas A»): dá o nome à sessão.
  const favorite = input.favorite_id
    ? ((await db.from('favorites').select('id,name,use_count').eq('id', input.favorite_id).maybeSingle()).data as {
        id: string
        name: string
        use_count: number | null
      } | null)
    : null

  if (input.workout_id) {
    const target = await ownWorkout(db, input.workout_id)
    const patch: Record<string, unknown> = { minutes: input.minutes }
    if (input.kcal_device != null) patch.kcal_device = input.kcal_device
    // Só a duração ou as calorias do relógio mudam as contas: corrigir as
    // séries de uma sessão antiga não reescreve as kcal dela (decisão 64).
    if (input.minutes !== target.minutes || (input.kcal_device != null && input.kcal_device !== target.kcal_device)) {
      const kcal = await kcalFor(target.date as string, input.kcal_device ?? storedDeviceKcal(target))
      Object.assign(patch, { kcal_est: kcal.kcal, kcal_rule: kcal.rule, kcal_estimated: kcal.estimated })
    }
    if (favorite) Object.assign(patch, { favorite_id: favorite.id, name: favorite.name })
    if (input.pain_during !== undefined) {
      patch.pain_during = input.pain_during
      patch.status = painStatus(input.pain_during, (target.pain_next_day as number | null) ?? null)
    }
    if (input.note !== undefined) patch.note = input.note?.trim() || null
    const { data, error } = await db.from('workouts').update(patch).eq('id', target.id).select().single()
    if (error) throw new HttpError(500, error.message)
    await db.from('exercise_log').delete().eq('workout_id', target.id)
    if (input.sets.length) {
      const { error: logError } = await db.from('exercise_log').insert(rows(target.id))
      if (logError) throw new HttpError(500, logError.message)
    }
    res.status(200).json({ workout: data })
    return
  }

  const { data: again } = await db.from('workouts').select('*').eq('client_id', input.client_id).maybeSingle()
  if (again) {
    res.status(200).json({ workout: again })
    return
  }
  const now = new Date()
  const startedAt = instantOrNow(input.started_at, new Date(estimatedStart(now, input.minutes)))
  const guessed = !input.started_at || input.started_at_estimated === true
  const date = nutritionalDay(startedAt, cutoff)
  const kcal = await kcalFor(date, input.kcal_device ?? null)
  if (favorite) {
    await db
      .from('favorites')
      .update({ use_count: (favorite.use_count ?? 0) + 1, last_used_at: now.toISOString() })
      .eq('id', favorite.id)
  }
  const { data: workout, error } = await db
    .from('workouts')
    .insert({
      user_id: userId,
      client_id: input.client_id,
      date,
      started_at: startedAt.toISOString(),
      source: 'manual',
      type: 'strength',
      minutes: input.minutes,
      kcal_device: input.kcal_device ?? null,
      kcal_est: kcal.kcal,
      kcal_rule: kcal.rule,
      kcal_estimated: kcal.estimated,
      pain_during: input.pain_during ?? null,
      status: painStatus(input.pain_during ?? null, null),
      favorite_id: favorite?.id ?? null,
      ...(favorite ? { name: favorite.name } : input.name ? { name: input.name } : {}),
      note: input.note?.trim() || null,
      raw: withGuess(null, guessed),
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      const { data: dup } = await db.from('workouts').select('*').eq('client_id', input.client_id).maybeSingle()
      if (dup) {
        res.status(200).json({ workout: dup })
        return
      }
    }
    throw new HttpError(500, error.message)
  }
  if (input.sets.length) {
    const { error: logError } = await db.from('exercise_log').insert(rows(workout.id as string))
    if (logError) {
      // Sem séries a sessão não serve: desfaz o treino.
      await db.from('workouts').delete().eq('id', workout.id)
      throw new HttpError(500, logError.message)
    }
  }
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
  if (input.favorite_id !== undefined) {
    if (input.favorite_id) {
      const { data: fav } = await db
        .from('favorites')
        .select('id,name,kind,use_count')
        .eq('id', input.favorite_id)
        .maybeSingle()
      if (!fav || fav.kind !== 'workout') throw new HttpError(404, 'Treino não encontrado.')
      patch.favorite_id = fav.id
      patch.name = input.name ?? fav.name
      await db
        .from('favorites')
        .update({ use_count: Number(fav.use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq('id', fav.id)
    } else {
      patch.favorite_id = null
    }
  }
  if (input.name !== undefined && patch.name === undefined) patch.name = input.name || null
  if (input.watts !== undefined) {
    patch.watts = input.watts
    patch.watts_source = input.watts == null ? null : 'manual'
  }
  let raw = (workout.raw ?? null) as Record<string, unknown> | null
  if (input.started_at) {
    const startedAt = instantOrNow(input.started_at, new Date())
    patch.started_at = startedAt.toISOString()
    patch.date = nutritionalDay(startedAt, await cutoffHour(db))
    raw = withGuess(raw, input.started_at_estimated === true)
  }
  const type = (patch.type ?? workout.type) as WorkoutType
  const sport = (type === 'other' ? (input.sport ?? (workout.raw as { sport?: OtherSport } | null)?.sport ?? 'outro') : null) as
    | OtherSport
    | null
  if (type === 'other' && (input.sport !== undefined || patch.type !== undefined)) raw = { ...(raw ?? {}), sport }
  if (raw !== workout.raw) patch.raw = raw
  // Mudar o tipo (ex.: a elíptica que entrou como bicicleta): o desporto
  // mostrado acompanha.
  if (type === 'other' && (input.sport !== undefined || patch.type !== undefined)) patch.sport = sport
  else if (patch.type !== undefined && patch.type !== workout.type && workout.type === 'other') patch.sport = null

  // Mudar o que entra nas contas (o tipo, a duração, os watts, o desporto)
  // recalcula as kcal deste treino, com as calorias do relógio guardadas.
  // Corrigir só os batimentos ou a hora não mexe nelas (decisão 64).
  const storedSport = (workout.raw as { sport?: OtherSport } | null)?.sport ?? (workout.sport as string | null) ?? 'outro'
  const changed =
    (input.type !== undefined && input.type !== workout.type) ||
    (input.minutes !== undefined && input.minutes !== workout.minutes) ||
    (input.watts !== undefined && input.watts !== workout.watts) ||
    (input.sport !== undefined && type === 'other' && input.sport !== storedSport)
  if (changed) {
    const date = (patch.date ?? workout.date) as string
    const deviceCalories = storedDeviceKcal(workout)
    const gym =
      type === 'strength'
        ? await strengthNeeds(db, await cutoffHour(db), date, deviceCalories)
        : { gymPace: null, weightKg: null }
    const kcal = exerciseKcal({
      type,
      minutes: (patch.minutes ?? workout.minutes) as number | null,
      watts: type === 'bike' ? ((patch.watts !== undefined ? patch.watts : workout.watts) as number | null) : null,
      wattsSource: ((patch.watts_source !== undefined ? patch.watts_source : workout.watts_source) as WattsSource | null) ?? null,
      deviceCalories,
      sport,
      weightKg: type === 'other' && deviceCalories == null ? await weightNear(db, date) : gym.weightKg,
      gymPace: gym.gymPace,
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

// «Juntar outro print» a um rascunho: as imagens novas juntam-se às que lá
// estão e o rascunho volta a ser lido com os valores atuais e os campos que
// o João já corrigiu (que nunca são reescritos).
export const shotAdd = post(async ({ db, userId, body, res }) => {
  const input = parse(ShotAddSchema, body)
  const row = await ownImport(db, input.import_id)
  if (row.status === 'guardado' || row.status === 'descartado') throw new HttpError(409, 'Este print já foi tratado.')
  const prefix = `${userId}/${row.client_id}/`
  if ([...input.source_paths, ...input.thumb_paths].some((p) => !p.startsWith(prefix) || p.includes('..'))) {
    throw new HttpError(403, 'Imagem inválida.')
  }
  const added = input.source_paths.filter((p) => !row.source_paths.includes(p))
  if (row.source_paths.length + added.length > MAX_SHOTS) {
    throw new HttpError(422, `Cada treino leva no máximo ${MAX_SHOTS} prints.`)
  }
  const admin = adminClient()
  if (await aiLimitReached(admin, userId, true)) {
    throw new HttpError(429, 'Chegaste ao limite da IA que definiste. Preenche à mão ou sobe o limite.')
  }
  const { data, error } = await db
    .from('workout_imports')
    .update({
      source_paths: [...row.source_paths, ...added],
      thumb_paths: [...row.thumb_paths, ...input.thumb_paths.filter((p) => !row.thumb_paths.includes(p))],
      image_hashes: [...row.image_hashes, ...input.image_hashes.filter((h) => !row.image_hashes.includes(h))],
      edited_fields: [...new Set([...(row.edited_fields ?? []), ...input.edited_fields])],
      status: 'a_ler',
      analysis_attempts: 0,
      analysis_started_at: null,
      analysis_error: null,
    })
    .eq('id', row.id)
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  waitUntil(claimAndParse(admin, row.id).catch((err) => console.error('Print em segundo plano falhou:', err)))
  res.status(202).json({ import: data })
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
