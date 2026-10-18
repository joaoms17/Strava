import { useEffect, useState } from 'react'
import { useToast } from '../lib/toast'
import { BusyButton, Spinner, runBusy, useBusyKey } from '../lib/busy'
import {
  DENIED_TEXT,
  NO_PUSH,
  applyPush,
  checkPush,
  pushPermission,
  pushSupport,
  savedPushPrefs,
  testPush,
  type PushState,
} from '../lib/push'
import type { PushKind, PushPrefs } from '../../api/_lib/rules/notificacoes'

// Definições › Notificações: cada uma liga-se à parte, neste telemóvel. O
// texto no ecrã bloqueado é neutro (sem pesos nem gordura).

const KINDS: { kind: PushKind; label: string; help: string }[] = [
  {
    kind: 'refeicao',
    label: 'Refeição analisada',
    help: 'Quando a IA acaba de ler a foto: «Almoço analisado · 640 kcal». Toca para ver ou corrigir.',
  },
  {
    kind: 'jantar',
    label: 'Lembrete do jantar',
    help: 'À noite, se o dia ainda não estiver completo e não houver jantar registado.',
  },
  {
    kind: 'semana',
    label: 'Resumo da semana',
    help: 'À segunda à noite, quando o resumo da semana que passou está pronto.',
  },
]

function KindToggle({
  label,
  help,
  value,
  disabled,
  onChange,
}: {
  label: string
  help: string
  value: boolean
  disabled: boolean
  onChange: (value: boolean, key: string) => void
}) {
  const [key, mine] = useBusyKey()
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-[15px]">{label}</span>
        <span className="block text-[13px] text-dim">{help}</span>
      </span>
      {mine ? (
        <Spinner size={24} className="mt-1" />
      ) : (
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked, key)}
          className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-eat)] disabled:opacity-40"
        />
      )}
    </label>
  )
}

export default function Notificacoes() {
  const toast = useToast()
  const support = pushSupport()
  const [state, setState] = useState<PushState>(() => ({ prefs: savedPushPrefs(), other: false }))
  const [permission, setPermission] = useState(pushPermission)

  // A subscrição deste telemóvel continua viva? (por trás, sem bloquear)
  useEffect(() => {
    if (support !== 'ok') return
    void checkPush()
      .then(setState)
      .catch(() => undefined)
  }, [support])

  if (support === 'instalar') {
    return (
      <p className="text-[13px] text-dim">
        No iPhone, as notificações só funcionam com a app no ecrã principal: no Safari, toca em Partilhar › «Adicionar ao
        ecrã principal» e abre a app pelo ícone. Depois liga-as aqui.
      </p>
    )
  }
  if (support === 'nao') {
    return (
      <p className="text-[13px] text-dim">
        Este telemóvel não recebe notificações da app. No iPhone é preciso o iOS 16.4 ou mais recente, com a app no ecrã
        principal.
      </p>
    )
  }

  const prefs: PushPrefs = state.prefs ?? NO_PUSH
  const on = state.prefs != null

  function change(kind: PushKind, value: boolean, key: string) {
    void runBusy(
      value ? 'A ligar…' : 'A desligar…',
      async () => {
        try {
          const result = await applyPush({ ...prefs, [kind]: value })
          setState(result)
          if (!result.prefs) toast('Notificações desligadas neste telemóvel.')
          else if (result.moved) toast('Notificações ligadas. Neste telemóvel deixam de ir para a outra pessoa.')
          else toast(on ? 'Guardado.' : 'Notificações ligadas neste telemóvel.')
        } finally {
          setPermission(pushPermission())
        }
      },
      key,
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-dim">
        Avisos no ecrã do telemóvel, só os que ligares. Não mostram pesos nem gordura. No iPhone, só com a app no ecrã
        principal; cada telemóvel liga as suas.
      </p>
      {permission === 'denied' && <p className="text-[14px] text-attn">{DENIED_TEXT}</p>}
      {state.other && !on && (
        <p className="text-[14px] text-attn">
          Neste telemóvel as notificações estão ligadas para outra pessoa. Se as ligares aqui, passam a ser tuas.
        </p>
      )}
      {KINDS.map((k) => (
        <KindToggle
          key={k.kind}
          label={k.label}
          help={k.help}
          value={prefs[k.kind]}
          disabled={permission === 'denied'}
          onChange={(value, key) => change(k.kind, value, key)}
        />
      ))}
      {on && permission === 'granted' && (
        <BusyButton
          busy="A enviar…"
          onClick={async () => {
            await testPush()
            toast('Enviada. Deve aparecer daqui a uns segundos.')
          }}
          className="min-h-11 w-full rounded-xl bg-surface2 text-[15px]"
        >
          Mandar uma de teste
        </BusyButton>
      )}
    </div>
  )
}
