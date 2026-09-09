import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { localCalendarDate, shiftDate } from '../lib/day'
import { blockWeekOf, sessionDate } from '../../api/_lib/rules/plan-dates'
import { nextBikeTarget, type BikeTarget } from '../../api/_lib/rules/progressao-bike'
import { readyForIncrease } from '../../api/_lib/rules/progressao-forca'
import type { Semaforo } from '../../api/_lib/rules/semaforo'
import type {
  Chapter,
  ExerciseLogRow,
  PlanBlock,
  PlannedSession,
  Profile,
  Workout,
} from '../lib/types'
import StrengthLogger, { type ExerciseSuggestion } from '../components/StrengthLogger'

type ManualType = Workout['type']

const TYPE_LABEL: Record<ManualType, string> = {
  bike: 'Bike',
  strength: 'Força',
  other: 'Outro',
}

const TARGET_LABEL: Record<BikeTarget['kind'], string> = {
  start: 'primeira sessão',
  'progress-time': 'sobe o tempo',
  'validate-next-watts': 'validação do W seguinte',
  hold: 'mantém',
  ease: 'bike leve (semáforo)',
}

const STATUS_DOT: Record<NonNullable<Workout['status']>, string> = {
  green: 'bg-ok',
  yellow: 'bg-accent',
  red: 'bg-warn',
}

interface TreinoData {
  profile: Profile
  block: (PlanBlock & { chapter: Chapter | null }) | null
  sessions: (PlannedSession & { date: string })[]
  workouts: Workout[]
  logs: ExerciseLogRow[]
}

