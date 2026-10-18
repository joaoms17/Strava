import { AiError, describeAiError } from './rules/resposta-ia.js'
import { geminiError, geminiRequest, readGeminiResponse, type ClaudeLikeParams, type GeminiResult } from './rules/gemini.js'

// Cliente REST do Gemini (sem SDK): generateContent com a chave no cabeçalho
// x-goog-api-key. Se o primeiro modelo esgotar o limite gratuito, não existir
// ou estiver sobrecarregado, tenta o seguinte da lista.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

async function generate(
  key: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AiError('A IA demorou demasiado a responder.', `${model}: timeout ${timeoutMs} ms`, true)
    }
    throw describeAiError(Object.assign(new Error((err as Error).message), { name: 'APIConnectionError' }))
  } finally {
    clearTimeout(timer)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw geminiError(res.status, json)
  const result = readGeminiResponse(json)
  return { ...result, model: result.model ?? model }
}

// `reserve`: respondeu um modelo que não o primeiro da lista (o principal
// esgotou o limite gratuito, não existe ou estava sobrecarregado).
export async function geminiCall(
  models: string[],
  params: ClaudeLikeParams,
  jsonSchema: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiResult & { reserve: boolean }> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) throw new AiError('Falta a chave do Gemini no Vercel (GEMINI_API_KEY).', 'GEMINI_API_KEY vazia')
  const body = geminiRequest(params, jsonSchema)
  const started = Date.now()
  let last: unknown = null
  for (const [i, model] of models.entries()) {
    const left = timeoutMs - (Date.now() - started)
    if (last && left < 8_000) break
    try {
      return { ...(await generate(key, model, body, last ? left : timeoutMs)), reserve: i > 0 }
    } catch (err) {
      last = err
      if (!(err as { fallback?: boolean }).fallback) throw err
      console.error(`Gemini ${model} falhou, a tentar o seguinte:`, (err as AiError).detail)
    }
  }
  throw last
}
