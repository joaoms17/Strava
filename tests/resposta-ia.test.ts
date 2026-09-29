import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AiError,
  coerceToSchema,
  describeAiError,
  errorForStorage,
  outputSchema,
  parseStructured,
  splitStoredError,
} from '../api/_lib/rules/resposta-ia'
import { analysisStalled, analysisStuck } from '../api/_lib/rules/analise'
import { MealAnalysisSchema, WorkoutShotSchema } from '../api/_lib/schemas'

// A chamada à IA com JSON estrito: o schema enviado leva os enum, e a
// resposta é arrumada antes de validar.
describe('schema para a API', () => {
  it('mantém os enum (o helper do SDK tirava-os) e fecha os objetos', () => {
    const json = outputSchema(MealAnalysisSchema) as any
    expect(json.$schema).toBeUndefined()
    expect(json.additionalProperties).toBe(false)
    expect(json.properties.meal_confidence).toEqual({ type: 'string', enum: ['alta', 'media', 'baixa'] })
    expect(json.properties.items.items.properties.confidence.enum).toEqual(['alta', 'media', 'baixa'])
    expect(json.properties.items.items.additionalProperties).toBe(false)
  })

  it('tira os limites numéricos que os structured outputs não aceitam', () => {
    const json = JSON.stringify(outputSchema(WorkoutShotSchema))
    expect(json).not.toMatch(/"minimum"|"maximum"|"\$schema"/)
    expect(json).toMatch(/"enum":\["garmin_connect"/)
  })
})

describe('resposta', () => {
  const answer = {
    title: 'Espetadas com batata',
    items: [
      { name: 'Espetada', grams: 200, kcal: 380, protein: 40, carbs: 2, fat: 22, confidence: 'Média', food_ref: null },
      { name: 'Batata frita', grams: '150', kcal: '450,5', protein: 5, carbs: 50, fat: 25, confidence: 'alta', food_ref: 'a3' },
    ],
    meal_confidence: 'média',
  }

  it('«Média» e «média» contam como media; números em texto passam a números', () => {
    const parsed = parseStructured(JSON.stringify(answer), MealAnalysisSchema)
    expect(parsed.meal_confidence).toBe('media')
    expect(parsed.items[0]!.confidence).toBe('media')
    expect(parsed.items[1]!.grams).toBe(150)
    expect(parsed.items[1]!.kcal).toBe(450.5)
  })

  it('campos anuláveis com valores estranhos ficam a null', () => {
    const schema = z.object({ sport: z.enum(['bike', 'walk']).nullable(), hr: z.number().nullable() })
    expect(coerceToSchema({ sport: 'natação', hr: 'n/d' }, outputSchema(schema))).toEqual({ sport: null, hr: null })
  })

  it('JSON partido ou fora do schema dá um erro legível e passageiro', () => {
    expect(() => parseStructured('{"title": "x"', MealAnalysisSchema)).toThrow(AiError)
    try {
      parseStructured(JSON.stringify({ title: 'x', items: [], meal_confidence: 'enorme' }), MealAnalysisSchema)
    } catch (err) {
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).message).toBe('A resposta da IA veio num formato inesperado.')
      expect((err as AiError).detail).toMatch(/meal_confidence/)
      expect((err as AiError).transient).toBe(true)
    }
  })
})

describe('erros da API em frases', () => {
  const api = (status: number, message: string) =>
    Object.assign(new Error(`${status} ${message}`), { status, error: { error: { message } } })

  it('chave inválida ou em falta não se repete sozinha', () => {
    expect(describeAiError(api(401, 'invalid x-api-key'))).toMatchObject({
      message: 'A chave da IA não é válida (ANTHROPIC_API_KEY no Vercel).',
      transient: false,
    })
    const missing = new Error('The ANTHROPIC_API_KEY environment variable is missing or empty; either provide it')
    expect(describeAiError(missing).message).toBe('Falta a chave da IA no Vercel (ANTHROPIC_API_KEY).')
    expect(describeAiError(api(400, 'Your credit balance is too low')).message).toBe('A conta da IA ficou sem crédito.')
  })

  it('sobrecarga, limite e demora tentam outra vez', () => {
    expect(describeAiError(api(529, 'Overloaded')).transient).toBe(true)
    expect(describeAiError(api(429, 'rate limit')).transient).toBe(true)
    const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })
    expect(describeAiError(timeout)).toMatchObject({ message: 'A IA demorou demasiado a responder.', transient: true })
  })

  it('fica guardado em duas linhas: a frase e o detalhe', () => {
    const stored = errorForStorage(api(400, 'messages.0.content.1.image.source: image exceeds 5 MB'))
    expect(splitStoredError(stored)).toEqual({
      message: 'A IA recusou o pedido.',
      detail: '400: messages.0.content.1.image.source: image exceeds 5 MB',
    })
    expect(splitStoredError('Não consegui ler esta refeição.')).toEqual({
      message: 'Não consegui ler esta refeição.',
      detail: null,
    })
  })
})

describe('anuláveis', () => {
  it('`type: [x, null]` vai como anyOf, com o enum na variante não nula', () => {
    const json = outputSchema(
      z.object({ a: z.string().nullable(), b: z.enum(['x', 'y']).nullable(), c: z.number().nullable() }),
    ) as any
    expect(json.properties.a).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] })
    expect(json.properties.b).toEqual({ anyOf: [{ type: 'string', enum: ['x', 'y'] }, { type: 'null' }] })
    expect(JSON.stringify(outputSchema(WorkoutShotSchema))).not.toMatch(/"type":\[/)
    expect(coerceToSchema({ a: null, b: 'X', c: '3,5' }, json)).toEqual({ a: null, b: 'x', c: 3.5 })
  })
})

describe('análise parada', () => {
  const base = { status: 'a_analisar', created_at: '2026-09-29T12:00:00Z' }
  const at = (s: string) => Date.parse(`2026-09-29T${s}Z`)

  it('à espera do servidor não está parada; sem começar há 25 s ou reivindicada há 95 s, está', () => {
    const started = { ...base, analysis_started_at: '2026-09-29T12:00:02Z', analysis_attempts: 1 }
    expect(analysisStalled(started, at('12:01:00'))).toBe(false)
    expect(analysisStalled(started, at('12:01:40'))).toBe(true)
    expect(analysisStalled({ ...base, analysis_started_at: null, analysis_attempts: 0 }, at('12:00:30'))).toBe(true)
  })

  it('«Tentar» aparece depois da 3.ª tentativa, ou passados 2 min e meio parada', () => {
    const third = { ...base, analysis_started_at: '2026-09-29T12:05:00Z', analysis_attempts: 3 }
    expect(analysisStuck(third, at('12:06:00'))).toBe(false)
    expect(analysisStuck(third, at('12:06:40'))).toBe(true)
    const first = { ...base, analysis_started_at: '2026-09-29T12:00:00Z', analysis_attempts: 1 }
    expect(analysisStuck(first, at('12:02:00'))).toBe(false)
    expect(analysisStuck(first, at('12:02:40'))).toBe(true)
    expect(analysisStuck({ ...first, status: 'erro' }, at('13:00:00'))).toBe(false)
  })
})
