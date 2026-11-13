import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase.js'
import { sameSecret } from '../_lib/secret.js'
import { aiProvider, anthropic, MODELS } from '../_lib/anthropic.js'
import { geminiModels } from '../_lib/rules/gemini.js'
import { DEFERRED_MIGRATIONS, MIGRATIONS, SCHEMA_VERSION, compareSchema, missingMigrations, type SchemaState } from '../_lib/rules/esquema.js'
import {
  PROMPT_REVIEW_NEUTRAL,
  PROMPT_MEAL_PHOTO_V3,
  PROMPT_MEAL_TEXT_V2,
  PROMPT_MEAL_CORRECT,
  PROMPT_MEAL_PHOTO_ADD,
  PROMPT_MEAL_LEFTOVERS,
  PROMPT_LABEL_READ,
  PROMPT_RECIPE,
  PROMPT_WORKOUT_SHOT,
  PROMPT_ASK,
  PROMPT_EVOLUTION,
  PROMPT_WORKOUT_SAID,
  PROMPT_MENU_PICK,
  readPrompt,
} from '../_lib/prompts.js'

// Estado do deploy: de preferência com o cabeçalho «Authorization: Bearer
// <CRON_SECRET>» (scripts/smoke.mjs); para abrir no browser,
// /api/day/health?token=<CRON_SECRET> (fica no histórico e nos registos).
// Diz que variáveis existem (nunca os valores), se os prompts foram incluídos,
// se o Supabase responde e se a chave da Anthropic dá acesso aos dois modelos.
// Mostra também a versão do schema (tabela schema_version, ideia 6) ao lado
// da que o código conhece; uma base de dados atrasada fica em `avisos`, sem
// tirar o «ok» (o código lê as colunas novas com tolerância).

const ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'CRON_SECRET',
  'HEALTH_INGEST_TOKEN',
  'HOUSE_EMAILS',
] as const

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']

interface Check {
  ok: boolean
  ms?: number
  detail?: string
}

function providedToken(req: VercelRequest): string {
  if (typeof req.query.token === 'string') return req.query.token
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7) : ''
}

