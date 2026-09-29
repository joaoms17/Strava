import { describe, expect, it } from 'vitest'
import { geminiError, geminiModels, geminiRequest, readGeminiResponse, toGeminiSchema } from '../api/_lib/rules/gemini'
import { AiError, outputSchema, parseStructured } from '../api/_lib/rules/resposta-ia'
import { MealAnalysisSchema, WorkoutShotSchema } from '../api/_lib/schemas'
import { aiProvider } from '../api/_lib/anthropic'

// Gemini como alternativa ao Claude: o mesmo pedido, outro formato.
describe('que IA', () => {
  it('Gemini quando há GEMINI_API_KEY; AI_PROVIDER manda', () => {
    expect(aiProvider({})).toBe('anthropic')
    expect(aiProvider({ GEMINI_API_KEY: 'AIza-x' })).toBe('gemini')
    expect(aiProvider({ GEMINI_API_KEY: 'AIza-x', AI_PROVIDER: 'anthropic' })).toBe('anthropic')
    expect(aiProvider({ AI_PROVIDER: 'Gemini' })).toBe('gemini')
  })

  it('fotos no Flash com o Flash-Lite de reserva; texto no Flash-Lite', () => {
    expect(geminiModels('vision', {})).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
    expect(geminiModels('text', {})).toEqual(['gemini-flash-lite-latest', 'gemini-flash-latest'])
    expect(geminiModels('vision', { GEMINI_MODEL_VISION: 'gemini-2.5-flash' })[0]).toBe('gemini-2.5-flash')
  })
})

describe('schema do Gemini', () => {
  it('tipos em maiúsculas, enum, anuláveis e ordem das propriedades; sem additionalProperties', () => {
    const g = toGeminiSchema(outputSchema(MealAnalysisSchema)) as any
    expect(g.type).toBe('OBJECT')
    expect(g.propertyOrdering).toEqual(['title', 'items', 'meal_confidence'])
    expect(g.properties.meal_confidence).toEqual({ type: 'STRING', format: 'enum', enum: ['alta', 'media', 'baixa'] })
    expect(g.properties.items.items.properties.food_ref).toEqual({ type: 'STRING', nullable: true })
    expect(JSON.stringify(g)).not.toMatch(/additionalProperties|anyOf|"null"/)
  })

  it('o schema do print do relógio também converte (inteiros, enum anuláveis)', () => {
    const g = toGeminiSchema(outputSchema(WorkoutShotSchema)) as any
    expect(g.properties.images.items.properties.index.type).toBe('INTEGER')
    expect(g.properties.activity.properties.training_load_kind).toMatchObject({ type: 'STRING', format: 'enum', nullable: true })
    expect(g.properties.activity.properties.avg_hr).toEqual({ type: 'NUMBER', nullable: true })
  })
})

describe('pedido', () => {
  it('system, imagem em base64 e texto no formato do Gemini, com JSON estrito', () => {
    const body = geminiRequest(
      {
        system: 'És nutricionista.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
              { type: 'text', text: '{"texto":null}' },
            ],
          },
        ],
      },
      outputSchema(MealAnalysisSchema),
    ) as any
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'És nutricionista.' }] })
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { text: '{"texto":null}' }] },
    ])
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT')
    expect(body.generationConfig.temperature).toBeUndefined()
  })
})

describe('resposta', () => {
  const answer = { title: 'Maçã', items: [{ name: 'Maçã', grams: 150, kcal: 78, protein: 0.4, carbs: 21, fat: 0.3, confidence: 'média', food_ref: null }], meal_confidence: 'alta' }

  it('junta o texto sem as partes de raciocínio e conta os tokens', () => {
    const r = readGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'a pensar', thought: true }, { text: JSON.stringify(answer) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 150, thoughtsTokenCount: 300 },
      modelVersion: 'gemini-3.8-flash',
    })
    expect(r.model).toBe('gemini-3.8-flash')
    expect(r.usage).toEqual({ input_tokens: 1200, output_tokens: 450 })
    expect(parseStructured(r.text, MealAnalysisSchema).items[0]!.confidence).toBe('media')
  })

  it('recusas e respostas cortadas dão frases', () => {
    expect(() => readGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow('A IA recusou analisar isto.')
    expect(() => readGeminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })).toThrow(
      'A resposta da IA ficou cortada.',
    )
  })
})

describe('erros', () => {
  it('chave inválida não tenta outro modelo; limite gratuito tenta a reserva', () => {
    const invalid = geminiError(400, {
      error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] },
    })
    expect(invalid).toBeInstanceOf(AiError)
    expect(invalid).toMatchObject({ message: 'A chave do Gemini não é válida (GEMINI_API_KEY no Vercel).', fallback: false, transient: false })
    const quota = geminiError(429, { error: { code: 429, message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED' } })
    expect(quota).toMatchObject({ fallback: true, transient: true })
    expect(quota.message).toMatch(/limite gratuito do Gemini/)
    expect(geminiError(404, { error: { message: 'models/x is not found' } }).fallback).toBe(true)
    expect(geminiError(503, { error: { message: 'The model is overloaded.' } })).toMatchObject({ fallback: true, transient: true })
  })
})

describe('chaves «AQ.»', () => {
  it('o erro conhecido da Google diz para criar uma chave AIza', () => {
    const e = geminiError(401, {
      error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] },
    })
    expect(e.message).toMatch(/AQ\..*AIza/)
    expect(e).toMatchObject({ transient: false, fallback: false })
    expect(geminiError(401, { error: { status: 'UNAUTHENTICATED', message: 'x' } }).message).toMatch(/não é válida/)
  })
})
