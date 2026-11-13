import { useEffect, useState } from 'react'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useSheet } from '../lib/sheet'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { loadMonth } from '../lib/projecao'
import { shareMonthReport } from '../lib/month-report'
import { bannerKey, monthBanner, monthName, type MonthSummary } from '../../api/_lib/rules/mes'

// Hoje, nos dias 1–3: «O teu mês de outubro está pronto», uma vez por mês
// (fica em dismissed_hints ao ver, partilhar ou fechar).
export default function MesPronto({ today }: { today: string }) {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const sheet = useSheet()
  const toast = useToast()
  const hints = profile.dismissed_hints ?? []
  const month = monthBanner(today, hints)
  // B12: o mês lê-se quando o aviso aparece; «Partilhar» abre logo a partilha
  // (no iOS, depois de 5 pedidos já não havia toque recente e falhava).
  const [ready, setReady] = useState<{ month: string; summary: MonthSummary } | null>(null)
  useEffect(() => {
    if (!month) return
    let alive = true
    loadMonth(profile, month, today)
      .then((summary) => alive && setReady({ month, summary }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [profile, month, today])
  if (!month) return null
  const dismiss = () => update({ dismissed_hints: [...hints, bannerKey(month)] })

  return (
    <section className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4">
      <p className="min-w-0 flex-1 text-[15px] font-semibold">O teu mês de {monthName(month)} está pronto</p>
      <button
        onClick={() => {
          sheet.open('mes', { mes: month })
          void dismiss()
        }}
        className="min-h-11 rounded-xl border border-line px-3 text-[15px] font-semibold"
      >
        Ver
      </button>
      <BusyButton
        busy="A preparar…"
        onClick={async () => {
          try {
            const summary = ready?.month === month ? ready.summary : await loadMonth(profile, month, today)
            const how = await shareMonthReport(summary)
            if (how === 'downloaded') toast('Imagem guardada.')
            if (how !== 'cancelled') await dismiss()
          } catch (err) {
            // Sem toque recente o iOS recusa a partilha: a imagem já está pronta, basta tocar outra vez.
            toast((err as Error)?.name === 'NotAllowedError' ? 'A imagem está pronta: toca outra vez em Partilhar.' : 'Não consegui criar a imagem.')
          }
        }}
        className="min-h-11 rounded-xl bg-cta px-3 text-[15px] font-semibold text-on-cta"
      >
        Partilhar
      </BusyButton>
      <button onClick={() => void dismiss()} className="h-11 w-8 text-dim" aria-label="Fechar">
        ✕
      </button>
    </section>
  )
}
