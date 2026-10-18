import { useEffect, useState } from 'react'
import { useToast } from '../lib/toast'
import { useReadyProfile } from '../lib/profile'
import { emitDataChanged } from '../lib/events'
import { useSignedUrls } from '../lib/photos'
import { recomputeFrom } from '../lib/recompute'
import { nutritionalDay } from '../lib/day'
import { diffText } from '../lib/meal-diff'
import { fmtKcal, timeOf } from '../lib/format'
import { BusyLabel, runBusy, useBusyKey } from '../lib/busy'
import {
  findLeftoversCandidate,
  sendLeftovers,
  undoLeftovers,
  type LeftoversCandidate,
  type LeftoversResult,
} from '../lib/sobras'
import { mealFolder, offersLeftovers, ofSlot, type PlateMeal } from '../../api/_lib/rules/sobras'
import { slotOf } from '../../api/_lib/rules/momentos'
import Thumb from './ui/Thumb'
import type { Meal } from '../lib/types'

// Foto do antes e do depois: depois de comer, a foto do que sobrou desconta-o
// dos itens (a IA compara com a do prato cheio), sem escrever «comi metade».
// Na folha da refeição, «Sobrou comida?» e a miniatura «depois»; no ＋, com
// uma foto nova pouco depois de uma refeição por foto, «Isto é o que sobrou
// do almoço?» (por omissão continua a ser uma refeição nova).

const BUSY_TEXT = 'A comparar o antes e o depois…'

type Changed = Extract<LeftoversResult, { outcome: 'aplicado' | 'tudo' }>
type Unchanged = Extract<LeftoversResult, { outcome: 'outro_prato' | 'igual' }>

// O aviso do fim, com Anular (como o «Juntar foto»).
function announce(
  toast: ReturnType<typeof useToast>,
  result: Changed,
  today: string,
  after?: () => void,
) {
  const text =
    result.outcome === 'tudo'
      ? 'Comeste tudo: os números ficam como estavam.'
      : `Descontei o que sobrou · ${diffText(result.previous.items, result.meal.items)}`
  toast(text, [
    {
      label: 'Anular',
      run: async () => {
        await undoLeftovers(result.meal.id, result.photo_path, result.previous)
        emitDataChanged()
        recomputeFrom(result.meal.date, today)
        after?.()
      },
    },
  ])
}

function unchanged(result: LeftoversResult): result is Unchanged {
  return result.outcome === 'outro_prato' || result.outcome === 'igual'
}

function nothingChanged(result: Unchanged, then: string): string {
  if (result.outcome === 'igual') return `Na foto do depois o prato está como no antes. ${then}`
  return `Esta foto não parece ser do mesmo prato${result.reason ? ` (${result.reason})` : ''}. ${then}`
}

// Sem a migração a coluna não vem, e o botão não aparece.
function takesLeftovers(meal: Meal, today: string): boolean {
  return 'leftover_photo_path' in meal && offersLeftovers(meal as unknown as PlateMeal & { date: string }, today)
}

// «Sobrou comida?» na folha da refeição: abre a câmara ou a galeria (sem
// «capture», o iPhone oferece as duas no mesmo toque).
export function LeftoversButton({ meal, className, onDone }: { meal: Meal; className?: string; onDone?: () => void }) {
  const profile = useReadyProfile()
  const toast = useToast()
  const [key, busy] = useBusyKey()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  if (!takesLeftovers(meal, today)) return null
  return (
    <label className={`cursor-pointer ${busy ? 'pointer-events-none' : ''} ${className ?? ''}`} aria-busy={busy || undefined}>
      {busy ? <BusyLabel text="A comparar…" /> : 'Sobrou comida?'}
      <input
        type="file"
        accept="image/*"
        aria-label="Foto do que sobrou"
        className="hidden"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void runBusy(
            BUSY_TEXT,
            async () => {
              try {
                const result = await sendLeftovers(meal, file)
                if (unchanged(result)) {
                  toast(nothingChanged(result, 'Não mudei nada.'))
                  return
                }
                emitDataChanged()
                onDone?.()
                announce(toast, result, today, onDone)
                recomputeFrom(meal.date, today)
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Não consegui comparar as fotos.')
              }
            },
            key,
          )
        }}
      />
    </label>
  )
}

