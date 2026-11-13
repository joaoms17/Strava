import type Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import { AiError, AiQuotaError, describeAiError, outputSchema, parseStructured } from './rules/resposta-ia.js'
import { USD_TO_EUR, quotaMessage, quotaOutcome, quotaPlan } from './rules/custos.js'
import { lisbonClock, lisbonInstant } from './rules/momentos.js'
import { geminiModels, type AiRole } from './rules/gemini.js'
import { geminiCall } from './gemini.js'

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

// Que IA usar: AI_PROVIDER=gemini|anthropic; sem isso, o Gemini quando há
// GEMINI_API_KEY (plano gratuito) e o Claude no resto.
export type AiProvider = 'anthropic' | 'gemini'
export function aiProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  const chosen = env.AI_PROVIDER?.trim().toLowerCase()
  if (chosen === 'gemini' || chosen === 'anthropic') return chosen
  return env.GEMINI_API_KEY?.trim() ? 'gemini' : 'anthropic'
}

function roleOf(model: string): AiRole {
  return model === MODELS.vision ? 'vision' : 'text'
}

// O SDK só se carrega quando a IA é o Claude (P7: ~50 ms a menos no arranque
// a frio de cada função, e com o Gemini nunca se carrega).
let client: Promise<Anthropic> | null = null
export function anthropic(): Promise<Anthropic> {
  client ??= import('@anthropic-ai/sdk').then(
    ({ default: Sdk }) => new Sdk(),
    (err: unknown) => {
      client = null
      throw err
    },
  )
  return client
}

// Opções por pedido. Sem repetições automáticas do SDK: cada função tem 60 s
// no total, e as repetições escondidas multiplicavam o tempo e o custo. Com o
// Gemini, o `timeout` é o da chamada inteira: o modelo principal deixa uma
// fatia à reserva nas fotos (30 s + 15 s; no texto o principal fica com os 25 s; rules/tempo-ia.ts).
export const REQUEST_TEXT = { maxRetries: 0, timeout: 25_000 }
export const REQUEST_VISION = { maxRetries: 0, timeout: 45_000 }

// O Sonnet 5 pensa de forma adaptativa quando o parâmetro é omitido; para
// extrair JSON não compensa o tempo nem o custo. Com o Gemini, o mesmo pedido
// vai com pouco raciocínio (thinkingLevel 'low' no Gemini 3, thinkingBudget 0
// no 2.5; rules/gemini.ts).
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

// A função não existe (migração por aplicar): PostgREST responde PGRST202;
// o Postgres, 42883.
export function missingFunction(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883' || /could not find the function/i.test(error?.message ?? '')
}

// M20: antes de chamar a IA, reserva a chamada (ai_reserve_call, migração
// 20261113000060): numa só transação, com um lock por pessoa (ou pela casa),
// verifica o limite diário e o teto do mês e regista a linha «reservada».
// Recusada, lança AiQuotaError. Devolve o id da linha, ou null sem a função
// (ou com uma falha dela): aí fica como antes, com a verificação feita por
// quem chama (aiLimitReached) e o registo depois da resposta.
export async function reserveCall(
  admin: SupabaseClient,
  userId: string,
  kind: string,
  model: string,
  force = false,
): Promise<string | null> {
  const provider = aiProvider()
  const { data: profile } = await admin
    .from('profile')
    .select('ai_monthly_cap_eur,ai_daily_vision_cap')
    .eq('user_id', userId)
    .maybeSingle()
  const plan = quotaPlan(kind, provider, profile, force)
  const now = new Date()
  const { data, error } = await admin.rpc('ai_reserve_call', {
    p_user_id: userId,
    p_kind: kind,
    p_model: model,
    p_count_kinds: plan.countKinds,
    p_daily_cap: plan.dailyCap,
    p_shared_daily: plan.sharedDaily,
    p_day_start: lisbonInstant(lisbonClock(now).date, '00:00').toISOString(),
    p_month_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    p_monthly_cap_eur: plan.monthlyCapEur,
    p_usd_to_eur: USD_TO_EUR,
  })
  if (error) {
    if (!missingFunction(error)) console.error('Reserva da quota da IA falhou:', error.message)
    return null
  }
  const outcome = quotaOutcome(data)
  if (!outcome) return null
  if (!outcome.ok) throw new AiQuotaError(quotaMessage(outcome.reason, kind, plan.sharedDaily), outcome.reason)
  return outcome.id
}

