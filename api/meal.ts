import type { VercelRequest, VercelResponse } from '@vercel/node'
import { dispatch, type Routes } from './_lib/router.js'

// O plano Hobby do Vercel limita a 12 funções por deploy; os endpoints de
// refeições vivem juntos numa função, com os caminhos originais preservados
// por rewrites no vercel.json (/api/meal/:action -> /api/meal?action=...,
// /api/food/barcode/:ean -> /api/meal?action=barcode&ean=...).
// P7: cada ação carrega só o ficheiro dela, quando é chamada (o arranque a
// frio deixa de trazer o código e as dependências de todas as outras).
const routes: Routes = {
  save: () => import('./_meal/save.js').then((m) => m.default),
  barcode: () => import('./_meal/barcode.js').then((m) => m.default),
  label: () => import('./_meal/barcode.js').then((m) => m.label),
  'food-search': () => import('./_meal/barcode.js').then((m) => m.foodSearch),
  menu: () => import('./_meal/menu.js').then((m) => m.default),
  'log-favorite': () => import('./_meal/quick.js').then((m) => m.logFavorite),
  repeat: () => import('./_meal/quick.js').then((m) => m.repeat),
  portion: () => import('./_meal/quick.js').then((m) => m.portion),
  'portion-undo': () => import('./_meal/quick.js').then((m) => m.portionUndo),
  delete: () => import('./_meal/quick.js').then((m) => m.remove),
  restore: () => import('./_meal/quick.js').then((m) => m.restore),
  capture: () => import('./_meal/async.js').then((m) => m.capture),
  analyse: () => import('./_meal/async.js').then((m) => m.analyse),
  attach: () => import('./_meal/async.js').then((m) => m.attach),
  detach: () => import('./_meal/async.js').then((m) => m.detach),
  leftovers: () => import('./_meal/leftovers.js').then((m) => m.leftovers),
  'leftovers-undo': () => import('./_meal/leftovers.js').then((m) => m.leftoversUndo),
  correct: () => import('./_meal/async.js').then((m) => m.correct),
  update: () => import('./_meal/async.js').then((m) => m.update),
  estimate: () => import('./_meal/async.js').then((m) => m.estimate),
  share: () => import('./_meal/share.js').then((m) => m.share),
  'share-undo': () => import('./_meal/share.js').then((m) => m.shareUndo),
  people: () => import('./_meal/share.js').then((m) => m.people),
  recipe: () => import('./_meal/recipe.js').then((m) => m.default),
  'favorite-copy': () => import('./_meal/share.js').then((m) => m.favoriteCopy),
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
  'share',
  'share-undo',
])

async function recomputeAfterWrite(): Promise<void> {
  const [{ inBackground }, { recomputeDirtyPast }, { adminClient }] = await Promise.all([
    import('./_meal/async.js'),
    import('./_lib/meal-recompute.js'),
    import('./_lib/supabase.js'),
  ])
  inBackground(recomputeDirtyPast(adminClient()))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = await dispatch(routes, req, res)
  if (action && WRITES.has(action) && res.statusCode < 400) {
    await recomputeAfterWrite().catch((err: unknown) => console.error('Recálculo depois da escrita:', err))
  }
}
