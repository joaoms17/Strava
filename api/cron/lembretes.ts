import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase.js'
import { cronAuthorized } from '../_lib/secret.js'
import { deliver, missingTable, SUBSCRIPTION_COLUMNS, type SubscriptionRow } from '../_lib/push.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import { lisbonClock } from '../_lib/rules/momentos.js'
import { dinnerNotice, isMonday, needsDinnerReminder, weekNotice, wantsPush, type PushKind } from '../_lib/rules/notificacoes.js'

// Lembretes por notificação (só para quem os ligou em Definições ›
// Notificações). Corre uma vez por noite (vercel.json): às 20:45 UTC (21:45
// em Lisboa no verão, 20:45 no inverno; no Hobby corre num minuto qualquer
// dessa hora UTC, 20:00–20:59):
// · «Já jantaste?» se o dia ainda não está completo (regra 5) e não há jantar
//   registado;
// · à segunda, «Resumo da semana pronto» se a cron das 04:30 fez o resumo da
//   semana que acabou.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'Não autorizado.' })
    return
  }

  try {
    const admin = adminClient()
    const now = new Date()
    const kinds: PushKind[] = isMonday(lisbonClock(now).date) ? ['jantar', 'semana'] : ['jantar']

    const { data: subs, error } = await admin.from('push_subscriptions').select(SUBSCRIPTION_COLUMNS)
    if (error) {
      if (missingTable(error)) {
        res.status(200).json({ ok: true, sent: 0, note: 'sem a migração das notificações' })
        return
      }
      throw new Error(error.message)
    }
    const byUser = new Map<string, SubscriptionRow[]>()
    for (const row of (subs ?? []) as SubscriptionRow[]) {
      if (!kinds.some((kind) => wantsPush(row.prefs, kind))) continue
      byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row])
    }
    if (!byUser.size) {
      res.status(200).json({ ok: true, sent: 0 })
      return
    }

    const { data: profiles } = await admin
      .from('profile')
      .select('user_id,nutrition_day_cutoff_hour')
      .in('user_id', [...byUser.keys()])
    let sent = 0
    for (const profile of profiles ?? []) {
      const rows = byUser.get(profile.user_id as string) ?? []
      const today = nutritionalDay(now, Number(profile.nutrition_day_cutoff_hour ?? 4))
      const dinnerRows = rows.filter((row) => wantsPush(row.prefs, 'jantar'))
      const weekRows = kinds.includes('semana') ? rows.filter((row) => wantsPush(row.prefs, 'semana')) : []
      if (dinnerRows.length) {
        const [{ data: meals }, { data: day }] = await Promise.all([
          // Todas as não apagadas: um jantar ainda a analisar também conta como registado.
          admin
            .from('meals')
            .select('slot,kcal,status')
            .eq('user_id', profile.user_id)
            .eq('date', today)
            .is('deleted_at', null),
          admin.from('days').select('flags').eq('user_id', profile.user_id).eq('date', today).maybeSingle(),
        ])
        const flags = Array.isArray(day?.flags) ? (day.flags as string[]) : []
        const dayMeals = (meals ?? []) as { slot: string | null; kcal: number | null; status: string | null }[]
        if (needsDinnerReminder(dayMeals, flags)) {
          sent += await deliver(admin, dinnerRows, 'jantar', dinnerNotice(today))
        }
      }
      if (weekRows.length) {
        const week = mondayOf(shiftDate(today, -7))
        const { data: review } = await admin
          .from('weekly_reviews')
          .select('id')
          .eq('user_id', profile.user_id)
          .eq('week_start', week)
          .eq('kind', 'neutro')
          .maybeSingle()
        if (review) sent += await deliver(admin, weekRows, 'semana', weekNotice(week))
      }
    }
    res.status(200).json({ ok: true, sent })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha nos lembretes.' })
  }
}
