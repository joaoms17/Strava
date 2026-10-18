import type { ReactNode } from 'react'
import { useToast } from '../../lib/toast'
import { emitDataChanged } from '../../lib/events'
import { attachPhotos } from '../../lib/capture'
import { BusyLabel, runBusy, useBusyKey } from '../../lib/busy'

// Juntar uma ou mais fotos a uma refeição que já existe. Sem «capture», o
// iPhone oferece Tirar foto, Fototeca ou Ficheiros no mesmo toque.
export default function AttachPhotoButton({
  meal,
  className,
  children,
  onDone,
}: {
  meal: { id: string; client_id: string | null; photo_paths: string[] | null }
  className?: string
  children: ReactNode
  onDone?: () => void
}) {
  const toast = useToast()
  const [key, busy] = useBusyKey()
  return (
    <label className={`cursor-pointer ${busy ? 'pointer-events-none' : ''} ${className ?? ''}`} aria-busy={busy || undefined}>
      {busy ? <BusyLabel text="A enviar a foto…" /> : children}
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
          void runBusy(
            'A enviar a foto…',
            () =>
              attachPhotos(meal, files)
                .then(() => {
                  emitDataChanged()
                  onDone?.()
                })
                .catch((err) => toast(err instanceof Error ? err.message : 'Não consegui juntar a foto.')),
            key,
          )
        }}
      />
    </label>
  )
}
