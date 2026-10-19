import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton } from '../../lib/busy'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay } from '../../lib/day'
import { fmtDayShort, fmtKcal } from '../../lib/format'
import { SPORT_LABEL, sameDaySession, saveWorkout } from '../../lib/workout-actions'
import { lisbonInstant } from '../../../api/_lib/rules/momentos'
import { exerciseKcal } from '../../../api/_lib/rules/treino'
import { isOtherSport } from '../../../api/_lib/rules/targets'
import { useKcalContext } from '../../lib/kcal-context'
import type { Favorite, Workout } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import SameSession from '../SameSession'

// Registar um dos teus treinos (bicicleta, corrida, padel…): o que costuma
// ser, com «Foi diferente?» para mudar o tempo ou a potência. Dois toques.
export default function LogWorkoutSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const favId = sheet.params.get('fav')
  const date = sheet.params.get('data')
  const [favorite, setFavorite] = useState<Favorite | null | undefined>(undefined)
  // Um treino parecido já registado nesse dia (o do relógio): é o mesmo?
  const [match, setMatch] = useState<Workout | null>(null)
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

  useEffect(() => {
    if (!favId) return
    void supabase
      .from('favorites')
      .select('*')
      .eq('id', favId)
      .maybeSingle()
      .then(({ data }) => setFavorite((data ?? null) as Favorite | null))
  }, [favId])
  // As kcal como o servidor as conta: o peso desse dia e, no ginásio, o teu ritmo.
  const context = useKcalContext(date ?? today, today, favorite?.workout?.type ?? null)

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
        <p className="py-6 text-center text-[15px] text-dim">Este treino já não existe.</p>
      </BottomSheet>
    )
  }

  const w = favorite.workout
  const { kcal } = exerciseKcal({
    type: w.type,
    minutes: w.minutes,
    watts: w.watts ?? null,
    wattsSource: w.watts ? 'favorite' : null,
    deviceCalories: null,
    sport: w.type === 'other' && isOtherSport(w.sport) ? w.sport : null,
    weightKg: context.weightKg,
    gymPace: context.gymPace,
  })
  const kind = w.type === 'bike' ? 'Bicicleta' : w.type === 'strength' ? 'Ginásio' : (SPORT_LABEL[w.sport ?? 'outro'] ?? 'Treino')

  // Sem decisão, vê primeiro se já há um treino parecido nesse dia.
  async function save(decision?: 'merge' | 'new') {
    const day = date ?? today
    if (!decision) {
      const found = await sameDaySession({ type: w.type, sport: w.sport ?? null, date: day, minutes: w.minutes, started_at: null })
      if (found) {
        setMatch(found)
        return
      }
    }
    // Num dia passado, a hora habitual do fim da tarde (suposta).
    const startedAt = day !== today ? lisbonInstant(day, '18:00').toISOString() : null
    const saved = await saveWorkout(
      {
        type: w.type,
        sport: w.sport ?? null,
        minutes: w.minutes,
        watts: w.watts ?? null,
        watts_source: w.watts ? 'favorite' : null,
        favorite_id: favorite!.id,
        started_at: startedAt,
        started_at_estimated: startedAt != null,
        merge_into: decision === 'merge' ? match?.id : null,
        not_duplicate: decision === 'new',
      },
      toast,
    )
    if (saved) sheet.close()
  }

  return (
    <BottomSheet
      title={favorite.name}
      onClose={sheet.close}
      footer={
        match ? (
          <SameSession workout={match} onMerge={() => save('merge')} onNew={() => save('new')} />
        ) : (
          <BusyButton
            busy="A guardar…"
            onClick={() => save()}
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
          >
            Registar
          </BusyButton>
        )
      }
    >
      <div className="space-y-3 pb-2">
        <p className="text-[15px] text-dim">{kind}</p>
        <p className="num text-[30px] leading-tight">
          {w.minutes} min{w.watts ? ` · ${w.watts} W` : ''}
          {kcal > 0 && <span className="text-burn"> · +{fmtKcal(kcal)}</span>}
        </p>
        {date && date !== today && <p className="text-[15px] text-dim">Em {fmtDayShort(date)}</p>}
        <button
          onClick={() => sheet.open('ja-fiz', { fav: favorite.id, ...(date ? { data: date } : {}) })}
          className="text-[15px] text-dim underline underline-offset-2"
        >
          Foi diferente? Mudar o tempo{w.type === 'bike' ? ' ou a potência' : ''}
        </button>
      </div>
    </BottomSheet>
  )
}
