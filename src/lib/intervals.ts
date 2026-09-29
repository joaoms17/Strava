import { useEffect } from 'react'
import { postApi } from './api'
import { emitDataChanged } from './events'
import { recomputeFrom } from './recompute'
import { useProfile } from './profile'
import { nutritionalDay } from './day'
import { AUTO_SYNC_AFTER_MIN } from '../../api/_lib/rules/intervals'

interface SyncResult {
  inserted: number
  merged: number
  weights: number
  oldestChanged: string | null
}

let lastAttempt = 0

// Sincroniza o intervals.icu e atualiza o que mudou (dias passados incluídos).
export async function syncNow(days = 3): Promise<SyncResult> {
  lastAttempt = Date.now()
  const result = await postApi<SyncResult>('/api/workout/sync', { days })
  if (result.inserted || result.merged || result.weights) emitDataChanged()
  return result
}

// Ao abrir o Hoje ou o Treino: se o relógio está ligado e passaram mais de
// 20 min desde a última sincronização, sincroniza os últimos 3 dias.
export function useAutoSync(): void {
  const { profile, reload } = useProfile()
  const status = profile?.integration_status?.intervals
  useEffect(() => {
    if (!profile || !status?.connected) return
    const last = Math.max(lastAttempt, status.last_sync_at ? Date.parse(status.last_sync_at) : 0)
    if (Date.now() - last < AUTO_SYNC_AFTER_MIN * 60_000) return
    lastAttempt = Date.now()
    const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
    void syncNow(3)
      .then((result) => {
        if (result.oldestChanged) recomputeFrom(result.oldestChanged, today)
        void reload()
      })
      .catch(() => void reload())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, status?.last_sync_at])
}
