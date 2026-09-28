// Mapeamento de atividades do Strava para workouts. A integração por API
// (OAuth, webhook, reconciliação) está em archive/strava: exige subscrição paga.
import { workoutKcal } from './rules/targets.js'

// Ride e VirtualRide -> bike; WeightTraining e Workout -> strength; resto -> other.
export function mapStravaType(sport: string): 'bike' | 'strength' | 'other' {
  if (sport === 'Ride' || sport === 'VirtualRide') return 'bike'
  if (sport === 'WeightTraining' || sport === 'Workout') return 'strength'
  return 'other'
}

export interface StravaActivity {
  id: number
  sport_type?: string
  type?: string
  start_date_local?: string
  start_date?: string
  moving_time?: number
  elapsed_time?: number
  average_watts?: number
  average_cadence?: number
  average_heartrate?: number
  max_heartrate?: number
  calories?: number
  [key: string]: unknown
}

export function mapActivityToWorkout(activity: StravaActivity, userId: string) {
  const sport = activity.sport_type ?? activity.type ?? ''
  const type = mapStravaType(sport)
  const startLocal = activity.start_date_local ?? activity.start_date ?? new Date().toISOString()
  // bike conta o tempo em movimento; força e outros contam o tempo total
  const seconds = type === 'bike' ? activity.moving_time : activity.elapsed_time
  const minutes = seconds ? Math.round(seconds / 60) : null
  const watts =
    type === 'bike' && activity.average_watts ? Math.round(activity.average_watts) : null
  return {
    user_id: userId,
    date: startLocal.slice(0, 10),
    source: 'strava' as const,
    strava_id: activity.id,
    type,
    minutes,
    watts,
    cadence:
      type === 'bike' && activity.average_cadence ? Math.round(activity.average_cadence) : null,
    avg_hr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    max_hr: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
    // Regra 2 — nunca as kcal do relógio para bike ou força
    kcal_est: workoutKcal({
      type,
      minutes,
      watts,
      deviceCalories: activity.calories ?? null,
    }),
    raw: activity,
  }
}
