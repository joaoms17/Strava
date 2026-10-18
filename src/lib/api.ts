import { supabase } from './supabase'
import { failureText } from '../../api/_lib/rules/falhas'

// Resposta de erro do servidor, com o estado HTTP (a fila decide por ele se
// tenta outra vez sozinha). A mensagem fica sempre em português.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function callApi<T>(path: string, init: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Sessão expirada. Volta a entrar.')

  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...init.headers,
      },
    })
  } catch (err) {
    // Sem rede o fetch rejeita com TypeError («Load failed» no Safari): continua
    // a ser TypeError (é assim que se reconhece a falta de rede), em português.
    if (err instanceof TypeError) throw new TypeError(failureText({ name: err.name, message: err.message }))
    throw err
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, failureText({ status: res.status, message: json.error }, `Erro ${res.status}`))
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
