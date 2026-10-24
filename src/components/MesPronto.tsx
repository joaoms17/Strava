import { useProfile, useReadyProfile } from '../lib/profile'
import { useSheet } from '../lib/sheet'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { loadMonth } from '../lib/projecao'
import { shareMonthReport } from '../lib/month-report'
import { bannerKey, monthBanner, monthName } from '../../api/_lib/rules/mes'

// Hoje, nos dias 1–3: «O teu mês de outubro está pronto», uma vez por mês
// (fica em dismissed_hints ao ver, partilhar ou fechar).
export default function MesPronto({ today }: { today: string }) {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const sheet = useSheet()
  const toast = useToast()
  const hints = profile.dismissed_hints ?? []
  const month = monthBanner(today, hints)
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
            const how = await shareMonthReport(await loadMonth(profile, month, today))
            if (how === 'downloaded') toast('Imagem guardada.')
            if (how !== 'cancelled') await dismiss()
          } catch {
            toast('Não consegui criar a imagem.')
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
