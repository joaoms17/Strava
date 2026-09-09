import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase'

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

// Troca o code por tokens e guarda-os para o utilizador único da app.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : null
    const state = typeof req.query.state === 'string' ? req.query.state : null
    const expected = cookieValue(req.headers.cookie, 'strava_state')
    if (!code || !state || !expected || state !== expected) {
      res.redirect(302, '/?strava=erro')
      return
    }

    const tokenRes = await fetch('https://www.strava.com/api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    })
    if (!tokenRes.ok) throw new Error(`Troca do code falhou (${tokenRes.status})`)
    const json = (await tokenRes.json()) as {
      access_token: string
      refresh_token: string
      expires_at: number
      athlete?: { id: number }
    }
    const athleteId = json.athlete?.id
    if (!athleteId) throw new Error('Resposta do Strava sem athlete.id')

    // App de utilizador único: os tokens pertencem ao dono do perfil.
    const admin = adminClient()
    const { data: profile, error: profileError } = await admin
      .from('profile')
      .select('user_id')
      .order('created_at')
      .limit(1)
      .single()
    if (profileError || !profile) throw new Error('Perfil não encontrado — corre os seeds.')

    const { error: upsertError } = await admin.from('strava_tokens').upsert(
      {
        user_id: profile.user_id,
        athlete_id: athleteId,
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: new Date(json.expires_at * 1000).toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (upsertError) throw new Error(upsertError.message)

    await admin
      .from('profile')
      .update({ strava_athlete_id: athleteId })
      .eq('user_id', profile.user_id)

    // limpa o cookie de state
    res.setHeader(
      'Set-Cookie',
      'strava_state=; HttpOnly; Path=/api/strava; Max-Age=0; SameSite=Lax; Secure',
    )
    res.redirect(302, '/?strava=ok')
  } catch (err) {
    console.error(err)
    res.redirect(302, '/?strava=erro')
  }
}
