import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { ApiError, postApi, isNetworkError } from './api'
import { emitDataChanged } from './events'
import { STORES, inStore } from './idb'
import { prepareImage, sha256Hex } from './image'
import { activeUserId } from './scoped'
import { failureText, isTransientFailure, retryDelayMs } from '../../api/_lib/rules/falhas'
import type { Slot } from './types'

// Captura sem espera: cada foto (ou texto) entra primeiro na base local com o
// ficheiro original, e só sai quando o servidor responde. Envia-se uma de cada
// vez (o iOS fecha a app se a memória encher), ao abrir, ao voltar a rede e
// quando a app volta ao primeiro plano. Uma falha passageira (rede fraca,
// servidor ocupado) não é erro: fica por enviar e tenta outra vez sozinha.

export interface CaptureEntry {
  client_id: string
  created_at: string
  files: Blob[]
  text: string | null
  note: string | null
  tags: string[]
  taken_at: string | null // hora conhecida (câmara ou EXIF)
  date: string | null // dia escolhido quando a hora é desconhecida ou é um dia passado
  slot: Slot | null
  state: 'pendente' | 'erro'
  error: string | null
  user_id?: string | null // de quem é (várias pessoas no mesmo telemóvel)
  attempts?: number // falhas passageiras seguidas (a espera cresce com elas)
}

export type NewCapture = Omit<CaptureEntry, 'client_id' | 'created_at' | 'state' | 'error' | 'user_id' | 'attempts'>

// Só as da pessoa que está a usar a app (as antigas, sem dono, contam para todas).
export function ownCapture(entry: CaptureEntry, userId: string | null): boolean {
  return !entry.user_id || !userId || entry.user_id === userId
}

const EVENT = 'regresso:captures'
const DUPLICATE_EVENT = 'regresso:duplicate'

function changed() {
  window.dispatchEvent(new Event(EVENT))
}

export async function listCaptures(): Promise<CaptureEntry[]> {
  try {
    const all = await inStore(STORES.captures, 'readonly', (s) => s.getAll() as IDBRequest<CaptureEntry[]>)
    return all.sort((a, b) => a.created_at.localeCompare(b.created_at))
  } catch {
    return []
  }
}

async function putCapture(entry: CaptureEntry) {
  await inStore(STORES.captures, 'readwrite', (s) => s.put(entry))
}

export async function discardCapture(clientId: string): Promise<void> {
  await inStore(STORES.captures, 'readwrite', (s) => s.delete(clientId))
  changed()
}

// «Anular» depois de «Descartar»: a captura volta, com a foto, e segue.
export async function restoreCapture(entry: CaptureEntry): Promise<void> {
  const { preview: _preview, ...stored } = entry as CaptureEntry & { preview?: unknown }
  await putCapture({ ...stored, state: 'pendente', error: null, attempts: 0 })
  changed()
  void processCaptures()
}

export async function enqueueCapture(capture: NewCapture): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const entry: CaptureEntry = {
    ...capture,
    // Sem rede a sessão pode não vir (token por renovar): fica de quem está na app.
    user_id: session?.user.id ?? activeUserId(),
    client_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    state: 'pendente',
    error: null,
  }
  await putCapture(entry)
  changed()
  void processCaptures()
  return entry.client_id
}

export async function retryCapture(clientId: string): Promise<void> {
  const entry = (await listCaptures()).find((e) => e.client_id === clientId)
  if (!entry) return
  await putCapture({ ...entry, state: 'pendente', error: null, attempts: 0 })
  changed()
  void processCaptures()
}

// Rede fraca ou servidor ocupado: a captura fica por enviar.
class TransientFailure extends Error {}

