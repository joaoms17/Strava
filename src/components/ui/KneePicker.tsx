import { useState } from 'react'
import { KNEE_ANSWERS } from '../../../api/_lib/rules/semaforo'

const TONE = ['border-ok/50 text-ok', 'border-attn/60 text-attn', 'border-pain/60 text-pain']
const FILLED = ['!bg-ok !text-bg', '!bg-attn !text-bg', '!bg-pain !text-bg']

// O joelho em 1 toque: Bem (1), Algum incómodo (4), Doeu (7). O detalhe 0–10
// fica recolhido para quem o quiser.
export default function KneePicker({
  onAnswer,
  busy = false,
  value = null,
}: {
  onAnswer: (value: number) => void
  busy?: boolean
  value?: number | null
}) {
  const [detail, setDetail] = useState(false)
  // Com um valor escolhido, o botão do grupo dele fica cheio.
  const group = value == null ? null : value <= 2 ? 0 : value <= 5 ? 1 : 2
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {KNEE_ANSWERS.map((answer, i) => (
          <button
            key={answer.label}
            disabled={busy}
            onClick={() => onAnswer(answer.value)}
            aria-pressed={group === i}
            className={`min-h-14 rounded-xl border px-1 text-[15px] font-semibold leading-tight disabled:opacity-50 ${TONE[i]} ${
              group === i ? FILLED[i] : 'bg-surface2'
            }`}
          >
            {answer.label}
          </button>
        ))}
      </div>
      {detail ? (
        <div className="grid grid-cols-11 gap-1">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              disabled={busy}
              onClick={() => onAnswer(n)}
              className={`rounded-lg border py-2 text-[13px] tabular-nums disabled:opacity-50 ${
                n <= 2 ? TONE[0] : n <= 5 ? TONE[1] : TONE[2]
              } ${value === n ? 'font-bold underline' : ''}`}
            >
              {n}
            </button>
          ))}
        </div>
      ) : (
        <button onClick={() => setDetail(true)} className="text-[13px] text-dim underline-offset-2 hover:underline">
          mais detalhe 0–10
        </button>
      )}
    </div>
  )
}
