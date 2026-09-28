// Arquivado: a API do Strava passou a exigir subscrição paga (junho de 2026).
// Fica aqui como referência; não entra no deploy nem no typecheck.
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapActivityToWorkout, type StravaActivity } from '../../api/_lib/strava.js'
import { pairWorkout } from '../../api/_lib/pairing.js'

const STRAVA_API = 'https://www.strava.com/api/v3'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente em falta: ${name}`)
  return value
}

interface TokenRow {
  id: string
  user_id: string
  athlete_id: number
  access_token: string
  refresh_token: string
  expires_at: string
}

// Refresh automático quando o token expira em menos de 5 minutos.
export async function freshAccessToken(
  admin: SupabaseClient,
  tokens: TokenRow,
): Promise<string> {
  if (Date.parse(tokens.expires_at) > Date.now() + 5 * 60 * 1000) {
    return tokens.access_token
  }
  const res = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env('STRAVA_CLIENT_ID'),
      client_secret: env('STRAVA_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })
  if (!res.ok) throw new Error(`Refresh do token Strava falhou (${res.status})`)
  const json = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_at: number
  }
  await admin
    .from('strava_tokens')
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: new Date(json.expires_at * 1000).toISOString(),
    })
    .eq('id', tokens.id)
  return json.access_token
}

export async function fetchActivity(accessToken: string, id: number): Promise<StravaActivity> {
  const res = await fetch(`${STRAVA_API}/activities/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`GET /activities/${id} falhou (${res.status})`)
  return (await res.json()) as StravaActivity
}

export async function listRecentActivities(
  accessToken: string,
  afterEpochSeconds: number,
): Promise<StravaActivity[]> {
  const res = await fetch(
    `${STRAVA_API}/athlete/activities?after=${afterEpochSeconds}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) throw new Error(`GET /athlete/activities falhou (${res.status})`)
  return (await res.json()) as StravaActivity[]
}

// Idempotente por strava_id. Só escreve os campos vindos do Strava —
// dor, semáforo e emparelhamento nunca são tocados num update.
export async function upsertActivity(
  admin: SupabaseClient,
  activity: StravaActivity,
  userId: string,
): Promise<void> {
  const workout = mapActivityToWorkout(activity, userId)
  const { data: saved, error } = await admin
    .from('workouts')
    .upsert(workout, { onConflict: 'strava_id' })
    .select('id,date,type,planned_session_id')
    .single()
  if (error) throw new Error(`Upsert do workout ${activity.id}: ${error.message}`)
  await pairWorkout(admin, userId, saved)
}

// Reconciliação das últimas 48 h (os webhooks falham). Erros ficam no log —
// a reconciliação nunca pode travar o resto da cron.
export async function reconcileStrava(admin: SupabaseClient): Promise<number> {
  const { data: tokenRows } = await admin.from('strava_tokens').select('*')
  let count = 0
  for (const tokens of (tokenRows ?? []) as TokenRow[]) {
    try {
      const accessToken = await freshAccessToken(admin, tokens)
      const after = Math.floor(Date.now() / 1000) - 48 * 3600
      const summaries = await listRecentActivities(accessToken, after)
      for (const summary of summaries) {
        try {
          const detail = await fetchActivity(accessToken, summary.id)
          await upsertActivity(admin, detail, tokens.user_id)
          count++
        } catch (err) {
          console.error('Reconciliação: atividade', summary.id, err)
        }
      }
    } catch (err) {
      console.error('Reconciliação Strava falhou:', err)
    }
  }
  return count
}
