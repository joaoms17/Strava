import type { VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { HttpError } from './supabase.js'
import { AiError } from './rules/resposta-ia.js'

export function respondError(res: VercelResponse, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(err)
  if (err instanceof AiError) {
    res.status(502).json({ error: err.message })
    return
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    res.status(504).json({ error: 'A IA demorou demasiado a responder. Tenta outra vez.' })
    return
  }
  if (err instanceof Anthropic.RateLimitError) {
    res.status(503).json({ error: 'A IA está ocupada. Tenta daqui a um minuto.' })
    return
  }
  if (err instanceof Anthropic.AuthenticationError) {
    res.status(500).json({ error: 'A chave da Anthropic não é válida. Verifica a ANTHROPIC_API_KEY no Vercel.' })
    return
  }
  if (err instanceof Anthropic.APIError) {
    res.status(502).json({ error: 'A IA não respondeu. Tenta outra vez.' })
    return
  }
  res.status(500).json({ error: 'Erro inesperado.' })
}
