import type { VercelRequest, VercelResponse } from '@vercel/node'
import health from './_day/health.js'

// Endpoints do dia (e o estado do deploy) numa só função, por causa do limite
// do Hobby; caminhos preservados por rewrite (/api/day/:action).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  health,
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
