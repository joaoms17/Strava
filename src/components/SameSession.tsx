import { timeOf } from '../lib/format'
import { BusyButton } from '../lib/busy'
import { workoutTitle } from '../lib/workout-actions'
import { startGuessed } from '../../api/_lib/rules/treino'
import type { Workout } from '../lib/types'

// Antes de guardar um treino à mão: já há um parecido nesse dia (o do relógio
// que chegou de manhã, por exemplo)? «É esse» junta os dois; «É outro» grava
// um novo.
export default function SameSession({
  workout,
  onMerge,
  onNew,
}: {
  workout: Workout
  onMerge: () => unknown
  onNew: () => unknown
}) {
  const when = workout.started_at && !startGuessed(workout) ? ` das ${timeOf(workout.started_at)}` : ''
  const origin = workout.source === 'intervals' || workout.external_id ? ', do relógio' : ''
  return (
    <div className="space-y-2">
      <p className="text-[16px]">
        Já tens registado neste dia: {workoutTitle(workout)}
        {when} ({workout.minutes ?? '?'} min{origin}). É este treino?
      </p>
      <div className="grid grid-cols-2 gap-2">
        <BusyButton
          busy="A guardar…"
          onClick={onMerge}
          className="min-h-14 rounded-2xl bg-cta font-display text-[17px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
        >
          Sim, é esse
        </BusyButton>
        <BusyButton busy="A guardar…" onClick={onNew} className="min-h-14 rounded-2xl border border-line text-[15px] disabled:opacity-40">
          Não, é outro
        </BusyButton>
      </div>
      <p className="text-[13px] text-dim">Se for, junto os dois num só treino e não conta duas vezes.</p>
    </div>
  )
}
