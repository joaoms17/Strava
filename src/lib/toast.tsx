import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearch } from 'wouter'

// Aviso de 10 s acima da barra, com Anular (e outras ações curtas, como as
// porções de um favorito). Substitui as perguntas «tens a certeza?».
export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

interface Toast {
  id: number
  text: string
  actions: ToastAction[]
}

const ToastContext = createContext<(text: string, actions?: ToastAction[]) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  // Com uma folha aberta, o aviso vai para cima para não tapar a folha.
  const sheetOpen = new URLSearchParams(useSearch()).has('folha')
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

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          role="status"
          className={`fade-in fixed inset-x-0 z-50 flex justify-center px-4 ${
            sheetOpen
              ? 'top-[calc(12px+env(safe-area-inset-top))]'
              : 'bottom-[calc(96px+env(safe-area-inset-bottom))]'
          }`}
        >
          <div className="flex w-full max-w-md items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-bg shadow-lg">
            <p className="min-w-0 flex-1 text-[15px]">{toast.text}</p>
            {toast.actions.map((action) => (
              <button
                key={action.label}
                className="shrink-0 rounded-lg px-2 py-1.5 text-[15px] font-semibold text-eat"
                onClick={() => {
                  setToast(null)
                  void action.run()
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
