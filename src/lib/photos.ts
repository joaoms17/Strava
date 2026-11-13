import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { pickCachedUrls, pruneUrlCache, type UrlCache } from './photo-url-cache'

// URLs assinados das fotos privadas (P6). Valem 7 dias e guardam-se por
// caminho em memória e no armazenamento do telemóvel: o mesmo URL de um
// arranque para o outro, e o browser usa a foto que já tem em cache (antes
// mudavam a cada arranque e a foto descarregava-se outra vez).
const TTL_S = 7 * 86_400
// Um URL guardado serve enquanto lhe faltar mais de um dia.
const MARGIN_MS = 86_400_000
const STORE_KEY = 'regresso.fotos.urls.v1'
const MAX_ENTRIES = 600

let memory: UrlCache | null = null

function cache(): UrlCache {
  if (memory) return memory
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as unknown
    memory = parsed && typeof parsed === 'object' ? (parsed as UrlCache) : {}
  } catch {
    memory = {}
  }
  return memory
}

function persist() {
  if (!memory) return
  memory = pruneUrlCache(memory, Date.now(), MAX_ENTRIES)
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(memory))
  } catch {
    // Sem espaço ou sem armazenamento: fica só em memória.
  }
}

export async function signedUrls(
  paths: string[],
  bucket: 'meal-photos' | 'workout-shots' = 'meal-photos',
): Promise<Record<string, string>> {
  const now = Date.now()
  const { result, missing } = pickCachedUrls(cache(), bucket, paths, now, MARGIN_MS)
  if (missing.length) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, TTL_S)
    const store = cache()
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) {
        result[entry.path] = entry.signedUrl
        store[`${bucket}/${entry.path}`] = { url: entry.signedUrl, until: now + TTL_S * 1000 }
      }
    }
    persist()
  }
  return result
}

// Ao sair da conta: os URLs da pessoa anterior não ficam no telemóvel.
export function forgetSignedUrls() {
  memory = {}
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    // nada a fazer
  }
}

// As mesmas fotos num componente: devolve os URLs à medida que chegam.
export function useSignedUrls(paths: (string | null | undefined)[]): Record<string, string> {
  const key = [...new Set(paths.filter((p): p is string => !!p))].sort().join('|')
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!key) return
    let alive = true
    void signedUrls(key.split('|')).then((result) => {
      if (alive) setUrls((prev) => ({ ...prev, ...result }))
    })
    return () => {
      alive = false
    }
  }, [key])
  return urls
}
