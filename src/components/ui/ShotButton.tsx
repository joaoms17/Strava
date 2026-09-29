import { useState, type ReactNode } from 'react'
import { useToast } from '../../lib/toast'
import { useSheet } from '../../lib/sheet'
import { emitDataChanged } from '../../lib/events'
import { sendShots } from '../../lib/workout-actions'

// «Juntar print do relógio»: escolhe 1 a 4 imagens (Fototeca ou câmara, no
// mesmo toque) e abre a folha Confirmar treino enquanto o print é lido.
export default function ShotButton({ className, children }: { className?: string; children: ReactNode }) {
  const toast = useToast()
  const sheet = useSheet()
  const [busy, setBusy] = useState(false)
  return (
    <label className={`cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''} ${className ?? ''}`}>
      {busy ? 'A enviar…' : children}
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={busy}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length === 0) return
          setBusy(true)
          sendShots(files)
            .then((result) => {
              emitDataChanged()
              if (result.workout) {
                toast('Este print já estava registado.')
                sheet.open('confirmar-treino', { id: result.workout.id })
              } else if (result.import) {
                sheet.open('confirmar-treino', { import: result.import.id })
              }
            })
            .catch((err) => toast(err instanceof Error ? err.message : 'Não consegui enviar o print.'))
            .finally(() => setBusy(false))
        }}
      />
    </label>
  )
}
