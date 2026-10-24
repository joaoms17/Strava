import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { BusyButton } from '../../lib/busy'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { localCalendarDate, shiftDate } from '../../lib/day'
import { loadMonth } from '../../lib/projecao'
import { drawMonthReport, shareMonthReport } from '../../lib/month-report'
import { monthLabel, monthBounds, previousMonth, type MonthSummary } from '../../../api/_lib/rules/mes'

const nextMonth = (month: string) => shiftDate(monthBounds(month).last, 1).slice(0, 7)

// «O teu mês» (?folha=mes&mes=2026-10): a imagem do mês, para ver e
// partilhar; qualquer mês passado com ‹ ›.
export default function MesSheet() {
  const sheet = useSheet()
  const profile = useReadyProfile()
  const toast = useToast()
  const today = localCalendarDate()
  const thisMonth = today.slice(0, 7)
  const [month, setMonth] = useState(sheet.params.get('mes') ?? previousMonth(today))
  const [summary, setSummary] = useState<MonthSummary | null | 'erro'>(null)
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSummary(null)
    setImage(null)
    loadMonth(profile, month, today)
      .then((s) => {
        if (!alive) return
        setSummary(s)
        setImage(drawMonthReport(s).toDataURL('image/png'))
      })
      .catch(() => alive && setSummary('erro'))
    return () => {
      alive = false
    }
  }, [profile, month, today])

  return (
    <BottomSheet
      title="O teu mês"
      onClose={sheet.close}
      footer={
        <BusyButton
          busy="A preparar…"
          disabled={!summary || summary === 'erro'}
          onClick={async () => {
            if (!summary || summary === 'erro') return
            try {
              const how = await shareMonthReport(summary)
              if (how === 'downloaded') toast('Imagem guardada.')
            } catch {
              toast('Não consegui criar a imagem.')
            }
          }}
          className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
        >
          Partilhar
        </BusyButton>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="flex items-center justify-between">
          <button onClick={() => setMonth(previousMonth(`${month}-01`))} className="h-11 w-11 text-xl text-dim" aria-label="Mês anterior">
            ‹
          </button>
          <p className="text-[17px] font-semibold">{monthLabel(month)}</p>
          <button
            disabled={nextMonth(month) > thisMonth}
            onClick={() => setMonth(nextMonth(month))}
            className="h-11 w-11 text-xl text-dim disabled:opacity-30"
            aria-label="Mês seguinte"
          >
            ›
          </button>
        </div>
        {summary === 'erro' ? (
          <p className="py-6 text-center text-[15px] text-dim">Não consegui ler o mês.</p>
        ) : image ? (
          <img src={image} alt={`O meu mês, ${monthLabel(month)}`} className="w-full rounded-2xl border border-line" />
        ) : (
          <p className="py-6 text-center text-[15px] text-dim">A carregar…</p>
        )}
        {month === thisMonth && <p className="text-[13px] text-dim">O mês ainda não acabou: os números são até hoje.</p>}
      </div>
    </BottomSheet>
  )
}
