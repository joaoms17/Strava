import { useLocation, useSearch } from 'wouter'
import { BusyButton } from '../lib/busy'
import { planFavoriteOffline, usePlanoTreino } from '../lib/plano-treino'
import { SEGMENT_TRACK, segment } from '../components/ui/Chips'
import Icon from '../components/ui/Icon'
import {
  Cuidados,
  DayHeader,
  ExerciseList,
  KneeWarning,
  Progressao,
  bigTitle,
  dayTone,
  kicker,
} from '../components/plano/PlanoViews'
import type { PlanoDia } from '../../api/_lib/rules/plano-treino'

// O plano de treino (o PDF do treinador; decisão 305), para consultar no
// ginásio: o índice com os dias, os cuidados com o joelho, cada dia com as
// séries e as notas, e a progressão. ?ver=dia-2 | cuidados | progressao.
// Os dados vêm do perfil (guardado no telemóvel): abre sem rede.
export default function PlanoTreino() {
  const plan = usePlanoTreino()
  const [, navigate] = useLocation()
  const ver = new URLSearchParams(useSearch()).get('ver') ?? ''

  if (!plan) {
    return <p className="pt-8 text-center text-[15px] text-dim">Ainda não tens um plano de treino.</p>
  }

  const go = (v: string) => navigate(v ? `/treino/plano?ver=${v}` : '/treino/plano', { replace: true })
  const dayN = /^dia-(\d+)$/.exec(ver)?.[1]
  const day = dayN ? plan.dias.find((d) => d.n === Number(dayN)) : undefined

  // Sem rede abre na mesma (T11): o teu treino da última vez ou, se nunca
  // se abriu, o dia do plano (liga-se ao teu treino ao terminar).
  async function start(d: PlanoDia) {
    const id = await planFavoriteOffline(d)
    navigate(id ? `/treino/ginasio?fav=${id}` : `/treino/ginasio?plano=${d.n}`)
  }

  const tabs: [string, string][] = [['', 'Índice'], ...plan.dias.map((d): [string, string] => [`dia-${d.n}`, `Dia ${d.n}`])]
  const current = day ? `dia-${day.n}` : ver === 'cuidados' || ver === 'progressao' ? ver : ''

  return (
    <div className="space-y-5 pt-1 pb-24">
      <nav className={`${SEGMENT_TRACK} sticky top-2 z-10 grid gap-1`} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(([v, label]) => (
          <button
            key={v || 'indice'}
            onClick={() => go(v)}
            aria-current={current === v ? 'page' : undefined}
            className={`min-h-11 rounded-lg text-[16px] ${segment(current === v)}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {day ? (
        <>
          <DayHeader day={day} fase={plan.fase} />
          {day.aviso_joelho && <KneeWarning text={day.aviso_joelho} onOpen={() => go('cuidados')} />}
          <ExerciseList day={day} />
          <BusyButton
            busy="A abrir…"
            onClick={() => start(day)}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase"
          >
            <Icon name="dumbbell" size={22} />
            <span className="leading-tight">
              Começar Dia {day.n}
              <span className="block font-sans text-[14px] font-semibold tracking-normal normal-case opacity-80">{day.titulo}</span>
            </span>
          </BusyButton>
          <p className="text-center text-[14px] text-dim">
            Abre o Ginásio com estes exercícios, as séries e as notas. Durante a sessão, «Ver plano» mostra este dia.
          </p>
        </>
      ) : current === 'cuidados' ? (
        <>
          <div className="space-y-1">
            <p className={`${kicker} text-attn`}>Antes de começar</p>
            <h2 className={bigTitle}>Restrições e cuidados</h2>
          </div>
          <Cuidados plan={plan} />
        </>
      ) : current === 'progressao' ? (
        <>
          <div className="space-y-1">
            <p className={`${kicker} text-dim`}>Notas futuras</p>
            <h2 className={bigTitle}>Progressão</h2>
          </div>
          <Progressao plan={plan} />
        </>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-cta px-3 py-1 font-display text-[15px] font-bold tracking-[0.12em] text-on-cta uppercase">
                Fase {plan.fase}
              </span>
              {plan.quando && <span className="text-[15px] text-dim">{plan.quando}</span>}
            </div>
            <h2 className="font-display text-[48px] leading-[0.92] font-extrabold uppercase">
              Plano de <span className="text-burn">treino</span>
            </h2>
            {plan.lema && <p className="text-[18px] text-dim">{plan.lema}</p>}
          </div>

          <section className="space-y-2">
            <p className="label">Escolhe o treino</p>
            {plan.dias.map((d) => {
              const tone = dayTone(d.n)
              return (
                <button
                  key={d.n}
                  onClick={() => go(`dia-${d.n}`)}
                  className={`flex w-full items-center gap-4 rounded-[18px] border border-l-4 border-line ${tone.border} bg-surface p-4 text-left`}
                >
                  <span className={`num w-8 text-center text-[46px] leading-none ${tone.text}`}>{d.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`${kicker} block ${tone.text}`}>
                      Dia {d.n} · {d.exercicios.length} exercícios
                    </span>
                    <span className="block text-[19px] leading-tight font-semibold">{d.titulo}</span>
                    {d.resumo && <span className="block text-[15px] text-dim">{d.resumo}</span>}
                  </span>
                  <Icon name="chevron" size={22} />
                </button>
              )
            })}
          </section>

          <section className="space-y-2">
            <p className="label">Antes de começar</p>
            <div className="grid grid-cols-2 gap-2">
              {plan.cuidados && (
                <button onClick={() => go('cuidados')} className="rounded-[18px] border border-line bg-surface p-4 text-left">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-attn/15 text-attn">
                    <Icon name="alert" size={20} />
                  </span>
                  <span className="mt-3 block text-[17px] font-semibold">Cuidados</span>
                  <span className="block text-[15px] text-dim">{plan.cuidados.zona}</span>
                </button>
              )}
              {plan.progressao.length > 0 && (
                <button onClick={() => go('progressao')} className="rounded-[18px] border border-line bg-surface p-4 text-left">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-burn/15 text-burn">
                    <Icon name="chart" size={20} />
                  </span>
                  <span className="mt-3 block text-[17px] font-semibold">Progressão</span>
                  <span className="block text-[15px] text-dim">
                    {plan.progressao.length > 1
                      ? `Fases ${plan.progressao
                          .filter((f) => f.estado !== 'atual')
                          .map((f) => f.fase)
                          .join(' e ')}`
                      : `Fase ${plan.fase}`}
                  </span>
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
