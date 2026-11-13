import { supabase } from './supabase'
import { shiftDate } from './day'
import {
  MEASURED_MAX_GAP_KCAL,
  dailyBase,
  formulaBase,
  limitWeeklyBase,
  measuredNote,
  measuredState,
  trustedTdee,
  type MeasuredState,
} from '../../api/_lib/rules/gasto'
import { TDEE_LOOKBACK_DAYS, missingWeighings, tdeeWindow, windowTraining } from '../../api/_lib/rules/adaptativo'
import type { Profile } from './types'

export interface ExpenditureContext {
  base: number // base sem treino, por dia
  learning: boolean // sem gasto medido (antes de 10 dias completos ou sem pesagens que cheguem): fórmula
  tdeeFrozen: number | null // gasto usado até antes da semana: o medido, já com a base limitada a 100 kcal por semana (decisão 304)
  tdeeMeasured: number | null // só pelo peso, sem o ajuste lento nem o limite (tdee_raw; null sem a migração)
  formula: number // Mifflin × 1,2 (ou o valor fixo)
  avgTraining: number // kcal de treino por dia (a janela do gasto medido; sem ela, 14 dias completos)
  completeDays: number
  weighings: number // dias com pesagem nos 28 dias até ao fim da semana
  state: MeasuredState // «medido», «a aprender (faltam N pesagens)» ou «fórmula» (K1)
  flags: string[] // as marcas do gasto medido do dia congelado, mais o limite de ±400 se cortou aqui
  note: string | null // uma linha quando o gasto medido está limitado ou a acompanhar (decisão 304)
}

// O mesmo cálculo do fecho do dia (rules/fecho.ts), feito no telemóvel para a
// semana em curso: gasto medido congelado antes da segunda-feira, o treino
// médio da janela que o mediu (K3) e, sem 10 dias completos ou sem gasto
// medido, a fórmula. Numa semana passada, só com as pesagens até ao fim
// dela. A base medida muda no máximo 100 kcal por semana (a da semana
// anterior, guardada no fecho), como no servidor.
export async function loadExpenditure(profile: Profile, monday: string): Promise<ExpenditureContext> {
  const nextMonday = shiftDate(monday, 7)
  const since28 = shiftDate(nextMonday, -28)
  const [{ data: frozen }, { data: complete }, { data: trend }, { data: recent }, { data: lastBase }] = await Promise.all([
    // Tudo (`*`): o tdee_raw só existe com a migração 20261018140000.
    supabase
      .from('days')
      .select('*')
      .lt('date', monday)
      .not('tdee_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
    // Os dias completos de antes da semana (120 dias): quantos são e a janela do gasto medido.
    supabase
      .from('days')
      .select('date,kcal_exercise')
      .eq('is_complete', true)
      .gte('date', shiftDate(monday, -TDEE_LOOKBACK_DAYS))
      .lt('date', monday)
      .order('date'),
    supabase.from('weights').select('date,kg').lt('date', nextMonday).order('date', { ascending: false }).limit(7),
    // As pesagens das últimas 4 semanas: quantas faltam para medir (K1).
    supabase.from('weights').select('date').gte('date', since28).lt('date', nextMonday),
    supabase
      .from('days')
      .select('daily_base_est')
      .lt('date', monday)
      .not('daily_base_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
  ])
  const completeRows = ((complete ?? []) as { date: string; kcal_exercise: number | null }[]).map((d) => ({
    date: d.date,
    kcal_in: 0,
    weight_trend: null,
    kcal_exercise: d.kcal_exercise != null ? Number(d.kcal_exercise) : null,
  }))
  const stored = frozen?.[0] as
    | { date?: string; tdee_est?: number | null; tdee_raw?: number | null; flags?: string[] | null }
    | undefined
  const last14 = completeRows.slice(-14)
  const frozenDate = stored?.date
  const avgTraining = frozenDate
    ? windowTraining(
        tdeeWindow({
          date: frozenDate,
          rows: completeRows.filter((d) => d.date <= frozenDate),
          anchor: profile.maintenance_anchor ?? null,
          maintenanceEnabled: profile.maintenance_enabled !== false,
        }).window,
        last14,
      )
    : windowTraining(last14)
  const weights = (trend ?? []).map((w) => Number(w.kg))
  const formula = formulaBase({
    weightKg: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null,
    heightCm: profile.height_cm ?? null,
    birthYear: profile.birth_year ?? null,
    sex: profile.sex ?? 'm',
    date: monday,
    fallback: Number(profile.expected_tdee ?? 2200),
  })
  const storedTdee = stored?.tdee_est != null ? Number(stored.tdee_est) : null
  const measured = trustedTdee(storedTdee, formula + avgTraining)
  const tdeeMeasured = stored?.tdee_raw != null ? Number(stored.tdee_raw) : null
  const prevBase = (lastBase?.[0] as { daily_base_est?: number | null } | undefined)?.daily_base_est
  const completeDays = completeRows.length
  const { base, learning, limited } = limitWeeklyBase(
    dailyBase({ completeDays, tdeeFrozen: measured, avgTrainingKcal: avgTraining, formula }),
    prevBase != null ? Number(prevBase) : null,
  )
  // O gasto usado (coerência, sugestão do plano): o mesmo da base, já limitado.
  const tdeeFrozen = measured != null && !learning ? Math.round(base + avgTraining) : measured
  // O limite de ±400 da fórmula fica à vista (K4), também quando corta aqui.
  const reference = formula + avgTraining
  const capped =
    storedTdee != null && storedTdee > reference + MEASURED_MAX_GAP_KCAL
      ? ['gasto_teto400']
      : storedTdee != null && storedTdee < reference - MEASURED_MAX_GAP_KCAL
        ? ['gasto_piso400']
        : []
  const flags = [...(stored?.flags ?? []), ...capped, ...(limited ? ['gasto_ritmo'] : [])]
  const note = learning ? null : measuredNote(flags)
  const weighDates = ((recent ?? []) as { date: string }[]).map((w) => w.date)
  const weighings = new Set(weighDates).size
  const state = measuredState({ learning, completeDays, missingWeighings: missingWeighings(weighDates), weighingDays: weighings })
  return { base, learning, tdeeFrozen, tdeeMeasured, formula, avgTraining, completeDays, weighings, state, flags, note }
}
