// A cache dos URLs assinados (P6), sem supabase nem browser: por
// «bucket/caminho», com a hora até à qual o URL serve.
export type UrlCache = Record<string, { url: string; until: number }>

// Os que já há (com pelo menos `marginMs` de validade) e os que faltam pedir.
export function pickCachedUrls(
  store: UrlCache,
  bucket: string,
  paths: string[],
  now: number,
  marginMs: number,
): { result: Record<string, string>; missing: string[] } {
  const result: Record<string, string> = {}
  const missing: string[] = []
  for (const path of new Set(paths)) {
    const hit = store[`${bucket}/${path}`]
    if (hit && typeof hit.url === 'string' && hit.until - marginMs > now) result[path] = hit.url
    else missing.push(path)
  }
  return { result, missing }
}

// Tira os expirados e, acima de `max`, os que expiram primeiro.
export function pruneUrlCache(store: UrlCache, now: number, max: number): UrlCache {
  const alive = Object.entries(store).filter(([, v]) => v && typeof v.until === 'number' && v.until > now)
  alive.sort((a, b) => b[1].until - a[1].until)
  return Object.fromEntries(alive.slice(0, max))
}
