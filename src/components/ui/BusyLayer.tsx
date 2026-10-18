import { useEffect, useState } from 'react'
import { BUSY_SHOW_MS, Spinner, onBusyNotice, showsOwnLabel, useBusy } from '../../lib/busy'
import { useToast, useToastPlace } from '../../lib/toast'

// A camada que tapa tudo (acima das folhas e dos avisos) enquanto corre.
// Quando o botão tocado já diz «A guardar…» com o círculo, a camada só
// engole os toques e esbate pouco (o rótulo não aparece duas vezes nem tapa
// o formulário). Sem botão (Anular, as porções, um toque num cartão), o
// rótulo aparece onde aparecem os avisos, como se o aviso continuasse.
export default function BusyLayer() {
  const busy = useBusy()
  const toast = useToast()
  const place = useToastPlace()
  const [shown, setShown] = useState(false)

  useEffect(() => onBusyNotice((text) => toast(text)), [toast])

  // Pela espera e não pelo objeto: quando o botão sai do ecrã a meio, a mesma
  // espera continua (já à vista) e só passa a mostrar o rótulo.
  const busyId = busy?.id ?? null
  useEffect(() => {
    setShown(false)
    if (busyId == null) return
    const timer = setTimeout(() => setShown(true), BUSY_SHOW_MS)
    return () => clearTimeout(timer)
  }, [busyId])

  const ownLabel = showsOwnLabel(busy)

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {busy && shown ? busy.label : ''}
      </p>
      {busy && (
        // Engole os toques desde o primeiro instante; só se vê aos 200 ms.
        <div className="fixed inset-0 z-[60] touch-none" onClick={(e) => e.stopPropagation()}>
          {shown && (
            <div className={`fade-in h-full ${ownLabel ? 'bg-bg/20' : 'bg-bg/45'}`}>
              {!ownLabel && (
                <div className={`fixed inset-x-0 flex justify-center px-4 ${place}`}>
                  <p className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-toast px-4 py-3 text-[15px] font-semibold text-on-toast shadow-lg ring-1 ring-white/10">
                    <Spinner size={20} />
                    {busy.label}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
