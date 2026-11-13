import { shiftDate } from './day'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { STEPS_AVG_DAYS } from '../../api/_lib/rules/passos'

// P1: o dia do Hoje num só pedido (função day_bundle, migração
// 20261113000062). Aqui só a parte pura: os argumentos e a validação da
// resposta. Uma resposta que não tenha a forma esperada não se usa: o Hoje
// faz os pedidos separados de antes.

export const DAY_BUNDLE_VERSION = 1

type Row = Record<string, unknown>

export interface DayBundle {
  meals: Row[]
  deleted: Row[]
  workouts: Row[]
  weights: Row[]
  yesterdayMeals: Row[]
  days: Row[]
  tdee: number | null
  health: Row[]
}

export interface DayBundleArgs {
  p_date: string
  p_days_from: string
  p_health_from: string
  p_deleted_since: string
}

// Os mesmos limites dos pedidos separados: os dias desta semana até este e
// o de ontem (que pode ser da semana anterior), o relógio dos 30 dias antes
// (passos) e as refeições apagadas nos últimos 7 dias.
export function dayBundleArgs(date: string, nowMs: number): DayBundleArgs {
  const yesterday = shiftDate(date, -1)
  const monday = mondayOf(date)
  return {
    p_date: date,
    p_days_from: monday < yesterday ? monday : yesterday,
    p_health_from: shiftDate(date, -STEPS_AVG_DAYS),
    p_deleted_since: new Date(nowMs - 7 * 86_400_000).toISOString(),
  }
}

function rows(value: unknown): Row[] | null {
  if (!Array.isArray(value)) return null
  return value.every((r) => r != null && typeof r === 'object' && !Array.isArray(r)) ? (value as Row[]) : null
}

function sameDate(rowsList: Row[], date: string): boolean {
  return rowsList.every((r) => r.date === date)
}

// A resposta da função para este dia, ou null se não servir (outra versão,
// outro dia, uma lista que não é lista, linhas de outro dia).
export function parseDayBundle(raw: unknown, date: string): DayBundle | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version !== DAY_BUNDLE_VERSION || r.date !== date) return null
  const meals = rows(r.meals)
  const deleted = rows(r.deleted)
  const workouts = rows(r.workouts)
  const weights = rows(r.weights)
  const yesterdayMeals = rows(r.yesterday_meals)
  const days = rows(r.days)
  const health = rows(r.health)
  if (!meals || !deleted || !workouts || !weights || !yesterdayMeals || !days || !health) return null
  if (!sameDate(meals, date) || !sameDate(workouts, date) || !sameDate(weights, date)) return null
  if (!sameDate(yesterdayMeals, shiftDate(date, -1))) return null
  if (days.some((d) => typeof d.date !== 'string' || d.date > date)) return null
  if (health.some((h) => typeof h.date !== 'string' || h.date > date)) return null
  const tdee = r.tdee == null ? null : Number(r.tdee)
  if (tdee != null && !Number.isFinite(tdee)) return null
  return { meals, deleted, workouts, weights, yesterdayMeals, days, tdee, health }
}

// A função não existe (migração por aplicar): não vale a pena voltar a
// pedi-la até a app recarregar. PostgREST: PGRST202 (404).
export function dayBundleMissing(error: { code?: string; message?: string } | null, status?: number): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || status === 404 || /could not find the function/i.test(error.message ?? '')
}
