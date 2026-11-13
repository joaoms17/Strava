import type { VercelRequest, VercelResponse } from '@vercel/node'
import { dispatch, type Routes } from './_lib/router.js'

// Consolidado numa função (limite de 12 do Hobby); caminhos originais
// preservados por rewrites no vercel.json. P7: cada ação carrega só o seu
// ficheiro quando é chamada (o leitor de FIT do intervals.icu e a IA do
// «Dizer» não entram no arranque de um «Guardar»).
const routes: Routes = {
  save: () => import('./_workout/actions.js').then((m) => m.save),
  strength: () => import('./_workout/actions.js').then((m) => m.strength),
  update: () => import('./_workout/actions.js').then((m) => m.update),
  join: () => import('./_workout/actions.js').then((m) => m.join),
  'join-undo': () => import('./_workout/actions.js').then((m) => m.joinUndo),
  delete: () => import('./_workout/actions.js').then((m) => m.remove),
  restore: () => import('./_workout/actions.js').then((m) => m.restore),
  shot: () => import('./_workout/actions.js').then((m) => m.shot),
  'parse-shot': () => import('./_workout/actions.js').then((m) => m.parseShot),
  'shot-add': () => import('./_workout/actions.js').then((m) => m.shotAdd),
  discard: () => import('./_workout/actions.js').then((m) => m.discard),
  connect: () => import('./_workout/intervals.js').then((m) => m.connect),
  disconnect: () => import('./_workout/intervals.js').then((m) => m.disconnect),
  sync: () => import('./_workout/intervals.js').then((m) => m.sync),
  'parse-said': () => import('./_workout/said.js').then((m) => m.default),
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await dispatch(routes, req, res)
}
