import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { emitDataChanged } from '../../lib/events'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay } from '../../lib/day'
import { fmtDayShort, fmtKcal } from '../../lib/format'
import { saveWorkout, workoutTitle } from '../../lib/workout-actions'
import { lisbonInstant } from '../../../api/_lib/rules/momentos'
import { workoutKcal } from '../../../api/_lib/rules/targets'
import type { Favorite, Workout } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import KneePicker from '../ui/KneePicker'

// Folha Joelho: um treino favorito (a Bicicleta habitual) guarda-se com a
// resposta do joelho — 3 toques no total. Se faltar o «dia seguinte» da
// sessão anterior, pergunta primeiro por esse.
export default function KneeSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const favId = sheet.params.get('fav')
  const date = sheet.params.get('data')
  const [favorite, setFavorite] = useState<Favorite | null | undefined>(undefined)
  const [previous, setPrevious] = useState<Workout | null>(null)
  const [busy, setBusy] = useState(false)
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

  useEffect(() => {
    if (!favId) return
    void Promise.all([
      supabase.from('favorites').select('*').eq('id', favId).maybeSingle(),
      supabase
        .from('workouts_active')
        .select('*')
        .in('type', ['bike', 'strength'])
        .lt('date', date ?? today)
        .order('date', { ascending: false })
        .limit(1),
    ]).then(([fav, last]) => {
      setFavorite((fav.data ?? null) as Favorite | null)
      const w = (last.data?.[0] ?? null) as Workout | null
      setPrevious(w && w.pain_during != null && w.pain_next_day == null ? w : null)
    })
  }, [favId, date, today])

  if (favorite === undefined) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }
  if (!favorite?.workout) {
    return (
      <BottomSheet title="Treino" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Este favorito já não existe.</p>
      </BottomSheet>
    )
  }

  const w = favorite.workout
  const kcal = workoutKcal({ type: w.type, minutes: w.minutes, watts: w.watts ?? null, deviceCalories: null })

  async function answerPrevious(pain: number) {
    if (!previous) return
    try {
      await postApi('/api/workout/checkin', { workout_id: previous.id, pain_next_day: pain })
      setPrevious(null)
      emitDataChanged()
    } catch {
      toast('Não consegui gravar. Tenta outra vez.')
    }
  }

  async function save(pain: number) {
    setBusy(true)
    const saved = await saveWorkout(
      {
        type: w.type,
        sport: w.sport ?? null,
        minutes: w.minutes,
        watts: w.watts ?? null,
        watts_source: w.watts ? 'favorite' : null,
        favorite_id: favorite!.id,
        pain_during: pain,
        // Num dia passado, a hora habitual do fim da tarde.
        started_at: date && date !== today ? lisbonInstant(date, '18:00').toISOString() : null,
      },
      toast,
    )
    setBusy(false)
    if (saved) sheet.close()
  }

  return (
    <BottomSheet title={favorite.name} onClose={sheet.close}>
      <div className="space-y-5 pb-2">
        <div>
          <p className="num text-[30px] leading-tight">
            {w.minutes} min{w.watts ? ` · ${w.watts} W` : ''}
            {kcal > 0 && <span className="text-burn"> · +{fmtKcal(kcal)}</span>}
          </p>
          {date && date !== today && <p className="text-[15px] text-dim">Em {fmtDayShort(date)}</p>}
          <button
            onClick={() => sheet.open('ja-fiz', { fav: favorite.id, ...(date ? { data: date } : {}) })}
            className="mt-1 text-[15px] text-dim underline underline-offset-2"
          >
            Foi diferente? Mudar tempo ou potência
          </button>
        </div>

        {previous && (
          <div className="space-y-2 rounded-2xl border border-line p-3">
            <p className="text-[15px]">
              E depois da última sessão ({workoutTitle(previous).toLowerCase()}, {fmtDayShort(previous.date)})?
            </p>
            <KneePicker onAnswer={(pain) => void answerPrevious(pain)} />
          </div>
        )}

        <div className="space-y-2">
          <p className="label">Como esteve o joelho?</p>
          <KneePicker busy={busy} onAnswer={(pain) => void save(pain)} />
        </div>
      </div>
    </BottomSheet>
  )
}
