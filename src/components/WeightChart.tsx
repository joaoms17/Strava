import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { projectWeight, trend7 } from '../../api/_lib/rules/weight'
import type { WeightRow } from '../lib/types'

interface ChartPoint {
  date: string
  kg?: number
  trend?: number
  proj?: number
}

const COLORS = {
  accent: '#f59e0b',
  dim: '#a1a1aa',
  edge: '#26262b',
  ink: '#e7e5e4',
}

function fmtKg(value: number): string {
  return `${value.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
}

function fmtDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${day}/${month}`
}

function fmtDateLong(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'long',
  })
}

// Gráfico de peso (regra 3): pesagens diárias, média de 7 dias e projeção
// linear a 4 semanas, com a linha do peso alvo.
export default function WeightChart({ weights, target }: { weights: WeightRow[]; target: number }) {
  const trend = trend7(weights.map((w) => ({ date: w.date, value: w.kg })))
  const projection = projectWeight(trend, target)
  const lastTrend = trend[trend.length - 1]

  const byDate = new Map<string, ChartPoint>()
  for (const w of weights) byDate.set(w.date, { date: w.date, kg: w.kg })
  for (const t of trend) byDate.set(t.date, { ...byDate.get(t.date), date: t.date, trend: t.value })
  if (lastTrend) {
    // liga a projeção ao último ponto da tendência
    const anchor = byDate.get(lastTrend.date)
    if (anchor) anchor.proj = lastTrend.value
  }
  for (const p of projection.projected) {
    byDate.set(p.date, { ...byDate.get(p.date), date: p.date, proj: p.value })
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))

  const allValues = points.flatMap((p) =>
    [p.kg, p.trend, p.proj].filter((v): v is number => v != null),
  )
  const yMin = Math.floor(Math.min(...allValues, target) - 0.5)
  const yMax = Math.ceil(Math.max(...allValues, target) + 0.5)
  const weeklyDelta = projection.slopePerDay * 7

  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-dim">Peso — 8 semanas</h2>
        {lastTrend && <p className="text-lg font-bold">{fmtKg(lastTrend.value)}</p>}
      </div>
      <p className="pb-2 text-xs text-dim">
        {weeklyDelta !== 0 &&
          `${weeklyDelta > 0 ? '+' : ''}${weeklyDelta.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} kg/semana`}
        {projection.targetDate && ` · ${target} kg a ${fmtDateLong(projection.targetDate)}`}
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={COLORS.edge} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: COLORS.dim, fontSize: 11 }}
              axisLine={{ stroke: COLORS.edge }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: COLORS.dim, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={{
                background: '#161619',
                border: `1px solid ${COLORS.edge}`,
                borderRadius: 12,
                color: COLORS.ink,
                fontSize: 12,
              }}
              labelFormatter={(label) => fmtDateLong(String(label))}
              formatter={(value, name) => [
                fmtKg(Number(value)),
                name === 'kg' ? 'pesagem' : name === 'trend' ? 'média 7 dias' : 'projeção',
              ]}
            />
            <ReferenceLine
              y={target}
              stroke={COLORS.dim}
              strokeDasharray="2 4"
              label={{
                value: `${target} kg`,
                position: 'insideBottomLeft',
                fill: COLORS.dim,
                fontSize: 11,
              }}
            />
            <Scatter
              dataKey="kg"
              fill={COLORS.dim}
              shape={(props: unknown) => {
                const { cx, cy } = props as { cx?: number; cy?: number }
                return <circle cx={cx} cy={cy} r={2.5} fill={COLORS.dim} fillOpacity={0.55} />
              }}
            />
            <Line dataKey="trend" stroke={COLORS.accent} strokeWidth={2} dot={false} connectNulls />
            <Line
              dataKey="proj"
              stroke={COLORS.accent}
              strokeWidth={2}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 pt-2 text-xs text-dim">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.dim }} />
          pesagens
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: COLORS.accent }} />
          média 7 dias
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 opacity-60"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${COLORS.accent} 0 4px, transparent 4px 8px)`,
            }}
          />
          projeção
        </span>
      </div>
    </div>
  )
}
