import type { VercelRequest, VercelResponse } from '@vercel/node'
import health from './_day/health.js'
import aiCheck from './_day/ai-check.js'
import recompute from './_day/recompute.js'
import evolution from './_day/evolution.js'
import ingestToken from './_day/ingest-token.js'
import { addPerson, createProfile } from './_day/people.js'
import aiUsage from './_day/ai-usage.js'
import { pushKey, pushSubscribe, pushTest, pushUnsubscribe } from './_day/push.js'

// Endpoints do dia (e o estado do deploy) numa só função, por causa do limite
// do Hobby; caminhos preservados por rewrite (/api/day/:action).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  health,
  recompute,
  'ai-check': aiCheck,
  'add-person': addPerson,
  'create-profile': createProfile,
  evolution,
  'ingest-token': ingestToken,
  'ai-usage': aiUsage,
  'push-key': pushKey,
  'push-subscribe': pushSubscribe,
  'push-unsubscribe': pushUnsubscribe,
  'push-test': pushTest,
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
