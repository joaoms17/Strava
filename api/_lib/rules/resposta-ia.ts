import { z } from 'zod'

// Respostas da IA em JSON estrito (structured outputs), sem depender do
// helper zodOutputFormat do SDK: esse helper tira os `enum` do schema que
// vai para a API (passam a texto na descrição), e o modelo podia responder
// «média» em vez de «media» — a validação falhava e a refeição ficava em
// «Não carregou», sem sequer ficar registado o custo da chamada.

type Json = Record<string, unknown>

const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid'])
const DROPPED = [
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'default',
]

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify)
  if (!node || typeof node !== 'object') return node
  const out: Json = {}
  for (const [key, value] of Object.entries(node as Json)) {
    if (DROPPED.includes(key)) continue
    if (key === 'format' && !SUPPORTED_FORMATS.has(String(value))) continue
    if (key === 'minItems' && value !== 0 && value !== 1) continue
    if (key === 'oneOf') out.anyOf = strictify(value)
    else if (key === 'properties' || key === '$defs') {
      out[key] = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, strictify(v)]))
    } else out[key] = strictify(value)
  }
  if (out.type === 'object') out.additionalProperties = false
  // `type: ["string", "null"]` → anyOf, a forma que a documentação dá como
  // suportada; o enum e os restantes campos ficam na variante não nula.
  if (Array.isArray(out.type) && out.type.length > 1) {
    const { type, description, title, ...rest } = out
    const variants = (type as string[]).map((t) =>
      t === 'null' ? { type: 'null' } : strictify({ ...rest, type: t }),
    )
    return { anyOf: variants, ...(description ? { description } : {}), ...(title ? { title } : {}) }
  }
  return out
}

// O JSON schema que vai para output_config.format: com os enum, sem os
// limites que os structured outputs não aceitam (verificam-se depois).
export function outputSchema(schema: z.ZodType): Json {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output', reused: 'inline' })
  return strictify(json) as Json
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

function typesOf(node: Json): string[] {
  const t = node.type
  return Array.isArray(t) ? (t as string[]) : typeof t === 'string' ? [t] : []
}

// Arruma pequenas diferenças antes de validar: «Média» → «media», «42,5» → 42.5,
// campos anuláveis com valores estranhos → null.
export function coerceToSchema(value: unknown, node: unknown): unknown {
  if (!node || typeof node !== 'object') return value
  const schema = node as Json
  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf as Json[]
    const nullable = variants.some((v) => typesOf(v).includes('null'))
    if (value == null) return nullable ? null : value
    for (const variant of variants.filter((v) => !typesOf(v).includes('null'))) {
      const coerced = coerceToSchema(value, variant)
      if (matches(coerced, variant)) return coerced
    }
    return nullable ? null : value
  }
  const types = typesOf(schema)
  const nullable = types.includes('null')
  if (value == null) return nullable ? null : value

  if (Array.isArray(schema.enum)) {
    const options = schema.enum as unknown[]
    if (options.includes(value)) return value
    if (typeof value === 'string') {
      const found = options.find((o) => typeof o === 'string' && fold(o) === fold(value))
      if (found !== undefined) return found
    }
    return nullable ? null : value
  }
  if (types.includes('number') || types.includes('integer')) {
    let n: number | null = typeof value === 'number' ? value : null
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.replace(',', '.'))
      n = Number.isFinite(parsed) ? parsed : null
    }
    if (n == null || !Number.isFinite(n)) return nullable ? null : value
    return types.includes('integer') && !types.includes('number') ? Math.round(n) : n
  }
  if (types.includes('string')) {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return nullable ? null : value
  }
  if (types.includes('boolean')) {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 'sim') return true
    if (value === 'false' || value === 'nao' || value === 'não') return false
    return nullable ? null : value
  }
  if (types.includes('array')) {
    if (!Array.isArray(value)) return nullable ? null : []
    return value.map((item) => coerceToSchema(item, schema.items))
  }
  if (types.includes('object') && typeof value === 'object' && !Array.isArray(value)) {
    const props = (schema.properties ?? {}) as Json
    const out: Json = {}
    for (const [key, prop] of Object.entries(props)) out[key] = coerceToSchema((value as Json)[key], prop)
    return out
  }
  return value
}

