import { useState } from 'react'
import { postApi } from '../lib/api'
import type { PlannedSession } from '../lib/types'

export interface ExerciseSuggestion {
  load: number | null
  ready: boolean
}

interface SetRow {
  reps: string
  kg: string
  rpe: string
}

// Registo de cargas por toques: linhas prefilled, ajustar e guardar.
export default function StrengthLogger({
  session,
  suggestions,
  onSaved,
  onCancel,
}: {
  session: PlannedSession
  suggestions: Record<string, ExerciseSuggestion>
  onSaved: () => void
  onCancel: () => void
}) {
  const exercises = session.details.exercises
  const [rows, setRows] = useState<Record<string, SetRow[]>>(() => {
    const initial: Record<string, SetRow[]> = {}
    for (const exercise of exercises) {
      const suggestion = suggestions[exercise.name]
      const kg = suggestion?.load ?? exercise.load_kg
      initial[exercise.name] = Array.from({ length: exercise.sets }, () => ({
        reps: String(exercise.rep_min),
        kg: kg != null ? String(kg) : '',
        rpe: '8',
      }))
    }
    return initial
  })
  const [minutes, setMinutes] = useState(45)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(exercise: string, index: number, patch: Partial<SetRow>) {
    setRows((prev) => ({
      ...prev,
      [exercise]: (prev[exercise] ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }))
  }

  function num(value: string): number | null {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const sets = exercises.flatMap((exercise) =>
        (rows[exercise.name] ?? []).map((row, i) => ({
          exercise: exercise.name,
          set_index: i + 1,
          reps: num(row.reps) != null ? Math.round(num(row.reps)!) : null,
          load_kg: num(row.kg),
          rpe: num(row.rpe),
        })),
      )
      await postApi('/api/workout/session', {
        planned_session_id: session.id,
        minutes,
        sets,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar a sessão.')
    } finally {
      setBusy(false)
    }
  }

  const cell =
    'w-full rounded-lg border border-edge bg-bg px-1.5 py-1.5 text-center text-sm focus:border-accent focus:outline-none'

  return (
    <div className="space-y-4">
      {exercises.map((exercise) => {
        const suggestion = suggestions[exercise.name]
        return (
          <div key={exercise.name} className="space-y-2 rounded-xl border border-edge p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{exercise.name}</p>
              <p className="shrink-0 text-xs text-dim">
                {exercise.sets}×{exercise.rep_min}–{exercise.rep_max}
                {suggestion?.ready && <span className="ml-2 text-ok">+2 kg</span>}
              </p>
            </div>
            {exercise.notes && <p className="text-xs text-dim">{exercise.notes}</p>}
            <div className="grid grid-cols-[2rem_1fr_1fr_1fr] items-center gap-1.5 text-xs text-dim">
              <span />
              <span className="text-center">reps</span>
              <span className="text-center">kg</span>
              <span className="text-center">RPE</span>
            </div>
            {(rows[exercise.name] ?? []).map((row, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr] items-center gap-1.5">
                <span className="text-xs text-dim">S{i + 1}</span>
                <input
                  inputMode="numeric"
                  value={row.reps}
                  onChange={(e) => update(exercise.name, i, { reps: e.target.value })}
                  className={cell}
                />
                <input
                  inputMode="decimal"
                  value={row.kg}
                  onChange={(e) => update(exercise.name, i, { kg: e.target.value })}
                  className={cell}
                />
                <input
                  inputMode="decimal"
                  value={row.rpe}
                  onChange={(e) => update(exercise.name, i, { rpe: e.target.value })}
                  className={cell}
                />
              </div>
            ))}
          </div>
        )
      })}

      <div className="flex items-center gap-2">
        <span className="text-xs text-dim">duração:</span>
        {[30, 45, 60, 90].map((option) => (
          <button
            key={option}
            onClick={() => setMinutes(option)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${
              minutes === option ? 'border-accent text-accent' : 'border-edge text-dim'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-warn">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} className="rounded-xl border border-edge px-4 py-3 text-sm text-dim">
          Cancelar
        </button>
        <button
          disabled={busy}
          onClick={() => void save()}
          className="flex-1 rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
        >
          {busy ? 'A guardar…' : 'Terminar sessão'}
        </button>
      </div>
    </div>
  )
}
