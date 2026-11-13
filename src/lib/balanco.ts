// O Balanço lê uma vez, para a página toda (P1b), as últimas 16 semanas com
// tudo o que a semana vista precisa: os dias (com os 120 de antes, para o
// gasto), as pesagens, as refeições, os treinos, o relógio e os resumos. A
// semana vista, o gasto dela e a proteína por refeição saem daqui em memória
// (lib/balanco-semana.ts): ‹ › é instantâneo. Uma semana mais antiga lê o seu
// bloco de 4 semanas, uma vez.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { shiftDate } from './day'
import { allPages } from './corpo'
import { projectionFrom, type ProjectionData, type ProjectionRows } from './projecao'
import { covers, type BalancoRows, type HealthRow, type MealRow, type StoredDay, type WorkoutRow } from './balanco-semana'
import type { Profile } from './types'

export type { ProteinRow } from './balanco-semana'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { TDEE_LOOKBACK_DAYS } from '../../api/_lib/rules/adaptativo'

export const LONG_WEEKS = 12
export const LOADED_WEEKS = 16
const OLD_CHUNK_WEEKS = 4

export interface LongDay {
  date: string
  kcal_in: number
  kcal_out_est: number | null
  kcal_target: number
  is_complete: boolean
  flags: string[]
  tdee_est: number | null
}

export interface BalancoLongo {
  from: string // o primeiro dia lido
  days: LongDay[]
  weights: { date: string; value: number }[]
  health: HealthRow[]
  projection: ProjectionData
  // O primeiro dia com comida (L15: os dias de antes vêm do histórico do relógio).
  firstDate: string | null
}

const WORKOUT_COLUMNS = 'id,date,started_at,type,sport,minutes,elapsed_s,watts,kcal_est,calories:raw->calories'

// As linhas de `from` (uma segunda-feira) a `to`; um erro em qualquer pedido
// é um erro (B8: sem rede não é «regista alguns dias»).
export async function loadBalancoRows(from: string, to: string): Promise<BalancoRows> {
  const daysFrom = shiftDate(from, -TDEE_LOOKBACK_DAYS)
  const workoutsFrom = shiftDate(to, -40) < from ? shiftDate(to, -40) : from
  const [days, weights, meals, workouts, pending, health, reviews, first, before] = await Promise.all([
    // Tudo (`*`): o plano base de cada dia (base_kcal) e o tdee_raw só existem com a migração 20261018140000.
    allPages<StoredDay>((a, b) => supabase.from('days').select('*').gte('date', daysFrom).lte('date', to).order('date').range(a, b)),
    allPages<{ date: string; kg: number }>((a, b) =>
      supabase.from('weights').select('date,kg').gte('date', shiftDate(daysFrom, -7)).lte('date', to).order('date').range(a, b),
    ),
    allPages<MealRow>((a, b) =>
      supabase
        .from('meals_counted')
        .select('date,kcal,protein,carbs,fat,slot')
        .gte('date', shiftDate(from, -14))
        .lte('date', to)
        .order('date')
        .range(a, b),
    ),
    allPages<Omit<WorkoutRow, 'calories'> & { calories: unknown }>((a, b) =>
      supabase.from('workouts_active').select(WORKOUT_COLUMNS).gte('date', workoutsFrom).lte('date', to).order('date').range(a, b),
    ),
    // Fotos ainda sem números: o dia não conta (regra 5), como no fecho do dia.
    supabase
      .from('meals')
      .select('date')
      .gte('date', from)
      .lte('date', to)
      .is('deleted_at', null)
      .in('status', ['a_analisar', 'sem_analise', 'erro']),
    supabase.from('health_daily').select('*').gte('date', from).lte('date', to),
    // Os resumos destas semanas (a cron escreve-o na segunda-feira).
    supabase.from('weekly_reviews').select('week_start,text').gte('week_start', shiftDate(from, -7)).lte('week_start', to).eq('kind', 'neutro'),
    // Primeira refeição (o histórico importado do relógio cria dias sem comida).
    supabase.from('meals_counted').select('date').order('date').limit(1),
    // Os dias completos de antes dos dias lidos (contam para os 10 do gasto medido).
    supabase.from('days').select('date', { count: 'exact', head: true }).eq('is_complete', true).lt('date', daysFrom),
  ])
  const failed = pending.error ?? health.error ?? reviews.error ?? first.error ?? before.error
  if (failed) throw new Error(failed.message)
  return {
    from,
    to,
    daysFrom,
    days: days.map((d) => ({ ...d, flags: (d.flags as string[] | null) ?? [] })),
    weights: weights.map((w) => ({ date: w.date, kg: Number(w.kg) })),
    meals: meals.map((m) => ({
      date: m.date,
      kcal: Number(m.kcal ?? 0),
      protein: Number(m.protein ?? 0),
      carbs: Number(m.carbs ?? 0),
      fat: Number(m.fat ?? 0),
      slot: m.slot ?? null,
    })),
    pending: ((pending.data ?? []) as { date: string }[]).map((m) => m.date),
    workouts: workouts.map((w) => ({ ...w, calories: typeof w.calories === 'number' ? w.calories : null })),
    health: (health.data ?? []) as HealthRow[],
    reviews: (reviews.data ?? []) as { week_start: string; text: string | null }[],
    firstDate: (first.data?.[0]?.date as string | undefined) ?? null,
    completeBefore: before.count ?? 0,
  }
}

