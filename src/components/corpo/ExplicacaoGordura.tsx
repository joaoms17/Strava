import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton } from '../../lib/busy'
import { emitDataChanged } from '../../lib/events'
import { fmt1, fmtDayMonth } from '../../lib/format'
import type { BodyMeasurement } from '../../lib/types'
import type { MeasureExplanation } from '../../../api/_lib/rules/composicao'

const cm = (n: number) => (Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : fmt1(n))

// «Está certo»: o pescoço medido passa a contar (readings.neck_confirmed);
// com Anular, que repõe as leituras como estavam.
export function useConfirmNeck() {
  const toast = useToast()
  return async (row: Pick<BodyMeasurement, 'id' | 'readings'>, neckCm: number) => {
    const before = row.readings ?? {}
    const { error } = await supabase
      .from('body_measurements')
      .update({ readings: { ...before, neck_confirmed: true } })
      .eq('id', row.id)
    if (error) {
      toast('Não consegui guardar. Tenta outra vez.')
      return
    }
    emitDataChanged()
    toast(`Pescoço de ${cm(neckCm)} cm aceite: a %G conta com ele.`, [
      {
        label: 'Anular',
        run: async () => {
          await supabase.from('body_measurements').update({ readings: before }).eq('id', row.id)
          emitDataChanged()
        },
      },
    ])
  }
}

// Porque mudou a %G desde a medição anterior (decisão 303): a frase com a
// parte da cintura (e da anca) e a do pescoço e, quando a conta usa o
// pescoço habitual, a nota com a %G que fica e «Está certo» / «Corrigir».
export default function ExplicacaoGordura({
  explanation: x,
  row,
  offerConfirm = true,
  compact = false,
}: {
  explanation: MeasureExplanation
  row?: Pick<BodyMeasurement, 'id' | 'readings'>
  offerConfirm?: boolean
  compact?: boolean
}) {
  const confirmNeck = useConfirmNeck()
  const sheet = useSheet()
  const ask = offerConfirm && x.askConfirm && row != null && x.neck != null
  return (
    <div className={`space-y-2 ${compact ? 'text-[14px]' : 'text-[15px]'}`}>
      <p>
        <span className="text-dim">Desde {fmtDayMonth(x.previousDate)}: </span>
        {x.change.text}
      </p>
      {x.usualNote && <p className="rounded-xl bg-surface2 px-3 py-2">{x.usualNote}</p>}
      {ask && (
        <div className="grid grid-cols-2 gap-2">
          <BusyButton
            busy="A guardar…"
            onClick={() => confirmNeck(row, x.neck!.measured)}
            className="min-h-11 rounded-xl border border-line px-2 text-[14px] font-semibold"
          >
            Está certo ({cm(x.neck!.measured)} cm)
          </BusyButton>
          <button onClick={() => sheet.open('medidas', { id: row.id })} className="min-h-11 rounded-xl border border-line px-2 text-[14px]">
            Corrigir a medida
          </button>
        </div>
      )}
    </div>
  )
}
