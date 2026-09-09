import type { VercelRequest, VercelResponse } from '@vercel/node'
import auth from './_strava/auth'
import callback from './_strava/callback'
import webhook from './_strava/webhook'

// Consolidado numa função (limite de 12 do Hobby); caminhos originais
// preservados por rewrites no vercel.json — o redirect_uri do OAuth e o
// callback_url do webhook continuam /api/strava/callback e /api/strava/webhook.
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  auth,
  callback,
  webhook,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  const route = routes[action]
  if (!route) {
    res.status(404).json({ error: 'Endpoint desconhecido.' })
    return
  }
  await route(req, res)
}
