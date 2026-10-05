// Gemini (Google) como alternativa ao Claude, pela API REST generateContent.
// Aqui só o que é puro: o pedido a partir do mesmo formato das chamadas ao
// Claude, o schema no formato do Gemini, a leitura da resposta e os erros.
import { AiError } from './resposta-ia.js'

type Json = Record<string, unknown>

// Plano gratuito: o Flash lê melhor as fotos (poucos pedidos por dia); o
// Flash-Lite tem muitos mais pedidos grátis e serve de reserva. Os «-latest»
// seguem a versão mais recente de cada um.
export const GEMINI_DEFAULTS = {
  vision: 'gemini-flash-latest',
  text: 'gemini-flash-lite-latest',
} as const

export type AiRole = 'text' | 'vision'

// Modelos a tentar, por ordem (o segundo é a reserva quando o primeiro
// esgota o limite gratuito ou não existe).
export function geminiModels(role: AiRole, env: Record<string, string | undefined>): string[] {
  const vision = env.GEMINI_MODEL_VISION?.trim() || GEMINI_DEFAULTS.vision
  const text = env.GEMINI_MODEL_TEXT?.trim() || GEMINI_DEFAULTS.text
  const list = role === 'vision' ? [vision, text] : [text, vision]
  return [...new Set(list)]
}

// JSON Schema (o de outputSchema) → schema do Gemini (subconjunto OpenAPI):
// tipos em maiúsculas, anuláveis com `nullable`, enum com format 'enum',
// sem additionalProperties, com a ordem das propriedades.
export function toGeminiSchema(node: unknown): Json {
  if (!node || typeof node !== 'object') return {}
  const schema = node as Json
  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf as Json[]
    const nonNull = variants.filter((v) => v.type !== 'null')
    const nullable = nonNull.length < variants.length
    const base =
      nonNull.length === 1 ? toGeminiSchema(nonNull[0]) : { anyOf: nonNull.map((v) => toGeminiSchema(v)) }
    return {
      ...base,
      ...(nullable ? { nullable: true } : {}),
      ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
    }
  }
  const out: Json = {}
  const type = Array.isArray(schema.type) ? (schema.type as string[]).find((t) => t !== 'null') : schema.type
  if (Array.isArray(schema.type) && (schema.type as string[]).includes('null')) out.nullable = true
  if (typeof type === 'string') out.type = type.toUpperCase()
  if (typeof schema.description === 'string') out.description = schema.description
  if (Array.isArray(schema.enum)) {
    out.type = 'STRING'
    out.format = 'enum'
    out.enum = (schema.enum as unknown[]).map(String)
  }
  if (type === 'object') {
    const props = (schema.properties ?? {}) as Json
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]))
    out.propertyOrdering = Object.keys(props)
    if (Array.isArray(schema.required)) out.required = schema.required
  }
  if (type === 'array' && schema.items) out.items = toGeminiSchema(schema.items)
  return out
}

// As chamadas estão escritas no formato do Claude (system, messages com
// blocos de imagem ou de áudio em base64); o mesmo pedido no formato do Gemini.
interface ClaudeLikeBlock {
  type: string
  text?: string
  source?: { type: string; media_type?: string; data?: string }
}
export interface ClaudeLikeParams {
  system?: unknown
  messages: { role: string; content: string | ClaudeLikeBlock[] | unknown }[]
}

