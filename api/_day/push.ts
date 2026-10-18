import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import {
  MISSING_PUSH_MIGRATION,
  SUBSCRIPTION_COLUMNS,
  deliver,
  missingTable,
  vapidKeys,
  type SubscriptionRow,
} from '../_lib/push.js'
import { NO_PUSH, PUSH_KINDS, TEST_NOTICE, anyPush, cleanPrefs, pushEndpointAllowed } from '../_lib/rules/notificacoes.js'

// Definições › Notificações: cada telemóvel (cada app instalada) tem a sua
// subscrição, com as notificações escolhidas. Uma subscrição é de uma pessoa
// de cada vez: ligar noutra conta no mesmo telemóvel passa-a para essa.

const Endpoint = z.string().max(2000).refine(pushEndpointAllowed)
const PrefsSchema = z.object(Object.fromEntries(PUSH_KINDS.map((k) => [k, z.boolean().optional()]))).strict()

const SubscribeSchema = z.object({
  subscription: z.object({
    endpoint: Endpoint,
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  }),
  prefs: PrefsSchema.optional(),
  // A verificação ao abrir a app: só renova uma subscrição que o servidor já
  // tem desta pessoa (com as escolhas guardadas); não cria nem a tira a outra.
  check: z.boolean().optional(),
})
const EndpointSchema = z.object({ endpoint: Endpoint })

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new HttpError(400, 'Pedido inválido.')
  return result.data
}

function failIfMissing(error: { code?: string; message?: string } | null): void {
  if (missingTable(error)) throw new HttpError(503, MISSING_PUSH_MIGRATION)
  if (error) throw new HttpError(500, error.message ?? 'Erro na base de dados.')
}

// A chave pública (criada na primeira vez, se não houver).
export const pushKey: Handler = async (req, res) => {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    await requireUser(req)
    const { publicKey } = await vapidKeys(adminClient())
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ publicKey })
  } catch (err) {
    respondError(res, err)
  }
}

// Guarda (ou renova) a subscrição deste telemóvel para quem tem a sessão.
export const pushSubscribe: Handler = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const input = parse(SubscribeSchema, req.body)
    const admin = adminClient()
    const keys = await vapidKeys(admin)
    const { endpoint } = input.subscription
    const { data: existing, error } = await admin
      .from('push_subscriptions')
      .select('user_id,prefs')
      .eq('endpoint', endpoint)
      .maybeSingle()
    failIfMissing(error)
    const same = existing?.user_id === user.id
    if (input.check && !same) {
      res.status(200).json({ prefs: null, other: existing != null })
      return
    }
    const saved = same ? cleanPrefs(existing?.prefs) : NO_PUSH
    const prefs = input.check ? saved : cleanPrefs({ ...saved, ...(input.prefs ?? {}) })
    if (!anyPush(prefs) && !existing) {
      res.status(200).json({ prefs: null })
      return
    }
    const { error: saveError } = await admin.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        vapid_key: keys.publicKey,
        prefs,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    failIfMissing(saveError)
    res.status(200).json({ prefs, moved: existing != null && !same })
  } catch (err) {
    respondError(res, err)
  }
}

export const pushUnsubscribe: Handler = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { db } = await requireUser(req)
    const { endpoint } = parse(EndpointSchema, req.body)
    const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint)
    failIfMissing(error)
    res.status(200).json({ ok: true })
  } catch (err) {
    respondError(res, err)
  }
}

// «Mandar uma de teste»: só para este telemóvel.
export const pushTest: Handler = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const { endpoint } = parse(EndpointSchema, req.body)
    const admin = adminClient()
    const { data, error } = await admin
      .from('push_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('endpoint', endpoint)
      .eq('user_id', user.id)
      .maybeSingle()
    failIfMissing(error)
    if (!data) throw new HttpError(404, 'Este telemóvel já não recebe notificações. Liga-as outra vez.')
    const sent = await deliver(admin, [data as SubscriptionRow], 'teste', TEST_NOTICE)
    if (!sent) throw new HttpError(502, 'O serviço de notificações não aceitou. Desliga e liga outra vez.')
    res.status(200).json({ ok: true })
  } catch (err) {
    respondError(res, err)
  }
}
