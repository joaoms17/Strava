import { supabase } from './supabase'
import { shiftDate } from './day'
import { dailyBase, formulaBase, limitWeeklyBase, measuredNote, trustedTdee } from '../../api/_lib/rules/gasto'
import type { Profile } from './types'

export interface ExpenditureContext {
  base: number // base sem treino, por dia
  learning: boolean // antes de 10 dias completos: fórmula
  tdeeFrozen: number | null // gasto usado até antes da semana: o medido, já com a base limitada a 100 kcal por semana (decisão 304)
  tdeeMeasured: number | null // só pelo peso, sem o ajuste lento nem o limite (tdee_raw; null sem a migração)
  formula: number // Mifflin × 1,2 (ou o valor fixo)
  avgTraining: number // kcal de treino por dia (dias completos, 14)
  completeDays: number
  weighings: number // pesagens nos 28 dias até ao fim da semana (no máximo 7)
  note: string | null // uma linha quando o gasto medido está limitado ou a acompanhar (decisão 304)
}

// O mesmo cálculo do fecho do dia (close-day.ts), feito no telemóvel para a
// semana em curso: gasto medido congelado antes da segunda-feira, média do
// treino e, sem 10 dias completos, a fórmula. Numa semana passada, só com as
// pesagens até ao fim dela. A base medida muda no máximo 100 kcal por semana
// (a da semana anterior, guardada no fecho), como no servidor.
export async function loadExpenditure(profile: Profile, monday: string): Promise<ExpenditureContext> {
  const nextMonday = shiftDate(monday, 7)
  const [{ data: frozen }, { data: window }, { count }, { data: trend }, { data: lastBase }] = await Promise.all([
    // Tudo (`*`): o tdee_raw só existe com a migração 20261018140000.
    supabase
      .from('days')
      .select('*')
      .lt('date', monday)
      .not('tdee_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
    supabase
      .from('days')
      .select('kcal_exercise')
      .eq('is_complete', true)
      .lt('date', monday)
      .order('date', { ascending: false })
      .limit(14),
    supabase.from('days').select('date', { count: 'exact', head: true }).eq('is_complete', true).lt('date', monday),
    supabase.from('weights').select('date,kg').lt('date', nextMonday).order('date', { ascending: false }).limit(7),
    supabase
      .from('days')
      .select('daily_base_est')
      .lt('date', monday)
      .not('daily_base_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
  ])
  const trainings = (window ?? []).map((d) => Number(d.kcal_exercise ?? 0))
  const avgTraining = trainings.length ? trainings.reduce((a, b) => a + b, 0) / trainings.length : 0
  const weights = (trend ?? []).map((w) => Number(w.kg))
  const formula = formulaBase({
    weightKg: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null,
    heightCm: profile.height_cm ?? null,
    birthYear: profile.birth_year ?? null,
    sex: profile.sex ?? 'm',
    date: monday,
    fallback: Number(profile.expected_tdee ?? 2200),
  })
  const stored = frozen?.[0] as { tdee_est?: number | null; tdee_raw?: number | null; flags?: string[] | null } | undefined
  const measured = trustedTdee(stored?.tdee_est != null ? Number(stored.tdee_est) : null, formula + avgTraining)
  const tdeeMeasured = stored?.tdee_raw != null ? Number(stored.tdee_raw) : null
  const prevBase = (lastBase?.[0] as { daily_base_est?: number | null } | undefined)?.daily_base_est
  const { base, learning, limited } = limitWeeklyBase(
    dailyBase({ completeDays: count ?? 0, tdeeFrozen: measured, avgTrainingKcal: avgTraining, formula }),
    prevBase != null ? Number(prevBase) : null,
  )
  // O gasto usado (coerência, sugestão do plano): o mesmo da base, já limitado.
  const tdeeFrozen = measured != null && !learning ? Math.round(base + avgTraining) : measured
  const note = learning ? null : measuredNote([...(stored?.flags ?? []), ...(limited ? ['gasto_ritmo'] : [])])
  const since = shiftDate(nextMonday, -28)
  const weighings = (trend ?? []).filter((w) => (w.date as string) >= since).length
  return { base, learning, tdeeFrozen, tdeeMeasured, formula, avgTraining, completeDays: count ?? 0, weighings, note }
}
