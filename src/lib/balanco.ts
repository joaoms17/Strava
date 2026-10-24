// O Balanço lê uma vez, para a página toda, o que não muda com a semana
// escolhida: os dias e as pesagens das últimas 12 semanas (Semana a semana,
// o calendário do Mês, a projeção de «Para esta semana») e os treinos dos
// últimos 40 dias. A semana vista continua a ser lida à parte (Balanco.tsx).
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { shiftDate } from './day'
import { projectionFrom, type ProjectionData, type ProjectionRows } from './projecao'
import type { Profile } from './types'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { proteinBySlot } from '../../api/_lib/rules/extras'
import type { Slot } from '../../api/_lib/rules/momentos'

export const LONG_WEEKS = 12

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
  projection: ProjectionData
}

export async function loadBalancoLongo(profile: Profile, today: string): Promise<BalancoLongo> {
  // 12 semanas e mais 4 (os 28 dias da projeção de há uma semana, para a nota).
  const from = shiftDate(mondayOf(today), -7 * (LONG_WEEKS - 1) - 28)
  const [d, w, wk] = await Promise.all([
    supabase.from('days').select('date,kcal_in,kcal_out_est,kcal_target,is_complete,flags,tdee_est').gte('date', from).lte('date', today).order('date'),
    supabase.from('weights').select('date,kg').gte('date', shiftDate(from, -6)).lte('date', today).order('date'),
    supabase.from('workouts_active').select('date,minutes,kcal_est').gte('date', shiftDate(today, -40)).lte('date', today),
  ])
  if (d.error || w.error) throw new Error(d.error?.message ?? w.error?.message)
  const days = (d.data ?? []).map((x) => ({
    date: x.date as string,
    kcal_in: Number(x.kcal_in ?? 0),
    kcal_out_est: x.kcal_out_est != null ? Number(x.kcal_out_est) : null,
    kcal_target: Number(x.kcal_target ?? 0),
    is_complete: x.is_complete === true,
    flags: (x.flags as string[] | null) ?? [],
    tdee_est: x.tdee_est != null ? Number(x.tdee_est) : null,
  }))
  const weights = (w.data ?? []).map((x) => ({ date: x.date as string, value: Number(x.kg) }))
  const recent = shiftDate(today, -40)
  const projection = projectionFrom(profile, today, {
    weights: weights.filter((x) => x.date >= recent).map((x) => ({ date: x.date, kg: x.value })),
    days: days.filter((x) => x.date >= recent) as ProjectionRows['days'],
    workouts: (wk.data ?? []) as ProjectionRows['workouts'],
    measurements: [],
  })
  return { from, days, weights, projection }
}

// `failed`: sem rede e sem nada lido (os cartões que dependem disto não
// aparecem; o Mês mostra o resto).
export function useBalancoLongo(profile: Profile, today: string, version: number): { data: BalancoLongo | null; failed: boolean } {
  const [data, setData] = useState<BalancoLongo | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    loadBalancoLongo(profile, today)
      .then((d) => {
        if (!alive) return
        setData(d)
        setFailed(false)
      })
      // Sem rede fica o que havia.
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [profile, today, version])
  return { data, failed }
}

export type ProteinRow = { slot: Slot; avg: number; days: number }

// A proteína de cada refeição nos 14 dias antes de `until` (a mesma do
// cartão «Proteína por refeição» e de «Para esta semana»). Num erro as
// linhas ficam por ler (null) e `failed` diz-o: «Para esta semana» não
// pode tomar um erro por «a proteína está bem».
export function useProteinBySlot(until: string, version: number): { rows: ProteinRow[] | null; failed: boolean } {
  const [state, setState] = useState<{ rows: ProteinRow[] | null; failed: boolean }>({ rows: null, failed: false })
  useEffect(() => {
    let alive = true
    void supabase
      .from('meals_counted')
      .select('date,slot,protein')
      .gte('date', shiftDate(until, -14))
      .lt('date', until)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setState((s) => ({ rows: s.rows, failed: true }))
        else setState({ rows: proteinBySlot((data ?? []) as { date: string; slot: Slot | null; protein: number | null }[]), failed: false })
      })
    return () => {
      alive = false
    }
  }, [until, version])
  return state
}
