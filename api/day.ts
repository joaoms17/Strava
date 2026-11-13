import type { VercelRequest, VercelResponse } from '@vercel/node'
import { dispatch, type Routes } from './_lib/router.js'

// Endpoints do dia (e o estado do deploy) numa só função, por causa do limite
// do Hobby; caminhos preservados por rewrite (/api/day/:action). P7: cada
// ação carrega só o seu ficheiro quando é chamada (o web-push só nas
// notificações, o SDK da IA só no que a usa).
const routes: Routes = {
  health: () => import('./_day/health.js').then((m) => m.default),
  recompute: () => import('./_day/recompute.js').then((m) => m.default),
  'ai-check': () => import('./_day/ai-check.js').then((m) => m.default),
  'add-person': () => import('./_day/people.js').then((m) => m.addPerson),
  'create-profile': () => import('./_day/people.js').then((m) => m.createProfile),
  evolution: () => import('./_day/evolution.js').then((m) => m.default),
  'ingest-token': () => import('./_day/ingest-token.js').then((m) => m.default),
  'ai-usage': () => import('./_day/ai-usage.js').then((m) => m.default),
  'push-key': () => import('./_day/push.js').then((m) => m.pushKey),
  'push-subscribe': () => import('./_day/push.js').then((m) => m.pushSubscribe),
  'push-unsubscribe': () => import('./_day/push.js').then((m) => m.pushUnsubscribe),
  'push-test': () => import('./_day/push.js').then((m) => m.pushTest),
  ask: () => import('./_day/ask.js').then((m) => m.default),
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await dispatch(routes, req, res)
}
