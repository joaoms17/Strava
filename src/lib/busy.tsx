import { useEffect, useId, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { failureText } from '../../api/_lib/rules/falhas'

// À espera do servidor ou da IA (guardar, apagar, analisar, corrigir): só
// uma coisa de cada vez. Enquanto corre, o botão diz «A guardar…», os toques
// repetidos não contam e uma camada tapa o ecrã e a folha (aparece aos
// 200 ms, para não piscar), por isso não se fecha a folha, não se muda de dia
// nem se mexe noutra coisa a meio (o botão tocado já diz «A guardar…»; só
// sem botão o rótulo aparece na camada). Liberta-se sempre no fim; ao fim de 65 s
// (o servidor desiste aos 60) liberta-se sozinha, com um aviso. O que corre
// por trás (a fila das fotos, a sincronização, a análise das fotos, a
// Evolução) não passa por aqui: tem o seu próprio «a analisar».

export const BUSY_SHOW_MS = 200
export const BUSY_TIMEOUT_MS = 65_000
const TIMEOUT_TEXT = 'Está a demorar demasiado. Vê se ficou feito antes de tentar outra vez.'

interface Busy {
  id: number
  label: string
  key: string | null
}

let current: Busy | null = null
let seq = 0
const listeners = new Set<() => void>()
const notices = new Set<(text: string) => void>()

function emit() {
  for (const listener of listeners) listener()
}

function notify(text: string) {
  for (const notice of notices) notice(text)
}

// Quem mostra os avisos (o tempo esgotado, um erro que escapou).
export function onBusyNotice(notice: (text: string) => void): () => void {
  notices.add(notice)
  return () => {
    notices.delete(notice)
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isBusy(): boolean {
  return current != null
}

// Corre `work` com o ecrã bloqueado. Se já houver outra coisa a correr, não
// faz nada (devolve undefined): é o duplo toque. Um erro que escape mostra o
// aviso em português e devolve undefined.
export async function runBusy<T>(label: string, work: () => T | Promise<T>, key: string | null = null): Promise<T | undefined> {
  if (current) return undefined
  const id = ++seq
  current = { id, label, key }
  emit()
  // O teclado fecha e o Enter não volta a enviar.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  const timer = setTimeout(() => {
    if (current?.id !== id) return
    current = null
    emit()
    notify(TIMEOUT_TEXT)
  }, BUSY_TIMEOUT_MS)
  try {
    return await work()
  } catch (err) {
    if (current?.id === id) {
      notify(failureText({ name: (err as Error)?.name, message: (err as Error)?.message, status: (err as { status?: number })?.status }))
    }
    return undefined
  } finally {
    clearTimeout(timer)
    if (current?.id === id) {
      current = null
      emit()
    }
  }
}

export function useBusy(): Busy | null {
  return useSyncExternalStore(subscribe, () => current)
}

// Os botões no ecrã que mostram o seu próprio «A guardar…» (BusyButton e
// useBusyKey). Com o trabalho de um deles a correr, a camada não repete o
// rótulo: só engole os toques.
const ownLabels = new Set<string>()

export function showsOwnLabel(busy: Busy | null): boolean {
  return busy?.key != null && ownLabels.has(busy.key)
}

function useOwnLabel(key: string, on: boolean) {
  useEffect(() => {
    if (!on) return
    ownLabels.add(key)
    return () => {
      ownLabels.delete(key)
      // O botão saiu do ecrã a meio (a folha mudou): o rótulo passa para a camada.
      if (current?.key === key) {
        current = { ...current }
        emit()
      }
    }
  }, [key, on])
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={`shrink-0 motion-safe:animate-spin ${className}`}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// O que um botão diz enquanto o seu trabalho corre.
export function BusyLabel({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner />
      {text}
    </span>
  )
}

// Botão cujo toque espera pelo servidor: corre por `runBusy`, mostra o
// rótulo `busy` com o círculo a rodar e não aceita outro toque.
export function BusyButton({
  busy: busyText,
  onClick,
  disabled,
  className = '',
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { busy: string; onClick: () => unknown }) {
  const [key, mine] = useBusyKey()
  return (
    <button
      {...rest}
      disabled={disabled || mine}
      aria-busy={mine || undefined}
      onClick={() => void runBusy(busyText, onClick, key)}
      className={`${className} ${mine ? 'opacity-100!' : ''}`}
    >
      {mine ? <BusyLabel text={busyText} /> : children}
    </button>
  )
}

// Para os botões com um rótulo próprio: true enquanto corre o trabalho de `key`.
// `ownLabel = false` para quem só mostra o círculo (o rótulo fica na camada).
export function useBusyKey(ownLabel = true): [key: string, mine: boolean] {
  const key = useId()
  useOwnLabel(key, ownLabel)
  return [key, useBusy()?.key === key]
}

// Para o que não é um botão: o rótulo (com círculo) enquanto `mine`, senão o normal.
export function busyContent(mine: boolean, text: string, normal: ReactNode): ReactNode {
  return mine ? <BusyLabel text={text} /> : normal
}
