import { useEffect } from 'react'
import { postApi } from './api'
import { emitDataChanged } from './events'
import { recomputeFrom } from './recompute'
import { useProfile } from './profile'
import { nutritionalDay } from './day'
import { AUTO_SYNC_AFTER_MIN } from '../../api/_lib/rules/intervals'

export interface SyncResult {
  inserted: number
  merged: number
  weights: number
  wellnessDays?: number
  nights?: number
  wellnessError?: string | null
  oldestChanged: string | null
}

// Frase depois de «Sincronizar agora»: o que entrou, incluindo o sono, e
// porque é que o sono não veio (quando não veio).
export function syncSummary(r: SyncResult): string {
  const parts = [
    r.inserted ? `${r.inserted} ${r.inserted === 1 ? 'treino novo' : 'treinos novos'}` : null,
    r.merged ? `${r.merged} ${r.merged === 1 ? 'junto a uma sessão' : 'juntos a sessões'}` : null,
    r.weights ? `${r.weights} ${r.weights === 1 ? 'pesagem' : 'pesagens'}` : null,
    r.nights ? `${r.nights} ${r.nights === 1 ? 'noite de sono' : 'noites de sono'}` : null,
  ].filter(Boolean)
  const first = parts.length ? `Sincronizado: ${parts.join(' · ')}.` : 'Sincronizado. Nada de novo.'
  if (r.wellnessError) return `${first} Não consegui ler o sono do intervals.icu (${r.wellnessError}).`
  // Sem nenhuma noite nos dias pedidos: ou não dormiu com o relógio, ou a
  // ligação do intervals.icu ao Garmin não traz o bem-estar.
  if (r.nights === 0) {
    return `${first} Não veio nenhuma noite de sono. Se dormiste com o relógio, no intervals.icu vai a Settings › Garmin e liga «Wellness».`
  }
  return first
}

let lastAttempt = 0

// Sincroniza o intervals.icu e atualiza o que mudou (dias passados incluídos).
export async function syncNow(days = 3): Promise<SyncResult> {
  lastAttempt = Date.now()
  const result = await postApi<SyncResult>('/api/workout/sync', { days })
  if (result.inserted || result.merged || result.weights || result.nights) emitDataChanged()
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
