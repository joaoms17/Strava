import { useCallback, useRef } from 'react'

// O client_id de um registo feito numa folha. Repetir o mesmo envio (tocar
// outra vez depois de uma falha de rede, com o servidor já a ter gravado)
// leva o mesmo client_id e não grava a dobrar. Mudar o que se envia (outro
// prato do menu, outros números) é outro registo, com outro client_id: senão
// o servidor devolvia o primeiro e o ecrã dizia «Registado» com o que não foi.
export function useClientId(): (content: unknown) => string {
  const last = useRef<{ key: string; id: string } | null>(null)
  return useCallback((content: unknown) => {
    const key = JSON.stringify(content)
    if (last.current?.key !== key) last.current = { key, id: crypto.randomUUID() }
    return last.current.id
  }, [])
}

// Fora de uma folha (`saveWorkout`): um client_id por gravação (T24). Um
// toque duplo ou um «Tentar outra vez» depois de uma falha mandam o mesmo id,
// e o servidor devolve o treino que já gravou em vez de criar outro. Depois de gravar, o mesmo pedido volta a ser
// um treino novo (pode ser outro treino igual, ou o mesmo depois de Anular).
const PENDING_TTL_MS = 10 * 60_000
const pendingSaves = new Map<string, { id: string; at: number }>()

export function saveClientId(body: object, now = Date.now()): { id: string; key: string } {
  for (const [key, entry] of pendingSaves) if (now - entry.at > PENDING_TTL_MS) pendingSaves.delete(key)
  const key = JSON.stringify(body)
  const entry = pendingSaves.get(key)
  if (entry) return { id: entry.id, key }
  const id = crypto.randomUUID()
  pendingSaves.set(key, { id, at: now })
  return { id, key }
}

export function saveDone(key: string): void {
  pendingSaves.delete(key)
}