export function geminiRequest(params: ClaudeLikeParams, jsonSchema: Json): Json {
  const contents = params.messages.map((message) => {
    const blocks: ClaudeLikeBlock[] =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : ((message.content as ClaudeLikeBlock[]) ?? [])
    const parts = blocks.flatMap((block): Json[] => {
      if (block.type === 'text' && block.text) return [{ text: block.text }]
      if (block.type === 'image' && block.source?.type === 'base64' && block.source.data) {
        return [{ inlineData: { mimeType: block.source.media_type ?? 'image/jpeg', data: block.source.data } }]
      }
      // Áudio (só o Gemini ouve): «Dizer o treino».
      if (block.type === 'audio' && block.source?.type === 'base64' && block.source.data) {
        return [{ inlineData: { mimeType: block.source.media_type ?? 'audio/wav', data: block.source.data } }]
      }
      return []
    })
    return { role: message.role === 'assistant' ? 'model' : 'user', parts }
  })
  const system = typeof params.system === 'string' ? params.system : null
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    // Sem temperature: nos Gemini 3 a Google recomenda o valor por omissão.
    // O teto de saída é largo porque o raciocínio do modelo também conta.
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(jsonSchema),
      maxOutputTokens: 32_768,
    },
  }
}

export interface GeminiResult {
  text: string
  model: string | null
  usage: { input_tokens: number; output_tokens: number }
}

// Lê a resposta: texto (sem as partes de raciocínio), modelo e tokens.
export function readGeminiResponse(body: unknown): GeminiResult {
  const b = (body ?? {}) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
    modelVersion?: string
  }
  const usage = {
    input_tokens: b.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: (b.usageMetadata?.candidatesTokenCount ?? 0) + (b.usageMetadata?.thoughtsTokenCount ?? 0),
  }
  if (b.promptFeedback?.blockReason) {
    throw new AiError('A IA recusou analisar isto.', `blockReason: ${b.promptFeedback.blockReason}`)
  }
  const candidate = b.candidates?.[0]
  const finish = candidate?.finishReason ?? 'desconhecido'
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
  if (finish === 'MAX_TOKENS') throw new AiError('A resposta da IA ficou cortada.', `finishReason: MAX_TOKENS`, true)
  if (['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'].includes(finish)) {
    throw new AiError('A IA recusou analisar isto.', `finishReason: ${finish}`)
  }
  if (!text) throw new AiError('A IA respondeu sem texto.', `finishReason: ${finish}`, true)
  return { text, model: b.modelVersion ?? null, usage }
}

// Erro HTTP do Gemini → frase para a app. `fallback`: vale tentar o modelo
// de reserva (limite esgotado, modelo inexistente, sobrecarga).
export function geminiError(status: number, body: unknown): AiError & { fallback: boolean } {
  const e = ((body ?? {}) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } }).error
  const message = e?.message ?? `HTTP ${status}`
  const reason = e?.details?.find((d) => d.reason)?.reason ?? e?.status ?? ''
  const detail = `${status} ${reason}: ${message}`.slice(0, 300)
  const make = (text: string, transient: boolean, fallback: boolean) =>
    Object.assign(new AiError(text, detail, transient), { fallback })
  // Chaves novas «AQ.»: com um erro conhecido da Google, algumas são tratadas
  // como tokens OAuth e recusadas. Uma chave clássica «AIza…» resolve.
  if (reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED') {
    return make('A Google recusou esta chave «AQ.» (erro conhecido da Google). Cria uma chave «AIza…».', false, false)
  }
  if (reason === 'API_KEY_INVALID' || status === 401 || /api key not valid|api key expired/i.test(message)) {
    return make('A chave do Gemini não é válida (GEMINI_API_KEY no Vercel).', false, false)
  }
  if (status === 429) {
    return make('Chegaste ao limite gratuito do Gemini. Tenta mais logo ou amanhã.', true, true)
  }
  if (status === 404) return make('O modelo do Gemini não foi encontrado.', false, true)
  if (status === 403) return make('A chave do Gemini não tem acesso a este modelo.', false, true)
  if (status === 400 && /location is not supported|user location/i.test(message)) {
    return make('O Gemini não está disponível nesta região do servidor.', false, false)
  }
  if (status === 400) return make('O Gemini recusou o pedido.', false, false)
  if (status >= 500) return make('A IA está sobrecarregada. Tenta outra vez daqui a pouco.', true, true)
  return make('A análise falhou.', true, false)
}
