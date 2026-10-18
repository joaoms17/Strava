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
import { useThemeColors } from '../lib/colors'
import { fmtDayMonth } from '../lib/format'
import { exerciseKey } from '../../api/_lib/rules/exercicios'
import type { ExerciseLogRow } from '../lib/types'

// Carga por exercício (12 semanas): melhor série de cada sessão. O mesmo
// exercício escrito de outra maneira (maiúsculas, acentos) é uma só linha,
// com o nome da última vez.
export default function LoadChart({
  logs,
  workoutDates,
}: {
  logs: ExerciseLogRow[]
  workoutDates: Map<string, string>
}) {
  const colors = useThemeColors()
  const { exercises, seriesFor } = useMemo(() => {
    const byExercise = new Map<string, Map<string, number>>() // exercise -> date -> top load
    const names = new Map<string, { name: string; date: string }>()
    for (const log of logs) {
      if (log.load_kg == null) continue
      const date = workoutDates.get(log.workout_id)
      if (!date) continue
      const key = exerciseKey(log.exercise)
      const perDate = byExercise.get(key) ?? new Map<string, number>()
      perDate.set(date, Math.max(perDate.get(date) ?? 0, Number(log.load_kg)))
      byExercise.set(key, perDate)
      if (!names.has(key) || names.get(key)!.date <= date) names.set(key, { name: log.exercise, date })
    }
    const ranked = [...byExercise.entries()]
      .sort(([, a], [, b]) => b.size - a.size)
      .slice(0, 4)
      .map(([key]) => key)
    return {
      exercises: ranked.map((key) => ({ key, name: names.get(key)?.name ?? key })),
      seriesFor: (key: string) =>
        [...(byExercise.get(key) ?? new Map<string, number>()).entries()]
          .map(([date, load]) => ({ date, load }))
          .sort((a, b) => a.date.localeCompare(b.date)),
    }
  }, [logs, workoutDates])

  const [selected, setSelected] = useState<string | null>(null)
  const exercise = exercises.some((e) => e.key === selected) ? selected : (exercises[0]?.key ?? null)

  if (!exercise) {
    return (
      <div className="rounded-2xl border border-edge bg-card p-6 text-center text-sm text-dim">
        <p className="text-[17px] font-semibold text-ink">Cargas</p>
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
        {exercises.map(({ key, name }) => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${
              key === exercise ? 'border-accent text-accent' : 'border-edge text-dim'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="mt-2 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={colors.line} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDayMonth}
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
              width={72}
              unit=" kg"
            />
            <Tooltip
              contentStyle={{
                background: colors.surface,
                border: `1px solid ${colors.line}`,
                borderRadius: 12,
                color: colors.ink,
                fontSize: 12,
              }}
              labelFormatter={(label) => fmtDayMonth(String(label))}
              formatter={(value) => [`${value} kg`, 'melhor série']}
            />
            <Line isAnimationActive={false}
              dataKey="load"
              stroke={colors.burn}
              strokeWidth={2}
              dot={{ r: 3, fill: colors.burn, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
