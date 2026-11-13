import { useState } from 'react'
import { splitStoredError } from '../../../api/_lib/rules/resposta-ia'

// O motivo de uma análise falhada: a frase em grande e, a pedido, o detalhe
// técnico (o que a IA ou o servidor responderam) para se poder diagnosticar.
export default function ErrorReason({ stored, fallback }: { stored: string | null | undefined; fallback: string }) {
  const { message, detail } = splitStoredError(stored)
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1">
      <p className="text-[1.0625rem]">{message ?? fallback}</p>
      {detail &&
        (open ? (
          <p className="rounded-lg bg-surface2 p-2 font-mono text-[0.75rem] break-words text-dim select-text">{detail}</p>
        ) : (
          <button onClick={() => setOpen(true)} className="text-[0.8125rem] text-dim underline underline-offset-2">
            Ver detalhe
          </button>
        ))}
    </div>
  )
}
