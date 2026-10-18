import { useEffect, useState } from 'react'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { busyContent, runBusy, useBusyKey } from '../lib/busy'
import { NO_PUSH, applyPush, checkPush, pushPermission, pushSupport, savedPushPrefs, type PushState } from '../lib/push'
import { MEAL_PUSH_HINT, offerMealPush } from '../../api/_lib/rules/notificacoes'

// «Avisar-me quando acabar»: enquanto uma foto está a analisar, oferece a
// notificação «Refeição analisada» onde se espera por ela (a linha da
// refeição no Hoje e a folha da refeição), em vez de só em Definições ›
// Notificações. A autorização do iPhone pede-se no próprio toque. Antes de
// aparecer confirma (por trás) que este telemóvel não recebe as notificações
// de outra pessoa, que um toque aqui lhe tiraria (decisão 234).
export default function AvisarAnalise({ className = '' }: { className?: string }) {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const toast = useToast()
  const [key, mine] = useBusyKey()
  const hints = profile.dismissed_hints ?? []
  const dismissed = hints.includes(MEAL_PUSH_HINT)
  const support = pushSupport()
  const [state, setState] = useState<PushState | null>(null)

  useEffect(() => {
    if (dismissed || support !== 'ok' || pushPermission() === 'denied') return
    let alive = true
    void checkPush()
      .then((next) => {
        if (alive) setState(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [dismissed, support])

  const prefs = state?.prefs ?? savedPushPrefs()
  if (!offerMealPush({ support, permission: pushPermission(), prefs, other: state?.other ?? null, dismissed })) return null

  function turnOn() {
    void runBusy(
      'A ligar…',
      async () => {
        const result = await applyPush({ ...(prefs ?? NO_PUSH), refeicao: true })
        setState(result)
        toast(
          result.moved
            ? 'Ligado. Neste telemóvel as notificações deixam de ir para a outra pessoa.'
            : 'Ligado: aviso-te quando acabar (muda-se em Definições › Notificações).',
        )
      },
      key,
    )
  }

  return (
    <p className={`flex flex-wrap items-center gap-x-1 text-[14px] ${className}`}>
      <button onClick={turnOn} disabled={mine} className="min-h-10 text-eat">
        {busyContent(mine, 'A ligar…', 'Avisar-me quando acabar')}
      </button>
      <span className="text-dim" aria-hidden>
        ·
      </span>
      {/* Esconde de vez (como os outros cartões de pessoa nova). */}
      <button onClick={() => void update({ dismissed_hints: [...hints, MEAL_PUSH_HINT] })} className="min-h-10 px-1 text-dim">
        Não, obrigado
      </button>
    </p>
  )
}
