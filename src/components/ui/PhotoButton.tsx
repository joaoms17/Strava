import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { setPendingPhoto } from '../../lib/capture'

// Botão que abre a câmara (ou a galeria) dentro do próprio toque — o iOS não
// deixa abrir a câmara depois de mudar de ecrã. A foto segue para o Registar.
export default function PhotoButton({
  source,
  date,
  className,
  children,
}: {
  source: 'camera' | 'gallery'
  date?: string | null
  className?: string
  children: ReactNode
}) {
  const [, navigate] = useLocation()
  return (
    <label className={`cursor-pointer ${className ?? ''}`}>
      {children}
      <input
        type="file"
        accept="image/*"
        {...(source === 'camera' ? { capture: 'environment' as const } : {})}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setPendingPhoto(file, source)
          const query = new URLSearchParams({ modo: 'foto' })
          if (date) query.set('data', date)
          navigate(`/registar?${query.toString()}`, { replace: true })
        }}
      />
    </label>
  )
}
