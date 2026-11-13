import { useCallback, useEffect, useState } from 'react'
import { isNetworkError, postApi } from './api'
import { emitDataChanged } from './events'
import { enqueueGym, flushGymQueue, readGymQueue, removeQueuedGym, type QueuedGym } from './ginasio-offline'

// A fila do «Terminar» do Ginásio (T11): envia ao abrir o Treino ou o
// Ginásio, ao voltar a rede e quando a app regressa ao primeiro plano.
let running = false

export async function syncGymQueue(): Promise<void> {
  if (running || (typeof navigator !== 'undefined' && !navigator.onLine)) return
  running = true
  try {
    const { sent } = await flushGymQueue((body) => postApi('/api/workout/strength', body), isNetworkError)
    if (sent > 0) emitDataChanged()
  } finally {
    running = false
  }
}

export function useGymQueue(): {
  queued: QueuedGym[]
  retry: (entry: QueuedGym) => void
  discard: (entry: QueuedGym) => void
} {
  const [queued, setQueued] = useState<QueuedGym[]>(() => readGymQueue())
  const refresh = useCallback(() => setQueued(readGymQueue()), [])

  useEffect(() => {
    const run = () => void syncGymQueue().finally(refresh)
    run()
    const onVisible = () => {
      if (!document.hidden) run()
    }
    window.addEventListener('online', run)
    window.addEventListener('regresso:ginasio-fila', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', run)
      window.removeEventListener('regresso:ginasio-fila', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return {
    queued,
    retry: (entry) => {
      const { error: _error, ...rest } = entry
      enqueueGym(rest)
      void syncGymQueue().finally(refresh)
    },
    discard: (entry) => removeQueuedGym(entry.client_id),
  }
}
