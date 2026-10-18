import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearch } from 'wouter'
import { runBusy } from './busy'

// Aviso de 10 s acima da barra, com Anular (e outras ações curtas, como as
// porções de um favorito). Substitui as perguntas «tens a certeza?».
export interface ToastAction {
  label: string
  run: () => void | Promise<void>
  busy?: string // o que diz enquanto espera pelo servidor (por omissão, pelo rótulo)
}

const BUSY_TEXT: Record<string, string> = { Anular: 'A anular…', Repor: 'A repor…', Tentar: 'A tentar outra vez…' }

interface Toast {
  id: number
  text: string
  actions: ToastAction[]
}

const ToastContext = createContext<(text: string, actions?: ToastAction[]) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

// Onde aparecem os avisos (e o «A anular…» da camada de espera): com uma
// folha aberta vão para cima, para não tapar a folha; senão, acima da barra.
export function useToastPlace(): string {
  const sheetOpen = new URLSearchParams(useSearch()).has('folha')
  return sheetOpen ? 'top-[calc(12px+env(safe-area-inset-top))]' : 'bottom-[calc(96px+env(safe-area-inset-bottom))]'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const place = useToastPlace()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((text: string, actions: ToastAction[] = []) => {
    if (timer.current) clearTimeout(timer.current)
    const id = Date.now()
    setToast({ id, text, actions })
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 10_000)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const buttons = toast?.actions.map((action) => (
    <button
      key={action.label}
      className="min-h-11 min-w-11 shrink-0 rounded-lg px-2 text-[15px] font-semibold text-toast-action"
      onClick={() => {
        setToast(null)
        // Anular (e as porções) também esperam pelo servidor: nada muda a meio.
        void runBusy(action.busy ?? BUSY_TEXT[action.label] ?? 'Um momento…', action.run)
      }}
    >
      {action.label}
    </button>
  ))

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div role="status" className={`fade-in fixed inset-x-0 z-50 flex justify-center px-4 ${place}`}>
          {/* Escuro nos dois temas (o laranja das ações lê-se a ≥ 5:1); com mais
              de 2 ações (as porções e Anular), as ações vão para uma 2.ª linha. */}
          <div className="w-full max-w-md rounded-2xl bg-toast px-4 py-1 text-on-toast shadow-lg ring-1 ring-white/10">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 py-2.5 text-[15px]">{toast.text}</p>
              {toast.actions.length > 0 && toast.actions.length <= 2 && <div className="-mr-2 flex shrink-0 gap-1">{buttons}</div>}
            </div>
            {toast.actions.length > 2 && <div className="-mt-1 -mr-2 flex justify-end gap-1">{buttons}</div>}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
