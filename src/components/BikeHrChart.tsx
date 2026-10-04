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
import { useThemeColors } from '../lib/colors'
import type { Workout } from '../lib/types'


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
  const colors = useThemeColors()
  const sessions = workouts
    .filter((w) => w.type === 'bike' && w.avg_hr != null)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (sessions.length < 2) {
    return (
      <div className="rounded-2xl border border-edge bg-card p-6 text-center text-sm text-dim">
        <p className="text-[17px] font-semibold text-ink">Batimentos na bicicleta</p>
        <p className="mt-2">Com 2 sessões de bicicleta com batimentos, o gráfico aparece aqui.</p>
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
      <h2 className="text-sm font-semibold text-dim">Batimentos médios na bicicleta, por sessão</h2>
      <div className="mt-2 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid stroke={colors.line} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: colors.dim, fontSize: 11 }}
              axisLine={{ stroke: colors.line }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: colors.dim, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={{
                background: colors.surface,
                border: `1px solid ${colors.line}`,
                borderRadius: 12,
                color: colors.ink,
                fontSize: 12,
              }}
              labelFormatter={(label) => fmtDate(String(label))}
              formatter={(value, name, entry) => [
                `${value} bpm${entry?.payload?.watts != null ? ` @ ${entry.payload.watts} W` : ''}`,
                name === 'hr' ? 'batimentos médios' : String(name),
              ]}
            />
            <ReferenceLine
              y={capAvg}
              stroke={colors.dim}
              strokeDasharray="2 4"
              label={{
                value: `cap ${capAvg}`,
                position: 'insideTopRight',
                fill: colors.dim,
                fontSize: 11,
              }}
            />
            {wattChanges.map((change) => (
              <ReferenceLine
                key={change.date + change.watts}
                x={change.date}
                stroke={colors.line}
                label={{
                  value: `${change.watts} W`,
                  position: 'insideTopLeft',
                  fill: colors.burn,
                  fontSize: 11,
                }}
              />
            ))}
            <Line isAnimationActive={false}
              dataKey="hr"
              stroke={colors.burn}
              strokeWidth={2}
              dot={{ r: 3, fill: colors.burn, strokeWidth: 0 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="pt-2 text-xs text-dim">
        Sobe a potência quando 2 sessões seguidas ficam abaixo do limite de batimentos.
      </p>
    </div>
  )
}
