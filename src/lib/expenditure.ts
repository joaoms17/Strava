import { supabase } from './supabase'
import { shiftDate } from './day'
import { TDEE_LOOKBACK_DAYS } from '../../api/_lib/rules/adaptativo'
import { expenditureFrom, type ExpenditureContext } from './balanco-semana'
import type { Profile } from './types'

export type { ExpenditureContext } from './balanco-semana'

// O gasto de uma semana lido de raiz (o Hoje de um dia qualquer). O cálculo
// é o de lib/balanco-semana.ts › expenditureFrom, que o Balanço faz em
// memória com as linhas que já leu.
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
  const prevBase = (lastBase?.[0] as { daily_base_est?: number | null } | undefined)?.daily_base_est
  return expenditureFrom(profile, monday, {
    frozen: frozen?.[0] as { date?: string; tdee_est?: number | null; tdee_raw?: number | null; flags?: string[] | null } | undefined,
    complete: (complete ?? []) as { date: string; kcal_exercise: number | null }[],
    lastWeights: (trend ?? []).map((w) => Number(w.kg)),
    weighDates: ((recent ?? []) as { date: string }[]).map((w) => w.date),
    prevBase: prevBase != null ? Number(prevBase) : null,
  })
}
