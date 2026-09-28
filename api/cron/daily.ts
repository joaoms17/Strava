import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import { closeDay, recomputeRange, type CloseDayProfile } from '../_lib/close-day.js'
import { generateWeeklyReview } from '../_lib/review.js'

// Cron diária às 04:30 UTC (sempre depois das 04:00 em Lisboa, com ou sem DST):
// recalcula, por ordem, os dias alterados (marcados pelo trigger mark_day_dirty)
// e sempre os últimos 3 — no máximo 21 por noite, a noite seguinte continua —,
// calcula o gasto adaptativo, aplica a semana de pausa da dieta e, à segunda,
// gera o review da semana anterior.

const MAX_DAYS_PER_NIGHT = 21
const TIME_BUDGET_MS = 45_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Não autorizado.' })
    return
  }

  try {
    const admin = adminClient()

    const { data: profiles, error } = await admin
      .from('profile')
      .select(
        'user_id,base_kcal,kcal_floor_week,nutrition_day_cutoff_hour,maintenance_enabled,maintenance_anchor',
      )
    if (error) throw new Error(error.message)

    const startedAt = Date.now()
    const closed = []
    let reviews = 0
    for (const profile of (profiles ?? []) as CloseDayProfile[]) {
      const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

      // Âncora da regra 7: fixa no perfil; sem ela, a semana do primeiro dia registado.
      let anchor = profile.maintenance_anchor ?? null
      if (!anchor) {
        const { data: firstDay } = await admin
          .from('days')
          .select('date')
          .eq('user_id', profile.user_id)
          .order('date')
          .limit(1)
        anchor = firstDay?.[0]?.date ?? null
      }

      const { data: dirtyRows } = await admin
        .from('days')
        .select('date')
        .eq('user_id', profile.user_id)
        .eq('dirty', true)
        .lt('date', today)
        .order('date')
        .limit(1)
      const { dates, next } = recomputeRange(today, dirtyRows?.[0]?.date ?? null, MAX_DAYS_PER_NIGHT)

      let stoppedAt: string | null = next
      for (const date of dates) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          stoppedAt = date
          break
        }
        closed.push(await closeDay(admin, profile, date, anchor))
      }
      // Ficou a meio: marca o dia seguinte para a próxima noite continuar a cadeia.
      if (stoppedAt) {
        await admin
          .from('days')
          .upsert({ user_id: profile.user_id, date: stoppedAt, dirty: true }, { onConflict: 'user_id,date' })
      }

      // À segunda-feira, o review da semana que terminou.
      if (new Date(`${today}T00:00:00Z`).getUTCDay() === 1) {
        try {
          if (await generateWeeklyReview(admin, profile.user_id, mondayOf(shiftDate(today, -7)))) {
            reviews++
          }
        } catch (err) {
          console.error('Review semanal falhou:', err)
        }
      }

      // Blocos ativos que já passaram as 4 semanas ficam concluídos.
      const { data: expired } = await admin
        .from('plan_blocks')
        .select('id,start_date')
        .eq('user_id', profile.user_id)
        .eq('status', 'active')
        .lt('start_date', shiftDate(today, -27))
      for (const block of expired ?? []) {
        await admin.from('plan_blocks').update({ status: 'completed' }).eq('id', block.id)
        await admin
          .from('planned_sessions')
          .update({ status: 'skipped' })
          .eq('block_id', block.id)
          .eq('status', 'planned')
      }
    }
    res.status(200).json({ ok: true, closed, reviews })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha no fecho do dia.' })
  }
}
