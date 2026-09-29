import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from './_lib/supabase.js'
import { buildIcs, type IcsEvent } from './_lib/ics.js'
import { sessionDate } from './_lib/rules/plan-dates.js'

interface SessionRow {
  id: string
  week: number
  day_index: number
  type: string
  name: string | null
  status: string
  details: {
    bike: { watts: number; minutes: number; cadence_min: number } | null
    exercises: { name: string; sets: number; rep_min: number; rep_max: number }[]
    notes: string | null
  }
}

// Feed .ics das sessões planeadas, para subscrever no Google Calendar.
// Protegido por token na query (?token=ICS_TOKEN) — os calendários
// não sabem mandar headers.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.ICS_TOKEN
  if (!expected || req.query.token !== expected) {
    res.status(401).json({ error: 'Token errado.' })
    return
  }

  try {
    const admin = adminClient()
    const { data: blocks } = await admin
      .from('plan_blocks')
      .select('id,start_date,status')
      .in('status', ['active', 'completed'])
      .order('start_date')

    const events: IcsEvent[] = []
    for (const block of blocks ?? []) {
      const { data: sessions } = await admin
        .from('planned_sessions')
        .select('id,week,day_index,type,name,status,details')
        .eq('block_id', block.id)
      for (const session of (sessions ?? []) as SessionRow[]) {
        const bike = session.details?.bike
        const summary =
          session.name ??
          (session.type === 'bike' ? 'Bike' : session.type === 'strength' ? 'Força' : 'Treino')
        const parts: string[] = []
        if (bike) parts.push(`${bike.watts} W · ${bike.minutes} min · cadência ≥ ${bike.cadence_min}`)
        if (session.details?.exercises?.length) {
          parts.push(session.details.exercises.map((e) => `${e.name} ${e.sets}×${e.rep_min}-${e.rep_max}`).join('; '))
        }
        if (session.details?.notes) parts.push(session.details.notes)
        if (session.status === 'done') parts.push('✓ feita')
        events.push({
          uid: `${session.id}@epoca-do-regresso`,
          date: sessionDate(block.start_date, session.week, session.day_index),
          summary: bike ? `${summary} — ${bike.watts} W · ${bike.minutes} min` : summary,
          description: parts.join('\n') || undefined,
        })
      }
    }

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Cache-Control', 'private, max-age=900')
    res.status(200).send(buildIcs(events, 'A Época do Regresso'))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha a gerar o calendário.' })
  }
}
