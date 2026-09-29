import type { VercelRequest, VercelResponse } from '@vercel/node'
import checkin from './_workout/checkin.js'
import { discard, parseShot, remove, restore, save, shot, shotAdd, strength, update } from './_workout/actions.js'
import { connect, disconnect, sync } from './_workout/intervals.js'

// Consolidado numa função (limite de 12 do Hobby); caminhos originais
// preservados por rewrites no vercel.json.
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  checkin,
  save,
  strength,
  update,
  delete: remove,
  restore,
  shot,
  'parse-shot': parseShot,
  'shot-add': shotAdd,
  discard,
  connect,
  disconnect,
  sync,
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
