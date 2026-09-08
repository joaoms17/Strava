import { describe, expect, it } from 'vitest'
import { dayExerciseKcal, kcalTarget, proteinMealOk, workoutKcal } from '../api/_lib/rules/targets'

// Regra 2: bike = watts x minutos x 0,06; força = 150 se >= 30 min;
// outros = calorias do Strava x 0,7. Nunca as kcal do relógio para bike/força.
describe('workoutKcal', () => {
  it('bike usa watts x minutos x 0,06', () => {
    expect(workoutKcal({ type: 'bike', watts: 140, minutes: 45, stravaCalories: 999 })).toBe(378)
  })

  it('bike sem watts ou minutos vale 0 (nunca as kcal do relógio)', () => {
    expect(workoutKcal({ type: 'bike', watts: null, minutes: 45, stravaCalories: 500 })).toBe(0)
    expect(workoutKcal({ type: 'bike', watts: 140, minutes: null, stravaCalories: 500 })).toBe(0)
  })

  it('força vale 150 a partir de 30 minutos', () => {
    expect(workoutKcal({ type: 'strength', watts: null, minutes: 30, stravaCalories: 400 })).toBe(150)
    expect(workoutKcal({ type: 'strength', watts: null, minutes: 60, stravaCalories: 400 })).toBe(150)
  })

  it('força abaixo de 30 minutos vale 0', () => {
    expect(workoutKcal({ type: 'strength', watts: null, minutes: 29, stravaCalories: 400 })).toBe(0)
  })

  it('outros usam as calorias do Strava x 0,7', () => {
    expect(workoutKcal({ type: 'other', watts: null, minutes: 40, stravaCalories: 300 })).toBe(210)
    expect(workoutKcal({ type: 'other', watts: null, minutes: 40, stravaCalories: null })).toBe(0)
  })
})

describe('kcalTarget', () => {
  it('soma a base com o exercício do dia', () => {
    const exercise = dayExerciseKcal([
      { type: 'bike', watts: 130, minutes: 30, stravaCalories: null },
      { type: 'strength', watts: null, minutes: 45, stravaCalories: null },
    ])
    expect(exercise).toBe(234 + 150)
    expect(kcalTarget(1500, exercise)).toBe(1884)
  })
})

// Regra 8: >= 35 g de proteína por refeição principal.
describe('proteinMealOk', () => {
  it('compara com o alvo por refeição', () => {
    expect(proteinMealOk(35, 35)).toBe(true)
    expect(proteinMealOk(34.9, 35)).toBe(false)
  })
})
