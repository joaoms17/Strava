import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase'
import { fetchActivity, freshAccessToken, upsertActivity } from '../_lib/strava'

interface StravaEvent {
  object_type: 'activity' | 'athlete'
  object_id: number
  aspect_type: 'create' | 'update' | 'delete'
  owner_id: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Validação da subscrição (GET com hub.challenge)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN && challenge) {
      res.status(200).json({ 'hub.challenge': challenge })
    } else {
      res.status(403).json({ error: 'verify_token errado.' })
    }
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não suportado.' })
    return
  }

  try {
    const event = req.body as StravaEvent
    if (event.object_type !== 'activity') {
      // eventos de atleta (ex.: desautorização) — nada a fazer por agora
      res.status(200).json({ ok: true })
      return
    }

    const admin = adminClient()
    const { data: tokens } = await admin
      .from('strava_tokens')
      .select('*')
      .eq('athlete_id', event.owner_id)
      .maybeSingle()
    if (!tokens) {
      // atleta desconhecido — responder 200 para o Strava não reenviar
      res.status(200).json({ ok: true })
      return
    }

    if (event.aspect_type === 'delete') {
      await admin.from('workouts').delete().eq('strava_id', event.object_id)
      res.status(200).json({ ok: true })
      return
    }

    const accessToken = await freshAccessToken(admin, tokens)
    const activity = await fetchActivity(accessToken, event.object_id)
    await upsertActivity(admin, activity, tokens.user_id)
    res.status(200).json({ ok: true })
  } catch (err) {
    // 500 faz o Strava tentar outra vez; a reconciliação diária apanha o resto
    console.error('Webhook Strava:', err)
    res.status(500).json({ error: 'Falha a processar o evento.' })
  }
}
