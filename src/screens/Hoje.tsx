import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { useReadyProfile, useProfile } from '../lib/profile'
import { useSheet } from '../lib/sheet'
import { useToast } from '../lib/toast'
import { emitDataChanged, useDataVersion } from '../lib/events'
import { signedUrls } from '../lib/photos'
import { loadActiveDiet } from '../lib/diets'
import DietToday from '../components/DietToday'
import { localCalendarDate, nutritionalDay, shiftDate } from '../lib/day'
import { fmt1, fmtDayShort, fmtInt, fmtKcal, timeOf, weekdayShort } from '../lib/format'
import { deleteMeal, logFavorite, retryAnalysis } from '../lib/meal-actions'
import { workoutTitle } from '../lib/workout-actions'
import { discardCapture, retryCapture, useCaptures } from '../lib/capture-queue'
import { recomputeFrom } from '../lib/recompute'
import { daysSinceMeasure } from '../../api/_lib/rules/composicao'
import { kcalOut, paceFromDiff, round10 } from '../../api/_lib/rules/gasto'
import { loadExpenditure, type ExpenditureContext } from '../lib/expenditure'
import { useAutoSync } from '../lib/intervals'
import { storedExerciseKcal } from '../../api/_lib/rules/targets'
import { isMaintenanceWeek, maintenanceTarget, mondayOf } from '../../api/_lib/rules/manutencao'
import { SLOT_LABEL, SLOT_TIME, lisbonClock, slotOf } from '../../api/_lib/rules/momentos'
import { analysisStalled, analysisStuck } from '../../api/_lib/rules/analise'
import { fmtSleep, hasSleep, poorNight, sleepDetail, type NightSleep } from '../../api/_lib/rules/sono'
import { splitStoredError } from '../../api/_lib/rules/resposta-ia'
import {
  dismissNudge,
  nextStep,
  type NextStepId,
  type NudgeState,
} from '../../api/_lib/rules/proximo-passo'
import type { DayRow, Diet, Favorite, Meal, Slot, WeightRow, Workout } from '../lib/types'
import Segments from '../components/ui/Segments'
import Icon from '../components/ui/Icon'
import BottomSheet from '../components/ui/BottomSheet'
import KneePicker from '../components/ui/KneePicker'
import PhotoButton from '../components/ui/PhotoButton'
import AttachPhotoButton from '../components/ui/AttachPhotoButton'
import { MAX_MEAL_PHOTOS } from '../lib/capture'
import WeekStrip from '../components/ui/WeekStrip'

interface DayData {
  meals: (Meal & { created_at: string })[]
  deleted: Meal[]
  workouts: Workout[]
  yesterdayWorkouts: Workout[]
  weights: WeightRow[]
  yesterday: { meals: number; flags: string[] }
  latestTdee: number | null
  favorites: Favorite[]
  diet: Diet | null
  photos: Record<string, string>
  weighedToday: boolean
  sleep: NightSleep | null
  lastNight: (NightSleep & { date: string }) | null
  importsToConfirm: string[]
  weightCount: number
  lastMeasureDate: string | null
  expenditure: ExpenditureContext | null
  hasAnyWeight: boolean
  hasAnyMeal: boolean
}

const WORKOUT_OF: Record<Workout['type'], string> = {
  bike: 'a bicicleta',
  strength: 'o ginásio',
  other: 'o treino',
}
const WORKOUT_AFTER: Record<Workout['type'], string> = {
  bike: 'da bicicleta',
  strength: 'do ginásio',
  other: 'do treino',
}
const WORKOUT_ICON = { bike: 'bike', strength: 'dumbbell', other: 'walk' } as const
const GAP_SLOTS: Slot[] = ['pequeno_almoco', 'almoco', 'jantar']

// A foto da refeição; registada de uma favorita sem foto (a foto foi junta
// depois), a da favorita.
function mealThumb(meal: Meal, favorites: Favorite[]): string | null {
  const own = meal.thumb_paths?.[0] ?? meal.photo_path
  if (own) return own
  return meal.favorite_id ? (favorites.find((f) => f.id === meal.favorite_id)?.photo_path ?? null) : null
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return h * 60 + m
}

// A noite deste dia e, se faltar, a última registada nos 3 dias antes.
function pickNights(date: string, rows: (Partial<NightSleep> & { date: string })[]) {
  const withSleep = rows.filter((r) => hasSleep(r)) as (NightSleep & { date: string })[]
  const tonight = withSleep.find((r) => r.date === date) ?? null
  return { sleep: tonight, lastNight: tonight ? null : (withSleep.find((r) => r.date < date) ?? null) }
}