export default function Treino() {
  const [data, setData] = useState<TreinoData | null>(null)
  const [logging, setLogging] = useState<string | null>(null) // planned_session_id
  const [manualType, setManualType] = useState<ManualType | null>(null)
  const [minutes, setMinutes] = useState<number | null>(null)
  const [watts, setWatts] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const today = localCalendarDate()
    const [{ data: profile }, { data: blocks }, { data: workouts }, { data: logs }] =
      await Promise.all([
        supabase.from('profile').select('*').single(),
        supabase
          .from('plan_blocks')
          .select('*')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('workouts')
          .select('*')
          .gte('date', shiftDate(today, -59))
          .order('date'),
        supabase
          .from('exercise_log')
          .select('workout_id,exercise,set_index,reps,load_kg,rpe,created_at')
          .order('created_at')
          .limit(400),
      ])

    const block = (blocks?.[0] ?? null) as PlanBlock | null
    let chapter: Chapter | null = null
    let sessions: (PlannedSession & { date: string })[] = []
    if (block) {
      const [{ data: chapterRow }, { data: sessionRows }] = await Promise.all([
        block.chapter_id
          ? supabase.from('chapters').select('*').eq('id', block.chapter_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('planned_sessions').select('*').eq('block_id', block.id),
      ])
      chapter = (chapterRow ?? null) as Chapter | null
      sessions = ((sessionRows ?? []) as PlannedSession[])
        .map((s) => ({ ...s, date: sessionDate(block.start_date, s.week, s.day_index) }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    setData({
      profile: profile as Profile,
      block: block ? { ...block, chapter } : null,
      sessions,
      workouts: (workouts ?? []) as Workout[],
      logs: (logs ?? []) as ExerciseLogRow[],
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const today = localCalendarDate()

  const derived = useMemo(() => {
    if (!data) return null
    const { profile, sessions, workouts, logs } = data

    const bikeTarget = nextBikeTarget(
      workouts.filter((w) => w.type === 'bike'),
      profile.bike_watts_options ?? [130, 140, 150],
      { avgHr: profile.bike_hr_avg_cap, maxHr: profile.bike_hr_max_cap },
    )

    // sugestões de força (regra 11) a partir do exercise_log
    const workoutDate = new Map(workouts.map((w) => [w.id, w.date]))
    const byExercise = new Map<string, Map<string, ExerciseLogRow[]>>()
    for (const log of logs) {
      const perWorkout = byExercise.get(log.exercise) ?? new Map<string, ExerciseLogRow[]>()
      const sets = perWorkout.get(log.workout_id) ?? []
      sets.push(log)
      perWorkout.set(log.workout_id, sets)
      byExercise.set(log.exercise, perWorkout)
    }
    const suggestions: Record<string, ExerciseSuggestion> = {}
    const repMaxFor = new Map<string, number>()
    for (const session of sessions) {
      for (const exercise of session.details.exercises) repMaxFor.set(exercise.name, exercise.rep_max)
    }
    for (const [exercise, perWorkout] of byExercise) {
      const groups = [...perWorkout.entries()]
        .sort(([a], [b]) =>
          (workoutDate.get(a) ?? '').localeCompare(workoutDate.get(b) ?? ''),
        )
        .map(([, sets]) => sets)
      const lastTwo = groups.slice(-2)
      const lastSets = groups[groups.length - 1] ?? []
      const topLoad = lastSets.reduce<number | null>(
        (acc, s) => (s.load_kg != null && (acc == null || s.load_kg > acc) ? s.load_kg : acc),
        null,
      )
      const ready = readyForIncrease(lastTwo, repMaxFor.get(exercise) ?? 12)
      suggestions[exercise] = { load: topLoad != null ? (ready ? topLoad + 2 : topLoad) : null, ready }
    }

    const recent = workouts.filter((w) => w.date >= shiftDate(today, -2))
    const advisory: { level: Semaforo; text: string } | null = recent.some(
      (w) => w.status === 'red',
    )
      ? {
          level: 'red',
          text: 'Vermelho: sem pernas 48 h. Troca por tronco/core e, se repetir, o bloco replaneia-se.',
        }
      : recent.some((w) => w.status === 'yellow')
        ? {
            level: 'yellow',
            text: 'Amarelo: a próxima sessão de pernas passa a superior ou bike leve.',
          }
        : null

    const todaySessions = sessions.filter((s) => s.date === today && s.status === 'planned')
    const nextSession = sessions.find((s) => s.date > today && s.status === 'planned') ?? null
    const done = sessions.filter((s) => s.status === 'done').length

    return { bikeTarget, suggestions, advisory, todaySessions, nextSession, done }
  }, [data, today])

  async function saveManual() {
    if (!manualType || !minutes) return
    setBusy(true)
    setError(null)
    try {
      await postApi('/api/workout/manual', {
        type: manualType,
        minutes,
        watts: manualType === 'bike' ? watts : null,
      })
      setManualType(null)
      setMinutes(null)
      setWatts(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar a sessão.')
    } finally {
      setBusy(false)
    }
  }

  async function markBikeDone(session: PlannedSession) {
    setBusy(true)
    setError(null)
    try {
      await postApi('/api/workout/manual', {
        type: 'bike',
        minutes: session.details.bike?.minutes ?? 45,
        watts: session.details.bike?.watts ?? null,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao marcar a sessão.')
    } finally {
      setBusy(false)
    }
  }

  async function generateBlock() {
    setGenerating(true)
    setError(null)
    try {
      await postApi('/api/plan/generate', {})
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro a gerar o bloco.')
    } finally {
      setGenerating(false)
    }
  }

  if (!data || !derived) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  const { profile, block, workouts } = data
  const { bikeTarget, suggestions, advisory, todaySessions, nextSession, done } = derived
  const week = block ? Math.min(Math.max(blockWeekOf(block.start_date, today), 1), 4) : 0
  const loggingSession = todaySessions.find((s) => s.id === logging)

  if (loggingSession) {
    return (
      <div className="mx-auto max-w-md space-y-4 pt-2">
        <h2 className="font-semibold">{loggingSession.name ?? 'Sessão de força'}</h2>
        <StrengthLogger
          session={loggingSession}
          suggestions={suggestions}
          onSaved={() => {
            setLogging(null)
            void load()
          }}
          onCancel={() => setLogging(null)}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      {block ? (
        <div className="rounded-2xl border border-edge bg-card px-4 py-3">
          <p className="text-sm font-semibold">
            {block.chapter ? `${block.chapter.title} — ${block.chapter.patron}` : 'Bloco ativo'}
          </p>
          <p className="text-xs text-dim">
            Semana {week} de 4{week === 4 && ' · deload'} · feitas {done} de {data.sessions.length}
          </p>
        </div>
      ) : (
        <button
          disabled={generating}
          onClick={() => void generateBlock()}
          className="w-full rounded-2xl bg-accent py-4 font-semibold text-bg disabled:opacity-50"
        >
          {generating ? 'A gerar o bloco… (pode demorar um pouco)' : 'Gerar bloco de 4 semanas'}
        </button>
      )}

      {advisory && (
        <p
          className={`rounded-xl border bg-card px-4 py-3 text-sm ${
            advisory.level === 'red' ? 'border-warn/50 text-warn' : 'border-accent/50 text-accent'
          }`}
        >
          {advisory.text}
        </p>
      )}

      {todaySessions.map((session) => (
        <div key={session.id} className="space-y-3 rounded-2xl border border-accent/40 bg-card p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-semibold">{session.name ?? TYPE_LABEL[session.type]}</p>
            <p className="text-xs text-dim">hoje · semana {session.week}</p>
          </div>
          {session.type === 'bike' && session.details.bike && (
            <>
              <p className="text-sm">
                <span className="font-semibold text-accent">{session.details.bike.watts} W</span> ·{' '}
                {session.details.bike.minutes} min · cadência ≥ {session.details.bike.cadence_min}
              </p>
              <p className="text-xs text-dim">
                FC média ≤ {profile.bike_hr_avg_cap} · máx ≤ {profile.bike_hr_max_cap}. Regista no
                Strava (entra sozinha) ou marca aqui.
              </p>
              <button
                disabled={busy}
                onClick={() => void markBikeDone(session)}
                className="w-full rounded-xl border border-edge py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
              >
                Marcar feita
              </button>
            </>
          )}
          {session.type === 'strength' && (
            <>
              <ul className="space-y-1 text-sm">
                {session.details.exercises.map((exercise) => (
                  <li key={exercise.name} className="flex justify-between gap-2">
                    <span>{exercise.name}</span>
                    <span className="shrink-0 text-dim">
                      {exercise.sets}×{exercise.rep_min}–{exercise.rep_max}
                      {suggestions[exercise.name]?.ready && (
                        <span className="ml-1 text-ok">+2 kg</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setLogging(session.id)}
                className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-bg"
              >
                Registar cargas
              </button>
            </>
          )}
          {session.details.notes && <p className="text-xs text-dim">{session.details.notes}</p>}
        </div>
      ))}

      {todaySessions.length === 0 && block && (
        <div className="rounded-2xl border border-edge bg-card px-4 py-3 text-sm text-dim">
          {nextSession
            ? `Hoje é descanso. Próxima sessão: ${nextSession.name ?? TYPE_LABEL[nextSession.type]}, ${nextSession.date.split('-').reverse().slice(0, 2).join('/')}.`
            : 'Sem sessões planeadas por fazer neste bloco.'}
        </div>
      )}

      <div className="rounded-2xl border border-edge bg-card px-4 py-3">
        <p className="text-xs text-dim">Próximo alvo de bike ({TARGET_LABEL[bikeTarget.kind]})</p>
        <p className="text-sm font-semibold">
          {bikeTarget.watts} W · {bikeTarget.minutes} min · cadência ≥ {profile.bike_min_cadence}
        </p>
      </div>

      {profile.strava_athlete_id == null && (
        <a
          href="/api/strava/auth"
          className="block rounded-2xl border border-edge bg-card px-4 py-4 text-center font-semibold text-accent"
        >
          Ligar ao Strava
        </a>
      )}

      <div className="space-y-3 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Sessão manual</h2>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TYPE_LABEL) as ManualType[]).map((type) => (
            <button
              key={type}
              onClick={() => setManualType(manualType === type ? null : type)}
              className={`rounded-xl border py-3 text-sm font-semibold ${
                manualType === type ? 'border-accent text-accent' : 'border-edge text-dim'
              }`}
            >
              {TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        {manualType && (
          <div className="grid grid-cols-4 gap-2">
            {[30, 45, 60, 90].map((option) => (
              <button
                key={option}
                onClick={() => setMinutes(minutes === option ? null : option)}
                className={`rounded-xl border py-2 text-sm ${
                  minutes === option ? 'border-accent text-accent' : 'border-edge text-dim'
                }`}
              >
                {option} min
              </button>
            ))}
          </div>
        )}
        {manualType === 'bike' && minutes && (
          <div className="grid grid-cols-3 gap-2">
            {(profile.bike_watts_options ?? [130, 140, 150]).map((option) => (
              <button
                key={option}
                onClick={() => setWatts(watts === option ? null : option)}
                className={`rounded-xl border py-2 text-sm ${
                  watts === option ? 'border-accent text-accent' : 'border-edge text-dim'
                }`}
              >
                {option} W
              </button>
            ))}
          </div>
        )}
        {manualType && minutes && (
          <button
            disabled={busy}
            onClick={() => void saveManual()}
            className="w-full rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
          >
            {busy
              ? 'A guardar…'
              : `Guardar ${TYPE_LABEL[manualType]} · ${minutes} min${
                  manualType === 'bike' && watts ? ` · ${watts} W` : ''
                }`}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-warn">{error}</p>}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-dim">Últimas 2 semanas</h2>
        {workouts.filter((w) => w.date >= shiftDate(today, -13)).length === 0 && (
          <p className="text-sm text-dim">Ainda sem sessões.</p>
        )}
        {workouts
          .filter((w) => w.date >= shiftDate(today, -13))
          .slice()
          .reverse()
          .map((workout) => (
            <div
              key={workout.id}
              className="flex items-center justify-between rounded-xl border border-edge bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    workout.status ? STATUS_DOT[workout.status] : 'bg-edge'
                  }`}
                />
                <div>
                  <p className="text-sm">
                    {TYPE_LABEL[workout.type]}
                    {workout.minutes != null && ` · ${workout.minutes} min`}
                    {workout.watts != null && ` · ${workout.watts} W`}
                  </p>
                  <p className="text-xs text-dim">
                    {workout.date.split('-').reverse().slice(0, 2).join('/')}
                    {workout.avg_hr != null && ` · FC ${workout.avg_hr}`}
                    {workout.planned_session_id != null && ' · do plano'}
                    {` · ${workout.source === 'strava' ? 'Strava' : 'manual'}`}
                  </p>
                </div>
              </div>
              <p className="text-sm font-semibold">{workout.kcal_est ?? 0} kcal</p>
            </div>
          ))}
      </div>
    </div>
  )
}
