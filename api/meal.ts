import type { VercelRequest, VercelResponse } from '@vercel/node'
import parseText from './_meal/parse-text.js'
import parsePhoto from './_meal/parse-photo.js'
import save from './_meal/save.js'
import barcode from './_meal/barcode.js'
import menu from './_meal/menu.js'
import { logFavorite, portion, remove, repeat, restore } from './_meal/quick.js'
import { analyse, attach, capture, correct, quick, update } from './_meal/async.js'

// O plano Hobby do Vercel limita a 12 funções por deploy; os endpoints de
// refeições vivem juntos numa função, com os caminhos originais preservados
// por rewrites no vercel.json (/api/meal/:action -> /api/meal?action=...,
// /api/food/barcode/:ean -> /api/meal?action=barcode&ean=...).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  'parse-text': parseText,
  'parse-photo': parsePhoto,
  save,
  barcode,
  menu,
  'log-favorite': logFavorite,
  repeat,
  portion,
  delete: remove,
  restore,
  capture,
  analyse,
  attach,
  correct,
  update,
  quick,
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
