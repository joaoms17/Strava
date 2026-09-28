import { useState } from 'react'
import { KNEE_ANSWERS } from '../../../api/_lib/rules/semaforo'

const TONE = ['border-ok/50 text-ok', 'border-attn/60 text-attn', 'border-pain/60 text-pain']

// O joelho em 1 toque: Bem (1), Algum incómodo (4), Doeu (7). O detalhe 0–10
// fica recolhido para quem o quiser.
export default function KneePicker({
  onAnswer,
  busy = false,
}: {
  onAnswer: (value: number) => void
  busy?: boolean
}) {
  const [detail, setDetail] = useState(false)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {KNEE_ANSWERS.map((answer, i) => (
          <button
            key={answer.label}
            disabled={busy}
            onClick={() => onAnswer(answer.value)}
            className={`min-h-14 rounded-xl border bg-surface2 px-1 text-[15px] font-semibold leading-tight disabled:opacity-50 ${TONE[i]}`}
          >
            {answer.label}
          </button>
        ))}
      </div>
      {detail ? (
        <div className="grid grid-cols-11 gap-1">
          {Array.from({ length: 11 }, (_, value) => (
            <button
              key={value}
              disabled={busy}
              onClick={() => onAnswer(value)}
              className={`rounded-lg border py-2 text-[13px] tabular-nums disabled:opacity-50 ${
                value <= 2 ? TONE[0] : value <= 5 ? TONE[1] : TONE[2]
              }`}
            >
              {value}
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
