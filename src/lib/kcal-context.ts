import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { shiftDate } from '../../api/_lib/rules/nutritional-day'
import { GYM_PACE_DAYS, gymPace } from '../../api/_lib/rules/kcal-ginasio'

// O que as kcal de um treino sem calorias do relógio precisam, lido como o
// servidor o lê (`api/_lib/kcal-context.ts`), para o número antes de gravar
// ser o que fica: o ritmo da pessoa no ginásio (os ginásios dos últimos 120
// dias até hoje com calorias do relógio) e o peso perto do dia do treino.
export interface KcalContext {
  gymPace: number | null
  weightKg: number | null
}

async function weightNear(day: string): Promise<number | null> {
  const { data: recent } = await supabase.from('weights').select('kg').gte('date', shiftDate(day, -6)).lte('date', day)
  if (recent?.length) return recent.reduce((acc, w) => acc + Number(w.kg), 0) / recent.length
  const { data: last } = await supabase.from('weights').select('kg').lte('date', day).order('date', { ascending: false }).limit(1)
  return last?.[0] ? Number(last[0].kg) : null
}

async function paceUntil(today: string): Promise<number | null> {
  const { data } = await supabase
    .from('workouts_active')
    .select('date,minutes,kcal_device')
    .eq('type', 'strength')
    .not('kcal_device', 'is', null)
    .gte('date', shiftDate(today, -GYM_PACE_DAYS))
    .lte('date', today)
  return gymPace(
    ((data ?? []) as { date: string; minutes: number | null; kcal_device: number | null }[]).map((r) => ({
      date: r.date,
      minutes: r.minutes != null ? Number(r.minutes) : null,
      kcal_device: r.kcal_device != null ? Number(r.kcal_device) : null,
    })),
    today,
  )
}

// Só lê o que o tipo de treino usa: o ritmo no ginásio, o peso no ginásio e
// nos outros desportos (a bicicleta conta pelos watts).
export function useKcalContext(day: string, today: string, type: 'bike' | 'strength' | 'other' | null): KcalContext {
  const [pace, setPace] = useState<number | null>(null)
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const wantsPace = type === 'strength'
  const wantsWeight = type === 'strength' || type === 'other'
  useEffect(() => {
    if (!wantsPace) return
    let alive = true
    void paceUntil(today).then((p) => alive && setPace(p), () => undefined)
    return () => {
      alive = false
    }
  }, [today, wantsPace])
  useEffect(() => {
    if (!wantsWeight) return
    let alive = true
    void weightNear(day).then((w) => alive && setWeightKg(w), () => undefined)
    return () => {
      alive = false
    }
  }, [day, wantsWeight])
  return { gymPace: wantsPace ? pace : null, weightKg: wantsWeight ? weightKg : null }
}
