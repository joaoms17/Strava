import { shiftDate } from './nutritional-day.js'

// Uma escrita numa refeição de um dia passado (favorita, «Repetir», código de
// barras, repor, a análise de uma foto de ontem, a cópia de uma partilha…)
// recalcula esse dia logo no servidor, e os seguintes até ontem (o peso médio
// e o gasto medido encadeiam), em vez de cada ecrã se lembrar de o pedir (M8).
// Desde o dia sujo mais antigo, no máximo `maxDays`; `next` é onde a cadeia
// ficou, para a cron continuar. Hoje fica para o ecrã (ainda não fechou).
export const PAST_RECOMPUTE_MAX_DAYS = 30
export const PAST_RECOMPUTE_OLDEST_DAYS = 400

export function pastRecomputePlan(
  today: string,
  oldestDirty: string | null,
  maxDays = PAST_RECOMPUTE_MAX_DAYS,
): { dates: string[]; next: string | null } {
  if (oldestDirty == null || oldestDirty >= today) return { dates: [], next: null }
  const yesterday = shiftDate(today, -1)
  const floor = shiftDate(today, -PAST_RECOMPUTE_OLDEST_DAYS)
  const dates: string[] = []
  let d = oldestDirty < floor ? floor : oldestDirty
  for (; d <= yesterday && dates.length < maxDays; d = shiftDate(d, 1)) dates.push(d)
  return { dates, next: d <= yesterday ? d : null }
}
