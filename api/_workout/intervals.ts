import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { IntervalsError, setStatus, syncUser, testKey } from '../_lib/intervals-sync.js'

// Fase 7 — ligar o intervals.icu (valida a chave e guarda-a só no servidor),
// sincronizar (3 dias ao abrir a app; 30 com «Importar últimos 30 dias») e
// desligar. A chave nunca volta ao telemóvel.

const ConnectSchema = z.object({ api_key: z.string().trim().min(8).max(200) })
const SyncSchema = z.object({ days: z.number().int().min(1).max(30).default(3) })

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>

function post(run: (ctx: { userId: string; body: unknown; res: VercelResponse }) => Promise<void>): Handler {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
      const { user } = await requireUser(req)
      await run({ userId: user.id, body: req.body, res })
    } catch (err) {
      if (err instanceof IntervalsError) {
        res.status(502).json({ error: err.message })
        return
      }
      respondError(res, err)
    }
  }
}

export const connect = post(async ({ userId, body, res }) => {
  const parsed = ConnectSchema.safeParse(body)
  if (!parsed.success) throw new HttpError(400, 'Cola a chave inteira do intervals.icu.')
  const athlete = await testKey(parsed.data.api_key)
  const admin = adminClient()
  const { error } = await admin.from('integrations').upsert(
    {
      user_id: userId,
      provider: 'intervals',
      api_key: parsed.data.api_key,
      athlete_id: athlete.id,
      last_error: null,
    },
    { onConflict: 'user_id,provider' },
  )
  if (error) throw new HttpError(500, error.message)
  await setStatus(admin, userId, { connected: true, athlete: athlete.name, last_error: null })
  res.status(200).json({ ok: true, athlete: athlete.name })
})

export const disconnect = post(async ({ userId, res }) => {
  const admin = adminClient()
  await admin.from('integrations').delete().eq('user_id', userId).eq('provider', 'intervals')
  await setStatus(admin, userId, null)
  res.status(200).json({ ok: true })
})

export const sync = post(async ({ userId, body, res }) => {
  const parsed = SyncSchema.safeParse(body ?? {})
  if (!parsed.success) throw new HttpError(400, 'Pedido inválido.')
  const days = parsed.data.days
  const result = await syncUser(adminClient(), userId, { days, timeoutMs: days > 7 ? 25_000 : 10_000 })
  if (!result) throw new HttpError(404, 'O intervals.icu não está ligado.')
  res.status(200).json(result)
})
