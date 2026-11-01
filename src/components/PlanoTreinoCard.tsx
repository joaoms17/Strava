import { useLocation } from 'wouter'
import { usePlanoTreino } from '../lib/plano-treino'
import Icon from './ui/Icon'
import { dayTone } from './plano/PlanoViews'
import { dayLabel } from '../../api/_lib/rules/plano-treino'

// «Plano de treino» no Treino, por baixo de «Registar treino» (decisão 305):
// só para quem tem um plano (o João). O cartão abre o índice; cada dia abre
// esse dia.
export default function PlanoTreinoCard() {
  const plan = usePlanoTreino()
  const [, navigate] = useLocation()
  if (!plan) return null
  return (
    <section className="space-y-2 rounded-[18px] border border-line bg-surface p-3" aria-label="Plano de treino">
      <button onClick={() => navigate('/treino/plano')} className="flex min-h-11 w-full items-center gap-3 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface2 text-burn">
          <Icon name="calendar" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold">Plano de treino</span>
          <span className="block truncate text-[14px] text-dim">Fase {plan.fase} · cuidados e progressão</span>
        </span>
        <Icon name="chevron" size={20} />
      </button>
      <div className="grid grid-cols-3 gap-2">
        {plan.dias.map((d) => (
          <button
            key={d.n}
            onClick={() => navigate(`/treino/plano?ver=dia-${d.n}`)}
            className="flex min-h-14 flex-col justify-center rounded-xl border border-line bg-bg px-2.5 py-2 text-left leading-tight"
            aria-label={dayLabel(d)}
          >
            <span className={`num text-[18px] ${dayTone(d.n).text}`}>Dia {d.n}</span>
            <span className="text-[13px] text-dim">{d.curto ?? d.titulo}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
