import type { SupabaseClient } from '@supabase/supabase-js'
import { CLOSE_DAY_PROFILE_COLUMNS, closeDay, maintenanceAnchor, type CloseDayProfile } from './close-day.js'
import { nutritionalDay, shiftDate } from './rules/nutritional-day.js'
import { PAST_RECOMPUTE_OLDEST_DAYS, pastRecomputePlan } from './rules/recalculo-passado.js'

// M8: depois de uma escrita nas refeições, os dias passados que o trigger
// mark_day_dirty marcou (de quem escreveu e de quem recebeu uma cópia)
// recalculam-se já, por ordem até ontem, dentro de um orçamento de tempo. O
// que não couber fica marcado para a cron da noite continuar a cadeia.
const BUDGET_MS = 20_000

export async function recomputeDirtyPast(admin: SupabaseClient, budgetMs = BUDGET_MS): Promise<void> {
  const startedAt = Date.now()
  // Hoje com o corte mais cedo possível (0 h): um dia que ainda é hoje para
  // alguém volta a ser filtrado abaixo, com o corte de cada pessoa.
  const roughToday = nutritionalDay(new Date(), 0)
  const { data: dirty, error } = await admin
    .from('days')
    .select('user_id,date')
    .eq('dirty', true)
    .lt('date', roughToday)
    .gte('date', shiftDate(roughToday, -PAST_RECOMPUTE_OLDEST_DAYS))
    .order('date')
  if (error || !dirty?.length) return
  const oldestByUser = new Map<string, string>()
  for (const row of dirty) {
    const userId = row.user_id as string
    if (!oldestByUser.has(userId)) oldestByUser.set(userId, row.date as string)
  }

  for (const [userId, oldest] of oldestByUser) {
    const { data } = await admin.from('profile').select(CLOSE_DAY_PROFILE_COLUMNS).eq('user_id', userId).maybeSingle()
    if (!data) continue
    const profile = data as unknown as CloseDayProfile
    const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
    const { dates, next } = pastRecomputePlan(today, oldest)
    if (!dates.length) continue
    const anchor = await maintenanceAnchor(admin, profile)
    let stoppedAt: string | null = next
    for (const date of dates) {
      if (Date.now() - startedAt > budgetMs) {
        stoppedAt = date
        break
      }
      await closeDay(admin, profile, date, anchor)
    }
    // Ficou a meio: o dia seguinte fica marcado, para a cron continuar a cadeia.
    if (stoppedAt) {
      await admin.from('days').upsert({ user_id: userId, date: stoppedAt, dirty: true }, { onConflict: 'user_id,date' })
    }
  }
}
