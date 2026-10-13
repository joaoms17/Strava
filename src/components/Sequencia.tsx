import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDataVersion } from '../lib/events'
import { shiftDate } from '../lib/day'
import { completeStreak, type StreakDay } from '../../api/_lib/rules/day-close'

// Hoje › «O dia»: dias seguidos com tudo registado (regra 5 ou «Sim, foi
// tudo»), contados a partir das refeições. Só aparece a partir de 2.
export default function Sequencia({ today }: { today: string }) {
  const version = useDataVersion()
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    let alive = true
    const from = shiftDate(today, -120)
    void Promise.all([
      supabase.from('meals_counted').select('date,kcal').gte('date', from).lte('date', today),
      supabase.from('days').select('date,flags').gte('date', from).lte('date', today),
    ]).then(([meals, days]) => {
      if (!alive) return
      const byDate: Record<string, StreakDay> = {}
      for (const m of meals.data ?? []) {
        const d = (byDate[m.date as string] ??= { mealCount: 0, kcalIn: 0 })
        d.mealCount++
        d.kcalIn += Number(m.kcal ?? 0)
      }
      for (const d of days.data ?? []) {
        ;(byDate[d.date as string] ??= { mealCount: 0, kcalIn: 0 }).flags = (d.flags ?? []) as string[]
      }
      setStreak(completeStreak(byDate, today, 120))
    })
    return () => {
      alive = false
    }
  }, [today, version])

  if (streak < 2) return null
  return (
    <span className="text-[13px] text-dim tabular-nums">
      {streak} dias seguidos com tudo registado
    </span>
  )
}
