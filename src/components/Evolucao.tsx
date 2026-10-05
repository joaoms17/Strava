import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { useThemeColors } from '../lib/colors'
import { useDataVersion } from '../lib/events'
import { useReadyProfile } from '../lib/profile'
import BemEstar from './BemEstar'
import EvolucaoIA from './EvolucaoIA'
import { nutritionalDay, shiftDate } from '../lib/day'
import {
  cleanWellness,
  fitnessSeries,
  lastMondays,
  weeklyStats,
  type PlanWorkout,
  type WellnessRow,
} from '../../api/_lib/rules/plano'

const WEEKS = 12
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

// Corpo › Evolução: a análise da IA de tudo, o relógio dia a dia (passos,
// sono, FC em repouso e HRV), minutos de treino por semana (bicicleta e
// ginásio) e a forma (carga de 42 dias). A eficiência na bicicleta está no
// Treino.
export default function Evolucao() {
  const colors = useThemeColors()
  const profile = useReadyProfile()
  const version = useDataVersion()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [health, setHealth] = useState<WellnessRow[]>([])
  const [workouts, setWorkouts] = useState<PlanWorkout[]>([])

  useEffect(() => {
    let alive = true
    void Promise.all([
      supabase
        .from('health_daily')
        .select('date,hrv,resting_hr,sleep_score,sleep_quality,sleep_minutes,steps')
        .gte('date', shiftDate(today, -90))
        .lte('date', today),
      supabase
        .from('workouts_active')
        .select('id,date,started_at,type,sport,minutes,moving_s,elapsed_s,distance_km,watts,np_w,avg_hr,max_hr,training_load')
        .gte('date', shiftDate(today, -7 * WEEKS - 42))
        .lte('date', today)
        .order('date'),
    ]).then(([{ data: h }, { data: w }]) => {
      if (!alive) return
      setHealth(cleanWellness((h ?? []) as WellnessRow[]))
      setWorkouts((w ?? []) as PlanWorkout[])
    })
    return () => {
      alive = false
    }
  }, [today, version])

  const weeks = useMemo(() => {
    const stats = weeklyStats(workouts, lastMondays(today, WEEKS))
    return stats.map((w) => ({ label: dm(w.start), bike: w.bike.minutes, gym: w.gym.minutes, sessions: w.bike.sessions + w.gym.sessions }))
  }, [workouts, today])
  // A forma começa 6 semanas antes, para não arrancar do zero no gráfico.
  const form = useMemo(
    () => fitnessSeries(workouts, shiftDate(today, -7 * WEEKS - 41), today).slice(-7 * WEEKS),
    [workouts, today],
  )
  const hasWeeks = weeks.some((w) => w.bike + w.gym > 0)
  const hasForm = form.some((p) => p.ctl > 0)

  const axis = { tick: { fill: colors.dim, fontSize: 11 }, axisLine: false, tickLine: false } as const
  const tooltipStyle = {
    contentStyle: {
      background: colors.surface,
      border: `1px solid ${colors.line}`,
      borderRadius: 12,
      color: colors.ink,
      fontSize: 12,
    },
    // O texto da dica fica na cor do texto; a cor é só das marcas.
    itemStyle: { color: colors.ink },
    separator: ': ',
    labelStyle: { color: colors.dim },
    cursor: { fill: colors.surface2, stroke: colors.line },
  }

  return (
    <section className="space-y-3" aria-label="Evolução">
      <p className="label">Evolução</p>

      <EvolucaoIA today={today} />

      <BemEstar rows={health} today={today} />

      {hasWeeks && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[15px] font-semibold">Minutos de treino por semana</p>
          <div className="mt-1 flex gap-4 text-[13px] text-dim">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors['chart-bike'] }} /> Bicicleta
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors['chart-gym'] }} /> Ginásio
            </span>
          </div>
          <div className="mt-2 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeks} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid stroke={colors.line} vertical={false} />
                <XAxis dataKey="label" {...axis} minTickGap={16} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, name) => [`${value} min`, name === 'bike' ? 'Bicicleta' : 'Ginásio']}
                  labelFormatter={(label) => `Semana de ${label}`}
                />
                <Bar isAnimationActive={false} dataKey="bike" stackId="t" fill={colors['chart-bike']} maxBarSize={24} stroke={colors.surface} strokeWidth={2} />
                <Bar
                  isAnimationActive={false}
                  dataKey="gym"
                  stackId="t"
                  fill={colors['chart-gym']}
                  maxBarSize={24}
                  stroke={colors.surface}
                  strokeWidth={2}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-2 text-[13px] text-dim">
            <summary className="cursor-pointer">Ver os números</summary>
            <table className="mt-2 w-full tabular-nums">
              <thead>
                <tr className="text-left">
                  <th className="font-normal">Semana</th>
                  <th className="text-right font-normal">Bicicleta</th>
                  <th className="text-right font-normal">Ginásio</th>
                  <th className="text-right font-normal">Sessões</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                {weeks
                  .slice()
                  .reverse()
                  .map((w) => (
                    <tr key={w.label}>
                      <td>{w.label}</td>
                      <td className="text-right">{w.bike} min</td>
                      <td className="text-right">{w.gym} min</td>
                      <td className="text-right">{w.sessions}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </div>
      )}

      {hasForm && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[15px] font-semibold">Forma (carga dos últimos 42 dias)</p>
          <p className="text-[13px] text-dim">
            Sobe com o treino feito com regularidade; hoje {form[form.length - 1]!.ctl.toFixed(0)}, há 4 semanas{' '}
            {(form[form.length - 29] ?? form[0]!).ctl.toFixed(0)}.
          </p>
          <div className="mt-2 h-36">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={form} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid stroke={colors.line} vertical={false} />
                <XAxis dataKey="date" tickFormatter={dm} {...axis} minTickGap={40} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(label) => dm(String(label))}
                  formatter={(value, name) => [Number(value).toFixed(0), name === 'ctl' ? 'Forma' : String(name)]}
                />
                <Line isAnimationActive={false} dataKey="ctl" stroke={colors['chart-bike']} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  )
}
