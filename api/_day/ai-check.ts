import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { aiProvider, MODELS, NO_THINKING, structuredCall } from '../_lib/anthropic.js'
import { geminiModels } from '../_lib/rules/gemini.js'
import { describeAiError } from '../_lib/rules/resposta-ia.js'

// «Verificar a IA» (Definições › Avançado): uma chamada mínima a cada modelo,
// com o mesmo caminho das refeições (JSON estrito). Diz que IA está em uso
// (Claude ou Gemini), se a chave existe, se é válida, se há crédito ou limite
// gratuito e se os dois modelos respondem. Fica em api_calls como 'ai_check'.

const PingSchema = z.object({ ok: z.boolean() })

interface ModelCheck {
  model: string
  label: string
  ok: boolean
  ms: number
  message: string
  detail: string | null
}

async function ping(userId: string, model: string, label: string, vision: boolean): Promise<ModelCheck> {
  const started = Date.now()
  const planned = aiProvider() === 'gemini' ? geminiModels(vision ? 'vision' : 'text', process.env)[0]! : model
  try {
    const result = await structuredCall(
      adminClient(),
      { userId, kind: 'ai_check', request: { maxRetries: 0, timeout: 25_000 } },
      {
        model,
        max_tokens: 50,
        ...(vision ? { thinking: NO_THINKING } : { temperature: 0 }),
        messages: [{ role: 'user', content: 'Teste de ligação. Responde com ok = true.' }],
      },
      PingSchema,
    )
    return { model: result.model || planned, label, ok: true, ms: Date.now() - started, message: 'Responde.', detail: null }
  } catch (err) {
    const error = describeAiError(err)
    return { model: planned, label, ok: false, ms: Date.now() - started, message: error.message, detail: error.detail }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não suportado.' })
      return
    }
    const { user } = await requireUser(req)
    const provider = aiProvider()
    const keyName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'
    const providerName = provider === 'gemini' ? 'Gemini (Google)' : 'Claude (Anthropic)'
    const key = process.env[keyName] ?? ''
    if (!key.trim()) {
      res.status(200).json({
        ok: false,
        key: false,
        provider: providerName,
        resumo: `Falta a chave da IA no Vercel (${keyName}). Junta-a e volta a publicar.`,
        models: [],
      })
      return
    }
    const models = await Promise.all([
      ping(user.id, MODELS.text, 'Texto', false),
      ping(user.id, MODELS.vision, 'Fotos', true),
    ])
    const ok = models.every((m) => m.ok)
    const prefix = provider === 'gemini' ? 'AIza' : 'sk-ant-'
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      ok,
      key: true,
      provider: providerName,
      // Só o formato (nunca a chave): ajuda a ver se foi colada outra coisa.
      key_shape: key.startsWith(prefix) ? `${prefix}…` : `formato inesperado (devia começar por ${prefix})`,
      resumo: ok ? 'A IA está a funcionar.' : (models.find((m) => !m.ok)?.message ?? 'A IA não responde.'),
      models,
    })
  } catch (err) {
    respondError(res, err)
  }
}
