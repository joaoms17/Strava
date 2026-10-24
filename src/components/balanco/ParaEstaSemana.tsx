import { fmtDayShort } from '../../lib/format'
import type { WeekAction } from '../../../api/_lib/rules/balanco-graficos'

// Balanço › Semana › «Para esta semana»: uma ação só, tirada dos números da
// pessoa (rules/balanco-graficos.ts › weekAction), em vez de repetir a frase
// do topo.
export default function ParaEstaSemana({ action, onOpenDay }: { action: WeekAction; onOpenDay: (date: string) => void }) {
  return (
    <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4" aria-label="Para esta semana">
      <p className="font-display text-[12px] font-bold tracking-[0.16em] text-burn uppercase">Para esta semana</p>
      <p className="text-[19px] leading-snug font-semibold">{action.title}</p>
      <p className="text-[15px] text-dim">{action.detail}</p>
      {action.date && (
        <button onClick={() => onOpenDay(action.date!)} className="min-h-10 text-[15px] font-semibold text-eat">
          Abrir {fmtDayShort(action.date)} ›
        </button>
      )}
    </section>
  )
}
