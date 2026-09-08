import type { VercelResponse } from '@vercel/node'
import { HttpError } from './supabase'

export function respondError(res: VercelResponse, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Erro inesperado.' })
}
