import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import {
  Bar as RBar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useReadyProfile } from '../lib/profile'
import { useDataVersion } from '../lib/events'
import { useThemeColors } from '../lib/colors'
import { nutritionalDay, shiftDate } from '../lib/day'
import { fmt1, fmtInt, fmtKcal, fmtRange, weekdayLetter } from '../lib/format'
import { mondayOf, isMaintenanceWeek, maintenanceTarget } from '../../api/_lib/rules/manutencao'
import { storedExerciseKcal } from '../../api/_lib/rules/targets'
import { MIN_COMPLETE_DAYS } from '../../api/_lib/rules/adaptativo'
import { weeklyRate } from '../../api/_lib/rules/weight'
import { belowFloor, weekAverages, type BalanceDay } from '../../api/_lib/rules/balanco'
import type { Meal, Workout } from '../lib/types'

interface WeekData {
  days: BalanceDay[]
  workouts: Workout[]
  rate: number | null
  tdee: number | null
  completeDays: number
  steps: number | null
  sleep: number | null
}

// «Estou a comer menos do que gasto, e o peso confirma?» — uma frase e um gráfico.
export default function Balanco() {
  const profile = useReadyProfile()
  const [, navigate] = useLocation()
  const version = useDataVersion()
  const colors = useThemeColors()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [monday, setMonday] = useState(() => mondayOf(today))
  const [data, setData] = useState<WeekData | null>(null)
  const [details, setDetails] = useState(false)
  const sunday = shiftDate(monday, 6)

  const load = useCallback(async () => {
    const [
      { data: meals },
      { data: workouts },
      { data: dayRows },
      { data: weights },
      { data: tdeeRows },
      { count: completeCount },
      { data: health },
    ] = await Promise.all([
      supabase
        .from('meals_counted')
        .select('date,kcal,protein,carbs,fat')
        .gte('date', monday)
        .lte('date', sunday),
      supabase.from('workouts_active').select('*').gte('date', monday).lte('date', sunday),
      supabase.from('days').select('date,flags').gte('date', monday).lte('date', sunday),
      supabase
        .from('weights')
        .select('date,kg')
        .gte('date', shiftDate(sunday, -40))
        .lte('date', sunday)
        .order('date'),
      supabase
        .from('days')
        .select('tdee_est')
        .lte('date', sunday)
        .not('tdee_est', 'is', null)
        .order('date', { ascending: false })
        .limit(1),
      supabase.from('days').select('date', { count: 'exact', head: true }).eq('is_complete', true),
      supabase.from('health_daily').select('steps,sleep_minutes').gte('date', monday).lte('date', sunday),
    ])
    const latestTdee = tdeeRows?.[0]?.tdee_est != null ? Number(tdeeRows[0].tdee_est) : null
    const workoutRows = (workouts ?? []) as Workout[]
    const flagsByDate = new Map(
      (dayRows ?? []).map((d) => [d.date as string, (d.flags ?? []) as string[]]),
    )
    const days: BalanceDay[] = Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(monday, i)
      const ofDay = ((meals ?? []) as Pick<Meal, 'date' | 'kcal' | 'protein' | 'carbs' | 'fat'>[]).filter(
        (m) => m.date === date,
      )
      const exercise = storedExerciseKcal(
        workoutRows
          .filter((w) => w.date === date)
          .map((w) => ({
            type: w.type,
            minutes: w.minutes,
            watts: w.watts,
            deviceCalories: w.raw?.calories ?? null,
            kcal_est: w.kcal_est,
          })),
      )
      const maintenance =
        profile.maintenance_enabled !== false &&
        profile.maintenance_anchor != null &&
        isMaintenanceWeek(profile.maintenance_anchor, date)
      const sum = (pick: (m: (typeof ofDay)[number]) => number) => ofDay.reduce((a, m) => a + Number(pick(m)), 0)
      return {
        date,
        eaten: sum((m) => m.kcal),
        protein: sum((m) => m.protein),
        carbs: sum((m) => m.carbs),
        fat: sum((m) => m.fat),
        meals: ofDay.length,
        plan: maintenance ? maintenanceTarget(latestTdee) : profile.base_kcal + exercise,
        missingSomething: (flagsByDate.get(date) ?? []).includes('faltou_algo'),
      }
    })
    const healthRows = health ?? []
    const avgOf = (values: (number | null)[]) => {
      const known = values.filter((v): v is number => v != null)
      return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
    }
    setData({
      days,
      workouts: workoutRows,
      rate: weeklyRate(((weights ?? []) as { date: string; kg: number }[]).map((w) => ({ date: w.date, value: Number(w.kg) }))),
      tdee: latestTdee,
      completeDays: completeCount ?? 0,
      steps: avgOf(healthRows.map((h) => h.steps as number | null)),
      sleep: avgOf(healthRows.map((h) => h.sleep_minutes as number | null)),
    })
  }, [monday, sunday, profile])

  useEffect(() => {
    void load()
  }, [load, version])

  const header = (
    <div className="flex items-center justify-between">
      <button onClick={() => setMonday(shiftDate(monday, -7))} className="h-11 w-11 text-xl text-dim" aria-label="Semana anterior">
        ‹
      </button>
      <p className="text-[17px] font-semibold tabular-nums">{fmtRange(monday, sunday)}</p>
      <button
        disabled={shiftDate(monday, 7) > today}
        onClick={() => setMonday(shiftDate(monday, 7))}
        className="h-11 w-11 text-xl text-dim disabled:opacity-30"
        aria-label="Semana seguinte"
      >
        ›
      </button>
    </div>
  )

  if (!data) {
    return (
      <div className="space-y-4 pt-1">
        {header}
        <p className="pt-6 text-center text-[15px] text-dim">A carregar…</p>
      </div>
    )
  }

  const averages = weekAverages(data.days, today)
  const hasAny = data.days.some((d) => d.meals > 0)
  const rate = data.rate
  const weightSentence =
    rate == null
      ? null
      : Math.abs(rate) < 0.05
        ? 'O peso médio está estável.'
        : `O peso médio está a ${rate < 0 ? 'descer' : 'subir'} ${fmt1(Math.abs(rate))} kg por semana.`
  const sessions = data.workouts.length
  const minutes = data.workouts.reduce((a, w) => a + (w.minutes ?? 0), 0)
  const trainingKcal = data.workouts.reduce((a, w) => a + (w.kcal_est ?? 0), 0)
  const missingComplete = Math.max(0, MIN_COMPLETE_DAYS - data.completeDays)
  const chart = data.days.map((d) => ({
    date: d.date,
    label: weekdayLetter(d.date),
    eaten: d.meals > 0 ? Math.round(d.eaten) : null,
    plan: d.plan,
    today: d.date === today,
  }))

  return (
    <div className="space-y-4 pt-1">
      {header}

      {!hasAny ? (
        <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
          Regista alguns dias e aqui aparece a tua semana.
        </p>
      ) : (
        <>
          <section className="space-y-2 rounded-3xl bg-surface p-5">
            {averages ? (
              <p className="text-[20px] leading-snug font-semibold">
                Esta semana comeste em média {fmtKcal(averages.eaten)} por dia; o plano era{' '}
                {fmtKcal(averages.plan)}.
              </p>
            ) : (
              <p className="text-[17px] text-dim">A semana começou agora. A média aparece amanhã.</p>
            )}
            {weightSentence && <p className="text-[17px]">{weightSentence}</p>}
          </section>

          {belowFloor(averages, profile.kcal_floor_week) && (
            <p className="rounded-2xl bg-surface px-4 py-3 text-[15px] text-attn">
              Esta semana comeste menos de {fmtInt(profile.kcal_floor_week)} por dia em média. Come um pouco mais:
              perder devagar protege o músculo e o joelho.
            </p>
          )}

          <section className="space-y-2 rounded-3xl bg-surface p-4">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={colors.line} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: colors.dim, fontSize: 13 }} axisLine={{ stroke: colors.line }} tickLine={false} />
                  <YAxis
                    tick={{ fill: colors.dim, fontSize: 12 }}
                    tickFormatter={(v: number) => fmtInt(v)}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <RBar
                    dataKey="eaten"
                    radius={[6, 6, 0, 0]}
                    onClick={(entry: unknown) => {
                      const date = (entry as { payload?: { date?: string } }).payload?.date
                      if (date) navigate(date === today ? '/hoje' : `/hoje/${date}`)
                    }}
                    cursor="pointer"
                    isAnimationActive={false}
                  >
                    {chart.map((d) => (
                      <Cell key={d.date} fill={colors.eat} fillOpacity={d.today ? 0.45 : 1} />
                    ))}
                  </RBar>
                  <Line
                    dataKey="plan"
                    stroke={colors.dim}
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                    activeDot={false}
                    type="step"
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 text-[13px] text-dim">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-eat" /> o que comeste
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-dim" /> plano
              </span>
            </div>
          </section>

          <button onClick={() => setDetails(!details)} className="text-[15px] text-eat">
            {details ? 'Esconder detalhes' : 'Ver detalhes ›'}
          </button>

          {details && (
            <section className="space-y-3 rounded-3xl bg-surface p-5 text-[15px]">
              {averages && (
                <>
                  <p>
                    <span className="text-protein">Proteína média {fmtInt(averages.protein)} g</span> por dia
                  </p>
                  <p className="text-dim">
                    Hidratos {fmtInt(averages.carbs)} g · Gordura {fmtInt(averages.fat)} g por dia (média)
                  </p>
                </>
              )}
              <p>
                Treino: {sessions} {sessions === 1 ? 'sessão' : 'sessões'} · {fmtInt(minutes)} min
                {trainingKcal > 0 && <span className="text-burn"> · +{fmtKcal(trainingKcal)} no plano</span>}
              </p>
              {data.tdee != null && missingComplete === 0 ? (
                <p>
                  Gasto medido pelo teu peso: cerca de {fmtKcal(data.tdee)} por dia. A previsão inicial dizia{' '}
                  {fmtKcal(profile.expected_tdee)}.
                </p>
              ) : (
                <p className="text-dim">
                  Mais {missingComplete} {missingComplete === 1 ? 'dia completo' : 'dias completos'} e passo a medir o
                  teu gasto pelo peso. Até lá uso uma previsão.
                </p>
              )}
              {data.steps != null && (
                <p className="text-dim">
                  Passos: {fmtInt(data.steps)} por dia
                  {data.sleep != null && ` · Sono: ${fmt1(data.sleep / 60)} h`}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
