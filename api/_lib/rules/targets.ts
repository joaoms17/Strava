// Regra 2: kcal_target(dia) = base_kcal + kcal_exercise(dia).
// kcal_exercise: bike = watts x minutos x 0,06; força = 150 por sessão >= 30 min;
// outros = calorias do Strava x 0,7. Nunca usar kcal do relógio para bike ou força.

export type WorkoutType = 'bike' | 'strength' | 'other'

export interface WorkoutForKcal {
  type: WorkoutType
  minutes: number | null
  watts: number | null
  stravaCalories: number | null
}

export function workoutKcal(w: WorkoutForKcal): number {
  switch (w.type) {
    case 'bike':
      if (w.watts == null || w.minutes == null) return 0
      return Math.round(w.watts * w.minutes * 0.06)
    case 'strength':
      return (w.minutes ?? 0) >= 30 ? 150 : 0
    case 'other':
      return Math.round((w.stravaCalories ?? 0) * 0.7)
  }
}

export function dayExerciseKcal(workouts: WorkoutForKcal[]): number {
  return workouts.reduce((acc, w) => acc + workoutKcal(w), 0)
}

export function kcalTarget(baseKcal: number, exerciseKcal: number): number {
  return baseKcal + exerciseKcal
}

// Regra 8: >= protein_per_meal_g por refeição principal.
export function proteinMealOk(proteinG: number, perMealTargetG: number): boolean {
  return proteinG >= perMealTargetG
}
