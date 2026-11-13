import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient } from '../_lib/supabase.js'
import { tokenUser } from '../_lib/ingest-token.js'
import { sameSecret } from '../_lib/secret.js'
import { isDeletedWeighing } from '../_lib/rules/weight.js'

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
// sem pesagem do João nem pesagem apagada; a % de gordura completa uma
// pesagem que não a tem).
// Autenticado por Bearer (o Atalho não tem sessão): HEALTH_INGEST_TOKEN grava
// na primeira conta (o João, como sempre); o token pessoal de Definições ›
// Atalho do iPhone grava na conta dessa pessoa (ex.: a Joana).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.HEALTH_INGEST_TOKEN
  const header = req.headers.authorization ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const personal = secret && given ? tokenUser(secret, given) : null
  if (!secret || (!sameSecret(given, secret) && !personal)) {
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
    const query = admin.from('profile').select('user_id')
    const { data: profile } = await (personal
      ? query.eq('user_id', personal).maybeSingle()
      : query.order('created_at').limit(1).maybeSingle())
    if (!profile) {
      res.status(404).json({ error: 'Perfil não encontrado.' })
      return
    }

    let weights = 0
    // Pesagens que a pessoa apagou (ex.: outra pessoa na balança): não voltam.
    // Uma pesagem diferente nesse dia entra. Tudo em lote (P8): uma leitura
    // das pesagens e das apagadas, uma escrita das novas e uma das % de
    // gordura em falta (antes eram 2 idas à base de dados por dia do mês).
    const entries = body.data.body ?? []
    if (entries.length) {
      const dates = entries.map((b) => b.date)
      const [{ data: deletedRows, error: deletedError }, { data: existingRows, error: existingError }] = await Promise.all([
        admin.from('weights_deleted').select('date,kg').eq('user_id', profile.user_id).in('date', dates),
        admin.from('weights').select('date,kg,body_fat_pct').eq('user_id', profile.user_id).in('date', dates),
      ])
      // Sem estas leituras não se sabe o que entra: as pesagens ficam para o
      // envio seguinte e os passos e o sono gravam-se na mesma.
      if (deletedError || existingError) console.error('Atalho: leitura das pesagens', (deletedError ?? existingError)?.message)
      const deleted = new Map((deletedRows ?? []).map((r) => [r.date as string, r as { kg: number | null }]))
      const existing = new Map(
        (existingRows ?? []).map((r) => [r.date as string, r as { kg: number; body_fat_pct: number | null }]),
      )
      const fresh = new Map<string, { user_id: string; date: string; kg: number; body_fat_pct: number | null; source: string }>()
      const fatFills = new Map<string, { user_id: string; date: string; kg: number; body_fat_pct: number }>()
      for (const entry of deletedError || existingError ? [] : entries) {
        const kg = Math.round(entry.weight_kg * 10) / 10
        if (isDeletedWeighing(kg, deleted.get(entry.date))) continue
        const current = existing.get(entry.date)
        if (!current) {
          // Dois valores para o mesmo dia no mesmo envio: fica o primeiro (como antes).
          if (!fresh.has(entry.date)) {
            fresh.set(entry.date, {
              user_id: profile.user_id,
              date: entry.date,
              kg,
              body_fat_pct: entry.body_fat_pct ?? null,
              source: 'shortcut',
            })
          }
        } else if (current.body_fat_pct == null && entry.body_fat_pct != null && !fatFills.has(entry.date)) {
          fatFills.set(entry.date, { user_id: profile.user_id, date: entry.date, kg: current.kg, body_fat_pct: entry.body_fat_pct })
        }
      }
      if (fresh.size) {
        // Uma pesagem que entretanto apareceu (a pessoa pesou-se à mão) fica.
        const { data: inserted, error: insertError } = await admin
          .from('weights')
          .upsert([...fresh.values()], { onConflict: 'user_id,date', ignoreDuplicates: true })
          .select('date')
        if (insertError) console.error('Atalho: pesagens', insertError.message)
        else weights = inserted?.length ?? 0
      }
      if (fatFills.size) {
        const { error: fatError } = await admin.from('weights').upsert([...fatFills.values()], { onConflict: 'user_id,date' })
        if (fatError) console.error('Atalho: % de gordura', fatError.message)
      }
    }

    const hasDaily = body.data.steps != null || body.data.sleep_minutes != null || body.data.resting_hr != null
    const { error } = !hasDaily
      ? { error: null }
      : await admin.from('health_daily').upsert(
      {
        user_id: profile.user_id,
        date: body.data.date ?? localCalendarDate(),
        // Só o que o Atalho mandou (não apaga o que veio do relógio) e marcado
        // como dele, para a sincronização do intervals.icu não o substituir.
        ...(body.data.steps != null ? { steps: body.data.steps } : {}),
        ...(body.data.sleep_minutes != null ? { sleep_minutes: body.data.sleep_minutes } : {}),
        ...(body.data.resting_hr != null ? { resting_hr: body.data.resting_hr } : {}),
        source: 'shortcut',
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
