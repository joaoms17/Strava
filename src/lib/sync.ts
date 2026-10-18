import { useCallback, useEffect, useState } from 'react'
import { postApi } from './api'
import { listQueuedMeals, removeQueuedMeal, type QueuedMeal } from './queue'
import { listCaptures, ownCapture } from './capture-queue'
import { supabase } from './supabase'
import { emitDataChanged } from './events'

// Fila offline antiga das refeições de texto: envia ao abrir, ao voltar a
// rede e quando a app regressa ao primeiro plano, pela captura de agora (a
// análise corre no servidor; o id da entrada não deixa gravar a dobrar).
let running = false

export async function syncQueuedMeals(): Promise<void> {
  if (running || !navigator.onLine) return
  running = true
  try {
    const queued = await listQueuedMeals().catch(() => [] as QueuedMeal[])
    for (const entry of queued) {
      try {
        await postApi('/api/meal/capture', {
          client_id: entry.id,
          text: entry.text,
          tags: entry.jantar_fora ? ['jantar_fora'] : [],
          taken_at: entry.logged_at,
        })
        await removeQueuedMeal(entry.id)
        emitDataChanged()
      } catch {
        break // sem rede outra vez (ou erro) — fica para a próxima
      }
    }
  } finally {
    running = false
  }
}

// O que ainda não chegou ao servidor: as que falharam também contam (senão
// uma foto com erro desaparecia do topo e ninguém dava por ela).
export function useQueueCount(): { count: number; failed: number } {
  const [count, setCount] = useState({ count: 0, failed: 0 })
  const refresh = useCallback(async () => {
    try {
      const [legacy, captures, { data }] = await Promise.all([
        listQueuedMeals(),
        listCaptures(),
        supabase.auth.getSession(),
      ])
      const userId = data.session?.user.id ?? null
      const own = captures.filter((c) => ownCapture(c, userId))
      setCount({ count: legacy.length + own.length, failed: own.filter((c) => c.state === 'erro').length })
    } catch {
      setCount({ count: 0, failed: 0 })
    }
  }, [])

  useEffect(() => {
    const run = () => void syncQueuedMeals().finally(() => void refresh())
    run()
    const onVisible = () => {
      if (!document.hidden) run()
    }
    window.addEventListener('online', run)
    window.addEventListener('regresso:data', refresh)
    window.addEventListener('regresso:captures', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', run)
      window.removeEventListener('regresso:data', refresh)
      window.removeEventListener('regresso:captures', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  return count
}
