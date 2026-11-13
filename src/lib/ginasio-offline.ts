// O Ginásio com pouca rede (T11): o rascunho que não se perde, a fila do
// «Terminar» (como a das refeições) e o que se leu da última vez com rede
// (os teus treinos e as séries), para a sessão não abrir vazia nem dizer
// «Primeira vez» por causa de um pedido que falhou.
import { readScoped, writeScoped } from './scoped'

// --- O rascunho -------------------------------------------------------------

export interface DraftLike {
  startedAt: number
  exercises: { sets: { done: boolean }[] }[]
  day?: string | null
  minutes?: number | null
  // Rascunho de outra altura (fechaste a app e voltaste de manhã): sem
  // cronómetro, a hora de início fica a de quando começou.
  frozen?: boolean
}

// Sem séries feitas, um rascunho com mais de 6 h já não interessa. Com
// séries feitas nunca expira: passa a «congelado» (o cronómetro não conta as
// horas em que a app esteve fechada).
export const DRAFT_TIMER_MAX_MS = 6 * 3600_000

export function keptDraft<T extends DraftLike>(draft: T | null, now: number): T | null {
  if (!draft || !Number.isFinite(draft.startedAt) || !Array.isArray(draft.exercises)) return null
  if (now - draft.startedAt < DRAFT_TIMER_MAX_MS) return draft
  const anyDone = draft.exercises.some((ex) => ex.sets?.some((s) => s.done))
  if (!anyDone) return null
  return draft.frozen ? draft : { ...draft, frozen: true }
}

// --- A fila do «Terminar» ---------------------------------------------------

const QUEUE_KEY = 'regresso.ginasio.fila'

export interface QueuedGym {
  client_id: string
  body: Record<string, unknown> & { client_id: string }
  // Resumo para o aviso no Treino: «Ginásio de seg 9 nov · 12 séries».
  label: string
  at: string
  // O servidor recusou (não foi a rede): fica para a pessoa ver e decidir.
  error?: string
}

export function readGymQueue(storage: Storage | null = safeLocalStorage()): QueuedGym[] {
  if (!storage) return []
  try {
    const list = JSON.parse(readScoped(storage, QUEUE_KEY) ?? '[]') as QueuedGym[]
    return Array.isArray(list) ? list.filter((q) => q && typeof q.client_id === 'string' && q.body) : []
  } catch {
    return []
  }
}

function writeGymQueue(list: QueuedGym[], storage: Storage | null) {
  if (!storage) return
  writeScoped(storage, QUEUE_KEY, list.length ? JSON.stringify(list) : null)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('regresso:ginasio-fila'))
}

// O mesmo client_id substitui o que lá estava (tocar outra vez em Terminar).
export function enqueueGym(entry: QueuedGym, storage: Storage | null = safeLocalStorage()): void {
  writeGymQueue([...readGymQueue(storage).filter((q) => q.client_id !== entry.client_id), entry], storage)
}

export function removeQueuedGym(clientId: string, storage: Storage | null = safeLocalStorage()): void {
  writeGymQueue(
    readGymQueue(storage).filter((q) => q.client_id !== clientId),
    storage,
  )
}

// Envia o que está na fila, por ordem. O servidor reconhece o client_id e
// não grava a dobrar. Sem rede pára (fica para a próxima); uma recusa do
// servidor fica marcada com o motivo e passa à seguinte.
export async function flushGymQueue(
  send: (body: QueuedGym['body']) => Promise<unknown>,
  isNetworkError: (err: unknown) => boolean,
  storage: Storage | null = safeLocalStorage(),
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0
  for (const entry of readGymQueue(storage)) {
    if (entry.error) continue
    try {
      await send(entry.body)
      removeQueuedGym(entry.client_id, storage)
      sent++
    } catch (err) {
      if (isNetworkError(err)) break
      failed++
      writeGymQueue(
        readGymQueue(storage).map((q) =>
          q.client_id === entry.client_id ? { ...q, error: err instanceof Error ? err.message : 'Não consegui gravar.' } : q,
        ),
        storage,
      )
    }
  }
  return { sent, failed }
}

// --- O que se leu da última vez com rede ------------------------------------

const CACHE_KEY = 'regresso.ginasio.ultima-leitura'

export interface GymCache<F, L, W> {
  favorites: F[]
  logs: L[]
  workouts: W[]
  at: string
}

export function readGymCache<F, L, W>(storage: Storage | null = safeLocalStorage()): GymCache<F, L, W> | null {
  if (!storage) return null
  try {
    const raw = readScoped(storage, CACHE_KEY)
    return raw ? (JSON.parse(raw) as GymCache<F, L, W>) : null
  } catch {
    return null
  }
}

export function writeGymCache<F, L, W>(cache: GymCache<F, L, W>, storage: Storage | null = safeLocalStorage()): void {
  if (storage) writeScoped(storage, CACHE_KEY, JSON.stringify(cache))
}

// Os ids dos teus treinos do plano («Fase 1 · Dia 2» → id): «Começar Dia N»
// sem rede abre o Ginásio com o treino que já existe.
const PLAN_IDS_KEY = 'regresso.plano.favoritos'

export function cachedPlanFavorite(name: string, storage: Storage | null = safeLocalStorage()): string | null {
  if (!storage) return null
  try {
    const map = JSON.parse(readScoped(storage, PLAN_IDS_KEY) ?? '{}') as Record<string, string>
    return typeof map[name] === 'string' ? map[name] : null
  } catch {
    return null
  }
}

export function rememberPlanFavorite(name: string, id: string, storage: Storage | null = safeLocalStorage()): void {
  if (!storage) return
  try {
    const map = JSON.parse(readScoped(storage, PLAN_IDS_KEY) ?? '{}') as Record<string, string>
    writeScoped(storage, PLAN_IDS_KEY, JSON.stringify({ ...map, [name]: id }))
  } catch {
    writeScoped(storage, PLAN_IDS_KEY, JSON.stringify({ [name]: id }))
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
