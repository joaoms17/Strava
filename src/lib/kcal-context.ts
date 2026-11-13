import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { gymPaceFor, weightNear } from '../../api/_lib/kcal-context'

// O que as kcal de um treino sem calorias do relógio precisam, lido com as
// mesmas consultas do servidor (`api/_lib/kcal-context.ts`, L20), para o
// número antes de gravar ser o que fica: o ritmo da pessoa no ginásio (os
// ginásios dos últimos 120 dias até hoje com calorias do relógio) e o peso
// perto do dia do treino. Com o cliente da pessoa, pelo RLS.
export interface KcalContext {
  gymPace: number | null
  weightKg: number | null
}

const paceUntil = (today: string) => gymPaceFor(supabase, today)

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
    void weightNear(supabase, day).then((w) => alive && setWeightKg(w), () => undefined)
    return () => {
      alive = false
    }
  }, [day, wantsWeight])
  return { gymPace: wantsPace ? pace : null, weightKg: wantsWeight ? weightKg : null }
}
