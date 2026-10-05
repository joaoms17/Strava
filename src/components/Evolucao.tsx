import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { useThemeColors } from '../lib/colors'
import { useReadyProfile } from '../lib/profile'
import { nutritionalDay, shiftDate } from '../lib/day'
import { fmtInt } from '../lib/format'
import {
  efficiencySeries,
  fitnessSeries,
  lastMondays,
  weeklyStats,
  wellnessTrend,
  type WellnessRow,
} from '../../api/_lib/rules/plano'
import type { Workout } from '../lib/types'

const WEEKS = 12
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

// Treino › Evolução: minutos por semana (bicicleta e ginásio), watts por
// batimento na bicicleta, a forma (carga dos últimos 42 dias) e o bem-estar do
// relógio (HRV, FC em repouso, sono e passos, 7 dias contra o mês).
export default function Evolucao({ workouts }: { workouts: Workout[] }) {
  const colors = useThemeColors()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [health, setHealth] = useState<WellnessRow[]>([])

  useEffect(() => {
    let alive = true
    void supabase
      .from('health_daily')
      .select('date,hrv,resting_hr,sleep_score,sleep_quality,sleep_minutes,steps')
      .gte('date', shiftDate(today, -28))
      .lte('date', today)
      .then(({ data }) => {
        if (alive) setHealth((data ?? []) as WellnessRow[])
      })
    return () => {
      alive = false
    }
  }, [today])

  const weeks = useMemo(() => {
    const stats = weeklyStats(workouts, lastMondays(today, WEEKS))
    return stats.map((w) => ({ label: dm(w.start), bike: w.bike.minutes, gym: w.gym.minutes, sessions: w.bike.sessions + w.gym.sessions }))
  }, [workouts, today])
  const efficiency = useMemo(() => efficiencySeries(workouts).slice(-20), [workouts])
  const form = useMemo(() => fitnessSeries(workouts, shiftDate(today, -7 * WEEKS + 1), today), [workouts, today])
  const trend = wellnessTrend(health, today)
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

  const delta = (now: number | null, month: number | null, unit: string) => {
    if (now == null || month == null || now === month) return month != null ? `igual ao mês` : null
    return `${now > month ? '↑' : '↓'} ${fmtInt(Math.abs(now - month))}${unit} vs mês`
  }
  const tiles: { label: string; value: string | null; sub: string | null }[] = [
    { label: 'HRV (7 dias)', value: trend.hrv7 != null ? `${trend.hrv7} ms` : null, sub: delta(trend.hrv7, trend.hrv28, ' ms') },
    {
      label: 'FC em repouso',
      value: trend.rhr7 != null ? `${trend.rhr7} bpm` : null,
      sub: delta(trend.rhr7, trend.rhr28, ''),
    },
    {
      label: 'Sono',
      value: trend.sleepScore7 != null ? `${trend.sleepScore7}` : trend.sleepMinutes7 != null ? `${Math.floor(trend.sleepMinutes7 / 60)} h ${trend.sleepMinutes7 % 60}` : null,
      sub:
        trend.sleepQuality7 != null
          ? `qualidade ${['', 'ótima', 'boa', 'razoável', 'fraca'][Math.round(trend.sleepQuality7)] ?? '—'}`
          : delta(trend.sleepScore7, trend.sleepScore28, ''),
    },
    { label: 'Passos (7 dias)', value: trend.steps7 != null ? fmtInt(trend.steps7) : null, sub: delta(trend.steps7, trend.steps28, '') },
  ]
  const hasTiles = tiles.some((t) => t.value != null)

  if (!hasWeeks && !hasTiles) return null

  return (
    <section className="space-y-3" aria-label="Evolução">
      <p className="label">Evolução</p>

      {hasTiles && (
        <div className="grid grid-cols-2 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-line bg-surface p-3">
              <p className="text-[13px] text-dim">{t.label}</p>
              <p className="num text-[26px] leading-tight font-semibold">{t.value ?? '—'}</p>
              {t.sub && t.value && <p className="text-[12px] text-dim tabular-nums">{t.sub}</p>}
            </div>
          ))}
        </div>
      )}

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

      {efficiency.length >= 2 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[15px] font-semibold">Watts por batimento na bicicleta</p>
          <p className="text-[13px] text-dim">Se sobe, fazes a mesma potência com menos esforço do coração.</p>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={efficiency} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid stroke={colors.line} vertical={false} />
                <XAxis dataKey="date" tickFormatter={dm} {...axis} minTickGap={32} />
                <YAxis {...axis} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(2).replace('.', ',')} />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(label) => dm(String(label))}
                  formatter={(value) => [`${Number(value).toFixed(2).replace('.', ',')} W/bpm`, 'Eficiência']}
                />
                <Line
                  isAnimationActive={false}
                  dataKey="value"
                  stroke={colors['chart-bike']}
                  strokeWidth={2}
                  dot={{ r: 4, fill: colors['chart-bike'], stroke: colors.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6, stroke: colors.surface, strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