// A miniatura «depois» na folha da refeição, com o que ficou no prato.
export function LeftoversNote({ meal }: { meal: Meal }) {
  const path = meal.leftover_thumb_path ?? meal.leftover_photo_path ?? null
  const urls = useSignedUrls([path])
  if (!meal.leftover_photo_path) return null
  const left = Number(meal.leftover_kcal ?? 0)
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface2 p-2 pr-3">
      <span className="relative shrink-0 overflow-hidden rounded-xl">
        <Thumb url={path ? urls[path] : null} size={52} />
        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-px text-center text-[11px] font-semibold text-white">depois</span>
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] tabular-nums">{left > 0 ? `Sobraram ≈ ${fmtKcal(left)} kcal no prato` : 'Comeste tudo'}</span>
        <span className="block text-[13px] text-dim">{left > 0 ? 'Já descontado nos números.' : 'Os números ficam como estavam.'}</span>
      </span>
    </div>
  )
}

// «Não, é outra refeição» vale para essa refeição até a app recarregar.
const dismissed = new Set<string>()

// No ＋, com uma só foto e «Agora»: se for o que sobrou de uma refeição de há
// pouco, pergunta. «Sim» desconta-o nessa refeição em vez de criar outra;
// sem resposta, «Registar» continua a criar uma refeição nova.
export function LeftoversQuestion({
  file,
  active,
  note,
  onApplied,
}: {
  file: File | null
  active: boolean
  note?: string
  onApplied: () => void
}) {
  const profile = useReadyProfile()
  const toast = useToast()
  const [key, busy] = useBusyKey()
  const [candidate, setCandidate] = useState<LeftoversCandidate | null>(null)
  const folder = candidate ? mealFolder(candidate) : ''
  const thumb = candidate ? ((candidate.thumb_paths ?? []).find((p) => p.startsWith(folder)) ?? null) : null
  const urls = useSignedUrls([thumb])

  useEffect(() => {
    setCandidate(null)
    if (!file || !active) return
    let alive = true
    void findLeftoversCandidate(file, profile.nutrition_day_cutoff_hour).then((found) => {
      if (alive && found && !dismissed.has(found.id)) setCandidate(found)
    })
    return () => {
      alive = false
    }
  }, [file, active, profile.nutrition_day_cutoff_hour])

  if (!candidate || !file || !active) return null
  const meal = candidate
  const slot = meal.slot ?? slotOf(new Date(meal.logged_at))
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

  function no() {
    dismissed.add(meal.id)
    setCandidate(null)
  }

  function yes() {
    void runBusy(
      BUSY_TEXT,
      async () => {
        try {
          const result = await sendLeftovers(meal, file!, note)
          if (unchanged(result)) {
            no()
            toast(nothingChanged(result, 'Fica para registar como refeição nova.'))
            return
          }
          emitDataChanged()
          onApplied()
          announce(toast, result, today)
          recomputeFrom(meal.date, today)
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Não consegui comparar as fotos.')
        }
      },
      key,
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface2 p-3" role="group" aria-label="É o que sobrou?">
      <div className="flex items-center gap-3">
        <Thumb url={thumb ? urls[thumb] : null} size={44} />
        <div className="min-w-0">
          <p className="text-[16px] leading-snug font-semibold">Isto é o que sobrou {ofSlot(slot)}?</p>
          <p className="text-[13px] text-dim tabular-nums">
            Desconto o que ficou no prato das {timeOf(meal.logged_at)}{' '}
            <span className="whitespace-nowrap">(≈ {fmtKcal(Number(meal.kcal))} kcal).</span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-[2fr_3fr] gap-2">
        <button
          onClick={yes}
          disabled={busy}
          aria-busy={busy || undefined}
          className="min-h-11 rounded-xl border border-eat text-[15px] font-semibold text-eat"
        >
          {busy ? <BusyLabel text="A comparar…" /> : 'Sim'}
        </button>
        <button onClick={no} disabled={busy} className="min-h-11 rounded-xl bg-surface text-[15px]">
          Não, é outra refeição
        </button>
      </div>
    </div>
  )
}
