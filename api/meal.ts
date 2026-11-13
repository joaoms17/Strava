import type { VercelRequest, VercelResponse } from '@vercel/node'
import save from './_meal/save.js'
import barcode, { foodSearch, label } from './_meal/barcode.js'
import menu from './_meal/menu.js'
import { logFavorite, portion, portionUndo, remove, repeat, restore } from './_meal/quick.js'
import { analyse, attach, capture, correct, detach, estimate, inBackground, quick, update } from './_meal/async.js'
import { favoriteCopy, people, share, shareUndo } from './_meal/share.js'
import recipe from './_meal/recipe.js'
import { leftovers, leftoversUndo } from './_meal/leftovers.js'
import { recomputeDirtyPast } from './_lib/meal-recompute.js'
import { adminClient } from './_lib/supabase.js'

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
  'portion-undo': portionUndo,
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
  'share-undo': shareUndo,
  people,
  recipe,
  'favorite-copy': favoriteCopy,
}

// Escritas nas refeições: no fim, os dias passados que mudaram (marcados pelo
// trigger mark_day_dirty, também os de quem recebeu uma cópia) recalculam-se
// já no servidor (M8), em vez de cada ecrã o pedir.
const WRITES = new Set([
  'save',
  'log-favorite',
  'repeat',
  'portion',
  'portion-undo',
  'delete',
  'restore',
  'analyse',
  'detach',
  'leftovers',
  'leftovers-undo',
  'correct',
  'update',
  'quick',
  'share',
  'share-undo',
])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  const route = routes[action]
  if (!route) {
    res.status(404).json({ error: 'Endpoint desconhecido.' })
    return
  }
  await route(req, res)
  if (WRITES.has(action) && res.statusCode < 400) inBackground(recomputeDirtyPast(adminClient()))
}
