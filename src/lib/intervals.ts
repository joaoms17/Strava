import { useEffect } from 'react'
import { postApi } from './api'
import { emitDataChanged } from './events'
import { recomputeFrom } from './recompute'
import { useProfile } from './profile'
import { nutritionalDay, shiftDate } from './day'
import { readScoped, writeScoped } from './scoped'
import {
  AUTO_SYNC_AFTER_MIN,
  HISTORY_EMPTY_WINDOWS_TO_STOP,
  historyWindows,
  retryableImportError,
  splitWindow,
  windowDays,
} from '../../api/_lib/rules/intervals'

export interface SyncResult {
  activities?: number
  known?: number
  weightDays?: number
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
  jaNaApp?: number // treinos que já estavam na app
  diasComPeso?: number // dias com peso no intervals.icu
  oldestChanged: string | null
  blocks: number
  stoppedEarly: boolean
}

type Window = { oldest: string; newest: string }

// Onde ia a importação, para «Continuar» depois de um corte (a app foi para
// segundo plano, a rede caiu). Fica só neste telemóvel.
export interface ImportState {
  from: string
  untilEmpty: boolean
  nextNewest: string // o próximo bloco acaba neste dia
  emptyRun: number
  totals: HistoryTotals
}
const IMPORT_KEY = 'regresso.importacao'

export function loadImportState(): ImportState | null {
  try {
    const raw = readScoped(localStorage, IMPORT_KEY)
    return raw ? (JSON.parse(raw) as ImportState) : null
  } catch {
    return null
  }
}
// Sem armazenamento: sem «Continuar», mas a importação segue.
export function saveImportState(state: ImportState | null): void {
  writeScoped(localStorage, IMPORT_KEY, state ? JSON.stringify(state) : null)
}

export function newImport(from: string, today: string, untilEmpty: boolean): ImportState {
  return {
    from,
    untilEmpty,
    nextNewest: shiftDate(today, 1),
    emptyRun: 0,
    totals: { treinos: 0, pesagens: 0, noites: 0, oldestChanged: null, blocks: 0, stoppedEarly: false },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Com a app em segundo plano o iPhone corta os pedidos: espera que volte.
function whenVisible(): Promise<void> {
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve()
  return new Promise((resolve) => {
    const onChange = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', onChange)
        resolve()
      }
    }
    document.addEventListener('visibilitychange', onChange)
  })
}

async function syncWindow(window: Window, cancelled?: () => boolean): Promise<SyncResult> {
  let last: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    await whenVisible()
    try {
      return await postApi<SyncResult>('/api/workout/sync', window)
    } catch (err) {
      last = err
      if (!retryableImportError(err) || cancelled?.()) throw err
      // O servidor esgotou o tempo com este bloco: repetir o mesmo não
      // adianta muito; à segunda, divide-se ao meio.
      const slow = !(err instanceof TypeError) && /erro 50[234]|timeout|demorou/i.test(err instanceof Error ? err.message : '')
      if (slow && attempt >= 1 && windowDays(window) > 7) break
      await sleep(1500 * 2 ** attempt)
    }
  }
  // O servidor não aguentou o bloco inteiro (mês muito cheio): metade de cada vez.
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  if (!offline && !(last instanceof TypeError) && windowDays(window) > 7) {
    const [newer, older] = splitWindow(window)
    const a = await syncWindow(newer, cancelled)
    const b = await syncWindow(older, cancelled)
    return {
      activities: (a.activities ?? 0) + (b.activities ?? 0),
      inserted: a.inserted + b.inserted,
      merged: a.merged + b.merged,
      weights: a.weights + b.weights,
      wellnessDays: (a.wellnessDays ?? 0) + (b.wellnessDays ?? 0),
      nights: (a.nights ?? 0) + (b.nights ?? 0),
      wellnessError: a.wellnessError ?? b.wellnessError ?? null,
      oldestChanged: [a.oldestChanged, b.oldestChanged].filter(Boolean).sort()[0] ?? null,
    }
  }
  throw last
}

// Importa o histórico do intervals.icu bloco a bloco (30 dias por pedido,
// do mais recente para trás), a partir do ponto guardado. Cada bloco que
// acaba fica guardado: se a importação parar, «Continuar» retoma daí.
// `untilEmpty` («Tudo»): pára depois de um ano seguido sem nada.
export async function importHistory(
  state: ImportState,
  options: {
    onProgress?: (done: number, total: number, window: Window) => void
    cancelled?: () => boolean
  } = {},
): Promise<HistoryTotals> {
  const windows = historyWindows(state.from, shiftDate(state.nextNewest, -1))
  const totals = { ...state.totals, stoppedEarly: false }
  const doneBefore = totals.blocks
  let emptyRun = state.emptyRun
  saveImportState(state)
  let finished = true
  for (const [i, window] of windows.entries()) {
    if (options.cancelled?.()) {
      totals.stoppedEarly = true
      finished = false
      break
    }
    options.onProgress?.(doneBefore + i, doneBefore + windows.length, window)
    const r = await syncWindow(window, options.cancelled)
    totals.blocks++
    totals.treinos += r.inserted + r.merged
    totals.pesagens += r.weights
    totals.noites += r.nights ?? 0
    totals.jaNaApp = (totals.jaNaApp ?? 0) + (r.known ?? 0)
    totals.diasComPeso = (totals.diasComPeso ?? 0) + (r.weightDays ?? 0)
    if (r.oldestChanged && (!totals.oldestChanged || r.oldestChanged < totals.oldestChanged)) {
      totals.oldestChanged = r.oldestChanged
    }
    const empty = (r.activities ?? 0) === 0 && (r.wellnessDays ?? 0) === 0
    emptyRun = empty ? emptyRun + 1 : 0
    saveImportState({ ...state, nextNewest: shiftDate(window.oldest, -1), emptyRun, totals })
    if (state.untilEmpty && emptyRun >= HISTORY_EMPTY_WINDOWS_TO_STOP) break
  }
  // Acabou: não há nada para continuar. Parado a pedido: fica o ponto.
  if (finished) saveImportState(null)
  if (finished) options.onProgress?.(totals.blocks, totals.blocks, windows[windows.length - 1] ?? { oldest: state.from, newest: state.nextNewest })
  if (totals.treinos || totals.pesagens || totals.noites) emitDataChanged()
  return totals
}

export function historySummary(t: HistoryTotals): string {
  const head = t.stoppedEarly ? 'Importação parada' : 'Histórico importado'
  const treinos = t.treinos ? `${t.treinos} ${t.treinos === 1 ? 'treino novo' : 'treinos novos'}` : 'nenhum treino novo'
  const ja = t.jaNaApp ? ` (${t.jaNaApp} já estavam na app)` : ''
  const pesos = t.pesagens
    ? `${t.pesagens} ${t.pesagens === 1 ? 'pesagem' : 'pesagens'}`
    : t.diasComPeso
      ? 'nenhuma pesagem nova (nesses dias já tinhas pesagem tua)'
      : 'sem pesos (o intervals.icu não tem pesos do teu relógio)'
  const noites = t.noites ? ` · sono de ${t.noites} ${t.noites === 1 ? 'noite' : 'noites'}` : ''
  return `${head}: ${treinos}${ja} · ${pesos}${noites}.`
}
