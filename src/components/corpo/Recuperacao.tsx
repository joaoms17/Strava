import { useMemo, type ReactElement } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { shiftDate } from '../../lib/day'
import { fmtDayMonth, fmtDayShort, fmtInt } from '../../lib/format'
import type { CorpoData } from '../../lib/corpo'
import { fmtSleep, sleepLabel } from '../../../api/_lib/rules/sono'
import { cleanWellness } from '../../../api/_lib/rules/plano'
import { mondayOf } from '../../../api/_lib/rules/manutencao'
import { niceScale, weekMeans, type DatedValue, type Period } from '../../../api/_lib/rules/graficos'
import {
  FEW_DATA,
  bestDayMark,
  compareWindows,
  hrvReading,
  periodMean,
  restingHrReading,
  staleReading,
  sleepReading,
  stepsReading,
  vsAverage,
  type Comparison,
  type Mark,
} from '../../../api/_lib/rules/leituras'
import { ChartCard, EmptyChart, Key, Legend, Marks, TICK, TipBox, axisInt, categoryTicks, tooltipBase, useChartColors } from '../charts/kit'

// Mais de 4 meses dia a dia ficava ilegível (3 meses nas barras): no «Tudo»
// longo, a média de cada semana.
const DAILY_MAX = 120
const DAILY_BARS_MAX = 92
const HEIGHT = 150

interface Row {
  date: string
  steps: number | null
  sleep: number | null // minutos
  score: number | null
  quality: number | null
  rhr: number | null
  hrv: number | null
}

type Key = 'steps' | 'sleep' | 'rhr' | 'hrv'