function matches(value: unknown, node: Json): boolean {
  const types = typesOf(node)
  if (value === null) return types.includes('null')
  if (Array.isArray(node.enum)) return (node.enum as unknown[]).includes(value)
  if (Array.isArray(value)) return types.includes('array')
  if (typeof value === 'number') return types.includes('number') || types.includes('integer')
  return types.includes(typeof value)
}

export class AiError extends Error {
  // message: frase para o João; detail: o que aconteceu, para diagnóstico;
  // transient: vale a pena tentar outra vez já (demora, sobrecarga, formato).
  constructor(
    message: string,
    readonly detail: string,
    readonly transient = false,
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export const AI_FORMAT_ERROR = 'A resposta da IA veio num formato inesperado.'

// Lê o texto da resposta: JSON → arrumar → validar com o schema Zod.
export function parseStructured<T>(text: string, schema: z.ZodType<T>, json: Json = outputSchema(schema)): T {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new AiError(AI_FORMAT_ERROR, `JSON inválido: ${(err as Error).message}; início: ${text.slice(0, 80)}`, true)
  }
  const result = schema.safeParse(coerceToSchema(raw, json))
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ')
    throw new AiError(AI_FORMAT_ERROR, `schema: ${issues}`, true)
  }
  return result.data
}

// Erros do SDK (sem importar o SDK: basta o status e o nome) → frase curta.
export function describeAiError(err: unknown): AiError {
  if (err instanceof AiError) return err
  const e = (err ?? {}) as { status?: number; name?: string; message?: string; error?: { error?: { message?: string; type?: string } } }
  const apiMessage = e.error?.error?.message ?? e.message ?? String(err)
  const detail = `${e.status ?? e.name ?? 'erro'}: ${apiMessage}`.slice(0, 300)
  const text = apiMessage.toLowerCase()
  if (/anthropic_api_key|api key|apikey|x-api-key/.test(text) && e.status == null) {
    return new AiError('Falta a chave da IA no Vercel (ANTHROPIC_API_KEY).', detail)
  }
  if (e.name === 'APIConnectionTimeoutError' || /timed? ?out/.test(text)) {
    return new AiError('A IA demorou demasiado a responder.', detail, true)
  }
  if (e.name === 'APIConnectionError') return new AiError('Não consegui falar com a IA.', detail, true)
  switch (e.status) {
    case 401:
      return new AiError('A chave da IA não é válida (ANTHROPIC_API_KEY no Vercel).', detail)
    case 403:
      return new AiError('A chave da IA não tem acesso a este modelo.', detail)
    case 404:
      return new AiError('O modelo da IA não foi encontrado.', detail)
    case 413:
      return new AiError('As fotos são grandes demais para a IA.', detail)
    case 429:
      return new AiError('Demasiados pedidos à IA. Tenta daqui a um minuto.', detail, true)
    case 400:
      if (/credit|billing|balance/.test(text)) return new AiError('A conta da IA ficou sem crédito.', detail)
      return new AiError('A IA recusou o pedido.', detail)
  }
  if (e.status != null && e.status >= 500) return new AiError('A IA está sobrecarregada. Tenta outra vez daqui a pouco.', detail, true)
  // Outro erro qualquer (base de dados, rede do servidor): vale outra tentativa.
  return new AiError(apiMessage.length <= 120 ? apiMessage : 'A análise falhou.', detail, true)
}

// O que fica em analysis_error: a frase e, numa segunda linha, o detalhe.
export function errorForStorage(err: unknown): string {
  const e = describeAiError(err)
  return `${e.message}\n${e.detail}`.slice(0, 500)
}

// Lado da app: separa a frase do detalhe.
export function splitStoredError(stored: string | null | undefined): { message: string | null; detail: string | null } {
  if (!stored) return { message: null, detail: null }
  const [message, ...rest] = stored.split('\n')
  return { message: message || null, detail: rest.join('\n') || null }
}
