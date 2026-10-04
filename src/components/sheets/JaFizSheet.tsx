import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay } from '../../lib/day'
import { fmtKcal } from '../../lib/format'
import { saveWorkout } from '../../lib/workout-actions'
import { instantInNutritionalDay, lisbonInstant } from '../../../api/_lib/rules/momentos'
import { exerciseKcal } from '../../../api/_lib/rules/treino'
import { OTHER_SPORTS, SPORT_LABEL, isOtherSport, type OtherSport } from '../../../api/_lib/rules/targets'
import type { Favorite, Workout } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import { DayChips, chip } from '../ui/Chips'

type Kind = 'bike' | 'strength' | OtherSport

const KINDS: [Kind, string][] = [
  ['bike', 'Bicicleta'],
  ['strength', 'Ginásio'],
  ...OTHER_SPORTS.map((s): [Kind, string] => [s, SPORT_LABEL[s]]),
]

const DURATIONS = [30, 45, 60, 90]

function kindOf(w: { type: Workout['type']; sport?: string | null; raw?: { sport?: string } | null }): Kind {
  if (w.type !== 'other') return w.type
  const sport = w.sport ?? w.raw?.sport
  return isOtherSport(sport) ? sport : 'outro'
}

const toInt = (text: string): number | null => {
  const n = Number.parseInt(text, 10)
  return Number.isFinite(n) ? n : null
}

