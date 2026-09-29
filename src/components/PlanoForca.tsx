import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { localCalendarDate, shiftDate } from '../lib/day'
import { useDataVersion, emitDataChanged } from '../lib/events'
import { useToast } from '../lib/toast'
import KneePicker from '../components/ui/KneePicker'
import BikeHrChart from '../components/BikeHrChart'
import LoadChart from '../components/LoadChart'
import { blockWeekOf, sessionDate } from '../../api/_lib/rules/plan-dates'
import { nextBikeTarget, type BikeTarget } from '../../api/_lib/rules/progressao-bike'
import { readyForIncrease } from '../../api/_lib/rules/progressao-forca'
import type { Semaforo } from '../../api/_lib/rules/semaforo'
import type {
  ExerciseLogRow,
  PlanBlock,
  PlannedSession,
  Profile,
  Workout,
} from '../lib/types'
import StrengthLogger, { type ExerciseSuggestion } from '../components/StrengthLogger'

type ManualType = Workout['type']

const TYPE_LABEL: Record<ManualType, string> = {
  bike: 'Bicicleta',
  strength: 'Ginásio',
  other: 'Outro',
}

const SPORTS = [
  ['caminhada', 'Caminhada'],
  ['eliptica', 'Elíptica'],
  ['natacao', 'Natação'],
  ['outro', 'Outro'],
] as const
type Sport = (typeof SPORTS)[number][0]

const TARGET_LABEL: Record<BikeTarget['kind'], string> = {
  start: 'primeira sessão',
  'progress-time': 'sobe o tempo',
  'validate-next-watts': 'experimenta a potência seguinte',
  hold: 'mantém',
  ease: 'bicicleta leve (joelho)',
}

const STATUS_DOT: Record<NonNullable<Workout['status']>, string> = {
  green: 'bg-ok',
  yellow: 'bg-attn',
  red: 'bg-pain',
}

interface TreinoData {
  profile: Profile
  block: PlanBlock | null
  sessions: (PlannedSession & { date: string })[]
  workouts: Workout[]
  logs: ExerciseLogRow[]
}

