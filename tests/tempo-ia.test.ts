import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANALYSIS_FUNCTION_BUDGET_MS,
  ANALYSIS_WRITE_MARGIN_MS,
  MIN_ATTEMPT_MS,
  attemptBudgetMs,
  requestWithin,
  reserveSliceMs,
} from '../api/_lib/rules/tempo-ia'
import { ANALYSIS_LEASE_MS } from '../api/_lib/rules/analise'
import { REQUEST_TEXT, REQUEST_VISION } from '../api/_lib/anthropic'
import { geminiCall } from '../api/_lib/gemini'
import { AiError, outputSchema } from '../api/_lib/rules/resposta-ia'
import { MealAnalysisSchema } from '../api/_lib/schemas'

describe('o tempo dividido com a reserva', () => {
  it('fotos: 30 s para o principal e 15 s para a reserva; texto: 15 s + 10 s', () => {
    expect(reserveSliceMs(REQUEST_VISION.timeout)).toBe(15_000)
    expect(attemptBudgetMs(REQUEST_VISION.timeout, 0, 0, 2)).toBe(30_000)
    expect(attemptBudgetMs(REQUEST_VISION.timeout, 30_050, 1, 2)).toBe(14_950)
    expect(attemptBudgetMs(REQUEST_TEXT.timeout, 0, 0, 2)).toBe(15_000)
    expect(attemptBudgetMs(REQUEST_TEXT.timeout, 15_000, 1, 2)).toBe(10_000)
  })

  it('um modelo só, ou a reserva depois de uma falha rápida: o tempo todo que sobra', () => {
    expect(attemptBudgetMs(45_000, 0, 0, 1)).toBe(45_000)
    expect(attemptBudgetMs(45_000, 1_200, 1, 2)).toBe(43_800) // 429 do principal em 1,2 s
  })

  it('sem tempo útil a reserva não corre', () => {
    expect(attemptBudgetMs(45_000, 40_000, 1, 2)).toBeNull()
    expect(attemptBudgetMs(45_000, 45_000, 1, 2)).toBeNull()
    expect(attemptBudgetMs(12_000, 0, 0, 2)).toBe(MIN_ATTEMPT_MS)
  })

  it('a chamada encolhe para caber na função; abaixo de 8 s não se chama', () => {
    expect(requestWithin(REQUEST_VISION, 52_000, ANALYSIS_WRITE_MARGIN_MS)).toEqual({ maxRetries: 0, timeout: 45_000 })
    expect(requestWithin(REQUEST_VISION, 37_000, ANALYSIS_WRITE_MARGIN_MS)).toEqual({ maxRetries: 0, timeout: 34_000 })
    expect(requestWithin(REQUEST_TEXT, 10_000, ANALYSIS_WRITE_MARGIN_MS)).toBeNull()
  })

  it('cabe tudo nos 60 s da função e a reivindicação (90 s) dura mais do que a função', () => {
    // Antes da análise (sessão, limite, insert) ~2 s; depois (gravar, partilhar, avisar) ~2 s.
    expect(2_000 + ANALYSIS_FUNCTION_BUDGET_MS + 2_000).toBeLessThanOrEqual(60_000)
    expect(REQUEST_VISION.timeout + ANALYSIS_WRITE_MARGIN_MS).toBeLessThanOrEqual(ANALYSIS_FUNCTION_BUDGET_MS)
    expect(ANALYSIS_LEASE_MS).toBeGreaterThan(90_000)
  })
})

