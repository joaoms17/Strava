import { useEffect, useRef, useState, type ReactNode } from 'react'

// A parte do ecrã que se vê (sem o teclado). No iPhone o teclado não encolhe
// a página: a folha segue o visualViewport para o topo nunca sair do ecrã.
function useVisibleArea(): { top: number; height: number } | null {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setArea({ top: viewport.offsetTop, height: viewport.height })
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    update()
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
  return area
}

// Folha inferior: pega em cima, deslizar para baixo fecha, botão principal
// fixo no fundo e o teclado nunca tapa o campo nem empurra o título para fora.
export default function BottomSheet({
  title,
  onClose,
  children,
  footer,
}: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const area = useVisibleArea()
  const [drag, setDrag] = useState(0)
  const startY = useRef<number | null>(null)
  // Teclado aberto: a área visível é bem mais baixa do que a janela.
  const keyboardOpen = area != null && window.innerHeight - area.height > 120

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 h-dvh"
      style={area ? { top: area.top, height: area.height } : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div className="fade-in absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        className="sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-w-md flex-col rounded-t-3xl bg-surface shadow-2xl"
        style={{
          // Com o teclado, a folha usa quase toda a área visível (o título fica à vista).
          maxHeight: area ? area.height - (keyboardOpen ? 8 : Math.round(area.height * 0.08)) : '92dvh',
          transform: drag > 0 ? `translateY(${drag}px)` : undefined,
          transition: startY.current == null ? 'transform 180ms ease-out' : undefined,
        }}
      >
        <div
          className="flex shrink-0 cursor-grab justify-center pt-2.5 pb-2 touch-none"
          onTouchStart={(e) => {
            startY.current = e.touches[0]?.clientY ?? null
          }}
          onTouchMove={(e) => {
            if (startY.current == null) return
            setDrag(Math.max(0, (e.touches[0]?.clientY ?? 0) - startY.current))
          }}
          onTouchEnd={() => {
            const shouldClose = drag > 90
            startY.current = null
            setDrag(0)
            if (shouldClose) onClose()
          }}
        >
          <span className="h-1.5 w-10 rounded-full bg-line" />
        </div>
        {title && (
          <div className="flex shrink-0 items-center justify-between px-4 pb-2">
            <h2 className="font-display text-[22px] font-bold uppercase">{title}</h2>
            <button onClick={onClose} className="-mr-2 px-2 py-1 text-[15px] text-dim" aria-label="Fechar">
              Fechar
            </button>
          </div>
        )}
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 ${
            footer ? 'pb-4' : keyboardOpen ? 'pb-3' : 'pb-[calc(16px+env(safe-area-inset-bottom))]'
          }`}
        >
          {children}
        </div>
        {footer && (
          <div
            className={`shrink-0 border-t border-line px-4 pt-3 ${
              keyboardOpen ? 'pb-3' : 'pb-[calc(12px+env(safe-area-inset-bottom))]'
            }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
