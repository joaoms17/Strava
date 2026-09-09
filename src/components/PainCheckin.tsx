import { useState } from 'react'
import { postApi } from '../lib/api'
import type { Workout } from '../lib/types'

const TYPE_LABEL: Record<Workout['type'], string> = {
  bike: 'Bike',
  strength: 'Força',
  other: 'Outro',
}

// Check-in da regra 9: dor 0-10 pós-sessão e na manhã seguinte;
// nas sessões de bike sem watts, pede confirmação dos watts.
export default function PainCheckin({
  workout,
  field,
  onDone,
}: {
  workout: Workout
  field: 'pain_during' | 'pain_next_day'
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [watts, setWatts] = useState(workout.watts != null ? String(workout.watts) : '')
  const needsWatts = workout.type === 'bike' && workout.watts == null

  async function submit(pain: number) {
    setBusy(true)
    setError(false)
    try {
      const parsedWatts = Number(watts)
      await postApi('/api/workout/checkin', {
        workout_id: workout.id,
        [field]: pain,
        ...(needsWatts && Number.isFinite(parsedWatts) && parsedWatts > 0
          ? { watts: Math.round(parsedWatts) }
          : {}),
      })
      onDone()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-accent/40 bg-card px-4 py-3">
      <p className="text-sm">
        {field === 'pain_during'
          ? `Dor durante a sessão de ${TYPE_LABEL[workout.type]}?`
          : `E na manhã seguinte à sessão de ${TYPE_LABEL[workout.type]} de ontem?`}
      </p>
      {needsWatts && (
        <label className="flex items-center gap-2 text-xs text-dim">
          watts da sessão:
          <input
            inputMode="numeric"
            value={watts}
            onChange={(e) => setWatts(e.target.value.replace(/\D/g, ''))}
            className="w-16 rounded-lg border border-edge bg-bg px-2 py-1 text-right text-ink focus:border-accent focus:outline-none"
          />
        </label>
      )}
      <div className="grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, pain) => (
          <button
            key={pain}
            disabled={busy}
            onClick={() => void submit(pain)}
            className={`rounded-lg border py-2 text-xs disabled:opacity-50 ${
              pain <= 2 ? 'border-ok/40 text-ok' : pain <= 5 ? 'border-accent/40 text-accent' : 'border-warn/40 text-warn'
            }`}
          >
            {pain}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-warn">Não consegui gravar. Tenta outra vez.</p>}
    </div>
  )
}
