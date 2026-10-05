import type { ReactNode } from 'react'
import { useSheet } from '../../lib/sheet'
import { setPendingCamera, setPendingGallery } from '../../lib/capture'
import type { Slot } from '../../lib/types'

// Botão que abre a câmara (ou a galeria) dentro do próprio toque — o iOS só
// abre a câmara num gesto do utilizador. A foto da câmara abre o Registar
// (nota antes de enviar); as da galeria abrem a folha para dizer a hora.
export default function PhotoButton({
  source,
  date,
  slot,
  canOpen,
  className,
  children,
}: {
  source: 'camera' | 'gallery'
  date?: string | null
  slot?: Slot | null
  canOpen?: () => boolean // false: não abre (ex.: falta escolher a refeição)
  className?: string
  children: ReactNode
}) {
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
          // A foto abre o Registar: aí junta-se uma nota antes de enviar.
          setPendingCamera(files.slice(0, 1))
          sheet.open('registar', {
            ...(date ? { data: date } : {}),
            ...(slot ? { momento: slot } : {}),
          })
        }}
      />
    </label>
  )
}
