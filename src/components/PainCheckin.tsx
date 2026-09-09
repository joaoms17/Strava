import { useState } from 'react'
import { postApi } from '../lib/api'
import type { Workout } from '../lib/types'

const TYPE_LABEL: Record<Workout['type'], string> = {
  bike: 'Bike',
  strength: 'Força',
  other: 'Outro',
}

// Check-in da regra 9: dor 0-10 pós-sessão e na manhã seguinte.
// Nas sessões de bike, é também aqui que entram os dados da consola/relógio
// (watts, FC média/máxima, cadência) de que a regra 10 precisa — essencial
// sem Strava.
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
  const [avgHr, setAvgHr] = useState(workout.avg_hr != null ? String(workout.avg_hr) : '')
  const [maxHr, setMaxHr] = useState(workout.max_hr != null ? String(workout.max_hr) : '')
  const [cadence, setCadence] = useState(workout.cadence != null ? String(workout.cadence) : '')
  const isBikeDetails =
    workout.type === 'bike' &&
    field === 'pain_during' &&
    (workout.watts == null || workout.avg_hr == null || workout.max_hr == null)
  const needsWatts = workout.type === 'bike' && workout.watts == null

  function intOrSkip(value: string, min: number, max: number): number | undefined {
    const parsed = Math.round(Number(value))
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined
  }

  async function submit(pain: number) {
    setBusy(true)
    setError(false)
    try {
      const extras: Record<string, number> = {}
      if (workout.type === 'bike') {
        const w = intOrSkip(watts, 30, 500)
        const ah = intOrSkip(avgHr, 40, 230)
        const mh = intOrSkip(maxHr, 40, 240)
        const cad = intOrSkip(cadence, 30, 200)
        if (w != null && w !== workout.watts) extras.watts = w
        if (ah != null && ah !== workout.avg_hr) extras.avg_hr = ah
        if (mh != null && mh !== workout.max_hr) extras.max_hr = mh
        if (cad != null && cad !== workout.cadence) extras.cadence = cad
      }
      await postApi('/api/workout/checkin', {
        workout_id: workout.id,
        [field]: pain,
        ...extras,
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
      {isBikeDetails && (
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ['W', watts, setWatts, needsWatts],
              ['FC méd', avgHr, setAvgHr, workout.avg_hr == null],
              ['FC máx', maxHr, setMaxHr, workout.max_hr == null],
              ['rpm', cadence, setCadence, workout.cadence == null],
            ] as const
          ).map(([label, value, setter, show]) =>
            show ? (
              <label key={label} className="space-y-0.5 text-center text-xs text-dim">
                <span className="block">{label}</span>
                <input
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setter(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border border-edge bg-bg px-1 py-1.5 text-center text-ink focus:border-accent focus:outline-none"
                />
              </label>
            ) : null,
          )}
        </div>
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
