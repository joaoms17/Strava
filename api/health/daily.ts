import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient } from '../_lib/supabase.js'

const HealthSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  steps: z.number().int().min(0).max(200_000).nullable().optional(),
  sleep_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  resting_hr: z.number().int().min(20).max(150).nullable().optional(),
  // Balança que escreve no Saúde (Fase 8): peso e % de gordura por dia.
  body: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weight_kg: z.number().min(30).max(300),
        body_fat_pct: z.number().min(3).max(60).nullable().optional(),
      }),
    )
    .max(31)
    .optional(),
})

function localCalendarDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// Passos, sono e FC em repouso, enviados por um Atalho iOS todas as noites;
// com `body[]`, também o peso e a % de gordura da balança (só entram em dias
// sem pesagem do João; a % de gordura completa uma pesagem que não a tem).
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

    let weights = 0
    for (const entry of body.data.body ?? []) {
      const { data: existing } = await admin
        .from('weights')
        .select('date,body_fat_pct')
        .eq('user_id', profile.user_id)
        .eq('date', entry.date)
        .maybeSingle()
      if (!existing) {
        const { error: insertError } = await admin.from('weights').insert({
          user_id: profile.user_id,
          date: entry.date,
          kg: Math.round(entry.weight_kg * 10) / 10,
          body_fat_pct: entry.body_fat_pct ?? null,
          source: 'shortcut',
        })
        if (!insertError) weights++
      } else if (existing.body_fat_pct == null && entry.body_fat_pct != null) {
        await admin
          .from('weights')
          .update({ body_fat_pct: entry.body_fat_pct })
          .eq('user_id', profile.user_id)
          .eq('date', entry.date)
      }
    }

    const hasDaily = body.data.steps != null || body.data.sleep_minutes != null || body.data.resting_hr != null
    const { error } = !hasDaily
      ? { error: null }
      : await admin.from('health_daily').upsert(
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
    res.status(200).json({ ok: true, weights })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha a gravar.' })
  }
}
