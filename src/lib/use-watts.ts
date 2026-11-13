import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useReadyProfile } from './profile'
import { wattsChoices } from './bicicleta'

// As potências para escolher num toque (T15): as das Definições ou as das
// últimas sessões de bicicleta com watts confirmados. Sem nenhuma, lista
// vazia (escreve-se).
export function useWattsChoices(): number[] {
  const profile = useReadyProfile()
  const [recent, setRecent] = useState<number[]>([])
  const fromProfile = profile.bike_watts_options?.length ? profile.bike_watts_options : null
  useEffect(() => {
    if (fromProfile) return
    void supabase
      .from('workouts_active')
      .select('watts,watts_source')
      .eq('type', 'bike')
      .not('watts', 'is', null)
      .order('date', { ascending: false })
      .limit(20)
      .then(({ data }) =>
        setRecent(
          ((data ?? []) as { watts: number; watts_source: string | null }[])
            .filter((w) => w.watts_source !== 'prefill')
            .map((w) => w.watts),
        ),
      )
  }, [fromProfile])
  return wattsChoices(fromProfile, recent)
}
