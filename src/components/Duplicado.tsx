import { postApi } from '../lib/api'
import { BusyButton } from '../lib/busy'
import { emitDataChanged } from '../lib/events'
import { timeOf } from '../lib/format'
import { useToast } from '../lib/toast'
import { joinWorkouts, workoutTitle } from '../lib/workout-actions'
import { workoutOrigin } from '../lib/treino-origem'
import { startGuessed } from '../../api/_lib/rules/treino'
import type { Workout } from '../lib/types'

const describe = (w: Workout) =>
  [w.started_at && !startGuessed(w) ? `das ${timeOf(w.started_at)}` : null, w.minutes != null ? `${w.minutes} min` : null, workoutOrigin(w)]
    .filter(Boolean)
    .join(', ')

// «Possível duplicado» (T1): o mesmo treino registado duas vezes (o «Já fiz»
// e o do relógio, o cronómetro do Ginásio e o relógio). «Juntar os dois» fica
// com um só (o do relógio, com as séries, o teu treino e a nota do outro), com
// Anular; «São dois» deixa de avisar. `a` é o que não veio do relógio.
export default function Duplicado({
  a,
  b,
  onJoined,
  onSeparated,
  compact = false,
}: {
  a: Workout
  b: Workout
  onJoined?: (kept: Workout) => void
  onSeparated?: () => void
  compact?: boolean
}) {
  const toast = useToast()

  async function join() {
    const kept = await joinWorkouts(a, b, toast)
    if (kept) onJoined?.(kept)
  }

  async function separate() {
    try {
      await postApi('/api/workout/update', { workout_id: a.id, outro_treino: true })
      emitDataChanged()
      onSeparated?.()
      toast('Ficam os dois treinos.', [
        {
          label: 'Anular',
          run: async () => {
            try {
              await postApi('/api/workout/update', { workout_id: a.id, outro_treino: false })
              emitDataChanged()
              onSeparated?.()
            } catch (err) {
              toast(err instanceof Error ? `Não anulei: ${err.message}` : 'Não consegui anular.')
            }
          },
        },
      ])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gravar.')
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3 rounded-[18px] border border-attn/50 bg-attn/10 p-4'}>
      <p className="text-[1rem]">
        {!compact && <span className="block font-semibold">Possível duplicado</span>}
        {workoutTitle(a)} ({describe(a)}) e {workoutTitle(b).toLowerCase()} ({describe(b)}). É o mesmo treino?
      </p>
      <div className="grid grid-cols-2 gap-2">
        <BusyButton
          busy="A juntar…"
          onClick={join}
          className="min-h-12 rounded-xl bg-cta font-display text-[1rem] font-bold tracking-[0.04em] text-on-cta uppercase disabled:opacity-40"
        >
          Juntar os dois
        </BusyButton>
        <BusyButton busy="A guardar…" onClick={separate} className="min-h-12 rounded-xl border border-line text-[0.9375rem] disabled:opacity-40">
          São dois
        </BusyButton>
      </div>
      <p className="text-[0.8125rem] text-dim">Juntos contam uma vez. Podes anular a seguir.</p>
    </div>
  )
}
