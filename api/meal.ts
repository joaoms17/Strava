import type { VercelRequest, VercelResponse } from '@vercel/node'
import save from './_meal/save.js'
import barcode, { foodSearch, label } from './_meal/barcode.js'
import menu from './_meal/menu.js'
import { logFavorite, portion, remove, repeat, restore } from './_meal/quick.js'
import { analyse, attach, capture, correct, detach, estimate, quick, update } from './_meal/async.js'
import { favoriteCopy, people, share } from './_meal/share.js'
import recipe from './_meal/recipe.js'
import { leftovers, leftoversUndo } from './_meal/leftovers.js'

// O plano Hobby do Vercel limita a 12 funções por deploy; os endpoints de
// refeições vivem juntos numa função, com os caminhos originais preservados
// por rewrites no vercel.json (/api/meal/:action -> /api/meal?action=...,
// /api/food/barcode/:ean -> /api/meal?action=barcode&ean=...).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  save,
  barcode,
  label,
  'food-search': foodSearch,
  menu,
  'log-favorite': logFavorite,
  repeat,
  portion,
  delete: remove,
  restore,
  capture,
  analyse,
  attach,
  detach,
  leftovers,
  'leftovers-undo': leftoversUndo,
  correct,
  update,
  quick,
  estimate,
  share,
  people,
  recipe,
  'favorite-copy': favoriteCopy,
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