async function timed(run: () => Promise<string | undefined>): Promise<Check> {
  const started = Date.now()
  try {
    const detail = await run()
    return { ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, ms: Date.now() - started, detail: message.slice(0, 200) }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não suportado.' })
    return
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    res.status(401).json({ error: 'Define a CRON_SECRET no Vercel para ver o estado.' })
    return
  }
  if (!sameSecret(providedToken(req), secret)) {
    res.status(401).json({ error: 'Token errado.' })
    return
  }

  const env = Object.fromEntries(ENV_VARS.map((name) => [name, Boolean(process.env[name])]))

  const prompts = Object.fromEntries(
    // Os prompts que a app usa hoje (o do narrador antigo já não é chamado).
    [
      PROMPT_REVIEW_NEUTRAL,
      PROMPT_MEAL_PHOTO_V3,
      PROMPT_MEAL_TEXT_V2,
      PROMPT_MEAL_CORRECT,
      PROMPT_MEAL_PHOTO_ADD,
      PROMPT_MEAL_LEFTOVERS,
      PROMPT_LABEL_READ,
      PROMPT_RECIPE,
      PROMPT_WORKOUT_SHOT,
      PROMPT_ASK,
      PROMPT_EVOLUTION,
      PROMPT_WORKOUT_SAID,
      PROMPT_MENU_PICK,
    ].map((file) => {
      try {
        return [file, readPrompt(file).length > 0]
      } catch {
        return [file, false]
      }
    }),
  )

  const aiOptions = { maxRetries: 0, timeout: 8_000 }
  // A IA em uso (Claude ou Gemini): a chave dá acesso aos dois modelos?
  const provider = aiProvider()
  const keyName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'
  const textModel = provider === 'gemini' ? geminiModels('text', process.env)[0]! : MODELS.text
  const visionModel = provider === 'gemini' ? geminiModels('vision', process.env)[0]! : MODELS.vision
  async function modelExists(model: string): Promise<undefined> {
    if (provider === 'anthropic') {
      await (await anthropic()).models.retrieve(model, {}, aiOptions)
      return undefined
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? ''}`)
    return undefined
  }
  // A versão do schema: sem a tabela (antes da migração 20261113000042) é
  // «desconhecida».
  async function schemaVersion(): Promise<{ base_de_dados: number | null; codigo: number; estado: SchemaState }> {
    const { data, error } = await adminClient().from('schema_version').select('version').maybeSingle()
    const db = error ? null : ((data as { version?: unknown } | null)?.version ?? null)
    return { base_de_dados: db == null ? null : Number(db), codigo: SCHEMA_VERSION, estado: compareSchema(db) }
  }
  const [supabase, schema, haiku, sonnet, versao] = await Promise.all([
    timed(async () => {
      const { count, error } = await adminClient()
        .from('profile')
        .select('user_id', { count: 'exact', head: true })
      if (error) throw new Error(error.message)
      if (!count) throw new Error('Sem perfil — corre os seeds no Supabase.')
      return `${count} perfil`
    }),
    // Migrações 1, 2 e 4: favoritos, vistas, colunas da análise e treino.
    timed(async () => {
      const admin = adminClient()
      for (const table of ['favorites', 'meals_counted', 'workouts_active']) {
        const { error } = await admin.from(table).select('*', { count: 'exact', head: true })
        if (error) throw new Error(`falta ${table}: corre a migração 20260928000000_fase1.sql`)
      }
      const { error } = await admin.from('meals').select('status,photo_paths,note', { head: true })
      if (error) throw new Error('faltam colunas: corre a migração 20260929000000_fase2.sql')
      const { error: fase3 } = await admin.from('workout_imports').select('*', { count: 'exact', head: true })
      if (fase3) throw new Error('falta workout_imports: corre a migração 20260930000000_fase3.sql')
      return 'migrações 1, 2 e 4'
    }),
    timed(async () => modelExists(textModel)),
    timed(async () => modelExists(visionModel)),
    schemaVersion().catch(() => ({ base_de_dados: null, codigo: SCHEMA_VERSION, estado: 'desconhecida' as SchemaState })),
  ])

  const missing = [...REQUIRED_ENV, keyName].filter((name) => !env[name])
  const promptsOk = Object.values(prompts).every(Boolean)
  const ok = missing.length === 0 && promptsOk && supabase.ok && schema.ok && haiku.ok && sonnet.ok

  const problems: string[] = []
  if (missing.length) problems.push(`faltam variáveis: ${missing.join(', ')}`)
  if (!promptsOk) problems.push('os prompts não foram incluídos no deploy')
  if (!supabase.ok) problems.push('o Supabase não responde')
  else if (!schema.ok) problems.push(`falta uma migração no Supabase (${schema.detail ?? ''})`)
  if (!haiku.ok || !sonnet.ok) problems.push(`a IA (${provider}) não responde (chave ou modelos)`)

  const avisos: string[] = []
  if (versao.estado === 'atrasada') {
    const pending = missingMigrations(versao.base_de_dados, MIGRATIONS).map((f) =>
      DEFERRED_MIGRATIONS[f] ? `${f} (${DEFERRED_MIGRATIONS[f]})` : f,
    )
    avisos.push(`faltam migrações no Supabase: ${pending.join(', ')}`)
  }
  if (versao.estado === 'desconhecida') avisos.push('sem schema_version: corre a migração 20261113000042_schema_version.sql')

  res.setHeader('Cache-Control', 'no-store')
  res.status(ok ? 200 : 503).json({
    ok,
    resumo: ok ? 'Tudo a funcionar.' : `Problemas: ${problems.join('; ')}.`,
    regiao: process.env.VERCEL_REGION ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    env,
    prompts,
    supabase,
    schema,
    versao_schema: versao,
    avisos,
    ia: { provider, [textModel]: haiku, [visionModel]: sonnet },
  })
}
