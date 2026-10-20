import { AiError, describeAiError } from './rules/resposta-ia.js'
import {
  geminiError,
  geminiRequest,
  geminiTimeout,
  hasThinking,
  readGeminiResponse,
  thinkingRejected,
  withoutThinking,
  type ClaudeLikeParams,
  type GeminiResult,
} from './rules/gemini.js'
import { attemptBudgetMs } from './rules/tempo-ia.js'

// Cliente REST do Gemini (sem SDK): generateContent com a chave no cabeçalho
// x-goog-api-key. Se o primeiro modelo esgotar o limite gratuito, não existir,
// estiver sobrecarregado ou esgotar o seu tempo, tenta o seguinte da lista com
// o tempo que sobra.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

async function post(key: string, model: string, body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    // O corpo também conta para o tempo (a resposta chega toda no fim).
    const json = await res.json().catch((err: unknown) => {
      if ((err as Error).name === 'AbortError') throw err
      return null
    })
    return { status: res.status, ok: res.ok, json }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw geminiTimeout(model, timeoutMs)
    throw describeAiError(Object.assign(new Error((err as Error).message), { name: 'APIConnectionError' }))
  } finally {
    clearTimeout(timer)
  }
}

async function generate(
  key: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiResult> {
  const started = Date.now()
  let res = await post(key, model, body, timeoutMs)
  // O modelo não aceita o raciocínio pedido: o mesmo modelo outra vez, sem ele.
  if (!res.ok && hasThinking(body) && thinkingRejected(res.status, res.json)) {
    console.error(`Gemini ${model} recusou o thinkingConfig, a repetir sem ele:`, geminiError(res.status, res.json).detail)
    res = await post(key, model, withoutThinking(body), Math.max(timeoutMs - (Date.now() - started), 1))
  }
  if (!res.ok) throw geminiError(res.status, res.json)
  const result = readGeminiResponse(res.json)
  return { ...result, model: result.model ?? model }
}

// `reserve`: respondeu um modelo que não o primeiro da lista (o principal
// esgotou o limite gratuito ou o seu tempo, não existe, estava sobrecarregado
// ou cortou a resposta). O tempo total é `timeoutMs`: com reserva, o
// principal deixa-lhe uma fatia (rules/tempo-ia.ts).
export async function geminiCall(
  models: string[],
  params: ClaudeLikeParams,
  jsonSchema: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiResult & { reserve: boolean }> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) throw new AiError('Falta a chave do Gemini no Vercel (GEMINI_API_KEY).', 'GEMINI_API_KEY vazia')
  const started = Date.now()
  const failed: AiError[] = []
  for (const [i, model] of models.entries()) {
    const budget = attemptBudgetMs(timeoutMs, Date.now() - started, i, models.length)
    if (budget == null) break
    try {
      const body = geminiRequest(params, jsonSchema, model)
      return { ...(await generate(key, model, body, budget)), reserve: i > 0 }
    } catch (err) {
      if (!(err as { fallback?: boolean }).fallback) throw withEarlier(describeAiError(err), failed)
      failed.push(describeAiError(err))
      console.error(`Gemini ${model} falhou, a tentar o seguinte:`, failed.at(-1)!.detail)
    }
  }
  const last = failed.pop()
  throw last ? withEarlier(last, failed) : geminiTimeout(models[0] ?? 'gemini', timeoutMs)
}

// O erro que fica (o do último modelo tentado), com o que os anteriores
// disseram no detalhe: «gemini-flash-latest: timeout 30000 ms; …».
function withEarlier(err: AiError, earlier: AiError[]): AiError {
  if (earlier.length === 0) return err
  const detail = [...earlier.map((e) => e.detail), err.detail].join('; ').slice(0, 400)
  return Object.assign(new AiError(err.message, detail, err.transient), { fallback: (err as { fallback?: boolean }).fallback })
}