// O que não muda com a semana vista: os dias e as pesagens (Semana a semana,
// o calendário do Mês, a projeção de «Para esta semana»).
export function longoFrom(profile: Profile, rows: BalancoRows, today: string): BalancoLongo {
  const days = rows.days.map((x) => ({
    date: x.date,
    kcal_in: Number(x.kcal_in ?? 0),
    kcal_out_est: x.kcal_out_est != null ? Number(x.kcal_out_est) : null,
    kcal_target: Number(x.kcal_target ?? 0),
    is_complete: x.is_complete === true,
    flags: x.flags ?? [],
    tdee_est: x.tdee_est != null ? Number(x.tdee_est) : null,
  }))
  const weights = rows.weights.map((x) => ({ date: x.date, value: x.kg }))
  const recent = shiftDate(today, -40)
  const projection = projectionFrom(profile, today, {
    weights: rows.weights.filter((x) => x.date >= recent),
    days: days.filter((x) => x.date >= recent) as ProjectionRows['days'],
    workouts: rows.workouts.filter((x) => x.date >= recent).map((w) => ({ date: w.date, minutes: w.minutes, kcal_est: w.kcal_est })),
    measurements: [],
  })
  return { from: rows.daysFrom, days, weights, health: rows.health, projection, firstDate: rows.firstDate }
}

// As linhas da página (16 semanas) e, para uma semana mais antiga, o bloco
// dela. `failed`: sem nada lido para a semana vista (o ecrã diz que não
// conseguiu ler, B8); com dados de antes, ficam esses.
export function useBalanco(profile: Profile, today: string, version: number, monday: string) {
  const [main, setMain] = useState<{ rows: BalancoRows; longo: BalancoLongo } | null>(null)
  const [failed, setFailed] = useState(false)
  const [old, setOld] = useState<BalancoRows[]>([])
  const [oldFailed, setOldFailed] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    loadBalancoRows(shiftDate(mondayOf(today), -7 * (LOADED_WEEKS - 1)), today)
      .then((rows) => {
        if (!alive) return
        setMain({ rows, longo: longoFrom(profile, rows, today) })
        setOld([])
        setFailed(false)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [profile, today, version, retry])

  const needsOld = main != null && !covers(main.rows, monday) && !old.some((c) => covers(c, monday))
  useEffect(() => {
    if (!needsOld) return
    let alive = true
    setOldFailed(null)
    loadBalancoRows(shiftDate(monday, -7 * (OLD_CHUNK_WEEKS - 1)), shiftDate(monday, 6))
      .then((rows) => alive && setOld((list) => [...list, rows].slice(-4)))
      .catch(() => alive && setOldFailed(monday))
    return () => {
      alive = false
    }
  }, [needsOld, monday, retry])

  const rows = main && covers(main.rows, monday) ? main.rows : (old.find((c) => covers(c, monday)) ?? null)
  return {
    rows,
    longo: main?.longo ?? null,
    failed: rows == null && ((main == null && failed) || oldFailed === monday),
    longoFailed: main == null && failed,
    retry: () => setRetry((n) => n + 1),
  }
}
