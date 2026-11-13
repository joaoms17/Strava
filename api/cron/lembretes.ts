import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase.js'
import { cronAuthorized } from '../_lib/secret.js'
import { deliver, missingTable, SUBSCRIPTION_COLUMNS, type SubscriptionRow } from '../_lib/push.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import { lisbonClock } from '../_lib/rules/momentos.js'
import { dinnerNotice, needsDinnerReminder, weekNotice, wantsPush, type PushKind } from '../_lib/rules/notificacoes.js'
import { cronRunsSince, finishCronRun, startCronRun } from '../_lib/cron-runs.js'
import { cronError, weekNoticeDue, weekNoticeKey, type CronError } from '../_lib/rules/rotinas.js'

// Lembretes por notificação (só para quem os ligou em Definições ›
// Notificações). Corre uma vez por noite (vercel.json): às 20:45 UTC (21:45
// em Lisboa no verão, 20:45 no inverno; no Hobby corre num minuto qualquer
// dessa hora UTC, 20:00–20:59):
// · «Já jantaste?» se o dia ainda não está completo (regra 5) e não há jantar
//   registado;
// · «Resumo da semana pronto» na primeira noite (desde segunda) em que existe
//   o resumo da semana que acabou, uma vez por semana: se a cron das 05:30
//   UTC só o fez na terça, o aviso sai na terça (S4). Os avisos dados ficam em
//   cron_runs; sem essa tabela, só à segunda, como antes.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'Não autorizado.' })
    return
  }

  let runId: number | null = null
  const errors: CronError[] = []
  const weekNotified: string[] = []
  try {
    const admin = adminClient()
    runId = await startCronRun(admin, 'lembretes')
    const now = new Date()
    const kinds: PushKind[] = ['jantar', 'semana']
    const finish = async (sent: number) => {
      await finishCronRun(admin, runId, { ok: errors.length === 0, errors, summary: { sent, week_notified: weekNotified } })
    }

    const { data: subs, error } = await admin.from('push_subscriptions').select(SUBSCRIPTION_COLUMNS)
    if (error) {
      if (missingTable(error)) {
        await finish(0)
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
      await finish(0)
      res.status(200).json({ ok: true, sent: 0 })
      return
    }

    const { data: profiles } = await admin
      .from('profile')
      .select('user_id,nutrition_day_cutoff_hour')
      .in('user_id', [...byUser.keys()])
    // Os avisos do resumo já dados desde a segunda desta semana (undefined:
    // sem histórico).
    const thisMonday = mondayOf(lisbonClock(now).date)
    const runs = await cronRunsSince(admin, 'lembretes', `${shiftDate(thisMonday, -1)}T00:00:00Z`)
    const alreadyNotified = runs
      ? new Set(
          runs.flatMap((run) => {
            const list = run.summary?.week_notified
            return Array.isArray(list) ? list.filter((key): key is string => typeof key === 'string') : []
          }),
        )
      : null
    let sent = 0
    for (const profile of profiles ?? []) {
      try {
        const rows = byUser.get(profile.user_id as string) ?? []
        const today = nutritionalDay(now, Number(profile.nutrition_day_cutoff_hour ?? 4))
        const dinnerRows = rows.filter((row) => wantsPush(row.prefs, 'jantar'))
        const weekRows = rows.filter((row) => wantsPush(row.prefs, 'semana'))
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
          const key = weekNoticeKey(profile.user_id as string, week)
          if (weekNoticeDue(today, review != null, alreadyNotified ? alreadyNotified.has(key) : null)) {
            const delivered = await deliver(admin, weekRows, 'semana', weekNotice(week))
            sent += delivered
            if (delivered) weekNotified.push(key)
          }
        }
      } catch (err) {
        console.error('Lembretes: pessoa falhou', profile.user_id, err)
        errors.push(cronError('pessoa', err, { user_id: profile.user_id as string }))
      }
    }
    await finish(sent)
    res.status(200).json({ ok: errors.length === 0, sent, errors })
  } catch (err) {
    console.error(err)
    errors.push(cronError('geral', err))
    try {
      await finishCronRun(adminClient(), runId, { ok: false, errors, summary: { week_notified: weekNotified } })
    } catch {
      // sem cliente, sem registo
    }
    res.status(500).json({ error: 'Falha nos lembretes.' })
  }
}
