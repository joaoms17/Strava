import type { VercelRequest, VercelResponse } from '@vercel/node'
import health from './_day/health.js'
import aiCheck from './_day/ai-check.js'
import recompute from './_day/recompute.js'

// Endpoints do dia (e o estado do deploy) numa só função, por causa do limite
// do Hobby; caminhos preservados por rewrite (/api/day/:action).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  health,
  recompute,
  'ai-check': aiCheck,
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