// «Já fiz»: um treino à mão em poucos toques, em qualquer dia, com o tipo,
// a duração e os watts da última vez já escolhidos.
export default function JaFizSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const favId = sheet.params.get('fav')
  const [kind, setKind] = useState<Kind>('bike')
  const [day, setDay] = useState(sheet.params.get('data') ?? today)
  const [time, setTime] = useState('')
  const [minutes, setMinutes] = useState<number | null>(45)
  const [otherMinutes, setOtherMinutes] = useState('')
  const [watts, setWatts] = useState<number | null>(null)
  const [avgHr, setAvgHr] = useState('')
  const [deviceKcal, setDeviceKcal] = useState('')
  const [busy, setBusy] = useState(false)
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const wattsOptions = profile.bike_watts_options?.length ? profile.bike_watts_options : [130, 140, 150]

  // Começa com a última sessão (ou o favorito que se quis mudar).
  useEffect(() => {
    void (async () => {
      if (favId) {
        const { data } = await supabase.from('favorites').select('*').eq('id', favId).maybeSingle()
        const fav = data as Favorite | null
        if (fav?.workout) {
          setKind(kindOf({ type: fav.workout.type, sport: fav.workout.sport }))
          setMinutes(fav.workout.minutes)
          setWatts(fav.workout.watts ?? null)
          return
        }
      }
      const { data } = await supabase
        .from('workouts_active')
        .select('type,sport,raw,minutes,watts')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      const last = data?.[0] as Workout | undefined
      if (last) {
        setKind(kindOf(last))
        if (last.minutes) setMinutes(last.minutes)
        if (last.watts) setWatts(last.watts)
      }
      const { data: weights } = await supabase.from('weights').select('kg').order('date', { ascending: false }).limit(7)
      if (weights?.length) setWeightKg(weights.reduce((a, w) => a + Number(w.kg), 0) / weights.length)
    })()
  }, [favId])

  const type: Workout['type'] = kind === 'bike' || kind === 'strength' ? kind : 'other'
  const effectiveMinutes = minutes ?? toInt(otherMinutes)
  const canSave = effectiveMinutes != null && effectiveMinutes > 0
  const preview = exerciseKcal({
    type,
    minutes: effectiveMinutes,
    watts: type === 'bike' ? watts : null,
    wattsSource: 'manual',
    deviceCalories: type === 'other' ? toInt(deviceKcal) : null,
    sport: type === 'other' ? (kind as OtherSport) : null,
    weightKg,
  })

  async function save() {
    if (!canSave || effectiveMinutes == null) return
    setBusy(true)
    const startedAt = time
      ? instantInNutritionalDay(day, time, profile.nutrition_day_cutoff_hour).toISOString()
      : day !== today
        ? lisbonInstant(day, '18:00').toISOString()
        : null
    const saved = await saveWorkout(
      {
        type,
        sport: type === 'other' ? kind : null,
        minutes: effectiveMinutes,
        started_at: startedAt,
        watts: type === 'bike' ? watts : null,
        watts_source: type === 'bike' && watts != null ? 'manual' : null,
        avg_hr: type === 'bike' ? toInt(avgHr) : null,
        kcal_device: type === 'other' ? toInt(deviceKcal) : null,
        favorite_id: favId,
      },
      toast,
    )
    setBusy(false)
    if (saved) sheet.close()
  }

  const field =
    'h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] tabular-nums placeholder:text-dim focus:border-eat focus:outline-none'

  return (
    <BottomSheet
      title="Já fiz"
      onClose={sheet.close}
      footer={
        <button
          disabled={!canSave || busy}
          onClick={() => void save()}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
        >
          {busy ? 'A guardar…' : `Guardar${preview.kcal > 0 ? ` · +${fmtKcal(preview.kcal)}` : ''}`}
        </button>
      }
    >
      <div className="space-y-5 pb-2">
        <div className="flex flex-wrap gap-2">
          {KINDS.map(([id, label]) => (
            <button key={id} onClick={() => setKind(id)} className={chip(kind === id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="label">Quando</p>
          <DayChips today={today} value={day} onChange={setDay} />
          <label className="flex items-center gap-3 text-[15px] text-dim">
            Começou às
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-11 rounded-xl border border-line bg-bg px-3 text-[17px] text-ink"
              aria-label="Hora de início"
            />
            {!time && <span>{day === today ? '(agora)' : '(18:00)'}</span>}
          </label>
        </div>

        <div className="space-y-2">
          <p className="label">Duração</p>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setMinutes(d)
                  setOtherMinutes('')
                }}
                className={chip(minutes === d)}
              >
                {d} min
              </button>
            ))}
            <input
              inputMode="numeric"
              placeholder="outro"
              value={otherMinutes}
              onChange={(e) => {
                setOtherMinutes(e.target.value.replace(/\D/g, ''))
                setMinutes(null)
              }}
              className="h-9 w-20 rounded-full border border-line bg-transparent px-3 text-[15px] tabular-nums placeholder:text-dim"
              aria-label="Outra duração em minutos"
            />
          </div>
        </div>

        {type === 'bike' && (
          <>
            <div className="space-y-2">
              <p className="label">Potência</p>
              <div className="flex flex-wrap gap-2">
                {[...new Set([...wattsOptions, ...(watts ? [watts] : [])])]
                  .sort((a, b) => a - b)
                  .map((w) => (
                    <button key={w} onClick={() => setWatts(w)} className={chip(watts === w)}>
                      {w} W
                    </button>
                  ))}
              </div>
            </div>
            <label className="block space-y-1">
              <span className="label">Batimentos médios (opcional)</span>
              <input
                inputMode="numeric"
                value={avgHr}
                onChange={(e) => setAvgHr(e.target.value.replace(/\D/g, ''))}
                placeholder="ex.: 128"
                className={field}
              />
              <span className="block text-[13px] text-dim">Para a app poder subir a potência.</span>
            </label>
          </>
        )}

        {type === 'other' && (
          <label className="block space-y-1">
            <span className="label">Calorias do relógio (opcional)</span>
            <input
              inputMode="numeric"
              value={deviceKcal}
              onChange={(e) => setDeviceKcal(e.target.value.replace(/\D/g, ''))}
              placeholder="ex.: 250"
              className={field}
            />
            <span className="block text-[13px] text-dim">Sem elas, estimo pelo tempo e pelo teu peso.</span>
          </label>
        )}
      </div>
    </BottomSheet>
  )
}