async function send(entry: CaptureEntry, userId: string) {
  const photo_paths: string[] = []
  const thumb_paths: string[] = []
  const image_hashes: string[] = []
  for (let i = 0; i < entry.files.length; i++) {
    const original = entry.files[i]!
    const hash = await sha256Hex(original)
    const { full, thumb } = await prepareImage(original, entry.files.length > 1)
    const base = `${userId}/${entry.client_id}/${i}`
    for (const [path, blob] of [
      [`${base}.jpg`, full],
      [`${base}_t.jpg`, thumb],
    ] as const) {
      const { error } = await supabase.storage
        .from('meal-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      // Um envio repetido do mesmo ficheiro conta como feito.
      if (error && !/exists|duplicate/i.test(error.message)) {
        // O supabase-js devolve a falha de rede como StorageUnknownError (não lança).
        const failure = { name: error.name, message: error.message, status: (error as { status?: number }).status ?? null }
        if (!navigator.onLine || isTransientFailure(failure)) throw new TransientFailure(failureText(failure))
        throw new Error(failureText(failure, 'Não consegui enviar a foto.'))
      }
    }
    photo_paths.push(`${base}.jpg`)
    thumb_paths.push(`${base}_t.jpg`)
    image_hashes.push(hash)
  }
  try {
    const result = await postApi<{ meal: { id: string; date: string }; duplicate?: boolean }>('/api/meal/capture', {
      client_id: entry.client_id,
      photo_paths,
      thumb_paths,
      image_hashes,
      text: entry.text ?? undefined,
      note: entry.note ?? undefined,
      tags: entry.tags,
      taken_at: entry.taken_at,
      date: entry.date ?? undefined,
      slot: entry.slot ?? undefined,
    })
    if (result.duplicate) {
      window.dispatchEvent(new CustomEvent(DUPLICATE_EVENT, { detail: result.meal }))
    }
  } catch (err) {
    const status = err instanceof ApiError ? err.status : null
    if (isNetworkError(err) || (status != null && isTransientFailure({ status }))) {
      throw new TransientFailure(err instanceof Error ? err.message : 'Não consegui enviar.')
    }
    throw err
  }
}

// O que a captura diz enquanto espera por outra tentativa.
export const RETRY_TEXT = 'Ainda não consegui enviar: vou tentar outra vez sozinha.'

let retryTimer: ReturnType<typeof setTimeout> | null = null

function retryLater(attempts: number) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void processCaptures()
  }, retryDelayMs(attempts))
}

// Uma captura que já falhou por causa da rede (antes destas regras ficava em
// «erro» com «Load failed») volta a seguir sozinha.
function sendable(entry: CaptureEntry): boolean {
  if (entry.state === 'pendente') return true
  const legacyStatus = Number(/^Erro (\d{3})$/.exec(entry.error ?? '')?.[1]) || null
  return isTransientFailure({ message: entry.error, status: legacyStatus })
}

let running: Promise<void> | null = null
let again = false

// Uma de cada vez; o que entrar na fila a meio de um envio vai na volta
// seguinte (antes ficava à espera da próxima abertura da app).
export function processCaptures(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return
        for (const entry of await listCaptures()) {
          if (!sendable(entry) || !ownCapture(entry, session.user.id)) continue
          if (!navigator.onLine) return
          try {
            await send(entry, session.user.id)
            await discardCapture(entry.client_id)
            emitDataChanged()
          } catch (err) {
            if (err instanceof TransientFailure || isNetworkError(err)) {
              // Sem rede ou rede fraca: fica por enviar e tenta mais tarde (o
              // servidor reconhece o client_id, por isso repetir não duplica).
              const attempts = (entry.attempts ?? 0) + 1
              await putCapture({ ...entry, state: 'pendente', error: navigator.onLine ? RETRY_TEXT : null, attempts })
              changed()
              if (navigator.onLine) retryLater(attempts)
              return
            }
            await putCapture({
              ...entry,
              state: 'erro',
              error: failureText(
                { message: err instanceof Error ? err.message : null, status: err instanceof ApiError ? err.status : null },
                'Não consegui enviar.',
              ),
            })
            changed()
          }
        }
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

export function onDuplicate(listener: (meal: { id: string; date: string }) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent).detail)
  window.addEventListener(DUPLICATE_EVENT, handler)
  return () => window.removeEventListener(DUPLICATE_EVENT, handler)
}

// As capturas por enviar, com uma pré-visualização local da primeira foto.
export function useCaptures(): (CaptureEntry & { preview: string | null })[] {
  const [entries, setEntries] = useState<(CaptureEntry & { preview: string | null })[]>([])
  const refresh = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const list = (await listCaptures()).filter((e) => ownCapture(e, session?.user.id ?? null))
    setEntries((previous) => {
      for (const old of previous) if (old.preview) URL.revokeObjectURL(old.preview)
      return list.map((e) => ({ ...e, preview: e.files[0] ? URL.createObjectURL(e.files[0]) : null }))
    })
  }, [])
  useEffect(() => {
    void refresh()
    window.addEventListener(EVENT, refresh)
    return () => window.removeEventListener(EVENT, refresh)
  }, [refresh])
  return entries
}

// Envia ao abrir, ao voltar a rede e quando a app volta ao primeiro plano.
export function useCaptureSync(): void {
  useEffect(() => {
    const run = () => void processCaptures()
    const onVisible = () => {
      if (!document.hidden) run()
    }
    run()
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
