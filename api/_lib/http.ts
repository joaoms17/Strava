import type { VercelResponse } from '@vercel/node'
import { HttpError } from './supabase.js'
import { AiError } from './rules/resposta-ia.js'

// Os erros do SDK da Anthropic reconhecem-se pelo nome da classe (sem
// importar o SDK aqui: P7, arranque a frio mais curto).
function sdkError(err: unknown): Set<string> {
  const names = new Set<string>()
  let proto = err != null && typeof err === 'object' ? Object.getPrototypeOf(err) : null
  while (proto && proto !== Object.prototype) {
    const name = (proto.constructor as { name?: string } | undefined)?.name
    if (name) names.add(name)
    proto = Object.getPrototypeOf(proto)
  }
  return names
}

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
  const sdk = sdkError(err)
  if (sdk.has('APIConnectionTimeoutError')) {
    res.status(504).json({ error: 'A IA demorou demasiado a responder. Tenta outra vez.' })
    return
  }
  if (sdk.has('RateLimitError')) {
    res.status(503).json({ error: 'A IA está ocupada. Tenta daqui a um minuto.' })
    return
  }
  if (sdk.has('AuthenticationError')) {
    res.status(500).json({ error: 'A chave da Anthropic não é válida. Verifica a ANTHROPIC_API_KEY no Vercel.' })
    return
  }
  if (sdk.has('APIError')) {
    res.status(502).json({ error: 'A IA não respondeu. Tenta outra vez.' })
    return
  }
  res.status(500).json({ error: 'Erro inesperado.' })
}
