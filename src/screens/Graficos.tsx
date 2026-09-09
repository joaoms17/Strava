import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localCalendarDate, shiftDate } from '../lib/day'
import { sessionDate } from '../../api/_lib/rules/plan-dates'
import type {
  ExerciseLogRow,
  PlanBlock,
  PlannedSession,
  Profile,
  WeightRow,
  Workout,
} from '../lib/types'
import WeightChart from '../components/WeightChart'
import BikeHrChart from '../components/BikeHrChart'
import LoadChart from '../components/LoadChart'

interface WeekAdherence {
  week: number
  done: number
  total: number
}

export default function Graficos() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [weights, setWeights] = useState<WeightRow[]>([])
  const [estimatePct, setEstimatePct] = useState<number | null>(null)
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [logs, setLogs] = useState<ExerciseLogRow[]>([])
  const [adherence, setAdherence] = useState<WeekAdherence[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const today = localCalendarDate()
      const [
        { data: profileRow },
        { data: weightRows },
        { data: weekMeals },
        { data: workoutRows },
        { data: logRows },
        { data: blocks },
      ] = await Promise.all([
        supabase.from('profile').select('*').single(),
        supabase.from('weights').select('date,kg').gte('date', shiftDate(today, -55)).order('date'),
        supabase.from('meals').select('is_estimate').gte('date', shiftDate(today, -6)),
        supabase.from('workouts').select('*').gte('date', shiftDate(today, -83)).order('date'),
        supabase
          .from('exercise_log')
          .select('workout_id,exercise,set_index,reps,load_kg,rpe,created_at')
          .order('created_at')
          .limit(600),
        supabase
          .from('plan_blocks')
          .select('*')
          .in('status', ['active', 'completed'])
          .order('created_at', { ascending: false })
          .limit(1),
      ])
      setProfile((profileRow ?? null) as Profile | null)
      setWeights(
        ((weightRows ?? []) as { date: string; kg: number | string }[]).map((w) => ({
          date: w.date,
          kg: Number(w.kg),
        })),
      )
      if (weekMeals && weekMeals.length > 0) {
        const estimated = weekMeals.filter((m) => m.is_estimate).length
        setEstimatePct(Math.round((estimated / weekMeals.length) * 100))
      }
      setWorkouts((workoutRows ?? []) as Workout[])
      setLogs((logRows ?? []) as ExerciseLogRow[])

      const block = (blocks?.[0] ?? null) as PlanBlock | null
      if (block) {
        const { data: sessions } = await supabase
          .from('planned_sessions')
          .select('*')
          .eq('block_id', block.id)
        const rows: WeekAdherence[] = [1, 2, 3, 4].map((week) => {
          const ofWeek = ((sessions ?? []) as PlannedSession[]).filter((s) => s.week === week)
          return {
            week,
            done: ofWeek.filter((s) => s.status === 'done').length,
            total: ofWeek.length,
          }
        })
        // só semanas que já começaram
        setAdherence(
          rows.filter(
            (row) => sessionDate(block.start_date, row.week, 0) <= today && row.total > 0,
          ),
        )
      }
      setLoaded(true)
    }
    void load()
  }, [])

  if (!loaded) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      {weights.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-card p-6 text-center text-sm text-dim">
          <p className="font-display text-lg text-ink">Peso</p>
          <p className="mt-2">Regista o peso no ecrã Hoje para veres a tendência e a projeção.</p>
        </div>
      ) : (
        <WeightChart weights={weights} target={profile?.target_weight_kg ?? 75} />
      )}

      <BikeHrChart workouts={workouts} capAvg={profile?.bike_hr_avg_cap ?? 112} />

      <LoadChart logs={logs} workoutDates={new Map(workouts.map((w) => [w.id, w.date]))} />

      {adherence.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-edge bg-card p-4">
          <h2 className="text-sm font-semibold text-dim">Sessões feitas vs planeadas</h2>
          {adherence.map((row) => (
            <div key={row.week} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-dim">Semana {row.week}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${row.total ? (row.done / row.total) * 100 : 0}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs">
                {row.done}/{row.total}
              </span>
            </div>
          ))}
        </div>
      )}

      {estimatePct != null && (
        <div className="rounded-2xl border border-edge bg-card p-4">
          <p className="text-3xl font-bold">{estimatePct}%</p>
          <p className="mt-1 text-xs text-dim">refeições estimadas nos últimos 7 dias</p>
        </div>
      )}
    </div>
  )
}
