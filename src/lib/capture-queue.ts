import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { postApi, isNetworkError } from './api'
import { emitDataChanged } from './events'
import { STORES, inStore } from './idb'
import { prepareImage, sha256Hex } from './image'
import type { Slot } from './types'

// Captura sem espera: cada foto (ou texto) entra primeiro na base local com o
// ficheiro original, e só sai quando o servidor responde. Envia-se uma de cada
// vez (o iOS fecha a app se a memória encher), ao abrir, ao voltar a rede e
// quando a app volta ao primeiro plano.

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
}

export type NewCapture = Omit<CaptureEntry, 'client_id' | 'created_at' | 'state' | 'error'>

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

export async function enqueueCapture(capture: NewCapture): Promise<string> {
  const entry: CaptureEntry = {
    ...capture,
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
  await putCapture({ ...entry, state: 'pendente', error: null })
  changed()
  void processCaptures()
}

class HttpFailure extends Error {}

async function send(entry: CaptureEntry, userId: string) {
  const photo_paths: string[] = []
  const thumb_paths: string[] = []
  const image_hashes: string[] = []
  for (let i = 0; i < entry.files.length; i++) {
    const original = entry.files[i]!
    const hash = await sha256Hex(original)
    const { full, thumb } = await prepareImage(original)
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
        if (!navigator.onLine) throw new TypeError('offline')
        throw new Error(error.message)
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
    if (isNetworkError(err)) throw err
    throw new HttpFailure(err instanceof Error ? err.message : 'Não consegui enviar.')
  }
}

let running: Promise<void> | null = null

export function processCaptures(): Promise<void> {
  running ??= (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      for (const entry of await listCaptures()) {
        if (entry.state !== 'pendente') continue
        if (!navigator.onLine) return
        try {
          await send(entry, session.user.id)
          await discardCapture(entry.client_id)
          emitDataChanged()
        } catch (err) {
          if (isNetworkError(err)) return // sem rede: fica para depois
          await putCapture({
            ...entry,
            state: 'erro',
            error: err instanceof Error ? err.message : 'Não consegui enviar.',
          })
          changed()
        }
      }
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
    const list = await listCaptures()
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
