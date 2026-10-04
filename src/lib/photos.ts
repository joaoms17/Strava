import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// URLs assinados das fotos privadas, guardados em memória durante 50 min.
const cache = new Map<string, { url: string; until: number }>()
const TTL_S = 3600

export async function signedUrls(
  paths: string[],
  bucket: 'meal-photos' | 'workout-shots' = 'meal-photos',
): Promise<Record<string, string>> {
  const now = Date.now()
  const result: Record<string, string> = {}
  const missing: string[] = []
  for (const path of new Set(paths)) {
    const hit = cache.get(`${bucket}/${path}`)
    if (hit && hit.until > now) result[path] = hit.url
    else missing.push(path)
  }
  if (missing.length) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, TTL_S)
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) {
        result[entry.path] = entry.signedUrl
        cache.set(`${bucket}/${entry.path}`, { url: entry.signedUrl, until: now + (TTL_S - 600) * 1000 })
      }
    }
  }
  return result
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
