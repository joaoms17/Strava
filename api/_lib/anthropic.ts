import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import { AiError, describeAiError, outputSchema, parseStructured } from './rules/resposta-ia.js'

// IDs confirmados na documentação da API (skill claude-api, docs.claude.com).
export const MODELS = {
  text: 'claude-haiku-4-5',
  vision: 'claude-sonnet-5',
} as const

// USD por milhão de tokens (docs.claude.com/pricing).
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
}

let client: Anthropic | null = null
export function anthropic(): Anthropic {
  client ??= new Anthropic()
  return client
}

// Opções por pedido. Sem repetições automáticas do SDK: cada função tem 60 s
// no total, e as repetições escondidas multiplicavam o tempo e o custo.
export const REQUEST_TEXT = { maxRetries: 0, timeout: 25_000 }
export const REQUEST_VISION = { maxRetries: 0, timeout: 45_000 }

// O Sonnet 5 pensa de forma adaptativa quando o parâmetro é omitido; para
// extrair JSON não compensa o tempo nem o custo.
export const NO_THINKING = { type: 'disabled' } as const

// Só se tenta outra vez se ainda houver tempo para uma segunda chamada.
export function timeLeftForRetry(startedAt: number, budgetMs: number): boolean {
  return Date.now() - startedAt < budgetMs
}

export interface Usage {
  input_tokens: number
  output_tokens: number
}

export function costUsd(model: string, usage: Usage): number {
  const price = PRICES[model]
  if (!price) return 0
  return (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000
}

export async function logApiCall(
  admin: SupabaseClient,
  entry: { user_id: string; kind: string; model: string; usage: Usage },
): Promise<number> {
  const cost = costUsd(entry.model, entry.usage)
  const { error } = await admin.from('api_calls').insert({
    user_id: entry.user_id,
    kind: entry.kind,
    model: entry.model,
    tokens_in: entry.usage.input_tokens,
    tokens_out: entry.usage.output_tokens,
    cost_usd: cost,
  })
  if (error) console.error('Falha a registar api_call:', error.message)
  return cost
}

// Uma chamada com resposta em JSON estrito. O custo regista-se sempre (mesmo
// quando a resposta não serve); os erros chegam como AiError, com uma frase
// para a app e o detalhe para diagnóstico.
export async function structuredCall<T>(
  admin: SupabaseClient,
  meta: { userId: string; kind: string; request: { maxRetries: number; timeout: number } },
  params: Omit<MessageCreateParamsNonStreaming, 'output_config' | 'stream'>,
  schema: z.ZodType<T>,
): Promise<{ output: T; cost: number; usage: Usage }> {
  const json = outputSchema(schema)
  let response: Anthropic.Message
  try {
    response = await anthropic().messages.create(
      { ...params, output_config: { format: { type: 'json_schema', schema: json } } },
      meta.request,
    )
  } catch (err) {
    const error = describeAiError(err)
    console.error(`IA (${meta.kind}) falhou:`, error.message, '|', error.detail)
    throw error
  }
  const cost = await logApiCall(admin, { user_id: meta.userId, kind: meta.kind, model: params.model, usage: response.usage })
  if (response.stop_reason === 'refusal') throw new AiError('A IA recusou analisar isto.', 'stop_reason: refusal')
  if (response.stop_reason === 'max_tokens') {
    throw new AiError('A resposta da IA ficou cortada.', `stop_reason: max_tokens (${response.usage.output_tokens} tokens)`)
  }
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
  try {
    return { output: parseStructured(text, schema, json), cost, usage: response.usage }
  } catch (err) {
    const error = describeAiError(err)
    console.error(`IA (${meta.kind}) resposta inválida:`, error.detail)
    throw error
  }
}
