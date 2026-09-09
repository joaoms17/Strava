import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localCalendarDate, shiftDate } from '../lib/day'
import { sessionDate } from '../../api/_lib/rules/plan-dates'
import { paceKgPerWeek, shouldAdjustBase } from '../../api/_lib/rules/adaptativo'
import type {
  ExerciseLogRow,
  PlanBlock,
  PlannedSession,
  Profile,
  WeeklyReview,
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
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [tdee, setTdee] = useState<number | null>(null)
  const [kcalMean14, setKcalMean14] = useState<number | null>(null)
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
      const [{ data: reviews }, { data: completeDays }] = await Promise.all([
        supabase
          .from('weekly_reviews')
          .select('week_start,text')
          .order('week_start', { ascending: false })
          .limit(1),
        supabase
          .from('days')
          .select('kcal_in,tdee_est')
          .eq('is_complete', true)
          .order('date', { ascending: false })
          .limit(14),
      ])
      setReview((reviews?.[0] ?? null) as WeeklyReview | null)
      const latestWithTdee = (completeDays ?? []).find((d) => d.tdee_est != null)
      setTdee(latestWithTdee?.tdee_est != null ? Number(latestWithTdee.tdee_est) : null)
      if (completeDays?.length) {
        setKcalMean14(
          completeDays.reduce((acc, d) => acc + Number(d.kcal_in), 0) / completeDays.length,
        )
      }
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

  const expected = profile?.expected_tdee ?? 2200
  const paceReal = tdee != null && kcalMean14 != null ? paceKgPerWeek(kcalMean14, tdee) : null
  const pacePrevisto = kcalMean14 != null ? paceKgPerWeek(kcalMean14, expected) : null
  const fmtPace = (pace: number) =>
    `${pace > 0 ? '+' : ''}${pace.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} kg/sem`

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      {review && (
        <div className="space-y-2 rounded-2xl border border-accent/40 bg-card p-4">
          <h2 className="text-xs text-dim">
            O narrador — semana de {review.week_start.split('-').reverse().slice(0, 2).join('/')}
          </h2>
          <p className="whitespace-pre-line font-display text-sm leading-relaxed">{review.text}</p>
        </div>
      )}

      {tdee != null && (
        <div className="space-y-1 rounded-2xl border border-edge bg-card p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-dim">Gasto adaptativo</h2>
            <p className="text-lg font-bold">{Math.round(tdee)} kcal</p>
          </div>
          <p className="text-xs text-dim">
            previsto: {expected} kcal
            {paceReal != null && pacePrevisto != null && (
              <> · ritmo real {fmtPace(paceReal)} vs previsto {fmtPace(pacePrevisto)}</>
            )}
          </p>
          {shouldAdjustBase(tdee, expected) && (
            <p className="text-xs text-accent">
              O gasto real difere do previsto em mais de 250 kcal — considera ajustar o base_kcal
              nas Definições (M6) ou no Supabase.
            </p>
          )}
        </div>
      )}

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