export default function Hoje() {
  const profile = useReadyProfile()
  useAutoSync()
  const { update } = useProfile()
  const params = useParams<{ date?: string }>()
  const [, navigate] = useLocation()
  const sheet = useSheet()
  const toast = useToast()
  const version = useDataVersion()
  const now = new Date()
  const today = nutritionalDay(now, profile.nutrition_day_cutoff_hour)
  const date = params.date && params.date <= today ? params.date : today
  const isToday = date === today
  const [data, setData] = useState<DayData | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const captures = useCaptures()
  const retried = useRef(new Set<string>())
  // Refeições com «Tentar outra vez» em curso (mostram «A analisar…» já).
  const [retrying, setRetrying] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const [
      { data: meals },
      { data: deleted },
      { data: workouts },
      { data: yWorkouts },
      { data: weights },
      { data: yMeals },
      { data: yDay },
      { data: tdeeRows },
      { data: favorites },
      { data: todayWeights },
      { count: weightCount },
      { count: mealCount },
      { data: imports },
      { data: lastMeasure },
      { data: health },
      expenditure,
      diet,
    ] = await Promise.all([
      supabase.from('meals').select('*').eq('date', date).is('deleted_at', null).order('logged_at'),
      supabase
        .from('meals')
        .select('*')
        .eq('date', date)
        .not('deleted_at', 'is', null)
        .gte('deleted_at', weekAgo),
      supabase.from('workouts_active').select('*').eq('date', date).order('created_at'),
      supabase.from('workouts_active').select('*').eq('date', shiftDate(date, -1)),
      supabase.from('weights').select('date,kg,measured_at,created_at').eq('date', date),
      supabase.from('meals_counted').select('id').eq('date', shiftDate(date, -1)),
      supabase.from('days').select('flags').eq('date', shiftDate(date, -1)).maybeSingle(),
      supabase
        .from('days')
        .select('tdee_est')
        .lt('date', date)
        .not('tdee_est', 'is', null)
        .order('date', { ascending: false })
        .limit(1),
      supabase.from('favorites').select('*').eq('kind', 'meal').eq('archived', false),
      supabase.from('weights').select('date').eq('date', localCalendarDate()),
      supabase.from('weights').select('date', { count: 'exact', head: true }),
      supabase.from('meals_counted').select('id', { count: 'exact', head: true }),
      // Prints lidos à espera de «Guardar» (a tabela só existe com a migração 4).
      supabase
        .from('workout_imports')
        .select('id')
        .eq('status', 'por_confirmar')
        .gte('created_at', weekAgo)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('body_measurements').select('date').order('date', { ascending: false }).limit(1),
      // O sono da noite que acabou neste dia (Garmin via intervals.icu) e das
      // três noites antes, para dizer qual foi a última quando esta falta.
      supabase
        .from('health_daily')
        .select('*')
        .lte('date', date)
        .gte('date', shiftDate(date, -3))
        .order('date', { ascending: false }),
      loadExpenditure(profile, mondayOf(date)).catch(() => null),
      // A dieta que segue (migração 10; sem ela fica null).
      loadActiveDiet(),
    ])
    const mealRows = (meals ?? []) as (Meal & { created_at: string })[]
    const favoriteRows = (favorites ?? []) as Favorite[]
    const photos = await signedUrls(
      mealRows.map((m) => mealThumb(m, favoriteRows)).filter((p): p is string => !!p),
    )
    setData({
      meals: mealRows,
      deleted: (deleted ?? []) as Meal[],
      workouts: (workouts ?? []) as Workout[],
      yesterdayWorkouts: (yWorkouts ?? []) as Workout[],
      weights: ((weights ?? []) as WeightRow[]).map((w) => ({ ...w, kg: Number(w.kg) })),
      yesterday: {
        meals: (yMeals ?? []).length,
        flags: Array.isArray(yDay?.flags) ? (yDay.flags as string[]) : [],
      },
      latestTdee: tdeeRows?.[0]?.tdee_est != null ? Number(tdeeRows[0].tdee_est) : null,
      favorites: favoriteRows,
      diet,
      photos,
      weighedToday: (todayWeights ?? []).length > 0,
      importsToConfirm: (imports ?? []).map((i) => i.id as string),
      weightCount: weightCount ?? 0,
      lastMeasureDate: (lastMeasure?.[0]?.date as string | undefined) ?? null,
      ...pickNights(date, (health ?? []) as (Partial<NightSleep> & { date: string })[]),
      expenditure,
      hasAnyWeight: (weightCount ?? 0) > 0,
      hasAnyMeal: (mealCount ?? 0) > 0,
    })
  }, [date])

  useEffect(() => {
    void load()
  }, [load, version])

  // Fotos a analisar: pergunta pelo estado de 3 em 3 s (de 15 em 15 s depois
  // de 2 min) e pede outra tentativa quando uma análise parou a meio.
  useEffect(() => {
    const analysing = (data?.meals ?? []).filter((m) => m.status === 'a_analisar')
    if (analysing.length === 0) return
    const now = Date.now()
    const oldest = Math.min(...analysing.map((m) => Date.parse(m.created_at)))
    const timer = setTimeout(() => {
      if (!document.hidden) void load()
    }, now - oldest > 120_000 ? 15_000 : 3_000)
    for (const meal of analysing) {
      const key = `${meal.id}:${meal.analysis_started_at ?? '-'}:${meal.analysis_attempts}`
      if (analysisStalled(meal, now) && meal.analysis_attempts < 3 && !retried.current.has(key)) {
        retried.current.add(key)
        void postApi('/api/meal/analyse', { meal_id: meal.id })
          .then(() => load())
          .catch(() => undefined)
      }
    }
    return () => clearTimeout(timer)
  }, [data, load])

  if (!data) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>

  // Só contam as refeições analisadas (ok e por rever); as outras avisam.
  const counted = data.meals.filter((m) => m.status === 'ok' || m.status === 'por_rever')
  const kcalIn = counted.reduce((acc, m) => acc + Number(m.kcal), 0)
  const proteinIn = counted.reduce((acc, m) => acc + Number(m.protein), 0)
  const carbsIn = counted.reduce((acc, m) => acc + Number(m.carbs), 0)
  const fatIn = counted.reduce((acc, m) => acc + Number(m.fat), 0)
  const nowMs = Date.now()
  const errorMeals = data.meals.filter(
    (m) => !retrying.has(m.id) && (m.status === 'erro' || analysisStuck(m, nowMs)),
  )
  const limitMeals = data.meals.filter((m) => m.status === 'sem_analise')
  const reviewMeals = data.meals.filter((m) => m.status === 'por_rever')
  const localCaptures = captures.filter((c) => (c.date ?? today) === date)
  const stillCounting =
    data.meals.filter((m) => m.status === 'a_analisar' && !analysisStuck(m, nowMs)).length +
    localCaptures.filter((c) => c.state === 'pendente').length
  // Regra 2 ao vivo: a meta do dia sobe com o treino. Regra 7: na semana de
  // pausa da dieta, a meta é o gasto estimado (ou 2000), fixa.
  const workoutKcals = data.workouts.map((w) => ({
    workout: w,
    kcal: storedExerciseKcal([
      {
        type: w.type,
        minutes: w.minutes,
        watts: w.watts,
        deviceCalories: w.raw?.calories ?? null,
        kcal_est: w.kcal_est,
      },
    ]),
  }))
  const kcalExercise = workoutKcals.reduce((acc, w) => acc + w.kcal, 0)
  const maintenance =
    profile.maintenance_enabled !== false &&
    profile.maintenance_anchor != null &&
    isMaintenanceWeek(profile.maintenance_anchor, date)
  const plan = maintenance ? maintenanceTarget(data.latestTdee) : profile.base_kcal + kcalExercise
  const left = plan - kcalIn
  const over = left < 0
  // Gasto de hoje (só para mostrar): base sem treino + treino do dia.
  const outToday = data.expenditure ? kcalOut(data.expenditure.base, kcalExercise) : null
  const underSpend = outToday != null ? kcalIn < outToday : data.latestTdee != null && kcalIn < data.latestTdee

  // Linhas do joelho: nunca na fila do Próximo passo; ficam até haver resposta (48 h).
  const kneeRows = isToday
    ? [
        ...data.workouts
          .filter((w) => w.pain_during == null)
          .map((w) => ({ workout: w, field: 'pain_during' as const })),
        ...data.yesterdayWorkouts
          .filter((w) => w.pain_next_day == null)
          .map((w) => ({ workout: w, field: 'pain_next_day' as const })),
      ]
    : []

  const clock = lisbonClock(now)
  const minutesOfDay = clock.hour * 60 + clock.minute
  const nudges = (profile.nudge_state ?? {}) as NudgeState
  const step: NextStepId | null = isToday
    ? nextStep({
        today,
        minutesOfDay,
        weighedToday: data.weighedToday,
        yesterdayMeals: data.yesterday.meals,
        yesterdayAnswered:
          data.yesterday.flags.includes('dia_fechado') || data.yesterday.flags.includes('faltou_algo'),
        mealsToday: counted.length,
        kcalToday: kcalIn,
        proteinToday: proteinIn,
        proteinTarget: profile.protein_g,
        mealsWithError: errorMeals.length,
        mealsOverLimit: limitMeals.length,
        mealsToReview: reviewMeals.length,
        workoutsToConfirm: data.importsToConfirm.length,
        measureDaysSince: daysSinceMeasure(data.lastMeasureDate, today),
        measureIntervalDays: profile.measure_interval_days ?? 14,
        weighings: data.weightCount,
        nudges,
      })
    : null
  const proteinFavorites = [...data.favorites]
    .filter((f) => Number(f.protein) >= 15)
    .sort((a, b) => Number(b.protein) - Number(a.protein))
    .slice(0, 3)

  const hints = profile.dismissed_hints ?? []
  const firstCards = isToday
    ? [
        !data.hasAnyWeight && !hints.includes('primeira_pesagem') ? 'primeira_pesagem' : null,
        !data.hasAnyMeal && !hints.includes('primeira_foto') ? 'primeira_foto' : null,
      ].filter((c): c is string => c != null)
    : []

  // Linha de lacuna: no máximo 1, só com um favorito habitual para esse momento.
  const nowSlot = slotOf(now)
  const gapFavorite =
    isToday &&
    GAP_SLOTS.includes(nowSlot) &&
    !hints.includes('lacuna') &&
    !data.diet &&
    minutesOfDay > minutesOf(SLOT_TIME[nowSlot]) + 30 &&
    !data.meals.some((m) => slotOf(new Date(m.logged_at)) === nowSlot)
      ? (data.favorites
          .filter((f) => f.default_slot === nowSlot)
          .sort((a, b) => b.use_count - a.use_count)[0] ?? null)
      : null

  async function retry(mealId: string) {
    setRetrying((prev) => new Set(prev).add(mealId))
    await retryAnalysis(mealId, toast)
    setRetrying((prev) => {
      const next = new Set(prev)
      next.delete(mealId)
      return next
    })
  }

  async function dismiss(id: NextStepId) {
    await update({ nudge_state: dismissNudge(nudges, id, today) as Record<string, unknown> })
  }

  async function dismissHint(hint: string) {
    await update({ dismissed_hints: [...hints, hint] })
  }

  async function answerYesterday(flag: 'dia_fechado' | 'faltou_algo') {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const other = flag === 'dia_fechado' ? 'faltou_algo' : 'dia_fechado'
    const flags = [...data!.yesterday.flags.filter((f) => f !== other && f !== flag), flag]
    const { error } = await supabase
      .from('days')
      .upsert(
        { user_id: user.id, date: shiftDate(today, -1), flags, dirty: true },
        { onConflict: 'user_id,date' },
      )
    if (error) {
      toast('Não consegui gravar. Tenta outra vez.')
      return
    }
    emitDataChanged()
    recomputeFrom(shiftDate(today, -1), today)
    toast(flag === 'dia_fechado' ? 'Ontem fica completo.' : 'Ontem fica fora das contas do gasto.')
  }

  type Entry = { at: string; key: string; node: React.ReactNode }
  const entries: Entry[] = []
  // Sem sono desta noite (não dormiu com o relógio): diz qual foi a última.
  if (!data.sleep && data.lastNight) {
    const last = data.lastNight
    entries.push({
      at: `${date}T00:00:00Z`,
      key: 'sono',
      node: (
        <div className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 opacity-80">
          <span className="w-12 shrink-0 font-display text-[15px] font-semibold tracking-[0.04em] text-dim uppercase">
            Noite
          </span>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-dashed border-line text-dim">
            <Icon name="moon" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Sem registo esta noite</span>
            <span className="block truncate text-[14px] text-dim">
              Última: {last.date === shiftDate(date, -1) ? 'ontem' : weekdayShort(last.date)}
              {last.sleep_minutes != null ? ` · ${fmtSleep(last.sleep_minutes)}` : ''}
              {sleepDetail(last) ? ` · ${sleepDetail(last)}` : ''}
            </span>
          </span>
        </div>
      ),
    })
  }
  // O sono da noite abre o dia (antes da pesagem e das refeições).
  if (data.sleep) {
    const night = data.sleep
    entries.push({
      at: `${date}T00:00:00Z`,
      key: 'sono',
      node: (
        <div className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2">
          <span className="w-12 shrink-0 font-display text-[15px] font-semibold tracking-[0.04em] text-dim uppercase">
            Noite
          </span>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface2 text-dim">
            <Icon name="moon" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Sono</span>
            <span className={`block truncate text-[14px] ${poorNight(night) ? 'text-attn' : 'text-dim'}`}>
              {sleepDetail(night) || 'do relógio'}
            </span>
          </span>
          {night.sleep_minutes != null && (
            <span className="num shrink-0 text-[22px]">{fmtSleep(night.sleep_minutes)}</span>
          )}
        </div>
      ),
    })
  }
  for (const w of data.weights) {
    const at = w.measured_at ?? w.created_at ?? `${w.date}T07:00:00Z`
    entries.push({
      at,
      key: `w-${w.date}`,
      node: (
        <button
          onClick={() => sheet.open('peso', { data: w.date, valor: fmt1(w.kg) })}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left"
        >
          <span className="w-12 shrink-0 font-display text-[17px] font-semibold text-dim tabular-nums">{timeOf(at)}</span>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface2 text-body">
            <Icon name="scale" />
          </span>
          <span className="flex-1 text-[16px] font-semibold">Peso</span>
          <span className="num text-[22px] text-body">
            {profile.calm_mode ? '✓' : `${fmt1(w.kg)} kg`}
          </span>
        </button>
      ),
    })
  }
  for (const meal of data.meals) {
    const slot = meal.slot ?? slotOf(new Date(meal.logged_at))
    const fresh = Date.now() - Date.parse(meal.created_at) < 60_000
    const thumbPath = mealThumb(meal, data.favorites)
    const thumb = thumbPath ? data.photos[thumbPath] : null
    const fromFavorite = meal.input_type === 'favorite' && meal.raw_text
    const title = fromFavorite ? meal.raw_text! : SLOT_LABEL[slot]
    const analysed = meal.status === 'ok' || meal.status === 'por_rever'
    const isRetrying = retrying.has(meal.id)
    const stuck = !isRetrying && analysisStuck(meal, Date.now())
    const failed = !isRetrying && (meal.status === 'erro' || stuck)
    const pending = isRetrying || (meal.status === 'a_analisar' && !stuck)
    const subtitle = isRetrying
      ? 'A analisar outra vez…'
      : meal.status === 'erro'
        ? (splitStoredError(meal.analysis_error).message ?? 'Não consegui analisar')
        : stuck
          ? 'Parou a meio'
          : meal.status === 'a_analisar'
            ? 'A analisar…'
            : meal.status === 'sem_analise'
              ? 'Sem análise (limite da IA)'
              : fromFavorite
                ? SLOT_LABEL[slot]
                : meal.items.map((i) => i.name).join(', ')
    entries.push({
      at: meal.logged_at,
      key: `m-${meal.id}`,
      node: (
        <div>
          <div className="flex items-center">
            <button
              onClick={() => sheet.open('refeicao', { id: meal.id })}
              className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-1 text-left"
            >
              <span className="w-12 shrink-0 font-display text-[17px] font-semibold text-dim tabular-nums">{timeOf(meal.logged_at)}</span>
              {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  className={`h-12 w-12 shrink-0 rounded-xl object-cover ${pending ? 'animate-pulse' : ''} ${failed ? 'opacity-60' : ''}`}
                />
              ) : (
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                    failed ? 'border-[1.5px] border-dashed border-eat text-eat' : 'bg-surface2 text-dim'
                  } ${pending ? 'animate-pulse' : ''}`}
                >
                  <Icon name={failed ? 'alert' : meal.input_type === 'barcode' ? 'barcode' : 'plate'} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">
                  {title}
                  {meal.favorite_id && <span className="ml-1 text-attn">★</span>}
                </span>
                <span
                  className={`block truncate text-[14px] ${failed ? 'text-eat' : meal.status === 'sem_analise' ? 'text-attn' : 'text-dim'}`}
                >
                  {subtitle}
                </span>
              </span>
              {analysed && (
                <span className="num flex shrink-0 items-center gap-1.5 text-[22px]">
                  {meal.status === 'por_rever' && (
                    <span className="h-2 w-2 rounded-full bg-attn" aria-label="por confirmar" />
                  )}
                  {meal.is_estimate ? '≈ ' : ''}
                  {fmtKcal(Number(meal.kcal))}
                </span>
              )}
            </button>
            {failed && (
              <button
                onClick={() => void retry(meal.id)}
                aria-label="Tentar outra vez"
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-eat/50 px-3 font-display text-[15px] font-semibold tracking-[0.04em] text-eat uppercase"
              >
                <Icon name="retry" size={18} />
                Tentar
              </button>
            )}
            {pending && !isRetrying && (
              <button
                onClick={() => sheet.open('nota', { id: meal.id })}
                className="min-h-11 shrink-0 rounded-xl px-3 text-[13px] text-eat"
              >
                ＋ Nota
              </button>
            )}
          </div>
          {fresh && analysed && (
            <p className="pl-[72px] text-[13px] text-dim">
              acabado de registar ·{' '}
              <button className="text-eat" onClick={() => void deleteMeal(meal.id, toast)}>
                Anular
              </button>
            </p>
          )}
        </div>
      ),
    })
  }
  // Capturas que ainda não chegaram ao servidor (sem rede ou a enviar).
  for (const capture of localCaptures) {
    entries.push({
      at: capture.taken_at ?? capture.created_at,
      key: `c-${capture.client_id}`,
      node: (
        <div className="flex min-h-14 items-center gap-3 px-2 py-1">
          <span className="w-12 shrink-0 font-display text-[17px] font-semibold text-dim tabular-nums">
            {timeOf(capture.taken_at ?? capture.created_at)}
          </span>
          {capture.preview ? (
            <img src={capture.preview} alt="" className="h-12 w-12 shrink-0 animate-pulse rounded-xl object-cover" />
          ) : (
            <span className="flex h-12 w-12 shrink-0 animate-pulse items-center justify-center rounded-xl bg-surface2 text-dim">
              <Icon name="pencil" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold">{capture.text ?? 'Foto'}</span>
            <span className={`block truncate text-[14px] ${capture.state === 'erro' ? 'text-eat' : 'text-dim'}`}>
              {capture.state === 'erro'
                ? (capture.error ?? 'Não consegui enviar.')
                : navigator.onLine
                  ? 'A enviar…'
                  : 'À espera de rede · fica guardada'}
            </span>
          </span>
          {capture.state === 'erro' && (
            <span className="flex shrink-0 gap-1">
              <button onClick={() => void retryCapture(capture.client_id)} className="min-h-11 px-2 text-[13px] text-eat">
                Tentar
              </button>
              <button onClick={() => void discardCapture(capture.client_id)} className="min-h-11 px-2 text-[13px] text-dim">
                Descartar
              </button>
            </span>
          )}
        </div>
      ),
    })
  }
  for (const { workout, kcal } of workoutKcals) {
    entries.push({
      at: workout.started_at ?? workout.created_at,
      key: `t-${workout.id}`,
      node: (
        <button
          onClick={() => sheet.open('confirmar-treino', { id: workout.id })}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left"
        >
          <span className="w-12 shrink-0 font-display text-[17px] font-semibold text-dim tabular-nums">
            {timeOf(workout.started_at ?? workout.created_at)}
          </span>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-burn text-bg">
            <Icon name={WORKOUT_ICON[workout.type]} size={26} />
          </span>
          <span className="flex-1 text-[16px] font-semibold">
            {workoutTitle(workout)}
            {workout.minutes != null && ` · ${workout.minutes} min`}
            {(workout.status === 'yellow' || workout.status === 'red') && (
              <span
                className={`ml-2 inline-block h-2 w-2 rounded-full ${workout.status === 'red' ? 'bg-pain' : 'bg-attn'}`}
                aria-label="joelho"
              />
            )}
          </span>
          {kcal > 0 && <span className="num text-[22px] text-burn">+{fmtKcal(kcal)}</span>}
        </button>
      ),
    })
  }
  entries.sort((a, b) => a.at.localeCompare(b.at))
  // O sono sozinho não conta como dia registado: continua o convite a começar.
  const empty = entries.every((e) => e.key === 'sono')
  const sleepEntry = entries.find((e) => e.key === 'sono')

  return (
    <div className="space-y-4 pt-1">
      <WeekStrip
        selected={date}
        today={today}
        onPick={(picked) => navigate(picked === today ? '/hoje' : `/hoje/${picked}`)}
      />

      {!isToday && (
        <p className="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-[15px]">
          <span>A ver {fmtDayShort(date)}</span>
          <button className="text-eat" onClick={() => navigate('/hoje')}>
            Voltar a hoje
          </button>
        </p>
      )}

      <button
        onClick={() => setPlanOpen(true)}
        className="block w-full rounded-[18px] border border-line bg-surface px-[18px] pt-4 pb-4 text-left"
      >
        <div className="flex items-center justify-between">
          <p className="label">
            {!isToday
              ? 'Comeste'
              : over
                ? 'Passaste o plano'
                : `${counted.length === 0 ? 'Podes comer' : 'Podes comer mais'}${stillCounting > 0 ? ' cerca de' : ''}`}
          </p>
          <p className="label">Ver o plano ›</p>
        </div>
        <p className="mt-0.5 flex items-baseline gap-2">
          <span
            className={`num text-[96px] leading-[0.92] font-extrabold ${
              !isToday ? 'text-ink' : over ? 'text-attn' : 'text-eat'
            } ${isToday && stillCounting ? 'opacity-50' : ''}`}
          >
            {!isToday ? fmtKcal(kcalIn) : over ? `+${fmtKcal(-left)}` : fmtKcal(left)}
          </span>
          <span className="num text-[22px] text-dim">KCAL</span>
        </p>
        {isToday && over && (
          <p className="mt-1 text-[15px] text-dim">
            {underSpend ? 'Mas continuas a comer menos do que gastas.' : 'A semana conta mais do que o dia.'}
          </p>
        )}
        {stillCounting > 0 && (
          <p className="mt-1 text-[14px] text-dim">
            ainda a contar {stillCounting} {stillCounting === 1 ? 'foto' : 'fotos'}
          </p>
        )}
        <div className="mt-3">
          <Segments value={kcalIn} max={plan} tone="eat" label="Comer" />
        </div>
        <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-line pt-3">
          <div>
            <p className="label text-[12px]">Comido</p>
            <p className="num text-[26px] leading-tight">{fmtKcal(kcalIn)}</p>
          </div>
          <div>
            <p className="label text-[12px]">Treino</p>
            <p className={`num text-[26px] leading-tight ${kcalExercise > 0 && !maintenance ? 'text-burn' : 'text-dim'}`}>
              {kcalExercise > 0 && !maintenance ? `+${fmtKcal(kcalExercise)}` : '—'}
            </p>
          </div>
          <div>
            <p className="label text-[12px]">Plano</p>
            <p className="num text-[26px] leading-tight">{fmtKcal(plan)}</p>
          </div>
        </div>
        <div className="mt-3.5 flex items-baseline justify-between">
          <p className="label text-[12px]">Proteína</p>
          <p className="num text-[18px]">
            {fmtInt(proteinIn)} <span className="text-dim">/ {fmtInt(profile.protein_g)} g</span>
          </p>
        </div>
        <div className="mt-1.5">
          <Segments value={proteinIn} max={profile.protein_g} count={14} height={6} tone="protein" label="Proteína" />
        </div>
        {maintenance && (
          <span className="mt-3 inline-block rounded-lg border border-line px-3 py-1 font-display text-[13px] font-semibold tracking-[0.1em] text-burn uppercase">
            Semana de pausa da dieta
          </span>
        )}
      </button>

      {firstCards.map((card) => (
        <div key={card} className="space-y-3 rounded-2xl border border-line p-4">
          {card === 'primeira_pesagem' ? (
            <>
              <p className="text-[17px] font-semibold">Pesa-te</p>
              <p className="text-[15px] text-dim">
                De manhã, antes de comer.
              </p>
              <div className="flex gap-2">
                <button onClick={() => sheet.open('peso')} className="min-h-12 flex-1 rounded-xl bg-eat font-semibold text-bg">
                  Pesar
                </button>
                <button onClick={() => void dismissHint(card)} className="min-h-12 px-4 text-[15px] text-dim">
                  Saltar
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[17px] font-semibold">Fotografa a próxima refeição</p>
              <p className="text-[15px] text-dim">Toca em + e tira uma foto ao prato. Eu faço as contas.</p>
              <button onClick={() => void dismissHint(card)} className="text-[15px] text-dim">
                Saltar
              </button>
            </>
          )}
        </div>
      ))}

      {kneeRows.map(({ workout, field }) => (
        <KneeRow
          key={`${workout.id}-${field}`}
          workout={workout}
          field={field}
          onDone={() => emitDataChanged()}
        />
      ))}

      {step && (
        <NextStepCard
          id={step}
          yesterdayMeals={data.yesterday.meals}
          favorites={proteinFavorites}
          onWeigh={() => sheet.open('peso')}
          onYesterday={(flag) => void answerYesterday(flag)}
          onFavorite={(fav) => void logFavorite(fav, null, toast)}
          onDismiss={() => void dismiss(step)}
          errorMeals={errorMeals}
          onRetry={(id) => void retry(id)}
          limitMeal={limitMeals[0] ?? null}
          reviewCount={reviewMeals.length}
          onOpenMeal={(id) => sheet.open('refeicao', { id })}
          onAnalyse={async (id, body) => {
            try {
              await postApi('/api/meal/analyse', { meal_id: id, ...body })
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Não consegui analisar.')
            }
            emitDataChanged()
          }}
          onReview={() => sheet.open('rever')}
          onRaiseLimit={() => navigate('/definicoes/avancado')}
          onConfirmWorkout={() => sheet.open('confirmar-treino', { import: data.importsToConfirm[0]! })}
          measureDaysSince={daysSinceMeasure(data.lastMeasureDate, today)}
          onMeasure={() => sheet.open('medidas')}
        />
      )}

      {empty && sleepEntry && <div className="-mx-2">{sleepEntry.node}</div>}
      {empty ? (
        <div className="space-y-4 rounded-2xl border border-line p-5 text-center">
          <p className="text-[15px] text-dim">
            {isToday
              ? 'O teu dia começa aqui. Toca em + e tira uma foto ao que comes. Eu faço as contas.'
              : `Nada registado em ${weekdayShort(date)}. Toca em + para registar nesse dia.`}
          </p>
          {isToday && (
            <>
              <PhotoButton
                source="camera"
                className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-eat text-[17px] font-semibold text-bg"
              >
                Fotografar
              </PhotoButton>
              {!data.weighedToday && (
                <button onClick={() => sheet.open('peso')} className="text-[15px] text-eat">
                  Ou pesa-te primeiro
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div>
          <p className="label mb-1">O dia</p>
          <div className="-mx-2 divide-y divide-line/60">{entries.map((e) => <div key={e.key}>{e.node}</div>)}</div>
        </div>
      )}

      {data.diet && date <= today && (
        <DietToday diet={data.diet} favorites={data.favorites} meals={data.meals} date={date} today={today} />
      )}

      {gapFavorite && (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-3 py-2 text-[15px]">
          <span className="flex-1 text-dim">Ainda sem {SLOT_LABEL[nowSlot].toLowerCase()}</span>
          <button
            onClick={() => void logFavorite(gapFavorite, null, toast)}
            className="rounded-full bg-surface2 px-3 py-1.5"
          >
            {gapFavorite.name}
          </button>
          <PhotoButton source="camera" className="flex min-h-9 items-center rounded-full bg-surface2 px-3" aria-label="Fotografar">
            <Icon name="camera" size={20} />
          </PhotoButton>
          <button onClick={() => void dismissHint('lacuna')} className="px-1 text-[13px] text-dim" aria-label="Não mostrar isto">
            ✕
          </button>
        </div>
      )}

      {data.deleted.length > 0 && (
        <div className="space-y-2">
          <button onClick={() => setShowDeleted(!showDeleted)} className="text-[13px] text-dim">
            Apagados ({data.deleted.length}) {showDeleted ? '▾' : '›'}
          </button>
          {showDeleted &&
            data.deleted.map((meal) => (
              <div key={meal.id} className="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-[15px]">
                <span className="min-w-0 truncate text-dim">
                  {timeOf(meal.logged_at)} · {meal.items.map((i) => i.name).join(', ') || 'Refeição'}
                </span>
                <button
                  className="shrink-0 pl-3 text-eat"
                  onClick={async () => {
                    try {
                      await postApi('/api/meal/restore', { meal_id: meal.id })
                      emitDataChanged()
                      recomputeFrom(meal.date, today)
                    } catch {
                      toast('Não consegui repor.')
                    }
                  }}
                >
                  Repor
                </button>
              </div>
            ))}
        </div>
      )}

      {planOpen && (
        <BottomSheet title={isToday ? 'O plano de hoje' : `O plano de ${fmtDayShort(date)}`} onClose={() => setPlanOpen(false)}>
          <div className="space-y-4 pb-2 text-[15px]">
            {outToday != null && (
              <div className="space-y-1">
                <p className="text-[17px]">
                  Gastas cerca de {fmtKcal(round10(outToday))} {isToday ? 'hoje' : 'nesse dia'}
                  {data.expenditure?.learning ? ' (a aprender)' : ''}.
                </p>
                {!maintenance && paceFromDiff(plan - outToday) < 0 && (
                  <p>
                    O plano deixa-te comer {fmtKcal(plan)} para perderes cerca de{' '}
                    {fmt1(Math.abs(paceFromDiff(plan - outToday)))} kg por semana.
                  </p>
                )}
              </div>
            )}
            {maintenance ? (
              <p>
                Esta semana o plano é comer o que gastas ({fmtInt(plan)}) para o corpo descansar da dieta.
              </p>
            ) : (
              <p className="tabular-nums">
                Plano: {fmtInt(profile.base_kcal)}
                {kcalExercise > 0 && (
                  <>
                    {' '}
                    + <span className="text-burn">{fmtInt(kcalExercise)} do treino</span> = {fmtInt(plan)}
                  </>
                )}
              </p>
            )}
            <p className="tabular-nums">
              Comeste {fmtInt(kcalIn)}
              {isToday && !over && <> · Podes comer mais {fmtInt(left)}</>}
              {over && <> · Passaste {fmtInt(-left)} do plano</>}
            </p>
            <p className="text-dim tabular-nums">
              <span className="text-protein">Proteína {fmtInt(proteinIn)} de {fmtInt(profile.protein_g)} g</span> ·
              Hidratos {fmtInt(carbsIn)} g · Gordura {fmtInt(fatIn)} g
            </p>
            {workoutKcals.length > 0 && (
              <ul className="space-y-1 text-dim">
                {workoutKcals.map(({ workout, kcal }) => (
                  <li key={workout.id} className="tabular-nums">
                    {workoutTitle(workout)} · +{fmtInt(kcal)}{' '}
                    {workout.type === 'bike' && workout.watts != null
                      ? `pela potência (${workout.watts} W × ${workout.minutes} min)`
                      : workout.type === 'strength'
                        ? '150 fixas por ginásio de 30 min ou mais'
                        : workout.raw?.calories != null
                          ? '70 % das calorias do relógio'
                          : 'pelo tempo e pelo teu peso'}
                  </li>
                ))}
              </ul>
            )}
            {kcalExercise === 0 && !maintenance && (
              <p className="text-dim">Um treino aumenta o que podes comer.</p>
            )}
            <details className="text-dim">
              <summary className="cursor-pointer">Como sei quanto gastas?</summary>
              <p className="mt-1">
                Primeiro por uma fórmula com a tua altura, peso e idade. Depois de 10 dias completos, pelo que comes e pelo
                que o teu peso faz.
              </p>
            </details>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

function KneeRow({
  workout,
  field,
  onDone,
}: {
  workout: Workout
  field: 'pain_during' | 'pain_next_day'
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)
  const [values, setValues] = useState({ watts: '', avg_hr: '', max_hr: '', cadence: '' })
  const [error, setError] = useState(false)
  const bikeMissing =
    workout.type === 'bike' && field === 'pain_during' && (workout.avg_hr == null || workout.watts == null)

  async function answer(pain: number) {
    setBusy(true)
    setError(false)
    const extras: Record<string, number> = {}
    const limits: Record<string, [number, number]> = {
      watts: [30, 500],
      avg_hr: [40, 230],
      max_hr: [40, 240],
      cadence: [30, 200],
    }
    for (const [key, raw] of Object.entries(values)) {
      const n = Math.round(Number(raw))
      const [min, max] = limits[key]!
      if (raw && Number.isFinite(n) && n >= min && n <= max) extras[key] = n
    }
    try {
      await postApi('/api/workout/checkin', { workout_id: workout.id, [field]: pain, ...extras })
      onDone()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line p-4">
      <p className="text-[17px]">
        {field === 'pain_during'
          ? `Como esteve o joelho durante ${WORKOUT_OF[workout.type]}?`
          : `Joelho depois ${WORKOUT_AFTER[workout.type]} de ontem?`}
      </p>
      {bikeMissing &&
        (details ? (
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ['watts', 'W', workout.watts == null],
                ['avg_hr', 'bat. méd.', true],
                ['max_hr', 'bat. máx.', true],
                ['cadence', 'rpm', workout.cadence == null],
              ] as const
            ).map(([key, label, show]) =>
              show ? (
                <label key={key} className="space-y-1 text-center text-[13px] text-dim">
                  <span className="block">{label}</span>
                  <input
                    inputMode="numeric"
                    value={values[key]}
                    onChange={(e) => setValues({ ...values, [key]: e.target.value.replace(/\D/g, '') })}
                    className="h-11 w-full rounded-xl border border-line bg-bg text-center text-ink tabular-nums focus:border-eat focus:outline-none"
                  />
                </label>
              ) : null,
            )}
          </div>
        ) : (
          <button onClick={() => setDetails(true)} className="text-[13px] text-eat">
            ＋ batimentos e rpm da consola (ajudam a subir a potência)
          </button>
        ))}
      <KneePicker busy={busy} onAnswer={(pain) => void answer(pain)} />
      {error && <p className="text-[13px] text-pain">Não consegui gravar. Tenta outra vez.</p>}
    </div>
  )
}

function NextStepCard({
  id,
  yesterdayMeals,
  favorites,
  onWeigh,
  onYesterday,
  onFavorite,
  onDismiss,
  errorMeals,
  onRetry,
  limitMeal,
  reviewCount,
  onOpenMeal,
  onAnalyse,
  onReview,
  onRaiseLimit,
  onConfirmWorkout,
  measureDaysSince,
  onMeasure,
}: {
  id: NextStepId
  yesterdayMeals: number
  favorites: Favorite[]
  onWeigh: () => void
  onYesterday: (flag: 'dia_fechado' | 'faltou_algo') => void
  onFavorite: (favorite: Favorite) => void
  onDismiss: () => void
  errorMeals: Meal[]
  onRetry: (id: string) => void
  limitMeal: Meal | null
  reviewCount: number
  onOpenMeal: (id: string) => void
  onAnalyse: (id: string, body: Record<string, boolean>) => Promise<void>
  onReview: () => void
  onRaiseLimit: () => void
  onConfirmWorkout: () => void
  measureDaysSince: number | null
  onMeasure: () => void
}) {
  const errorMeal = errorMeals[0] ?? null
  const later = (
    <button onClick={onDismiss} className="min-h-11 px-3 text-[15px] text-dim">
      Agora não
    </button>
  )
  const chips = favorites.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {favorites.map((fav) => (
        <button key={fav.id} onClick={() => onFavorite(fav)} className="rounded-full bg-surface2 px-3 py-2 text-[15px]">
          {fav.name} <span className="text-protein tabular-nums">{fmtInt(Number(fav.protein))} g</span>
        </button>
      ))}
    </div>
  )

  return (
    <div
      className={`space-y-3 rounded-[18px] border p-4 ${
        id === 'erro' ? 'border-eat/40 bg-eat/10' : 'border-line bg-surface'
      }`}
    >
      {id === 'erro' && errorMeal && (
        <>
          <p className="font-display text-[12px] font-bold tracking-[0.16em] text-eat uppercase">
            {errorMeals.length > 1 ? `${errorMeals.length} refeições por analisar` : 'Não consegui analisar'}
          </p>
          <div className="-mt-2">
            <p className="text-[17px] font-medium">A refeição das {timeOf(errorMeal.logged_at)} ficou sem números.</p>
            <p className="text-[14px] text-dim">
              {errorMeal.status === 'erro'
                ? (splitStoredError(errorMeal.analysis_error).message ?? 'A análise falhou.')
                : 'A análise parou a meio.'}
            </p>
          </div>
          <button
            onClick={() => errorMeals.forEach((m) => onRetry(m.id))}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-eat font-display text-[17px] font-bold tracking-[0.04em] text-bg uppercase"
          >
            <Icon name="retry" size={20} />
            {errorMeals.length > 1 ? `Tentar as ${errorMeals.length} outra vez` : 'Tentar outra vez'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            {(errorMeal.photo_paths?.length ?? 0) < MAX_MEAL_PHOTOS ? (
              <AttachPhotoButton
                meal={errorMeal}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line font-display text-[15px] font-semibold tracking-[0.04em] uppercase"
              >
                <Icon name="camera" size={18} />
                Juntar foto
              </AttachPhotoButton>
            ) : (
              <span />
            )}
            <button
              onClick={() => onOpenMeal(errorMeal.id)}
              className="min-h-12 rounded-xl border border-line px-3 font-display text-[15px] font-semibold tracking-[0.04em] uppercase"
            >
              Escrever
            </button>
          </div>
        </>
      )}
      {id === 'treino' && (
        <>
          <p className="text-[17px]">Li o print do relógio. Falta confirmar o treino.</p>
          <button
            onClick={onConfirmWorkout}
            className="min-h-12 w-full rounded-xl bg-cta font-display text-[17px] font-bold tracking-[0.04em] text-on-cta uppercase"
          >
            Confirmar treino
          </button>
        </>
      )}
      {id === 'limite' && limitMeal && (
        <>
          <p className="text-[17px]">
            Chegaste ao limite da IA que definiste. A foto das {timeOf(limitMeal.logged_at)} está guardada.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => void onAnalyse(limitMeal.id, { force: true })}
              className="min-h-12 rounded-xl bg-eat px-1 text-[13px] font-semibold text-bg"
            >
              Analisar esta mesmo assim
            </button>
            <button onClick={onRaiseLimit} className="min-h-12 rounded-xl bg-surface2 px-1 text-[13px]">
              Subir limite
            </button>
            <button onClick={() => onOpenMeal(limitMeal.id)} className="min-h-12 rounded-xl bg-surface2 px-1 text-[13px]">
              Escrever em vez disso
            </button>
          </div>
        </>
      )}
      {id === 'rever' && (
        <>
          <p className="text-[17px]">
            {reviewCount} {reviewCount === 1 ? 'refeição por confirmar' : 'refeições por confirmar'}. Já contam; confirmar é
            opcional.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onReview} className="min-h-12 flex-1 rounded-xl bg-eat font-semibold text-bg">
              Rever
            </button>
            {later}
          </div>
        </>
      )}
      {id === 'medir' && (
        <>
          <p className="text-[17px]">
            {measureDaysSince == null
              ? 'Mede a cintura e o pescoço: 2 minutos com uma fita métrica chegam para estimar a gordura e a massa magra.'
              : `Medições: há ${measureDaysSince} dias · 2 minutos.`}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onMeasure} className="min-h-12 flex-1 rounded-xl bg-cta font-semibold text-on-cta">
              Medir
            </button>
            {later}
          </div>
        </>
      )}
      {id === 'pesar' && (
        <>
          <p className="text-[17px]">Bom dia. Pesa-te?</p>
          <div className="flex items-center gap-2">
            <button onClick={onWeigh} className="min-h-12 flex-1 rounded-xl bg-eat font-semibold text-bg">
              Pesar
            </button>
            {later}
          </div>
        </>
      )}
      {id === 'ontem' && (
        <>
          <p className="text-[17px]">
            Ontem registaste {yesterdayMeals} {yesterdayMeals === 1 ? 'refeição' : 'refeições'}. Foi tudo?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onYesterday('dia_fechado')} className="min-h-12 rounded-xl bg-surface2 text-[15px]">
              Sim, foi tudo
            </button>
            <button onClick={() => onYesterday('faltou_algo')} className="min-h-12 rounded-xl bg-surface2 text-[15px]">
              Não, faltou algo
            </button>
          </div>
        </>
      )}
      {id === 'pouco' && (
        <>
          <p className="text-[17px]">Hoje comeste pouco. Um lanche com proteína ajuda o músculo e o joelho.</p>
          {chips}
          <div className="flex justify-end">{later}</div>
        </>
      )}
      {id === 'proteina' && (
        <>
          <p className="text-[17px]">Ainda tens espaço para proteína.</p>
          {chips}
          <div className="flex justify-end">{later}</div>
        </>
      )}
    </div>
  )
}
