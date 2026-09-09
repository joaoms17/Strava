import type { VercelRequest, VercelResponse } from '@vercel/node'

// Início do OAuth do Strava. Navegação de página inteira (sem Authorization),
// por isso o CSRF é coberto por um state em cookie, verificado no callback.
export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.STRAVA_CLIENT_ID
  if (!clientId) {
    res.status(500).json({ error: 'STRAVA_CLIENT_ID em falta.' })
    return
  }

  const host = req.headers.host ?? 'localhost:3000'
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  const redirectUri = `${proto}://${host}/api/strava/callback`
  const state = crypto.randomUUID()

  res.setHeader(
    'Set-Cookie',
    `strava_state=${state}; HttpOnly; Path=/api/strava; Max-Age=600; SameSite=Lax; Secure`,
  )

  const url = new URL('https://www.strava.com/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'activity:read_all')
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('state', state)

  res.redirect(302, url.toString())
}
