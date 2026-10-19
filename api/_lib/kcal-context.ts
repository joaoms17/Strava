import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftDate } from './rules/nutritional-day.js'
import { GYM_PACE_DAYS, gymPace } from './rules/kcal-ginasio.js'

// O que as kcal de um treino sem calorias do relógio precisam de ler: o peso
// perto do dia e, no ginásio, o ritmo da pessoa. Com o cliente da pessoa
// (RLS) ou, com `userId`, com o de serviço (sincronização do intervals.icu).

// Peso médio dos 7 dias até esta data ou, sem pesagens nesses dias, o último antes.
export async function weightNear(db: SupabaseClient, date: string, userId?: string): Promise<number | null> {
  let recentQuery = db.from('weights').select('kg').gte('date', shiftDate(date, -6)).lte('date', date)
  if (userId) recentQuery = recentQuery.eq('user_id', userId)
  const { data: recent } = await recentQuery
  if (recent?.length) return recent.reduce((acc, w) => acc + Number(w.kg), 0) / recent.length
  let lastQuery = db.from('weights').select('kg').lte('date', date)
  if (userId) lastQuery = lastQuery.eq('user_id', userId)
  const { data: last } = await lastQuery.order('date', { ascending: false }).limit(1)
  return last?.[0] ? Number(last[0].kg) : null
}

// Kcal por minuto da pessoa no ginásio: os ginásios (não apagados) dos últimos
// 120 dias até hoje com calorias do relógio (`gymPace`).
export async function gymPaceFor(db: SupabaseClient, today: string, userId?: string): Promise<number | null> {
  let query = db
    .from('workouts_active')
    .select('date,minutes,kcal_device')
    .eq('type', 'strength')
    .not('kcal_device', 'is', null)
    .gte('date', shiftDate(today, -GYM_PACE_DAYS))
    .lte('date', today)
  if (userId) query = query.eq('user_id', userId)
  const { data } = await query
  return gymPace(
    (data ?? []).map((r) => ({
      date: r.date as string,
      minutes: r.minutes != null ? Number(r.minutes) : null,
      kcal_device: r.kcal_device != null ? Number(r.kcal_device) : null,
    })),
    today,
  )
}

// Um ginásio sem calorias do relógio: o ritmo da pessoa e, só sem ele, o peso.
export async function strengthContext(
  db: SupabaseClient,
  today: string,
  date: string,
  userId?: string,
): Promise<{ gymPace: number | null; weightKg: number | null }> {
  const pace = await gymPaceFor(db, today, userId)
  return { gymPace: pace, weightKg: pace == null ? await weightNear(db, date, userId) : null }
}
