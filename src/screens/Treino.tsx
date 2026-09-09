import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { localCalendarDate, shiftDate } from '../lib/day'
import type { Profile, Workout } from '../lib/types'

type ManualType = Workout['type']

const TYPE_LABEL: Record<ManualType, string> = {
  bike: 'Bike',
  strength: 'Força',
  other: 'Outro',
}

const STATUS_DOT: Record<NonNullable<Workout['status']>, string> = {
  green: 'bg-ok',
  yellow: 'bg-accent',
  red: 'bg-warn',
}

export default function Treino() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [manualType, setManualType] = useState<ManualType | null>(null)
  const [minutes, setMinutes] = useState<number | null>(null)
  const [watts, setWatts] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [{ data: profileRow }, { data: workoutRows }] = await Promise.all([
      supabase.from('profile').select('*').single(),
      supabase
        .from('workouts')
        .select('*')
        .gte('date', shiftDate(localCalendarDate(), -13))
        .order('date', { ascending: false }),
    ])
    setProfile((profileRow ?? null) as Profile | null)
    setWorkouts((workoutRows ?? []) as Workout[])
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  if (!loaded) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  const wattsOptions = profile?.bike_watts_options ?? [130, 140, 150]

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      {profile?.strava_athlete_id ? (
        <p className="rounded-2xl border border-edge bg-card px-4 py-3 text-sm text-dim">
          Strava ligado ✓ — as atividades entram sozinhas (webhook + reconciliação diária).
        </p>
      ) : (
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
            {wattsOptions.map((option) => (
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

        {error && <p className="text-sm text-warn">{error}</p>}

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

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-dim">Últimas 2 semanas</h2>
        {workouts.length === 0 && (
          <p className="text-sm text-dim">
            Ainda sem sessões. Liga o Strava ou regista uma sessão manual.
          </p>
        )}
        {workouts.map((workout) => (
          <div
            key={workout.id}
            className="flex items-center justify-between rounded-xl border border-edge bg-card px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  workout.status ? STATUS_DOT[workout.status] : 'bg-edge'
                }`}
                title={workout.status ?? 'sem check-in'}
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
                  {workout.cadence != null && ` · ${workout.cadence} rpm`}
                  {` · ${workout.source === 'strava' ? 'Strava' : 'manual'}`}
                </p>
              </div>
            </div>
            <p className="text-sm font-semibold">{workout.kcal_est ?? 0} kcal</p>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-dim">
        O plano do bloco e o capítulo chegam no M4; o check-in de dor aparece no ecrã Hoje.
      </p>
    </div>
  )
}
