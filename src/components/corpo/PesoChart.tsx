import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt1, fmtDayMonth } from '../../lib/format'
import type { CorpoData } from '../../lib/corpo'
import { trend7 } from '../../../api/_lib/rules/weight'
import { fmtDayMon, project } from '../../../api/_lib/rules/projecao'
import { dayNum, fromDayNum, niceScale, type Period } from '../../../api/_lib/rules/graficos'
import { projectionHorizon, projectionPath, projectionStart, startWeight, weightChange, weightMarks, weightReading, type Mark } from '../../../api/_lib/rules/leituras'
import { BAND_OPACITY, ChartCard, EmptyChart, Key, Legend, Marks, TICK, TipBox, dotOpacity, padBelowTarget, timeAxis, tooltipBase, useChartColors } from '../charts/kit'

const HEIGHT = 240
// Com muitas pesagens («Tudo» de anos), só a linha do peso médio.
const MAX_DOTS = 200

interface Point {
  x: number
  kg?: number // a pesagem do dia
  trend?: number // o peso médio (7 dias)
  mid?: number // a projeção
  band?: [number, number] // o leque da projeção
}

// Corpo › Peso: o peso médio (linha) e cada pesagem (pontos), a meta
// tracejada, a projeção a continuar a linha até à data do alvo (com o
// leque, a partir do «agora» da Projeção), o começo, o mais baixo e o de
// hoje marcados, e as semanas de água do ciclo à vista (o peso sobe sem ser
// gordura). No «Tudo», o começo é o do resumo «Desde o início» (a média da
// 1.ª semana): o mesmo número nos dois sítios.
export default function PesoChart({
  data,
  period,
  from,
  today,
  targetKg,
  calm,
}: {
  data: CorpoData
  period: Period
  from: string
  today: string
  targetKg: number | null
  calm: boolean
}) {
  const colors = useChartColors()
  const model = useMemo(() => {
    const all = data.weights.map((w) => ({ date: w.date, value: w.kg }))
    const trendAll = trend7(all)
    const daily = all.filter((w) => w.date >= from)
    const trend = trendAll.filter((p) => p.date >= from)
    const waterDay = data.projection.input.waterDay
    const firstEver = data.firstWeighings[0]?.date ?? null
    const ever = period === 'Tudo' ? startWeight(data.firstWeighings, waterDay) : null
    const start = ever && ever.start.date >= from ? ever.start : null
    const change = weightChange(trendAll, from, waterDay, start)
    const marks: Mark[] = weightMarks(trend, { firstEver: firstEver != null && firstEver >= from, lowestEver: period === 'Tudo', start })

    // A projeção (a mesma do resumo) continua a linha do peso médio.
    const p = project(data.projection.input)
    const lastTrend = trend[trend.length - 1]
    const horizon = projectionHorizon(from, today)
    const path =
      p.status === 'ok' && targetKg != null && lastTrend && lastTrend.date >= shiftBack(today, 7)
        ? projectionPath(projectionStart(data.projection.input.asOf, p.basis.currentKg), p.weight, targetKg, horizon)
        : null
    if (path && p.status === 'ok' && p.weight.kind === 'date') {
      marks.push({
        id: 'meta',
        date: path.end.date,
        value: path.end.value,
        label: path.reachesInView ? `${kg(targetKg!)} kg a ${fmtDayMon(p.weight.date, today)}` : `→ ${kg(targetKg!)} kg a ${fmtDayMon(p.weight.date, today)}`,
        priority: 3.5,
        prefer: 'below',
      })
    }

    const byX = new Map<number, Point>()
    const at = (date: string) => {
      const x = dayNum(date)
      let pt = byX.get(x)
      if (!pt) {
        pt = { x }
        byX.set(x, pt)
      }
      return pt
    }
    if (!calm && daily.length <= MAX_DOTS) for (const w of daily) at(w.date).kg = w.value
    for (const t of trend) at(t.date).trend = t.value
    for (const q of path?.points ?? []) {
      const pt = at(q.date)
      pt.mid = q.mid
      if (q.low != null && q.high != null) pt.band = [q.low, q.high]
    }
    const points = [...byX.values()].sort((a, b) => a.x - b.x)

    const values = [...(calm ? [] : daily.map((w) => w.value)), ...trend.map((t) => t.value), ...(path?.points.map((q) => q.mid) ?? [])]
    const showTarget = targetKg != null && values.length > 0 && (path != null || Math.min(...values) - targetKg < 4)
    const scale = padBelowTarget(niceScale(Math.min(...values, showTarget ? targetKg! : Infinity), Math.max(...values), 5, 3), showTarget ? targetKg : null)
    const end = path ? path.end.date : today
    const axis = timeAxis(from, end, 5)

    // As semanas de água do ciclo (Joana): faixas claras com «água».
    const water: [number, number][] = []
    if (waterDay) {
      let start: number | null = null
      for (let d = dayNum(from); d <= dayNum(today); d++) {
        const on = waterDay(fromDayNum(d))
        if (on && start == null) start = d
        if ((!on || d === dayNum(today)) && start != null) {
          water.push([start, on ? d : d - 1])
          start = null
        }
      }
    }
    // Os rótulos não tapam a linha do peso médio nem a da projeção.
    const avoid = [...trend.filter((_, i) => i % 2 === 0), ...(path?.points.map((q) => ({ date: q.date, value: q.mid })) ?? [])]
    return { points, marks, change, scale, axis, showTarget, path, water, avoid, count: daily.length }
  }, [data, from, today, targetKg, calm, period])

  const enough = model.count >= 2
  const reading = model.count === 0 ? 'Ainda sem pesagens' : weightReading(model.change)
  // Os rótulos das linhas de referência (contam como obstáculos dos marcos).
  const refs = model.showTarget ? [{ y: targetKg!, text: `meta ${kg(targetKg!)}`, side: 'left' as const }] : []
  return (
    <ChartCard
      kicker="Peso médio"
      reading={reading}
      legend={
        enough && (
          <Legend>
            {!calm && model.count <= MAX_DOTS && <Key shape="dot" color={colors.weight} label="pesagem" faint />}
            <Key shape="line" color={colors.weight} label="peso médio (7 dias)" />
            {model.path && <Key shape="dash" color={colors.weight} label="projeção" />}
            {model.showTarget && <Key shape="dash" color={colors.dim} label="meta" />}
            {model.water.length > 0 && <Key shape="band" color={colors.dim} label="semana de água" />}
          </Legend>
        )
      }
      note={enough && 'O peso varia ±1 kg de um dia para o outro com água e sal; a linha é a média de 7 dias.'}
      table={
        enough && (
          <table className="mt-1 w-full tabular-nums">
            <thead>
              <tr className="text-left">
                <th className="font-normal">Dia</th>
                <th className="text-right font-normal">Pesagem</th>
                <th className="text-right font-normal">Peso médio</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {model.points
                .filter((p) => p.trend != null)
                .slice(-21)
                .reverse()
                .map((p) => (
                  <tr key={p.x}>
                    <td>{fmtDayMonth(fromDayNum(p.x))}</td>
                    <td className="text-right">{p.kg != null ? `${fmt1(p.kg)} kg` : '—'}</td>
                    <td className="text-right">{fmt1(p.trend!)} kg</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )
      }
    >
      {!enough ? (
        <EmptyChart
          text={model.count === 0 ? 'Volta daqui a 1 semana: com 7 dias de pesagens aparece aqui a linha do peso médio.' : 'Ainda poucas pesagens: volta daqui a 1 semana.'}
          height={140}
        />
      ) : (
        <div style={{ height: HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={model.points} margin={{ top: 20, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              {model.water.map(([a, b]) => (
                <ReferenceArea
                  key={a}
                  x1={a - 0.5}
                  x2={b + 0.5}
                  fill={colors.dim}
                  fillOpacity={BAND_OPACITY}
                  stroke="none"
                  ifOverflow="hidden"
                  // «água» só numa faixa larga que caiba inteira à vista (a do começo vem cortada).
                  label={a > model.axis.domain[0] && b - a >= 3 ? { value: 'água', position: 'insideTop', fill: colors.dim, fontSize: 12 } : undefined}
                />
              ))}
              <XAxis
                type="number"
                dataKey="x"
                domain={[model.axis.domain[0], model.axis.domain[1] + 1]}
                ticks={model.axis.ticks}
                tickFormatter={model.axis.format}
                tick={TICK(colors)}
                axisLine={{ stroke: colors.grid }}
                tickLine={false}
                allowDataOverflow
              />
              <YAxis
                domain={model.scale.domain}
                ticks={model.scale.ticks}
                tickFormatter={(v: number) => String(v).replace('.', ',')}
                tick={TICK(colors)}
                axisLine={false}
                tickLine={false}
                width={34}
              />
              <Tooltip
                {...tooltipBase(colors)}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as Point | undefined
                  if (!active || !p) return null
                  const rows = [
                    p.kg != null ? { label: 'pesagem', value: `${fmt1(p.kg)} kg` } : null,
                    p.trend != null ? { label: 'peso médio', value: `${fmt1(p.trend)} kg`, color: colors.weight } : null,
                    p.mid != null && p.trend == null ? { label: 'projeção', value: `${fmt1(p.mid)} kg`, color: colors.weight, dash: true } : null,
                  ].filter((r): r is NonNullable<typeof r> => r != null)
                  return <TipBox title={fmtDayMonth(fromDayNum(p.x))} rows={rows} colors={colors} />
                }}
              />
              {model.showTarget && <ReferenceLine y={targetKg!} stroke={colors.dim} strokeDasharray="3 4" strokeWidth={1.5} />}
              {model.path && (
                <Area dataKey="band" stroke="none" fill={colors.weight} fillOpacity={0.1} isAnimationActive={false} connectNulls activeDot={false} />
              )}
              {!calm && model.count <= MAX_DOTS && (
                <Line dataKey="kg" stroke="none" isAnimationActive={false} dot={{ r: 2.5, fill: colors.weight, fillOpacity: dotOpacity(colors), stroke: 'none' }} activeDot={{ r: 4, fill: colors.weight, stroke: colors.surface, strokeWidth: 2 }} />
              )}
              <Line dataKey="trend" stroke={colors.weight} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 5, fill: colors.weight, stroke: colors.surface, strokeWidth: 2 }} strokeLinecap="round" strokeLinejoin="round" />
              {model.path && <Line dataKey="mid" stroke={colors.weight} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} activeDot={false} />}
              <Marks marks={model.marks} color={colors.weight} colors={colors} x={(d) => dayNum(d)} avoid={model.avoid} refs={refs} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

const kg = (n: number) => fmt1(n).replace(/,0$/, '')
const shiftBack = (date: string, days: number) => fromDayNum(dayNum(date) - days)
