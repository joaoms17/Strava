import type { VercelRequest, VercelResponse } from '@vercel/node'
import manual from './_workout/manual.js'
import checkin from './_workout/checkin.js'
import session from './_workout/session.js'

// Consolidado numa função (limite de 12 do Hobby); caminhos originais
// preservados por rewrites no vercel.json.
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  manual,
  checkin,
  session,
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