// Fecha a chamada: com reserva, atualiza essa linha (ok ou falhou, com os
// tokens e o custo); sem ela, regista como antes (só as que responderam).
async function settleCall(
  admin: SupabaseClient,
  reservation: string | null,
  entry: { user_id: string; kind: string; model: string; usage: Usage | null; ok: boolean },
): Promise<number> {
  if (!reservation) {
    return entry.usage ? logApiCall(admin, { user_id: entry.user_id, kind: entry.kind, model: entry.model, usage: entry.usage }) : 0
  }
  const usage = entry.usage ?? { input_tokens: 0, output_tokens: 0 }
  const cost = costUsd(entry.model, usage)
  const { error } = await admin
    .from('api_calls')
    .update({
      model: entry.model,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      cost_usd: cost,
      status: entry.ok ? 'ok' : 'falhou',
    })
    .eq('id', reservation)
  if (error) console.error('Falha a fechar api_call:', error.message)
  return cost
}

// Uma chamada com resposta em JSON estrito. Antes, a reserva da quota (M20);
// o custo regista-se sempre (mesmo quando a resposta não serve), e com a
// reserva também as chamadas que falham ficam registadas (e contam). Os
// erros chegam como AiError, com uma frase para a app e o detalhe para
// diagnóstico. As chamadas escrevem-se no formato do Claude (MODELS.text /
// MODELS.vision); com o Gemini, o mesmo pedido vai para o modelo Gemini
// desse papel. `model` é o modelo que respondeu e `reserve` diz se foi o de
// reserva (só com o Gemini).
export async function structuredCall<T>(
  admin: SupabaseClient,
  // `force`: «mesmo assim» (acima do limite): regista, mas não recusa.
  meta: { userId: string; kind: string; request: { maxRetries: number; timeout: number }; force?: boolean },
  params: Omit<MessageCreateParamsNonStreaming, 'output_config' | 'stream'>,
  schema: z.ZodType<T>,
): Promise<{ output: T; cost: number; usage: Usage; model: string; reserve: boolean }> {
  const json = outputSchema(schema)
  const reservation = await reserveCall(admin, meta.userId, meta.kind, params.model, meta.force === true)
  const settle = (model: string, usage: Usage | null, ok: boolean) =>
    settleCall(admin, reservation, { user_id: meta.userId, kind: meta.kind, model, usage, ok })

  if (aiProvider() === 'gemini') {
    let result
    try {
      result = await geminiCall(geminiModels(roleOf(params.model), process.env), params, json, meta.request.timeout)
    } catch (err) {
      const error = describeAiError(err)
      console.error(`IA (${meta.kind}, Gemini) falhou:`, error.message, '|', error.detail)
      await settle(params.model, null, false)
      throw error
    }
    let output: T
    try {
      output = parseStructured(result.text, schema, json)
    } catch (err) {
      const error = describeAiError(err)
      console.error(`IA (${meta.kind}, Gemini) resposta inválida:`, error.detail)
      await settle(result.model ?? '', result.usage, false)
      throw error
    }
    const cost = await settle(result.model ?? '', result.usage, true)
    return { output, cost, usage: result.usage, model: result.model ?? '', reserve: result.reserve }
  }

  let response: Anthropic.Message
  try {
    response = await (await anthropic()).messages.create(
      { ...params, output_config: { format: { type: 'json_schema', schema: json } } },
      meta.request,
    )
  } catch (err) {
    const error = describeAiError(err)
    console.error(`IA (${meta.kind}) falhou:`, error.message, '|', error.detail)
    await settle(params.model, null, false)
    throw error
  }
  let output: T
  try {
    if (response.stop_reason === 'refusal') throw new AiError('A IA recusou analisar isto.', 'stop_reason: refusal')
    if (response.stop_reason === 'max_tokens') {
      throw new AiError('A resposta da IA ficou cortada.', `stop_reason: max_tokens (${response.usage.output_tokens} tokens)`)
    }
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
    output = parseStructured(text, schema, json)
  } catch (err) {
    const error = describeAiError(err)
    console.error(`IA (${meta.kind}) resposta inválida:`, error.detail)
    await settle(params.model, response.usage, false)
    throw error
  }
  const cost = await settle(params.model, response.usage, true)
  return { output, cost, usage: response.usage, model: params.model, reserve: false }
}
