import { useEffect } from 'react'
import { postApi } from './api'
import { emitDataChanged } from './events'
import { recomputeFrom } from './recompute'
import { useProfile } from './profile'
import { nutritionalDay } from './day'
import { AUTO_SYNC_AFTER_MIN, HISTORY_EMPTY_WINDOWS_TO_STOP, historyWindows } from '../../api/_lib/rules/intervals'

export interface SyncResult {
  activities?: number
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
    return `${first} Não veio nenhuma noite de sono. Se dormiste com o relógio: no intervals.icu, em Settings, na ligação do teu relógio, ativa «Descarregar dados de bem-estar» e carrega em «Descarregar dados antigos».`
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

export interface HistoryTotals {
  treinos: number
  pesagens: number
  noites: number
  oldestChanged: string | null
  blocks: number
  stoppedEarly: boolean
}

// Importa o histórico do intervals.icu bloco a bloco (30 dias por pedido,
// do mais recente para trás). `untilEmpty`: em «Tudo», pára depois de um ano
// seguido sem nada. `cancelled()` é consultado entre blocos.
export async function importHistory(
  from: string,
  today: string,
  options: {
    untilEmpty?: boolean
    onProgress?: (done: number, total: number, window: { oldest: string; newest: string }) => void
    cancelled?: () => boolean
  } = {},
): Promise<HistoryTotals> {
  const windows = historyWindows(from, today)
  const totals: HistoryTotals = { treinos: 0, pesagens: 0, noites: 0, oldestChanged: null, blocks: 0, stoppedEarly: false }
  let emptyRun = 0
  for (const [i, window] of windows.entries()) {
    if (options.cancelled?.()) {
      totals.stoppedEarly = true
      break
    }
    options.onProgress?.(i, windows.length, window)
    const r = await postApi<SyncResult>('/api/workout/sync', window)
    totals.blocks++
    totals.treinos += r.inserted + r.merged
    totals.pesagens += r.weights
    totals.noites += r.nights ?? 0
    if (r.oldestChanged && (!totals.oldestChanged || r.oldestChanged < totals.oldestChanged)) {
      totals.oldestChanged = r.oldestChanged
    }
    const empty = (r.activities ?? 0) === 0 && (r.wellnessDays ?? 0) === 0
    emptyRun = empty ? emptyRun + 1 : 0
    if (options.untilEmpty && emptyRun >= HISTORY_EMPTY_WINDOWS_TO_STOP) break
  }
  options.onProgress?.(windows.length, windows.length, windows[windows.length - 1] ?? { oldest: from, newest: today })
  if (totals.treinos || totals.pesagens || totals.noites) emitDataChanged()
  return totals
}

export function historySummary(t: HistoryTotals): string {
  const parts = [
    t.treinos ? `${t.treinos} ${t.treinos === 1 ? 'treino' : 'treinos'}` : null,
    t.pesagens ? `${t.pesagens} ${t.pesagens === 1 ? 'pesagem' : 'pesagens'}` : null,
    t.noites ? `${t.noites} ${t.noites === 1 ? 'noite de sono' : 'noites de sono'}` : null,
  ].filter(Boolean)
  const head = t.stoppedEarly ? 'Importação parada' : 'Histórico importado'
  return parts.length ? `${head}: ${parts.join(' · ')}.` : `${head}. Não havia nada de novo.`
}
