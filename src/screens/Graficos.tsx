import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localCalendarDate, shiftDate } from '../lib/day'
import type { Profile, WeightRow } from '../lib/types'
import WeightChart from '../components/WeightChart'

export default function Graficos() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [weights, setWeights] = useState<WeightRow[]>([])
  const [estimatePct, setEstimatePct] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const today = localCalendarDate()
      const [{ data: profileRow }, { data: weightRows }, { data: weekMeals }] = await Promise.all([
        supabase.from('profile').select('*').single(),
        supabase.from('weights').select('date,kg').gte('date', shiftDate(today, -55)).order('date'),
        supabase.from('meals').select('is_estimate').gte('date', shiftDate(today, -6)),
      ])
      setProfile((profileRow ?? null) as Profile | null)
      setWeights(
        ((weightRows ?? []) as { date: string; kg: number | string }[]).map((w) => ({
          date: w.date,
          kg: Number(w.kg),
        })),
      )
      if (weekMeals && weekMeals.length > 0) {
        const estimated = weekMeals.filter((m) => m.is_estimate).length
        setEstimatePct(Math.round((estimated / weekMeals.length) * 100))
      }
      setLoaded(true)
    }
    void load()
  }, [])

  if (!loaded) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      {weights.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-card p-6 text-center text-sm text-dim">
          <p className="font-display text-lg text-ink">Peso</p>
          <p className="mt-2">Regista o peso no ecrã Hoje para veres a tendência e a projeção.</p>
        </div>
      ) : (
        <WeightChart weights={weights} target={profile?.target_weight_kg ?? 75} />
      )}

      {estimatePct != null && (
        <div className="rounded-2xl border border-edge bg-card p-4">
          <p className="text-3xl font-bold">{estimatePct}%</p>
          <p className="mt-1 text-xs text-dim">refeições estimadas nos últimos 7 dias</p>
        </div>
      )}

      <p className="text-center text-xs text-dim">
        FC por watts, cargas e adesão ao plano chegam com o M3/M4.
      </p>
    </div>
  )
}
