import type { VercelRequest, VercelResponse } from '@vercel/node'

// Os routers (meal, workout, day) despacham por `?action=`. P7: cada ação é
// carregada com import() só quando é chamada, por isso um pedido não paga o
// arranque dos ficheiros (e das dependências: SDK da IA, web-push, FIT) das
// outras ações.

export type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void
export type Routes = Record<string, () => Promise<Handler>>

// Corre a ação pedida e devolve o nome dela (null se não existe: 404).
export async function dispatch(routes: Routes, req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  const load = Object.hasOwn(routes, action) ? routes[action] : undefined
  if (!load) {
    res.status(404).json({ error: 'Endpoint desconhecido.' })
    return null
  }
  let route: Handler
  try {
    route = await load()
  } catch (err) {
    console.error('Router: não consegui carregar a ação', action, err)
    res.status(500).json({ error: 'Erro no servidor. Tenta outra vez.' })
    return null
  }
  await route(req, res)
  return action
}