export default function Treino() {
  const version = useDataVersion()
  const toast = useToast()
  const [data, setData] = useState<TreinoData | null>(null)
  const [sport, setSport] = useState<Sport>('caminhada')
  const [kneeFor, setKneeFor] = useState<Workout | null>(null)
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
          .from('workouts_active')
          .select('*')
          .gte('date', shiftDate(today, -83))
          .order('date'),
        supabase
          .from('exercise_log')
          .select('workout_id,exercise,set_index,reps,load_kg,rpe,created_at')
          .order('created_at')
          .limit(600),
      ])

    const block = (blocks?.[0] ?? null) as PlanBlock | null
    let sessions: (PlannedSession & { date: string })[] = []
    if (block) {
      const { data: sessionRows } = await supabase.from('planned_sessions').select('*').eq('block_id', block.id)
      sessions = ((sessionRows ?? []) as PlannedSession[])
        .map((s) => ({ ...s, date: sessionDate(block.start_date, s.week, s.day_index) }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    setData({
      profile: profile as Profile,
      block,
      sessions,
      workouts: (workouts ?? []) as Workout[],
      logs: (logs ?? []) as ExerciseLogRow[],
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

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
      const { workout } = await postApi<{ workout: Workout }>('/api/workout/manual', {
        type: manualType,
        minutes,
        watts: manualType === 'bike' ? watts : null,
        ...(manualType === 'other' ? { sport } : {}),
      })
      setManualType(null)
      setMinutes(null)
      setWatts(null)
      emitDataChanged()
      setKneeFor(workout)
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
      const { workout } = await postApi<{ workout: Workout }>('/api/workout/manual', {
        type: 'bike',
        minutes: session.details.bike?.minutes ?? 45,
        watts: session.details.bike?.watts ?? null,
      })
      emitDataChanged()
      setKneeFor(workout)
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

  async function answerKnee(workout: Workout, pain: number) {
    setBusy(true)
    try {
      await postApi('/api/workout/checkin', { workout_id: workout.id, pain_during: pain })
      emitDataChanged()
      setKneeFor(null)
      toast(`${TYPE_LABEL[workout.type]} registada${workout.kcal_est ? ` · +${workout.kcal_est} no plano` : ''}`)
    } catch {
      setError('Não consegui gravar o joelho. Tenta outra vez.')
    } finally {
      setBusy(false)
    }
  }

  async function removeWorkout(workout: Workout) {
    const { error: deleteError } = await supabase
      .from('workouts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', workout.id)
    if (deleteError) {
      toast('Não consegui apagar.')
      return
    }
    emitDataChanged()
    toast('Treino apagado', [
      {
        label: 'Anular',
        run: async () => {
          await supabase.from('workouts').update({ deleted_at: null }).eq('id', workout.id)
          emitDataChanged()
        },
      },
    ])
  }

  if (!data || !derived) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>

  if (kneeFor) {
    return (
      <div className="space-y-4 pt-1">
        <div className="space-y-3 rounded-3xl bg-surface p-5">
          <p className="text-[17px]">
            Como esteve o joelho durante {kneeFor.type === 'bike' ? 'a bicicleta' : kneeFor.type === 'strength' ? 'o ginásio' : 'o treino'}?
          </p>
          <KneePicker busy={busy} onAnswer={(pain) => void answerKnee(kneeFor, pain)} />
          <button onClick={() => setKneeFor(null)} className="text-[15px] text-dim">
            Responder depois (fica no Hoje)
          </button>
        </div>
        {error && <p className="text-[15px] text-pain">{error}</p>}
      </div>
    )
  }

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

  const recent = workouts.filter((w) => w.date >= shiftDate(today, -13)).slice().reverse()
  const chip = (active: boolean) =>
    `min-h-11 rounded-xl text-[15px] ${active ? 'bg-eat text-bg font-semibold' : 'bg-surface2'}`

  return (
    <div className="space-y-4 pt-1">
      <section className="space-y-3 rounded-3xl bg-surface p-5">
        <h2 className="text-[17px] font-semibold">Já fiz</h2>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TYPE_LABEL) as ManualType[]).map((type) => (
            <button key={type} onClick={() => setManualType(manualType === type ? null : type)} className={chip(manualType === type)}>
              {TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        {manualType === 'other' && (
          <div className="grid grid-cols-4 gap-2">
            {SPORTS.map(([id, label]) => (
              <button key={id} onClick={() => setSport(id)} className={`${chip(sport === id)} text-[13px]`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {manualType && (
          <div className="grid grid-cols-4 gap-2">
            {[30, 45, 60, 90].map((option) => (
              <button key={option} onClick={() => setMinutes(minutes === option ? null : option)} className={chip(minutes === option)}>
                {option} min
              </button>
            ))}
          </div>
        )}
        {manualType === 'bike' && minutes && (
          <div className="grid grid-cols-3 gap-2">
            {(profile.bike_watts_options ?? [130, 140, 150]).map((option) => (
              <button key={option} onClick={() => setWatts(watts === option ? null : option)} className={chip(watts === option)}>
                {option} W
              </button>
            ))}
          </div>
        )}
        {manualType && minutes && (
          <button
            disabled={busy}
            onClick={() => void saveManual()}
            className="min-h-14 w-full rounded-2xl bg-eat font-semibold text-bg disabled:opacity-50"
          >
            {busy
              ? 'A guardar…'
              : `Guardar ${TYPE_LABEL[manualType]} · ${minutes} min${manualType === 'bike' && watts ? ` · ${watts} W` : ''}`}
          </button>
        )}
        {!manualType && (
          <p className="text-[13px] text-dim">
            Escolhe o tipo, a duração e (na bicicleta) a potência. A seguir pergunto pelo joelho.
          </p>
        )}
      </section>

      {error && <p className="text-[15px] text-pain">{error}</p>}

      {advisory && (
        <p
          className={`rounded-2xl bg-surface px-4 py-3 text-[15px] ${
            advisory.level === 'red' ? 'text-pain' : 'text-attn'
          }`}
        >
          {advisory.level === 'red'
            ? 'O joelho doeu: 48 h sem pernas. Troca por tronco ou core.'
            : 'O joelho deu sinal: a próxima sessão de pernas passa a tronco ou bicicleta leve.'}
        </p>
      )}

      <div className="rounded-2xl bg-surface px-4 py-3">
        <p className="text-[13px] text-dim">Sugestão seguinte na bicicleta ({TARGET_LABEL[bikeTarget.kind]})</p>
        <p className="text-[17px] font-semibold tabular-nums">
          {bikeTarget.watts} W · {bikeTarget.minutes} min · {profile.bike_min_cadence} rpm ou mais
        </p>
      </div>

      {todaySessions.map((session) => (
        <div key={session.id} className="space-y-3 rounded-2xl bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-semibold">{session.name ?? TYPE_LABEL[session.type]}</p>
            <p className="text-[13px] text-dim">hoje · semana {session.week}</p>
          </div>
          {session.type === 'bike' && session.details.bike && (
            <>
              <p className="text-[15px] tabular-nums">
                <span className="font-semibold text-burn">{session.details.bike.watts} W</span> ·{' '}
                {session.details.bike.minutes} min · {session.details.bike.cadence_min} rpm ou mais
              </p>
              <p className="text-[13px] text-dim">
                Batimentos médios até {profile.bike_hr_avg_cap} · máximos até {profile.bike_hr_max_cap}. Quando
                acabares, marca aqui e diz como ficou o joelho.
              </p>
              <button
                disabled={busy}
                onClick={() => void markBikeDone(session)}
                className="min-h-12 w-full rounded-xl bg-surface2 text-[15px] font-semibold disabled:opacity-50"
              >
                Marcar feita
              </button>
            </>
          )}
          {session.type === 'strength' && (
            <>
              <ul className="space-y-1 text-[15px]">
                {session.details.exercises.map((exercise) => (
                  <li key={exercise.name} className="flex justify-between gap-2">
                    <span>{exercise.name}</span>
                    <span className="shrink-0 text-dim tabular-nums">
                      {exercise.sets}×{exercise.rep_min}–{exercise.rep_max}
                      {suggestions[exercise.name]?.ready && <span className="ml-1 text-ok">+2 kg</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setLogging(session.id)}
                className="min-h-12 w-full rounded-xl bg-eat text-[15px] font-semibold text-bg"
              >
                Registar cargas
              </button>
            </>
          )}
          {session.details.notes && <p className="text-[13px] text-dim">{session.details.notes}</p>}
        </div>
      ))}

      {block ? (
        <div className="rounded-2xl bg-surface px-4 py-3">
          <p className="text-[15px] font-semibold">Plano de 4 semanas</p>
          <p className="text-[13px] text-dim">
            Semana {week} de 4{week === 4 && ' · semana leve'} · feitas {done} de {data.sessions.length}
            {todaySessions.length === 0 &&
              (nextSession
                ? ` · próxima: ${nextSession.name ?? TYPE_LABEL[nextSession.type]}, ${nextSession.date.split('-').reverse().slice(0, 2).join('/')}`
                : ' · sem sessões por fazer')}
          </p>
        </div>
      ) : (
        <button
          disabled={generating}
          onClick={() => void generateBlock()}
          className="min-h-12 w-full rounded-2xl bg-surface2 text-[15px] disabled:opacity-50"
        >
          {generating ? 'A preparar o plano… (pode demorar um pouco)' : 'Gerar plano de ginásio de 4 semanas'}
        </button>
      )}

      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold text-dim">Últimas 2 semanas</h2>
        {recent.length === 0 && <p className="text-[15px] text-dim">Ainda sem treinos.</p>}
        {recent.map((workout) => (
          <div key={workout.id} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${workout.status ? STATUS_DOT[workout.status] : 'bg-line'}`}
              aria-label={workout.status ? `joelho ${workout.status}` : 'joelho sem resposta'}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] tabular-nums">
                {TYPE_LABEL[workout.type]}
                {workout.minutes != null && ` · ${workout.minutes} min`}
                {workout.watts != null && ` · ${workout.watts} W`}
              </p>
              <p className="text-[13px] text-dim tabular-nums">
                {workout.date.split('-').reverse().slice(0, 2).join('/')}
                {workout.avg_hr != null && ` · ${workout.avg_hr} bpm`}
                {workout.planned_session_id != null && ' · do plano'}
              </p>
            </div>
            <p className="shrink-0 text-[15px] text-burn tabular-nums">+{workout.kcal_est ?? 0}</p>
            <button
              onClick={() => void removeWorkout(workout)}
              className="shrink-0 px-1 text-[13px] text-dim"
              aria-label="Apagar treino"
            >
              ✕
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-dim">Progressão</h2>
        <BikeHrChart workouts={workouts} capAvg={profile.bike_hr_avg_cap} />
        <LoadChart logs={data.logs} workoutDates={new Map(workouts.map((w) => [w.id, w.date]))} />
      </section>
    </div>
  )
}
