import { describe, expect, it } from 'vitest'
import {
  dayExerciseKcal,
  kcalTarget,
  proteinMealOk,
  storedExerciseKcal,
  workoutKcal,
} from '../api/_lib/rules/targets'

// Regra 2: bike = watts x minutos x 0,06; força = 150 se >= 30 min;
// outros = calorias do dispositivo x 0,7 ou METs líquidos x peso x horas.
// Nunca as kcal do relógio para bike/força.
describe('workoutKcal', () => {
  it('bike usa watts x minutos x 0,06', () => {
    expect(workoutKcal({ type: 'bike', watts: 140, minutes: 45, deviceCalories: 999 })).toBe(378)
  })

  it('bike sem watts ou minutos vale 0 (nunca as kcal do relógio)', () => {
    expect(workoutKcal({ type: 'bike', watts: null, minutes: 45, deviceCalories: 500 })).toBe(0)
    expect(workoutKcal({ type: 'bike', watts: 140, minutes: null, deviceCalories: 500 })).toBe(0)
  })

  it('força vale 150 a partir de 30 minutos', () => {
    expect(workoutKcal({ type: 'strength', watts: null, minutes: 30, deviceCalories: 400 })).toBe(150)
    expect(workoutKcal({ type: 'strength', watts: null, minutes: 60, deviceCalories: 400 })).toBe(150)
  })

  it('força abaixo de 30 minutos vale 0', () => {
    expect(workoutKcal({ type: 'strength', watts: null, minutes: 29, deviceCalories: 400 })).toBe(0)
  })

  it('outros usam as calorias do dispositivo x 0,7', () => {
    expect(workoutKcal({ type: 'other', watts: null, minutes: 40, deviceCalories: 300 })).toBe(210)
  })

  it('outros sem calorias estimam por METs líquidos x peso x horas', () => {
    // caminhada 2,5 x 85 kg x 40/60 h = 141,7
    expect(
      workoutKcal({ type: 'other', watts: null, minutes: 40, deviceCalories: null, sport: 'caminhada', weightKg: 85 }),
    ).toBe(142)
    // elíptica 4 x 84,9 x 0,75 h = 254,7
    expect(
      workoutKcal({ type: 'other', watts: null, minutes: 45, deviceCalories: null, sport: 'eliptica', weightKg: 84.9 }),
    ).toBe(255)
    // sem desporto indicado, usa 3 METs
    expect(workoutKcal({ type: 'other', watts: null, minutes: 60, deviceCalories: null, weightKg: 80 })).toBe(240)
  })

  it('as calorias do dispositivo ganham aos METs', () => {
    expect(
      workoutKcal({ type: 'other', watts: null, minutes: 40, deviceCalories: 300, sport: 'caminhada', weightKg: 85 }),
    ).toBe(210)
  })

  it('outros sem calorias nem peso valem 0 (nunca inventar)', () => {
    expect(workoutKcal({ type: 'other', watts: null, minutes: 40, deviceCalories: null })).toBe(0)
  })
})

describe('storedExerciseKcal', () => {
  it('usa as kcal guardadas ao gravar, mesmo que a regra mude depois', () => {
    expect(
      storedExerciseKcal([
        { type: 'bike', watts: 140, minutes: 45, deviceCalories: null, kcal_est: 378 },
        { type: 'other', watts: null, minutes: 40, deviceCalories: null, kcal_est: 0 },
      ]),
    ).toBe(378)
  })

  it('calcula pela regra quando não há valor guardado', () => {
    expect(
      storedExerciseKcal([{ type: 'strength', watts: null, minutes: 45, deviceCalories: null, kcal_est: null }]),
    ).toBe(150)
  })
})

describe('kcalTarget', () => {
  it('soma a base com o exercício do dia', () => {
    const exercise = dayExerciseKcal([
      { type: 'bike', watts: 130, minutes: 30, deviceCalories: null },
      { type: 'strength', watts: null, minutes: 45, deviceCalories: null },
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
