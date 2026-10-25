import { BusyButton } from '../lib/busy'
import { useToast } from '../lib/toast'
import { answerDay, clearMissing, type DayAnswer } from '../lib/day-flag'
import { ANSWER_HINT } from '../../api/_lib/rules/dia-resposta'

// «Foi tudo neste dia?» (decisão 302): «Sim, foi tudo» é o botão principal e
// «Faltou algo» o secundário, com a consequência numa linha por baixo. Um
// toque grava (com o «A guardar…» de sempre) e o aviso tem Anular.
// `onAnswered` corre depois de gravar (ex.: esconder a pergunta).
export function DayAnswerButtons({
  date,
  today,
  onAnswered,
}: {
  date: string
  today: string
  onAnswered?: (flag: DayAnswer) => void
}) {
  const toast = useToast()
  const run = async (flag: DayAnswer) => {
    if (await answerDay(date, flag, today, toast)) onAnswered?.(flag)
  }
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <BusyButton
          busy="A guardar…"
          onClick={() => run('dia_fechado')}
          className="min-h-12 rounded-xl bg-cta text-[15px] font-semibold text-on-cta"
        >
          Sim, foi tudo
        </BusyButton>
        <BusyButton
          busy="A guardar…"
          onClick={() => run('faltou_algo')}
          className="min-h-12 rounded-xl border border-line text-[15px] text-dim"
        >
          Faltou algo
        </BusyButton>
      </div>
      <p className="text-[13px] text-dim">{ANSWER_HINT}</p>
    </div>
  )
}

// Num dia marcado «faltou algo» (Balanço, calendário, o Hoje desse dia): diz
// porque não conta e deixa voltar atrás com «Afinal foi tudo» (com Anular).
export function MissingNote({ date, today, compact = false }: { date: string; today: string; compact?: boolean }) {
  const toast = useToast()
  return (
    <div className={`flex items-center justify-between gap-3 ${compact ? '' : 'rounded-[18px] border border-line bg-surface p-4'}`}>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">Marcado como «faltou algo»</p>
        <p className="text-[13px] text-dim">Este dia fica fora das contas.</p>
      </div>
      <BusyButton
        busy="A guardar…"
        onClick={() => clearMissing(date, today, toast)}
        className="min-h-11 shrink-0 rounded-xl border border-eat/50 px-3 text-[14px] font-semibold text-eat"
      >
        Afinal foi tudo
      </BusyButton>
    </div>
  )
}
