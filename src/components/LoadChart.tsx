import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { ExerciseLogRow } from '../lib/types'

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

// Carga por exercício (12 semanas): melhor série de cada sessão.
export default function LoadChart({
  logs,
  workoutDates,
}: {
  logs: ExerciseLogRow[]
  workoutDates: Map<string, string>
}) {
  const { exercises, seriesFor } = useMemo(() => {
    const byExercise = new Map<string, Map<string, number>>() // exercise -> date -> top load
    for (const log of logs) {
      if (log.load_kg == null) continue
      const date = workoutDates.get(log.workout_id)
      if (!date) continue
      const perDate = byExercise.get(log.exercise) ?? new Map<string, number>()
      perDate.set(date, Math.max(perDate.get(date) ?? 0, log.load_kg))
      byExercise.set(log.exercise, perDate)
    }
    const ranked = [...byExercise.entries()]
      .sort(([, a], [, b]) => b.size - a.size)
      .slice(0, 4)
      .map(([name]) => name)
    return {
      exercises: ranked,
      seriesFor: (name: string) =>
        [...(byExercise.get(name) ?? new Map<string, number>()).entries()]
          .map(([date, load]) => ({ date, load }))
          .sort((a, b) => a.date.localeCompare(b.date)),
    }
  }, [logs, workoutDates])

  const [selected, setSelected] = useState<string | null>(null)
  const exercise = selected ?? exercises[0] ?? null

  if (!exercise) {
    return (
      <div className="rounded-2xl border border-edge bg-card p-6 text-center text-sm text-dim">
        <p className="font-display text-lg text-ink">Cargas</p>
        <p className="mt-2">Regista sessões de força para veres a progressão por exercício.</p>
      </div>
    )
  }

  const points = seriesFor(exercise)
  const loads = points.map((p) => p.load)
  const yMin = Math.max(0, Math.floor(Math.min(...loads) - 2))
  const yMax = Math.ceil(Math.max(...loads) + 2)

  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      <h2 className="text-sm font-semibold text-dim">Carga por exercício — 12 semanas</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {exercises.map((name) => (
          <button
            key={name}
            onClick={() => setSelected(name)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${
              name === exercise ? 'border-accent text-accent' : 'border-edge text-dim'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="mt-2 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
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
              width={72}
              unit=" kg"
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
              formatter={(value) => [`${value} kg`, 'melhor série']}
            />
            <Line
              dataKey="load"
              stroke={COLORS.accent}
              strokeWidth={2}
              dot={{ r: 3, fill: COLORS.accent, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
