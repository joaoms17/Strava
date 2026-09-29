import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSheet } from '../lib/sheet'
import { useDataVersion } from '../lib/events'
import { useReadyProfile } from '../lib/profile'
import { nutritionalDay, shiftDate } from '../lib/day'
import { fmtKcal, weekdayShort } from '../lib/format'
import { workoutTitle } from '../lib/workout-actions'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { bikeSuggestion, nextBikeTarget } from '../../api/_lib/rules/progressao-bike'
import { fmtSleep, hasSleep, poorNight, type NightSleep } from '../../api/_lib/rules/sono'
import type { ExerciseLogRow, Favorite, Workout, WorkoutImport } from '../lib/types'
import Icon from '../components/ui/Icon'
import ShotButton from '../components/ui/ShotButton'
import BikeHrChart from '../components/BikeHrChart'
import LoadChart from '../components/LoadChart'
import { syncNow, syncSummary, useAutoSync } from '../lib/intervals'
import { syncedAgo } from '../../api/_lib/rules/intervals'
import { useProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { useLocation } from 'wouter'

const KNEE_DOT: Record<NonNullable<Workout['status']>, string> = {
  green: 'bg-ok',
  yellow: 'bg-attn',
  red: 'bg-pain',
}

function origin(w: Workout): string {
  if ((w.merged_from?.length ?? 0) > 0 || w.source === 'screenshot') return 'print'
  if (w.source === 'strava') return 'Strava'
  if (w.source === 'intervals') return 'Garmin (auto)'
  return w.favorite_id ? 'favorito' : 'à mão'
}

interface TreinoData {
  workouts: Workout[]
  favorites: Favorite[]
  pending: WorkoutImport[]
  logs: ExerciseLogRow[]
  sleep: NightSleep | null
}

// Treino: registar em poucos toques (Bicicleta habitual, Já fiz, print do
// relógio) e ver o que gastou, como progride e como reage o joelho.
export default function Treino() {
  const version = useDataVersion()
  const sheet = useSheet()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [data, setData] = useState<TreinoData | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [, navigate] = useLocation()
  const { reload } = useProfile()
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)
  useAutoSync()
  const icu = profile.integration_status?.intervals

  const load = useCallback(async () => {
    const [{ data: workouts }, { data: favorites }, { data: pending }, { data: logs }, { data: health }] = await Promise.all([
      supabase
        .from('workouts_active')
        .select('*')
        .gte('date', shiftDate(today, -83))
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('favorites')
        .select('*')
        .eq('kind', 'workout')
        .eq('archived', false)
        .order('use_count', { ascending: false }),
      supabase
        .from('workout_imports')
        .select('*')
        .in('status', ['a_ler', 'por_confirmar', 'erro'])
        .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('exercise_log')
        .select('workout_id,exercise,set_index,reps,load_kg,rpe,created_at')
        .order('created_at')
        .limit(600),
      supabase.from('health_daily').select('*').eq('date', today).maybeSingle(),
    ])
    setData({
      workouts: (workouts ?? []) as Workout[],
      favorites: (favorites ?? []) as Favorite[],
      pending: (pending ?? []) as WorkoutImport[],
      logs: (logs ?? []) as ExerciseLogRow[],
      sleep: hasSleep(health as Partial<NightSleep> | null) ? (health as NightSleep) : null,
    })
  }, [today])

  useEffect(() => {
    void load()
  }, [load, version])

  if (!data) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>

  const { workouts, favorites, pending } = data
  const monday = mondayOf(today)
  const week = workouts.filter((w) => w.date >= monday && w.date <= today)
  const weekMinutes = week.reduce((a, w) => a + (w.minutes ?? 0), 0)
  const weekKcal = week.reduce((a, w) => a + (w.kcal_est ?? 0), 0)
  const weekKnee = week.filter((w) => w.status === 'yellow' || w.status === 'red').length

  const habitual = favorites.find((f) => f.name === 'Bicicleta habitual') ?? favorites.find((f) => f.workout?.type === 'bike')
  const others = favorites.filter((f) => f !== habitual)
  // Um favorito de ginásio abre a Sessão de ginásio; os outros, a folha Joelho.
  const openFavorite = (f: Favorite) =>
    f.workout?.type === 'strength' ? navigate(`/treino/ginasio?fav=${f.id}`) : sheet.open('joelho', { fav: f.id })
  const openWorkout = (w: Workout) =>
    w.type === 'strength' && data.logs.some((l) => l.workout_id === w.id)
      ? navigate(`/treino/ginasio?id=${w.id}`)
      : sheet.open('confirmar-treino', { id: w.id })

  const bikes = workouts.filter((w) => w.type === 'bike')
  const target = nextBikeTarget(
    bikes.map((w) => ({
      watts: w.watts,
      minutes: w.minutes,
      avg_hr: w.avg_hr,
      max_hr: w.max_hr,
      status: w.status,
      watts_source: w.watts_source ?? null,
    })),
    profile.bike_watts_options?.length ? profile.bike_watts_options : [130, 140, 150],
    { avgHr: profile.bike_hr_avg_cap, maxHr: profile.bike_hr_max_cap },
  )
  const lastBike = bikes[bikes.length - 1]
  const suggestion = bikeSuggestion(target, lastBike == null || lastBike.status != null)

  const history = workouts.slice().reverse()
  const shown = showAll ? history : history.slice(0, 8)
  const kneeDots = workouts.filter((w) => w.type !== 'other').slice(-12)

  const secondary =
    'flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-display text-[18px] font-bold tracking-[0.06em] uppercase'

  return (
    <div className="space-y-4 pt-1">
      {pending.map((row) => (
        <button
          key={row.id}
          onClick={() => sheet.open('confirmar-treino', { import: row.id })}
          className="flex w-full items-center gap-3 rounded-[18px] border border-burn/50 bg-burn/10 p-4 text-left"
        >
          <Icon name="watch" />
          <span className="flex-1 text-[16px]">
            {row.status === 'a_ler'
              ? 'A ler o print do relógio…'
              : row.status === 'erro'
                ? 'Não consegui ler um print. Toca para ver.'
                : 'Print lido · falta confirmar'}
          </span>
          <Icon name="chevron" size={20} />
        </button>
      ))}

      {week.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Sessões', String(week.length), ''],
            ['Minutos', String(weekMinutes), ''],
            ['No plano', `+${fmtKcal(weekKcal)}`, 'text-burn'],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-2xl border border-line bg-surface p-3">
              <p className="label text-[12px]">{label}</p>
              <p className={`num text-[34px] leading-none font-extrabold ${tone}`}>{value}</p>
            </div>
          ))}
          <p className="col-span-3 flex items-center gap-2 px-1 text-[15px] text-dim">
            <span className={`h-2.5 w-2.5 rounded-full ${weekKnee ? 'bg-attn' : 'bg-ok'}`} />
            {weekKnee === 0
              ? `Joelho bem ${week.length === 1 ? 'na sessão' : `nas ${week.length} sessões`} desta semana`
              : `${weekKnee} ${weekKnee === 1 ? 'sessão' : 'sessões'} com incómodo esta semana`}
          </p>
        </div>
      )}

      {habitual?.workout && (
        <button
          onClick={() => sheet.open('joelho', { fav: habitual.id })}
          className="flex min-h-24 w-full items-center gap-4 rounded-[20px] bg-burn px-4 text-left text-bg active:scale-[0.99]"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-bg text-burn">
            <Icon name="bike" size={32} stroke={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[26px] leading-none font-extrabold uppercase">
              {habitual.name}
            </span>
            <span className="mt-1 block font-display text-[18px] font-semibold uppercase">
              {habitual.workout.minutes} min
              {habitual.workout.watts ? ` · ${habitual.workout.watts} W` : ''}
              {habitual.kcal ? ` · +${fmtKcal(habitual.kcal)}` : ''}
            </span>
          </span>
          <Icon name="chevron" size={22} stroke={2.4} />
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => sheet.open('ja-fiz')} className={secondary}>
          <Icon name="check" size={20} /> Já fiz
        </button>
        <button onClick={() => navigate('/treino/ginasio')} className={secondary}>
          <Icon name="dumbbell" size={20} /> Ginásio
        </button>
        <ShotButton className={`${secondary} col-span-2`}>
          <Icon name="watch" size={20} /> Print do relógio
        </ShotButton>
      </div>

      {icu?.connected && (
        <div className="flex items-center justify-between gap-2 text-[14px] text-dim">
          <span>
            Garmin (intervals.icu){icu.last_sync_at ? ` · sincronizado ${syncedAgo(icu.last_sync_at, new Date())}` : ''}
            {icu.last_error ? ` · ${icu.last_error}` : ''}
          </span>
          <button
            disabled={syncing}
            onClick={() => {
              setSyncing(true)
              void syncNow(3)
                .then((r) => toast(syncSummary(r)))
                .catch((err) => toast(err instanceof Error ? err.message : 'Não consegui sincronizar.'))
                .finally(() => {
                  setSyncing(false)
                  void reload()
                })
            }}
            className="min-h-10 shrink-0 rounded-xl border border-line px-3 text-ink disabled:opacity-40"
          >
            {syncing ? 'A sincronizar…' : 'Sincronizar agora'}
          </button>
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((f) => (
            <button
              key={f.id}
              onClick={() => openFavorite(f)}
              className="min-h-10 rounded-full border border-line px-3 text-[15px]"
            >
              {f.name}
              {f.workout?.type !== 'strength' && ` · ${f.workout?.minutes} min`}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-[18px] border border-line bg-surface p-4">
        <p className="font-display text-[12px] font-bold tracking-[0.16em] text-burn uppercase">Próxima bicicleta</p>
        <p className="mt-1 text-[17px] font-medium">{suggestion}</p>
        {data.sleep && poorNight(data.sleep) && (
          <p className="mt-2 text-[15px] text-attn">
            Dormiste mal esta noite
            {data.sleep.sleep_score != null
              ? ` (sono ${data.sleep.sleep_score})`
              : data.sleep.sleep_minutes != null
                ? ` (${fmtSleep(data.sleep.sleep_minutes)})`
                : ''}
            . Hoje não subas: repete os watts da última vez ou faz menos tempo.
          </p>
        )}
      </div>

      {workouts.length === 0 ? (
        <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
          Regista o primeiro treino: toca em Bicicleta habitual ou em Já fiz. Se usas relógio, podes juntar o print
          depois.
        </p>
      ) : (
        <section>
          <p className="label mb-1">Histórico</p>
          <div className="divide-y divide-line/60">
            {shown.map((w) => (
              <button
                key={w.id}
                onClick={() => openWorkout(w)}
                className="flex w-full items-center gap-3 py-2.5 text-left"
              >
                <span className="flex w-11 shrink-0 flex-col items-center">
                  <span className="font-display text-[12px] font-semibold tracking-[0.1em] text-dim uppercase">
                    {weekdayShort(w.date)}
                  </span>
                  <span className="num text-[24px] leading-none font-extrabold">{Number(w.date.slice(8))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{workoutTitle(w)}</span>
                  <span className="block truncate text-[14px] text-dim">
                    {[
                      w.minutes != null ? `${w.minutes} min` : null,
                      w.watts != null ? `${w.watts_source === 'prefill' ? '≈' : ''}${w.watts} W` : null,
                      w.avg_hr != null ? `${w.avg_hr} bpm` : null,
                      origin(w),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="num text-[22px] text-burn">+{fmtKcal(w.kcal_est ?? 0)}</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${w.status ? KNEE_DOT[w.status] : 'border border-line'}`}
                    aria-label={w.status ? `joelho ${w.status}` : 'joelho sem resposta'}
                  />
                </span>
              </button>
            ))}
          </div>
          {history.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-[15px] text-dim">
              Ver mais ({history.length - shown.length})
            </button>
          )}
        </section>
      )}

      {kneeDots.length > 0 && (
        <section className="space-y-2">
          <p className="label">Joelho</p>
          <div className="flex flex-wrap gap-1.5">
            {kneeDots.map((w) => (
              <span
                key={w.id}
                className={`h-4 w-4 rounded-full ${w.status ? KNEE_DOT[w.status] : 'border border-line'}`}
                title={`${w.date}: ${w.status ?? 'sem resposta'}`}
              />
            ))}
          </div>
          <p className="text-[13px] text-dim">Verde até 2 · amarelo 3–5 · vermelho 6 ou mais. Só sobes carga com verde.</p>
        </section>
      )}

      {bikes.some((w) => w.avg_hr != null) && (
        <section className="space-y-2">
          <p className="label">Progressão na bicicleta</p>
          <BikeHrChart workouts={workouts} capAvg={profile.bike_hr_avg_cap} />
        </section>
      )}

      {data.logs.length > 0 && (
        <section className="space-y-2">
          <p className="label">Cargas no ginásio</p>
          <LoadChart logs={data.logs} workoutDates={new Map(workouts.map((w) => [w.id, w.date]))} />
        </section>
      )}
    </div>
  )
}