// Corpo › Recuperação: passos, sono, FC em repouso e HRV, cada um com a sua
// frase (os últimos 30 dias contra antes), a média dos últimos 30 dias
// tracejada só por cima desses 30 dias, hoje contra essa média e o melhor dia
// (HRV mais alta, FC mais baixa). Só o que o relógio mandou. Sem os últimos
// 30 dias (o relógio parou), a frase diz a média do período.
export default function Recuperacao({ data, period, from, today }: { data: CorpoData; period: Period; from: string; today: string }) {
  const colors = useChartColors()
  const model = useMemo(() => {
    const clean = cleanWellness(data.health)
    const byDate = new Map(clean.map((r) => [r.date, r]))
    const rows: Row[] = []
    for (let d = from; d <= today; d = shiftDate(d, 1)) {
      const r = byDate.get(d)
      rows.push({
        date: d,
        steps: r?.steps != null && r.steps > 0 ? Number(r.steps) : null,
        sleep: r?.sleep_minutes != null ? Number(r.sleep_minutes) : null,
        score: r?.sleep_score != null ? Number(r.sleep_score) : null,
        quality: r?.sleep_quality != null ? Number(r.sleep_quality) : null,
        rhr: r?.resting_hr != null ? Number(r.resting_hr) : null,
        hrv: r?.hrv != null ? Math.round(Number(r.hrv)) : null,
      })
    }
    const weekly = rows.length > DAILY_MAX
    const weeklyBars = rows.length > DAILY_BARS_MAX
    const series = (key: Key): DatedValue[] =>
      clean
        .map((r) => ({
          date: r.date,
          value: key === 'steps' ? r.steps : key === 'sleep' ? r.sleep_minutes : key === 'rhr' ? r.resting_hr : r.hrv,
        }))
        .filter((r): r is DatedValue => r.value != null && Number(r.value) > 0)
        .map((r) => ({ date: r.date, value: Number(r.value) }))
    const shown = (key: Key) => {
      if (!(key === 'steps' ? weeklyBars : weekly)) return rows.map((r) => ({ date: r.date, value: r[key] }))
      const means = weekMeans(series(key).filter((p) => p.date >= from))
      return means.map((m) => ({ date: m.monday, value: Math.round(m.value) }))
    }
    return { rows, weekly, weeklyBars, series, shown }
  }, [data, from, today])

  const todayRow = model.rows.find((r) => r.date === today)
  const card = (opts: {
    key: Key
    kicker: string
    reading: string
    aside: string | null
    avg: number | null
    avgText: string | null
    color: string
    bars: boolean
    tickFormat: (v: number) => string
    scale: ReturnType<typeof niceScale>
    marks: Mark[]
    tip: (r: Row | { date: string; value: number | null }) => string[]
  }) => {
    const points = model.shown(opts.key)
    const wk = opts.key === 'steps' ? model.weeklyBars : model.weekly
    const known = points.filter((p) => p.value != null)
    if (model.series(opts.key).length === 0) return null
    const axis = categoryTicks(points.map((p) => p.date))
    let chart: ReactElement
    const axisX = (
      <XAxis
        dataKey="date"
        ticks={axis.ticks}
        interval={0}
        tickFormatter={axis.format}
        tick={TICK(colors)}
        axisLine={{ stroke: colors.grid }}
        tickLine={false}
      />
    )
    const axisY = <YAxis domain={opts.scale.domain} ticks={opts.scale.ticks} tickFormatter={opts.tickFormat} tick={TICK(colors)} axisLine={false} tickLine={false} width={44} />
    const tooltip = (
      <Tooltip
        {...tooltipBase(colors)}
        content={({ active, payload }) => {
          const p = payload?.[0]?.payload as { date: string; value: number | null } | undefined
          if (!active || !p) return null
          const row = wk ? p : (model.rows.find((r) => r.date === p.date) ?? p)
          const title = wk ? `Semana de ${fmtDayMonth(p.date)}` : p.date === today ? 'Hoje (até agora)' : fmtDayShort(p.date)
          return <TipBox title={title} rows={opts.tip(row).map((v) => ({ label: '', value: v }))} colors={colors} />
        }}
      />
    )
    // A média dos últimos 30 dias, desenhada só nesses 30 dias (não parece a do período).
    const cats = points.map((p) => p.date)
    const avgFrom = cats.find((d) => d >= (wk ? mondayOf(shiftDate(today, -29)) : shiftDate(today, -29))) ?? cats[0]
    const avgTo = cats[cats.length - 1]
    const ref = opts.avg != null && avgFrom != null && avgTo != null && (
      <ReferenceLine
        segment={[
          { x: avgFrom, y: opts.avg },
          { x: avgTo, y: opts.avg },
        ]}
        stroke={colors.dim}
        strokeDasharray="3 4"
        strokeWidth={1.5}
        ifOverflow="extendDomain"
      />
    )
    const margin = { top: 20, right: 6, bottom: 0, left: 0 }
    if (opts.bars) {
      chart = (
        <BarChart data={points} margin={margin} barCategoryGap={points.length > 40 ? 1 : '18%'}>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          {axisX}
          {axisY}
          {tooltip}
          <Bar dataKey="value" fill={opts.color} maxBarSize={24} radius={points.length > 40 ? 0 : [3, 3, 0, 0]} isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.date} fillOpacity={p.date === today || (wk && p.date === mondayOf(today)) ? 0.45 : 1} />
            ))}
          </Bar>
          {ref}
        </BarChart>
      )
    } else {
      chart = (
        <LineChart data={points} margin={margin}>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          {axisX}
          {axisY}
          {tooltip}
          {ref}
          <Line dataKey="value" stroke={opts.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 5, fill: opts.color, stroke: colors.surface, strokeWidth: 2 }} />
          <Marks marks={opts.marks} color={opts.color} colors={colors} x={(d) => d} avoid={known.filter((_, i) => i % 2 === 0).map((p) => ({ date: p.date, value: p.value! }))} />
        </LineChart>
      )
    }
    return (
      <ChartCard
        key={opts.key}
        kicker={opts.kicker}
        reading={known.length < 2 ? 'Ainda poucos dias do relógio neste período' : opts.reading}
        aside={opts.aside && <p className="text-[14px] text-dim tabular-nums">{opts.aside}</p>}
        legend={
          opts.avg != null &&
          known.length >= 2 && (
            <Legend>
              <Key shape={opts.bars ? 'bar' : 'line'} color={opts.color} label={wk ? 'média da semana' : 'cada dia'} />
              <Key shape="dash" color={colors.dim} label={opts.avgText ?? 'média'} />
            </Legend>
          )
        }
        note={wk ? `Cada ${opts.bars ? 'barra' : 'ponto'} é a média de uma semana.` : undefined}
      >
        {known.length < 2 ? (
          <EmptyChart text={FEW_DATA} height={HEIGHT} />
        ) : (
          <div style={{ height: HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%">
              {chart}
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
    )
  }

  const inWindow = (key: Key) => model.series(key).filter((p) => p.date >= from)
  const maxOf = (key: Key) => Math.max(0, ...inWindow(key).map((p) => p.value))
  const minOf = (key: Key) => Math.min(...inWindow(key).map((p) => p.value))
  const cmp = (key: Key, excludeToday = false) => compareWindows(model.series(key), today, period, from, { excludeToday })
  // A frase de cada um: a comparação; sem os últimos 30 dias, a média do
  // período (com 7 dias ou mais); só depois «poucos dados».
  const say = (key: Key, c: Comparison | null, read: (c: Comparison | null) => string) => {
    if (c) return read(c)
    const mean = periodMean(inWindow(key), from, today)
    return mean != null ? staleReading(key, mean) : FEW_DATA
  }

  const steps = cmp('steps', true)
  const sleep = cmp('sleep')
  const rhr = cmp('rhr')
  const hrv = cmp('hrv')
  const daily = !model.weekly
  const rhrPts = inWindow('rhr')
  const hrvPts = inWindow('hrv')

  const cards = [
    card({
      key: 'steps',
      kicker: 'Passos',
      reading: say('steps', steps, stepsReading),
      aside: todayRow?.steps != null ? `Hoje: ${fmtInt(todayRow.steps)} até agora (o dia ainda vai a meio).` : null,
      avg: steps?.now ?? null,
      avgText: steps ? `média dos últimos 30 dias (${fmtInt(Math.round(steps.now / 100) * 100)})` : null,
      color: colors.health,
      bars: true,
      tickFormat: axisInt,
      scale: niceScale(0, maxOf('steps'), 4),
      marks: [],
      tip: (r) => ['steps' in r ? (r.steps != null ? `${fmtInt(r.steps)} passos` : 'sem registo') : r.value != null ? `${fmtInt(r.value)} passos (média)` : 'sem registo'],
    }),
    card({
      key: 'sleep',
      kicker: 'Horas de sono',
      reading: say('sleep', sleep, sleepReading),
      aside: todayRow?.sleep != null && sleep ? `Esta noite: ${fmtSleep(todayRow.sleep)}, ${vsAverage(todayRow.sleep, Math.round(sleep.now), 'min', 10)}.` : null,
      avg: sleep?.now ?? null,
      avgText: sleep ? `média dos últimos 30 dias (${fmtSleep(Math.round(sleep.now))})` : null,
      color: colors.health,
      bars: false,
      tickFormat: (v) => `${Math.round(v / 60)} h`,
      scale: { step: 60, ...hourTicks(minOf('sleep'), maxOf('sleep')) },
      marks: [],
      tip: (r) =>
        'sleep' in r
          ? [r.sleep != null ? fmtSleep(r.sleep) : 'sem registo', r.score != null ? `pontuação ${r.score}` : '', sleepLabel({ sleep_score: r.score, sleep_quality: r.quality }) ?? ''].filter(Boolean)
          : [r.value != null ? `${fmtSleep(r.value)} (média)` : 'sem registo'],
    }),
    card({
      key: 'rhr',
      kicker: 'FC em repouso',
      reading: say('rhr', rhr, restingHrReading),
      aside: `${todayRow?.rhr != null && rhr ? `Hoje: ${todayRow.rhr} bpm, ${vsAverage(todayRow.rhr, rhr.now, 'bpm', 1)}. ` : ''}Se desce, o coração está mais em forma.`,
      avg: rhr?.now ?? null,
      avgText: rhr ? `média dos últimos 30 dias (${Math.round(rhr.now)} bpm)` : null,
      color: colors.health,
      bars: false,
      tickFormat: (v) => String(v),
      scale: niceScale(minOf('rhr') - 2, maxOf('rhr') + 2, 4, 8),
      marks: daily ? [bestDayMark(rhrPts, 'min', 'mais baixa', 'bpm')].filter((m): m is Mark => m != null) : [],
      tip: (r) => ['rhr' in r ? (r.rhr != null ? `${r.rhr} bpm` : 'sem registo') : r.value != null ? `${r.value} bpm (média)` : 'sem registo'],
    }),
    card({
      key: 'hrv',
      kicker: 'HRV durante o sono',
      reading: say('hrv', hrv, hrvReading),
      aside: `${todayRow?.hrv != null && hrv ? `Hoje: ${todayRow.hrv} ms, ${vsAverage(todayRow.hrv, hrv.now, 'ms', 2)}. ` : ''}Mais alta costuma querer dizer mais recuperado.`,
      avg: hrv?.now ?? null,
      avgText: hrv ? `média dos últimos 30 dias (${Math.round(hrv.now)} ms)` : null,
      color: colors.health,
      bars: false,
      tickFormat: (v) => String(v),
      scale: niceScale(minOf('hrv') - 2, maxOf('hrv') + 2, 4, 10),
      marks: daily ? [bestDayMark(hrvPts, 'max', 'mais alta', 'ms')].filter((m): m is Mark => m != null) : [],
      tip: (r) => ['hrv' in r ? (r.hrv != null ? `${r.hrv} ms` : 'sem registo') : r.value != null ? `${r.value} ms (média)` : 'sem registo'],
    }),
  ].filter(Boolean)

  if (cards.length === 0) return null
  const tableRows = model.rows.filter((d) => d.steps != null || d.sleep != null || d.rhr != null || d.hrv != null).reverse()
  const hasHrv = model.rows.some((r) => r.hrv != null)
  return (
    <div className="space-y-3">
      {cards}
      <details className="text-[13px] text-dim">
        <summary className="cursor-pointer py-1">Ver os números do relógio</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="font-normal">Dia</th>
              <th className="text-right font-normal">Passos</th>
              <th className="text-right font-normal">Sono</th>
              <th className="text-right font-normal">FC</th>
              {hasHrv && <th className="text-right font-normal">HRV</th>}
            </tr>
          </thead>
          <tbody className="text-ink">
            {tableRows.map((d) => (
              <tr key={d.date}>
                <td>{d.date === today ? 'hoje' : fmtDayMonth(d.date)}</td>
                <td className="text-right">{d.steps != null ? fmtInt(d.steps) : '—'}</td>
                <td className="text-right">{d.sleep != null ? fmtSleep(d.sleep) : '—'}</td>
                <td className="text-right">{d.rhr ?? '—'}</td>
                {hasHrv && <td className="text-right">{d.hrv ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

// O eixo do sono em horas certas (de hora a hora, ou de 2 em 2), em minutos.
function hourTicks(minMinutes: number, maxMinutes: number): { domain: [number, number]; ticks: number[] } {
  const lo = Math.floor(Math.max(0, minMinutes - 20) / 60) * 60
  const hi = Math.ceil((maxMinutes + 20) / 60) * 60
  const step = (hi - lo) / 60 > 4 ? 120 : 60
  const ticks: number[] = []
  for (let m = lo; m <= hi; m += step) ticks.push(m)
  return { domain: [lo, ticks[ticks.length - 1]! < hi ? ticks[ticks.length - 1]! + step : hi], ticks }
}
