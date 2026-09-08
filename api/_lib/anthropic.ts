import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

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
