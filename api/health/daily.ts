import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient } from '../_lib/supabase.js'

const HealthSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  steps: z.number().int().min(0).max(200_000).nullable().optional(),
  sleep_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  resting_hr: z.number().int().min(20).max(150).nullable().optional(),
})

function localCalendarDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// Passos, sono e FC em repouso, enviados por um Atalho iOS todas as noites.
// Autenticado por Bearer HEALTH_INGEST_TOKEN (o Atalho não tem sessão).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.HEALTH_INGEST_TOKEN
  if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'Token errado.' })
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não suportado.' })
    return
  }

  const body = HealthSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: 'Dados inválidos.' })
    return
  }

  try {
    const admin = adminClient()
    const { data: profile } = await admin
      .from('profile')
      .select('user_id')
      .order('created_at')
      .limit(1)
      .single()
    if (!profile) throw new Error('Perfil não encontrado.')

    const { error } = await admin.from('health_daily').upsert(
      {
        user_id: profile.user_id,
        date: body.data.date ?? localCalendarDate(),
        steps: body.data.steps ?? null,
        sleep_minutes: body.data.sleep_minutes ?? null,
        resting_hr: body.data.resting_hr ?? null,
      },
      { onConflict: 'user_id,date' },
    )
    if (error) throw new Error(error.message)
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha a gravar.' })
  }
}
