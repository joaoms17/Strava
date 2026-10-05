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
import BikeHrChart from '../components/BikeHrChart'
import LoadChart from '../components/LoadChart'
import { useAutoSync } from '../lib/intervals'
import { useLocation } from 'wouter'
import WeekPlanCard from '../components/WeekPlanCard'
import WorkoutLogOptions from '../components/WorkoutLogOptions'
import { cleanPrefs } from '../../api/_lib/rules/plano'

function origin(w: Workout): string {
  if ((w.merged_from?.length ?? 0) > 0 || w.source === 'screenshot') return 'print'
  if (w.source === 'strava') return 'Strava'
  if (w.source === 'intervals') return 'Relógio (auto)'
  return w.favorite_id ? 'favorito' : 'à mão'
}

interface TreinoData {
  workouts: Workout[]
  favorites: Favorite[]
  pending: WorkoutImport[]
  logs: ExerciseLogRow[]
  sleep: NightSleep | null
}

// Treino: o plano da semana, registar (print do relógio, print da app, ou
// dizer/escrever o que fizeste) e ver o que gastou e como progride. Os treinos
// do relógio chegam sozinhos (Definições › Ligações).
export default function Treino() {
  const version = useDataVersion()
  const sheet = useSheet()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [data, setData] = useState<TreinoData | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Treinos com mais de 12 semanas (histórico importado): só a pedido.
  const [older, setOlder] = useState<Workout[] | null>(null)
  const [, navigate] = useLocation()
  useAutoSync()

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
  const suggestion = bikeSuggestion(target)
  // A sugestão da bicicleta só para quem anda de bicicleta e não tem o plano
  // semanal (aí quem sugere é a IA).
  const planOn = cleanPrefs(profile.goals?.plano)?.ativo === true
  const ridesBike = !planOn && (bikes.length > 0 || favorites.some((f) => f.workout?.type === 'bike'))

  const history = [...workouts.slice().reverse(), ...(older ?? [])]
  async function loadOlder() {
    const { data: rows } = await supabase
      .from('workouts_active')
      .select('*')
      .lt('date', shiftDate(today, -83))
      .order('date', { ascending: false })
      .limit(500)
    setOlder((rows ?? []) as Workout[])
  }
  const shown = showAll ? history : history.slice(0, 8)


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
        </div>
      )}

      <WeekPlanCard workouts={workouts} />

      <WorkoutLogOptions />

      {ridesBike && (
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
      )}


      {workouts.length > 0 && (
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
                <span className="num text-[22px] text-burn">+{fmtKcal(w.kcal_est ?? 0)}</span>
              </button>
            ))}
          </div>
          {history.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-[15px] text-dim">
              Ver mais ({history.length - shown.length})
            </button>
          )}
          {history.length <= shown.length && older == null && (
            <button onClick={() => void loadOlder()} className="mt-2 text-[15px] text-dim">
              Ver treinos mais antigos
            </button>
          )}
          {older != null && older.length === 0 && (
            <p className="mt-2 text-[14px] text-dim">Não há treinos com mais de 12 semanas.</p>
          )}
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
