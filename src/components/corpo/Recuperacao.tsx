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
import { ChartCard, EmptyChart, Key, Legend, Marks, TICK, TipBox, WEEK_AXIS_HEIGHT, axisInt, categoryTicks, tooltipBase, useChartColors, weekTick } from '../charts/kit'

// Mais de 4 meses dia a dia ficava ilegível (3 meses nas barras): no «Tudo»
// longo, a média de cada semana.
const DAILY_MAX = 120
const DAILY_BARS_MAX = 92
const HEIGHT = 150
// B13: um buraco de até 2 dias (ou 1 semana, nas médias) liga-se; mais do que
// isso a linha parte, para duas semanas sem relógio não parecerem uma descida.
const BRIDGE_DAYS = 2
const BRIDGE_WEEKS = 1

// A linha desenhada: os valores, com os buracos curtos ligados e os longos
// em branco. Um ponto sozinho entre dois buracos longos fica com um ponto.
function withLine(points: { date: string; value: number | null }[], maxGap: number) {
  const out = points.map((p) => ({ ...p, line: p.value, lone: false }))
  let prev = -1
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.value == null) continue
    if (prev >= 0 && i - prev - 1 > 0 && i - prev - 1 <= maxGap) {
      const a = out[prev]!.value!
      const b = out[i]!.value!
      for (let j = prev + 1; j < i; j++) out[j]!.line = a + ((b - a) * (j - prev)) / (i - prev)
    }
    prev = i
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.value == null) continue
    out[i]!.lone = (i === 0 || out[i - 1]!.line == null) && (i === out.length - 1 || out[i + 1]!.line == null)
  }
  return out
}

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
// No 1S (decisão 307): os 7 dias, cada um com o dia da semana; passos e sono
// em barras (do zero), FC e HRV em pontos com o valor (barras do zero
// escondiam 52 contra 55 bpm); a média é a da semana e compara-se com a
// semana anterior.
export default function Recuperacao({ data, period, from, today }: { data: CorpoData; period: Period; from: string; today: string }) {
  const colors = useChartColors()
  const week = period === '1S'
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
    const wk = opts.key === 'steps' ? model.weeklyBars : model.weekly
    const points = withLine(model.shown(opts.key), wk ? BRIDGE_WEEKS : BRIDGE_DAYS)
    const known = points.filter((p) => p.value != null)
    if (model.series(opts.key).length === 0) return null
    const axis = categoryTicks(points.map((p) => p.date))
    let chart: ReactElement
    const axisX = week ? (
      <XAxis
        dataKey="date"
        interval={0}
        tick={weekTick(colors, today)}
        height={WEEK_AXIS_HEIGHT}
        // Nas linhas, o primeiro e o último dia não ficam colados à borda.
        padding={opts.bars ? undefined : { left: 18, right: 18 }}
        axisLine={{ stroke: colors.grid }}
        tickLine={false}
      />
    ) : (
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
          <Bar dataKey="value" fill={opts.color} maxBarSize={week ? 28 : 24} radius={points.length > 40 ? 0 : [3, 3, 0, 0]} isAnimationActive={false}>
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
          <Line
            dataKey={week ? 'value' : 'line'}
            stroke={opts.color}
            strokeWidth={2}
            dot={
              week
                ? { r: 4.5, fill: opts.color, stroke: colors.surface, strokeWidth: 2 }
                : (props: { cx?: number; cy?: number; index?: number; payload?: { lone: boolean } }) =>
                    props.payload?.lone && props.cx != null && props.cy != null ? (
                      <circle key={props.index} cx={props.cx} cy={props.cy} r={2.5} fill={opts.color} />
                    ) : (
                      <g key={props.index} />
                    )
            }
            connectNulls={week}
            isAnimationActive={false}
            activeDot={{ r: 5, fill: opts.color, stroke: colors.surface, strokeWidth: 2 }}
          />
          {week ? (
            <Marks marks={opts.marks} color={opts.color} colors={colors} x={(d) => d} dots={false} pointRoom={6} avoid={known.map((p) => ({ date: p.date, value: p.value! }))} />
          ) : (
            <Marks marks={opts.marks} color={opts.color} colors={colors} x={(d) => d} avoid={known.filter((_, i) => i % 2 === 0).map((p) => ({ date: p.date, value: p.value! }))} />
          )}
        </LineChart>
      )
    }
    return (
      <ChartCard
        key={opts.key}
        kicker={opts.kicker}
        reading={known.length < 2 ? (week ? 'Poucos dias do relógio nos últimos 7 dias' : 'Ainda poucos dias do relógio neste período') : opts.reading}
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
  // B5: o eixo vem do que se desenha (no «Tudo» longo, as médias semanais),
  // não dos extremos de cada dia.
  const plotted = (key: Key) =>
    model
      .shown(key)
      .map((p) => p.value)
      .filter((v): v is number => v != null)
  const maxOf = (key: Key) => Math.max(0, ...plotted(key))
  const minOf = (key: Key) => Math.min(...plotted(key))
  const cmp = (key: Key, excludeToday = false) => compareWindows(model.series(key), today, period, from, { excludeToday, days: week ? 7 : undefined })
  // A frase de cada um: a comparação; sem os últimos 30 dias, a média do
  // período (com 7 dias ou mais); só depois «poucos dados».
  const say = (key: Key, c: Comparison | null, read: (c: Comparison | null) => string) => {
    if (c) return read(c)
    if (week) return 'Poucos dias do relógio nos últimos 7 dias'
    const mean = periodMean(inWindow(key), from, today)
    return mean != null ? staleReading(key, mean) : FEW_DATA
  }

  const steps = cmp('steps', true)
  const sleep = cmp('sleep')
  const rhr = cmp('rhr')
  const hrv = cmp('hrv')
  const daily = !model.weekly
  const avgLabel = week ? 'média da semana' : 'média dos últimos 30 dias'
  // No 1S, o valor de cada dia por cima do ponto (FC e HRV).
  const dayMarks = (key: 'rhr' | 'hrv'): Mark[] =>
    inWindow(key).map((p) => ({ id: `${key}-${p.date}`, date: p.date, value: p.value, label: `${Math.round(p.value)}`, priority: p.date === today ? 2 : 1, prefer: 'above' as const }))
  const rhrPts = inWindow('rhr')
  const hrvPts = inWindow('hrv')

  const cards = [
    card({
      key: 'steps',
      kicker: 'Passos',
      reading: say('steps', steps, stepsReading),
      aside: todayRow?.steps != null ? `Hoje: ${fmtInt(todayRow.steps)} até agora (o dia ainda vai a meio).` : null,
      avg: steps?.now ?? null,
      avgText: steps ? `${avgLabel} (${fmtInt(Math.round(steps.now / 100) * 100)})` : null,
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
      avgText: sleep ? `${avgLabel} (${fmtSleep(Math.round(sleep.now))})` : null,
      color: colors.health,
      bars: week,
      tickFormat: (v) => `${Math.round(v / 60)} h`,
      // Em barras (1S), do zero.
      scale: { step: 60, ...hourTicks(week ? 0 : minOf('sleep'), maxOf('sleep')) },
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
      avgText: rhr ? `${avgLabel} (${Math.round(rhr.now)} bpm)` : null,
      color: colors.health,
      bars: false,
      tickFormat: (v) => String(v),
      scale: niceScale(minOf('rhr') - 2, maxOf('rhr') + 2, 4, 8),
      marks: week ? dayMarks('rhr') : daily ? [bestDayMark(rhrPts, 'min', 'mais baixa', 'bpm')].filter((m): m is Mark => m != null) : [],
      tip: (r) => ['rhr' in r ? (r.rhr != null ? `${r.rhr} bpm` : 'sem registo') : r.value != null ? `${r.value} bpm (média)` : 'sem registo'],
    }),
    card({
      key: 'hrv',
      kicker: 'HRV durante o sono',
      reading: say('hrv', hrv, hrvReading),
      aside: `${todayRow?.hrv != null && hrv ? `Hoje: ${todayRow.hrv} ms, ${vsAverage(todayRow.hrv, hrv.now, 'ms', 2)}. ` : ''}Mais alta costuma querer dizer mais recuperado.`,
      avg: hrv?.now ?? null,
      avgText: hrv ? `${avgLabel} (${Math.round(hrv.now)} ms)` : null,
      color: colors.health,
      bars: false,
      tickFormat: (v) => String(v),
      scale: niceScale(minOf('hrv') - 2, maxOf('hrv') + 2, 4, 10),
      marks: week ? dayMarks('hrv') : daily ? [bestDayMark(hrvPts, 'max', 'mais alta', 'ms')].filter((m): m is Mark => m != null) : [],
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
