import type { VercelRequest, VercelResponse } from '@vercel/node'
import parseText from './_meal/parse-text.js'
import parsePhoto from './_meal/parse-photo.js'
import save from './_meal/save.js'

// O plano Hobby do Vercel limita a 12 funções por deploy; os endpoints de
// refeições vivem juntos numa função, com os caminhos originais preservados
// por rewrites no vercel.json (/api/meal/:action -> /api/meal?action=...).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void> | void> = {
  'parse-text': parseText,
  'parse-photo': parsePhoto,
  save,
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
