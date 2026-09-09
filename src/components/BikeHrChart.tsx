import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { Workout } from '../lib/types'

const COLORS = {
  accent: '#f59e0b',
  dim: '#a1a1aa',
  edge: '#26262b',
  ink: '#e7e5e4',
}

function fmtDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${day}/${month}`
}

// FC média por sessão de bike, com anotação quando muda o W e a linha do cap.
export default function BikeHrChart({
  workouts,
  capAvg,
}: {
  workouts: Workout[]
  capAvg: number
}) {
  const sessions = workouts
    .filter((w) => w.type === 'bike' && w.avg_hr != null)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (sessions.length < 2) {
    return (
      <div className="rounded-2xl border border-edge bg-card p-6 text-center text-sm text-dim">
        <p className="font-display text-lg text-ink">FC na bike</p>
        <p className="mt-2">Com 2+ sessões de bike com FC, o gráfico aparece aqui.</p>
      </div>
    )
  }

  const points = sessions.map((w) => ({ date: w.date, hr: w.avg_hr, watts: w.watts }))
  const wattChanges: { date: string; watts: number }[] = []
  let prevWatts: number | null = null
  for (const p of points) {
    if (p.watts != null && p.watts !== prevWatts) {
      if (prevWatts != null) wattChanges.push({ date: p.date, watts: p.watts })
      prevWatts = p.watts
    }
  }
  const hrValues = points.map((p) => p.hr!).concat(capAvg)
  const yMin = Math.floor(Math.min(...hrValues) - 3)
  const yMax = Math.ceil(Math.max(...hrValues) + 3)

  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      <h2 className="text-sm font-semibold text-dim">FC média na bike, por sessão</h2>
      <div className="mt-2 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid stroke={COLORS.edge} vertical={false} />
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
              labelFormatter={(label) => fmtDate(String(label))}
              formatter={(value, name, entry) => [
                `${value} bpm${entry?.payload?.watts != null ? ` @ ${entry.payload.watts} W` : ''}`,
                name === 'hr' ? 'FC média' : String(name),
              ]}
            />
            <ReferenceLine
              y={capAvg}
              stroke={COLORS.dim}
              strokeDasharray="2 4"
              label={{
                value: `cap ${capAvg}`,
                position: 'insideTopRight',
                fill: COLORS.dim,
                fontSize: 11,
              }}
            />
            {wattChanges.map((change) => (
              <ReferenceLine
                key={change.date + change.watts}
                x={change.date}
                stroke={COLORS.edge}
                label={{
                  value: `${change.watts} W`,
                  position: 'insideTopLeft',
                  fill: COLORS.accent,
                  fontSize: 11,
                }}
              />
            ))}
            <Line
              dataKey="hr"
              stroke={COLORS.accent}
              strokeWidth={2}
              dot={{ r: 3, fill: COLORS.accent, strokeWidth: 0 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="pt-2 text-xs text-dim">
        Sobe o W quando 2 sessões seguidas ficam abaixo do cap, ambas verdes.
      </p>
    </div>
  )
}
