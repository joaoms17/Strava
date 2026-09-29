import { supabase } from './supabase'
import { dailyBase, formulaBase } from '../../api/_lib/rules/gasto'
import type { Profile } from './types'

export interface ExpenditureContext {
  base: number // base sem treino, por dia
  learning: boolean // antes de 10 dias completos: fórmula
  tdeeFrozen: number | null // gasto medido até antes da semana
  formula: number // Mifflin × 1,2 (ou o valor fixo)
  avgTraining: number // kcal de treino por dia (dias completos, 14)
  completeDays: number
}

// O mesmo cálculo do fecho do dia (close-day.ts), feito no telemóvel para a
// semana em curso: gasto medido congelado antes da segunda-feira, média do
// treino e, sem 10 dias completos, a fórmula.
export async function loadExpenditure(profile: Profile, monday: string): Promise<ExpenditureContext> {
  const [{ data: frozen }, { data: window }, { count }, { data: trend }] = await Promise.all([
    supabase
      .from('days')
      .select('tdee_est')
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
    supabase.from('weights').select('kg').order('date', { ascending: false }).limit(7),
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
  const tdeeFrozen = frozen?.[0]?.tdee_est != null ? Number(frozen[0].tdee_est) : null
  const { base, learning } = dailyBase({ completeDays: count ?? 0, tdeeFrozen, avgTrainingKcal: avgTraining, formula })
  return { base, learning, tdeeFrozen, formula, avgTraining, completeDays: count ?? 0 }
}