// geminiCall com um fetch falso e o relógio parado (vi.useFakeTimers): o que
// vai para a Google e quando.
describe('geminiCall com a reserva', () => {
  const json = outputSchema(MealAnalysisSchema)
  const answer = { title: 'H3 Grelhado', items: [{ name: 'Hambúrguer H3 grelhado', grams: 200, kcal: 480, protein: 40, carbs: 2, fat: 34, confidence: 'media', food_ref: null }, { name: 'Arroz thai', grams: 150, kcal: 195, protein: 4, carbs: 43, fat: 0.4, confidence: 'media', food_ref: null }], meal_confidence: 'media' }
  const ok = (model: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }], modelVersion: model, usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120 } }),
  })
  const params = {
    system: 'Lê a foto.',
    max_tokens: 4096,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'text', text: '{}' }] }],
  }
  let calls: { model: string; body: any; at: number; signal: AbortSignal }[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('GEMINI_API_KEY', 'AIza-teste')
    calls = []
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  // Uma resposta que nunca chega: só acaba quando o pedido é abortado.
  const hang = (signal: AbortSignal) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))

  function stubFetch(handler: (model: string, body: any, signal: AbortSignal) => unknown) {
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      const model = decodeURIComponent(/models\/([^:]+):/.exec(url)![1]!)
      const body = JSON.parse(init.body as string)
      calls.push({ model, body, at: Date.now(), signal: init.signal! })
      return Promise.resolve().then(() => handler(model, body, init.signal!))
    })
  }

  it('o principal esgota os seus 30 s: a reserva responde com os 15 s que sobram', async () => {
    stubFetch((model, _body, signal) => (model === 'gemini-flash-latest' ? hang(signal) : ok('gemini-3.5-flash-lite')))
    const started = Date.now()
    const call = geminiCall(['gemini-flash-latest', 'gemini-flash-lite-latest'], params, json, REQUEST_VISION.timeout)
    await vi.advanceTimersByTimeAsync(30_000)
    const result = await call
    expect(result.reserve).toBe(true)
    expect(result.model).toBe('gemini-3.5-flash-lite')
    expect(calls.map((c) => c.model)).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
    expect(calls[1]!.at - started).toBe(30_000)
    // Os dois com pouco raciocínio e o teto de saída do pedido + folga.
    expect(calls[0]!.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(calls[1]!.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(calls[0]!.body.generationConfig.maxOutputTokens).toBe(8_192)
  })

  it('os dois esgotam: «A IA demorou demasiado a responder.» com os dois no detalhe, dentro dos 45 s', async () => {
    stubFetch((_model, _body, signal) => hang(signal))
    const call = geminiCall(['gemini-flash-latest', 'gemini-flash-lite-latest'], params, json, REQUEST_VISION.timeout)
    const settled = call.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(45_000)
    const err = (await settled) as AiError
    expect(err).toBeInstanceOf(AiError)
    expect(err.message).toBe('A IA demorou demasiado a responder.')
    expect(err.transient).toBe(true)
    expect(err.detail).toBe('gemini-flash-latest: timeout 30000 ms; gemini-flash-lite-latest: timeout 15000 ms')
  })

  it('o modelo recusa o raciocínio pedido (400): o mesmo modelo outra vez, sem ele', async () => {
    stubFetch((_model, body) =>
      body.generationConfig.thinkingConfig
        ? { ok: false, status: 400, json: async () => ({ error: { code: 400, message: 'Thinking level is not supported for this model.', status: 'INVALID_ARGUMENT' } }) }
        : ok('gemini-2.0-flash'),
    )
    const result = await geminiCall(['gemini-flash-latest', 'gemini-flash-lite-latest'], params, json, REQUEST_VISION.timeout)
    expect(result.reserve).toBe(false)
    expect(calls.map((c) => c.model)).toEqual(['gemini-flash-latest', 'gemini-flash-latest'])
    expect(calls[1]!.body.generationConfig.thinkingConfig).toBeUndefined()
  })

  it('um erro que se repetiria (chave inválida) não passa à reserva', async () => {
    stubFetch(() => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }) }))
    await expect(geminiCall(['gemini-flash-latest', 'gemini-flash-lite-latest'], params, json, REQUEST_VISION.timeout)).rejects.toMatchObject({
      message: 'A chave do Gemini não é válida (GEMINI_API_KEY no Vercel).',
    })
    expect(calls).toHaveLength(1)
  })

  it('chamadas que deixam o modelo pensar ficam como estavam', async () => {
    stubFetch(() => ok('gemini-3.5-flash-lite'))
    const { thinking: _omit, ...withThinking } = params
    await geminiCall(['gemini-flash-lite-latest'], withThinking, json, REQUEST_TEXT.timeout)
    expect(calls[0]!.body.generationConfig.thinkingConfig).toBeUndefined()
    expect(calls[0]!.body.generationConfig.maxOutputTokens).toBe(32_768)
  })
})
