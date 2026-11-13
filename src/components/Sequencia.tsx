import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDataVersion } from '../lib/events'
import { shiftDate } from '../lib/day'
import { streakFromDays, type StoredStreakDay, type StreakDay } from '../../api/_lib/rules/day-close'

const STREAK_DAYS = 365

// Hoje › «O dia»: dias seguidos com tudo registado (regra 5 ou «Sim, foi
// tudo»). Só aparece a partir de 2. Lê os dias guardados (H3: as refeições
// de 120 dias passavam das 1 000 linhas da API e a sequência caía para 0);
// hoje, ontem e os dias por recalcular contam pelas refeições.
export default function Sequencia({ today }: { today: string }) {
  const version = useDataVersion()
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data: days, error } = await supabase
        .from('days')
        .select('date,is_complete,kcal_in,flags,dirty')
        .gte('date', shiftDate(today, -STREAK_DAYS))
        .lte('date', today)
        .order('date', { ascending: false })
      if (error || !alive) return
      const rows = (days ?? []) as (StoredStreakDay & { dirty?: boolean | null })[]
      // As refeições: hoje, ontem e os dias por recalcular (poucos).
      const recent = [today, shiftDate(today, -1), ...rows.filter((d) => d.dirty).map((d) => d.date)]
      const { data: meals, error: mealsError } = await supabase
        .from('meals_counted')
        .select('date,kcal')
        .in('date', [...new Set(recent)])
      if (mealsError || !alive) return
      const fromMeals: Record<string, StreakDay> = {}
      for (const date of recent) {
        fromMeals[date] = { mealCount: 0, kcalIn: 0, flags: rows.find((d) => d.date === date)?.flags ?? [] }
      }
      for (const m of meals ?? []) {
        const d = fromMeals[m.date as string]
        if (!d) continue
        d.mealCount++
        d.kcalIn += Number(m.kcal ?? 0)
      }
      setStreak(streakFromDays(rows, fromMeals, today, STREAK_DAYS))
    })()
    return () => {
      alive = false
    }
  }, [today, version])

  if (streak < 2) return null
  return (
    <span className="text-[0.8125rem] text-dim tabular-nums">
      {streak} dias seguidos com tudo registado
    </span>
  )
}
