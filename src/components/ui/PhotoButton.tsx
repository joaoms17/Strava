import type { ReactNode } from 'react'
import { useToast } from '../../lib/toast'
import { useSheet } from '../../lib/sheet'
import { captureCameraPhoto, setPendingGallery } from '../../lib/capture'
import type { Slot } from '../../lib/types'

// Botão que abre a câmara (ou a galeria) dentro do próprio toque — o iOS só
// abre a câmara num gesto do utilizador. A foto da câmara entra logo na fila;
// as da galeria abrem a folha para dizer a hora e juntar notas.
export default function PhotoButton({
  source,
  date,
  slot,
  canOpen,
  className,
  children,
  onDone,
}: {
  source: 'camera' | 'gallery'
  date?: string | null
  slot?: Slot | null
  canOpen?: () => boolean // false: não abre (ex.: falta escolher a refeição)
  className?: string
  children: ReactNode
  onDone?: () => void
}) {
  const toast = useToast()
  const sheet = useSheet()
  return (
    <label
      className={`cursor-pointer ${className ?? ''}`}
      onClick={(event) => {
        if (canOpen && !canOpen()) event.preventDefault()
      }}
    >
      {children}
      <input
        type="file"
        accept="image/*"
        {...(source === 'camera' ? { capture: 'environment' as const } : { multiple: true })}
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length === 0) return
          if (source === 'gallery') {
            setPendingGallery(files, date ?? null, slot ?? null)
            sheet.open('galeria')
            return
          }
          onDone?.()
          // Sem aviso: a linha «A analisar…» aparece logo no dia (um aviso
          // tapava o «＋ Nota» dessa linha).
          void captureCameraPhoto(files[0]!, date ?? null, slot ?? null).catch(() =>
            toast('Não consegui guardar a foto. Tenta outra vez.'),
          )
        }}
      />
    </label>
  )
}
