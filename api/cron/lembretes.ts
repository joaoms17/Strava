import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase.js'
import { cronAuthorized } from '../_lib/secret.js'
import { deliver, missingTable, SUBSCRIPTION_COLUMNS, type SubscriptionRow } from '../_lib/push.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import { lisbonClock } from '../_lib/rules/momentos.js'
import {
  dinnerNotice,
  isMonday,
  needsDinnerReminder,
  reminderSlot,
  weekNotice,
  wantsPush,
} from '../_lib/rules/notificacoes.js'

// Lembretes por notificação (só para quem os ligou em Definições ›
// Notificações). Corre duas vezes (vercel.json): às 20:45 UTC todos os dias
// (21:45 em Lisboa no verão, 20:45 no inverno; no Hobby pode atrasar até
// ~1 h) e às 08:00 UTC à segunda. Decide pela hora de Lisboa:
// · à noite, «Já jantaste?» se o dia ainda não está completo (regra 5) e não
//   há jantar registado;
// · à segunda de manhã, «Resumo da semana pronto» se a cron das 04:30 fez o
//   resumo da semana que acabou.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'Não autorizado.' })
    return
  }

  try {
    const admin = adminClient()
    const now = new Date()
    const slot = reminderSlot(now)
    const kind = slot === 'noite' ? 'jantar' : 'semana'
    if (slot === 'manha' && !isMonday(lisbonClock(now).date)) {
      res.status(200).json({ ok: true, slot, sent: 0 })
      return
    }

    const { data: subs, error } = await admin.from('push_subscriptions').select(SUBSCRIPTION_COLUMNS)
    if (error) {
      if (missingTable(error)) {
        res.status(200).json({ ok: true, slot, sent: 0, note: 'sem a migração das notificações' })
        return
      }
      throw new Error(error.message)
    }
    const byUser = new Map<string, SubscriptionRow[]>()
    for (const row of (subs ?? []) as SubscriptionRow[]) {
      if (!wantsPush(row.prefs, kind)) continue
      byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row])
    }
    if (!byUser.size) {
      res.status(200).json({ ok: true, slot, sent: 0 })
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
      if (slot === 'noite') {
        const [{ data: meals }, { data: day }] = await Promise.all([
          admin.from('meals_counted').select('slot,kcal').eq('user_id', profile.user_id).eq('date', today),
          admin.from('days').select('flags').eq('user_id', profile.user_id).eq('date', today).maybeSingle(),
        ])
        const flags = Array.isArray(day?.flags) ? (day.flags as string[]) : []
        if (needsDinnerReminder((meals ?? []) as { slot: string | null; kcal: number | null }[], flags)) {
          sent += await deliver(admin, rows, 'jantar', dinnerNotice(today))
        }
      } else {
        const week = mondayOf(shiftDate(today, -7))
        const { data: review } = await admin
          .from('weekly_reviews')
          .select('id')
          .eq('user_id', profile.user_id)
          .eq('week_start', week)
          .eq('kind', 'neutro')
          .maybeSingle()
        if (review) sent += await deliver(admin, rows, 'semana', weekNotice(week))
      }
    }
    res.status(200).json({ ok: true, slot, sent })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha nos lembretes.' })
  }
}
