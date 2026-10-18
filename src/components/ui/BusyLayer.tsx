import { useEffect, useState } from 'react'
import { BUSY_SHOW_MS, Spinner, onBusyNotice, useBusy } from '../../lib/busy'
import { useToast } from '../../lib/toast'

// A camada que tapa tudo (acima das folhas e dos avisos) enquanto corre.
export default function BusyLayer() {
  const busy = useBusy()
  const toast = useToast()
  const [shown, setShown] = useState(false)

  useEffect(() => onBusyNotice((text) => toast(text)), [toast])

  useEffect(() => {
    setShown(false)
    if (!busy) return
    const timer = setTimeout(() => setShown(true), BUSY_SHOW_MS)
    return () => clearTimeout(timer)
  }, [busy])

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {busy && shown ? busy.label : ''}
      </p>
      {busy && (
        // Engole os toques desde o primeiro instante; só se vê aos 200 ms.
        <div className="fixed inset-0 z-[60] touch-none" onClick={(e) => e.stopPropagation()}>
          {shown && (
            <div className="fade-in flex h-full items-center justify-center bg-bg/45 px-6">
              <p className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-[17px] font-semibold text-ink shadow-lg">
                <Spinner size={22} />
                {busy.label}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  )
}

