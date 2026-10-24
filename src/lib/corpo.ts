// Os dados do Corpo, lidos uma vez para a página toda (o resumo, o peso, as
// medidas, a projeção, o treino e o relógio) e partilhados pelos gráficos:
// sem pedidos por gráfico. 1M e 3M usam o mesmo lote (os últimos 5 meses);
// «Tudo» pede o resto às páginas, uma vez.
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { shiftDate } from './day'
import { scopedKey } from './scoped'
import { projectionFrom, type ProjectionData, type ProjectionRows } from './projecao'
import type { BodyMeasurement, Profile } from './types'
import { cleanPeriod, type Period } from '../../api/_lib/rules/graficos'
import type { PlanWorkout, WellnessRow } from '../../api/_lib/rules/plano'

export const RECENT_DAYS = 150 // 3M + os 30 dias de antes + a semana do peso médio
const PAGE = 1000

export interface CorpoWeight {
  date: string
  kg: number
  body_fat_pct: number | null
}

export type CorpoHealth = WellnessRow & { ctl: number | null; atl: number | null; vo2max: number | null }
export type CorpoWorkout = PlanWorkout & { kcal_est: number | null }

export interface CorpoData {
  scope: 'recente' | 'tudo'
  today: string
  weights: CorpoWeight[] // por data
  firstWeighings: { date: string; value: number }[] // as primeiras de sempre
  measurements: BodyMeasurement[] // todas, por data
  health: CorpoHealth[]
  workouts: CorpoWorkout[]
  projection: ProjectionData
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

// O Supabase devolve no máximo 1000 linhas por pedido.
async function allPages<T>(make: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const { data, error } = await make(rows.length, rows.length + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

const WORKOUT_COLUMNS = 'id,date,started_at,type,sport,minutes,moving_s,elapsed_s,distance_km,watts,np_w,avg_hr,max_hr,training_load,kcal_est'
const HEALTH_COLUMNS = 'date,hrv,resting_hr,sleep_score,sleep_quality,sleep_minutes,steps,ctl,atl,vo2max'

export async function loadCorpo(profile: Profile, today: string, scope: 'recente' | 'tudo'): Promise<CorpoData> {
  const from = shiftDate(today, -RECENT_DAYS)
  const all = scope === 'tudo'
  // A forma (42 dias) precisa de 6 semanas antes do primeiro dia do gráfico.
  const workoutsFrom = shiftDate(from, -42)
  const [weights, first, measurements, health, workouts, days] = await Promise.all([
    allPages<CorpoWeight>((a, b) => {
      const q = supabase.from('weights').select('date,kg,body_fat_pct')
      return (all ? q : q.gte('date', from)).lte('date', today).order('date').range(a, b)
    }),
    supabase.from('weights').select('date,kg').order('date').limit(7),
    supabase.from('body_measurements').select('*').order('date'),
    allPages<CorpoHealth>((a, b) => {
      const q = supabase.from('health_daily').select(HEALTH_COLUMNS)
      return (all ? q : q.gte('date', from)).lte('date', today).order('date').range(a, b)
    }),
    allPages<CorpoWorkout>((a, b) => {
      const q = supabase.from('workouts_active').select(WORKOUT_COLUMNS)
      return (all ? q : q.gte('date', workoutsFrom)).lte('date', today).order('date').range(a, b)
    }),
    supabase.from('days').select('date,kcal_in,kcal_target,is_complete,flags,tdee_est').gte('date', shiftDate(today, -40)).lte('date', today).order('date'),
  ])
  if (first.error) throw new Error(first.error.message)
  const cleanWeights = weights.map((w) => ({ date: w.date, kg: Number(w.kg), body_fat_pct: w.body_fat_pct != null ? Number(w.body_fat_pct) : null }))
  const rows = (measurements.data ?? []) as BodyMeasurement[]
  const recent40 = shiftDate(today, -40)
  const projection = projectionFrom(profile, today, {
    weights: cleanWeights.filter((w) => w.date >= recent40),
    days: (days.data ?? []) as ProjectionRows['days'],
    workouts: workouts.filter((w) => w.date >= recent40).map((w) => ({ date: w.date, minutes: w.minutes, kcal_est: w.kcal_est })),
    measurements: rows,
  })
  return {
    scope,
    today,
    weights: cleanWeights,
    firstWeighings: (first.data ?? []).map((w) => ({ date: w.date as string, value: Number(w.kg) })),
    measurements: rows,
    health: health.map((h) => ({ ...h })),
    workouts,
    projection,
  }
}

// O período escolhido fica neste telemóvel, para cada pessoa.
const PERIOD_KEY = 'regresso.corpo.periodo'

export function savedPeriod(): Period {
  try {
    return cleanPeriod(localStorage.getItem(scopedKey(PERIOD_KEY)))
  } catch {
    return cleanPeriod(null)
  }
}

export function savePeriod(period: Period): void {
  try {
    localStorage.setItem(scopedKey(PERIOD_KEY), period)
  } catch {
    // sem armazenamento: fica só nesta visita
  }
}

// Os dados para o período: enquanto chega o lote novo, fica o anterior (o
// ecrã mostra-o mais claro, sem saltar).
export function useCorpoData(profile: Profile, today: string, period: Period, version: number) {
  const scope = period === 'Tudo' ? 'tudo' : 'recente'
  // Os dois lotes (recente e tudo) do mesmo perfil, dia e versão: trocar de
  // período e voltar não pede outra vez. O perfil muda (ex.: o peso alvo) → lê de novo.
  const cache = useRef<{ profile: Profile; key: string; data: CorpoData }[]>([])
  const [state, setState] = useState<{ data: CorpoData | null; loading: boolean; error: boolean }>({ data: null, loading: true, error: false })
  useEffect(() => {
    const base = `${today}:${version}`
    const hit = cache.current.find((c) => c.profile === profile && c.key === `${base}:${scope}`)
    if (hit) {
      setState({ data: hit.data, loading: false, error: false })
      return
    }
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    loadCorpo(profile, today, scope)
      .then((data) => {
        if (!alive) return
        const keep = cache.current.filter((c) => c.profile === profile && c.key.startsWith(`${base}:`))
        cache.current = [...keep, { profile, key: `${base}:${scope}`, data }].slice(-2)
        setState({ data, loading: false, error: false })
      })
      .catch(() => alive && setState((s) => ({ ...s, loading: false, error: true })))
    return () => {
      alive = false
    }
  }, [profile, today, version, scope])
  return state
}
