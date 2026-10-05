import { useState, type ReactElement } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useThemeColors } from '../lib/colors'
import { shiftDate } from '../lib/day'
import { fmtDayShort, fmtInt } from '../lib/format'
import { fmtSleep, sleepLabel } from '../../api/_lib/rules/sono'
import { latestOf, wellnessTrend, type WellnessRow } from '../../api/_lib/rules/plano'

type Range = 30 | 90
type Day = {
  date: string
  steps: number | null
  sleepH: number | null
  sleep_minutes: number | null
  sleep_score: number | null
  sleep_quality: number | null
  rhr: number | null
  hrv: number | null
}

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const thousands = (v: number) => (v === 0 ? '0' : `${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',')} mil`)

// Corpo › Evolução › Do relógio: o último valor de cada coisa (passos de hoje
// no total, a noite, FC em repouso e HRV) e os gráficos dia a dia. Só aparece o
// que o relógio mandou.
export default function BemEstar({ rows, today }: { rows: WellnessRow[]; today: string }) {
  const colors = useThemeColors()
  const [range, setRange] = useState<Range>(30)
  const yesterday = shiftDate(today, -1)
  const when = (date: string, night = false) =>
    date === today ? (night ? 'esta noite' : 'hoje') : date === yesterday ? 'ontem' : dm(date)

  const month = wellnessTrend(rows, today)
  const steps = latestOf(rows, 'steps', today, 1)
  const stepsYesterday = rows.find((r) => r.date === yesterday)?.steps ?? null
  const night = rows
    .filter((r) => r.date <= today && r.date >= shiftDate(today, -2) && (r.sleep_score != null || r.sleep_minutes != null))
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const rhr = latestOf(rows, 'resting_hr', today)
  const hrv = latestOf(rows, 'hrv', today)
  const vsMonth = (now: number, avg: number | null, unit = '') =>
    avg == null ? null : Math.round(now) === avg ? 'igual ao mês' : `${now > avg ? '↑' : '↓'} ${fmtInt(Math.abs(now - avg))}${unit} vs mês`

  const tiles: { label: string; value: string; sub: string | null }[] = []
  if (steps) {
    tiles.push({
      label: `Passos ${when(steps.date)}`,
      value: fmtInt(steps.value),
      sub: steps.date === today && stepsYesterday != null ? `ontem ${fmtInt(stepsYesterday)}` : null,
    })
  }
  if (night) {
    const label = sleepLabel({ sleep_score: night.sleep_score ?? null, sleep_quality: night.sleep_quality ?? null })
    const hours = night.sleep_minutes != null ? fmtSleep(night.sleep_minutes) : null
    tiles.push({
      label: `Sono ${when(night.date, true)}`,
      value: night.sleep_score != null ? String(night.sleep_score) : hours!,
      sub: [night.sleep_score != null ? hours : null, label].filter(Boolean).join(' · ') || null,
    })
  }
  if (rhr) tiles.push({ label: 'FC em repouso', value: `${rhr.value} bpm`, sub: vsMonth(rhr.value, month.rhr28) })
  if (hrv) tiles.push({ label: 'HRV', value: `${Math.round(hrv.value)} ms`, sub: vsMonth(hrv.value, month.hrv28, ' ms') })

  const byDate = new Map(rows.map((r) => [r.date, r]))
  const days: Day[] = Array.from({ length: range }, (_, i) => {
    const date = shiftDate(today, i - range + 1)
    const r = byDate.get(date)
    return {
      date,
      steps: r?.steps ?? null,
      sleepH: r?.sleep_minutes != null ? Math.round((r.sleep_minutes / 60) * 10) / 10 : null,
      sleep_minutes: r?.sleep_minutes ?? null,
      sleep_score: r?.sleep_score ?? null,
      sleep_quality: r?.sleep_quality ?? null,
      rhr: r?.resting_hr ?? null,
      hrv: r?.hrv != null ? Math.round(r.hrv) : null,
    }
  })
  const count = (key: keyof Day) => days.filter((d) => d[key] != null).length
  const fullDays = days.filter((d) => d.date < today && d.steps != null)
  const stepsAvg = fullDays.length ? fullDays.reduce((a, d) => a + d.steps!, 0) / fullDays.length : null
  const sleepDays = days.filter((d) => d.sleep_minutes != null)
  const sleepAvg = sleepDays.length ? sleepDays.reduce((a, d) => a + d.sleep_minutes!, 0) / sleepDays.length : null
  const charts = count('steps') >= 2 || count('sleepH') >= 2 || count('rhr') >= 2 || count('hrv') >= 2

  if (tiles.length === 0 && !charts) return null

  const dense = range === 90
  const axis = { tick: { fill: colors.dim, fontSize: 11 }, axisLine: false, tickLine: false } as const
  const xAxis = <XAxis dataKey="date" tickFormatter={dm} {...axis} minTickGap={28} />
  const color = colors['chart-health']
  const bar = { fill: color, maxBarSize: 24, radius: [4, 4, 0, 0] as [number, number, number, number], isAnimationActive: false }
  const gap = dense ? {} : { stroke: colors.surface, strokeWidth: 2 }
  const line = {
    stroke: color,
    strokeWidth: 2,
    dot: false,
    connectNulls: true,
    isAnimationActive: false,
    activeDot: { r: 5, fill: color, stroke: colors.surface, strokeWidth: 2 },
  }
  // A dica: o dia e as linhas de cada gráfico, na cor do texto.
  const tip = (lines: (d: Day) => (string | null)[]) => (
    <Tooltip
      cursor={{ fill: colors.surface2, stroke: colors.line }}
      content={({ active, payload }) => {
        const d = payload?.[0]?.payload as Day | undefined
        if (!active || !d) return null
        return (
          <div
            className="rounded-xl px-3 py-2 text-[13px] tabular-nums shadow"
            style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.ink }}
          >
            <p style={{ color: colors.dim }}>{d.date === today ? 'Hoje (até agora)' : fmtDayShort(d.date)}</p>
            {lines(d)
              .filter(Boolean)
              .map((l) => (
                <p key={l}>{l}</p>
              ))}
          </div>
        )
      }}
    />
  )
  const card = (title: string, sub: string | null, chart: ReactElement) => (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[15px] font-semibold">{title}</p>
      {sub && <p className="text-[13px] text-dim tabular-nums">{sub}</p>}
      <div className="mt-2 h-36">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
    </div>
  )
  const margin = { top: 8, right: 8, bottom: 0, left: -4 }

  return (
    <div className="space-y-3">
      {tiles.length > 0 && (
        <div className={`grid gap-2 ${tiles.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-line bg-surface p-3">
              <p className="text-[13px] text-dim">{t.label}</p>
              <p className={`num leading-tight font-semibold ${tiles.length === 3 ? 'text-[22px]' : 'text-[26px]'}`}>{t.value}</p>
              {t.sub && <p className="text-[12px] text-dim tabular-nums">{t.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {charts && (
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">Do relógio, dia a dia</p>
          <div className="flex rounded-lg bg-surface2 p-0.5 text-[13px]">
            {([30, 90] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`min-h-8 rounded-md px-3 ${range === r ? 'bg-surface font-semibold' : 'text-dim'}`}
              >
                {r} dias
              </button>
            ))}
          </div>
        </div>
      )}

      {count('steps') >= 2 &&
        card(
          'Passos por dia',
          stepsAvg != null ? `Média: ${fmtInt(stepsAvg)} por dia (sem hoje, que ainda vai a meio)` : null,
          <BarChart data={days} margin={margin}>
            <CartesianGrid stroke={colors.line} vertical={false} />
            {xAxis}
            <YAxis {...axis} allowDecimals={false} tickFormatter={thousands} width={56} />
            {tip((d) => [d.steps != null ? `${fmtInt(d.steps)} passos` : 'sem registo'])}
            <Bar dataKey="steps" {...bar} {...gap}>
              {days.map((d) => (
                <Cell key={d.date} fillOpacity={d.date === today ? 0.45 : 1} />
              ))}
            </Bar>
          </BarChart>,
        )}

      {count('sleepH') >= 2 &&
        card(
          'Horas de sono',
          sleepAvg != null ? `Média: ${fmtSleep(sleepAvg)} por noite` : null,
          <BarChart data={days} margin={margin}>
            <CartesianGrid stroke={colors.line} vertical={false} />
            {xAxis}
            <YAxis {...axis} allowDecimals={false} tickFormatter={(v: number) => `${v} h`} width={56} />
            {tip((d) => [
              d.sleep_minutes != null ? fmtSleep(d.sleep_minutes) : 'sem registo',
              d.sleep_score != null ? `pontuação ${d.sleep_score}` : null,
              sleepLabel(d),
            ])}
            <Bar dataKey="sleepH" {...bar} {...gap} />
          </BarChart>,
        )}

      {count('rhr') >= 2 &&
        card(
          'FC em repouso',
          month.rhr28 != null ? `Média do mês: ${month.rhr28} bpm. Se desce, o coração está mais em forma.` : null,
          <LineChart data={days} margin={margin}>
            <CartesianGrid stroke={colors.line} vertical={false} />
            {xAxis}
            <YAxis {...axis} allowDecimals={false} domain={['dataMin - 2', 'dataMax + 2']} width={56} />
            {tip((d) => [d.rhr != null ? `${d.rhr} bpm` : 'sem registo'])}
            <Line dataKey="rhr" {...line} />
          </LineChart>,
        )}

      {count('hrv') >= 2 &&
        card(
          'HRV durante o sono',
          month.hrv28 != null ? `Média do mês: ${month.hrv28} ms. Mais alta costuma querer dizer mais recuperado.` : null,
          <LineChart data={days} margin={margin}>
            <CartesianGrid stroke={colors.line} vertical={false} />
            {xAxis}
            <YAxis {...axis} allowDecimals={false} domain={['dataMin - 5', 'dataMax + 5']} width={56} />
            {tip((d) => [d.hrv != null ? `${d.hrv} ms` : 'sem registo'])}
            <Line dataKey="hrv" {...line} />
          </LineChart>,
        )}

      {charts && (
        <details className="text-[13px] text-dim">
          <summary className="cursor-pointer">Ver os números do relógio</summary>
          <table className="mt-2 w-full tabular-nums">
            <thead>
              <tr className="text-left">
                <th className="font-normal">Dia</th>
                <th className="text-right font-normal">Passos</th>
                <th className="text-right font-normal">Sono</th>
                <th className="text-right font-normal">FC</th>
                {count('hrv') > 0 && <th className="text-right font-normal">HRV</th>}
              </tr>
            </thead>
            <tbody className="text-ink">
              {days
                .filter((d) => d.steps != null || d.sleep_minutes != null || d.rhr != null || d.hrv != null)
                .reverse()
                .map((d) => (
                  <tr key={d.date}>
                    <td>{d.date === today ? 'hoje' : dm(d.date)}</td>
                    <td className="text-right">{d.steps != null ? fmtInt(d.steps) : '—'}</td>
                    <td className="text-right">{d.sleep_minutes != null ? fmtSleep(d.sleep_minutes) : '—'}</td>
                    <td className="text-right">{d.rhr ?? '—'}</td>
                    {count('hrv') > 0 && <td className="text-right">{d.hrv ?? '—'}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
