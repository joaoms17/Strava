import { supabase } from './supabase'

async function callApi<T>(path: string, init: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Sessão expirada. Volta a entrar.')

  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...init.headers,
    },
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`)
  return json as T
}

export async function postApi<T>(path: string, body: unknown): Promise<T> {
  return callApi<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export async function getApi<T>(path: string): Promise<T> {
  return callApi<T>(path, { method: 'GET' })
}

// Erro de rede (fetch rejeita com TypeError) — usado para decidir a fila offline.
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || !navigator.onLine
}
