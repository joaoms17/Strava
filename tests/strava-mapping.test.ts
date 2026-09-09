import { describe, expect, it } from 'vitest'
import { mapActivityToWorkout, mapStravaType } from '../api/_lib/strava'

describe('mapStravaType', () => {
  it('Ride e VirtualRide são bike', () => {
    expect(mapStravaType('Ride')).toBe('bike')
    expect(mapStravaType('VirtualRide')).toBe('bike')
  })

  it('WeightTraining e Workout são strength', () => {
    expect(mapStravaType('WeightTraining')).toBe('strength')
    expect(mapStravaType('Workout')).toBe('strength')
  })

  it('o resto é other', () => {
    expect(mapStravaType('Walk')).toBe('other')
    expect(mapStravaType('Swim')).toBe('other')
    expect(mapStravaType('')).toBe('other')
  })
})

describe('mapActivityToWorkout', () => {
  const user = '00000000-0000-0000-0000-000000000000'

  it('mapeia uma volta de bicicleta com kcal da regra 2, não do relógio', () => {
    const workout = mapActivityToWorkout(
      {
        id: 123,
        sport_type: 'VirtualRide',
        start_date_local: '2026-09-08T19:12:00Z',
        moving_time: 45 * 60,
        elapsed_time: 50 * 60,
        average_watts: 139.6,
        average_cadence: 88.2,
        average_heartrate: 108.4,
        max_heartrate: 121,
        calories: 999,
      },
      user,
    )
    expect(workout.type).toBe('bike')
    expect(workout.date).toBe('2026-09-08')
    expect(workout.minutes).toBe(45)
    expect(workout.watts).toBe(140)
    expect(workout.cadence).toBe(88)
    expect(workout.avg_hr).toBe(108)
    expect(workout.max_hr).toBe(121)
    // 140 W x 45 min x 0,06 = 378, e nunca as 999 kcal do relógio
    expect(workout.kcal_est).toBe(378)
    expect(workout.strava_id).toBe(123)
  })

  it('força usa o tempo total e 150 kcal a partir de 30 min', () => {
    const workout = mapActivityToWorkout(
      {
        id: 124,
        sport_type: 'WeightTraining',
        start_date_local: '2026-09-08T18:00:00Z',
        moving_time: 10 * 60,
        elapsed_time: 40 * 60,
        calories: 500,
      },
      user,
    )
    expect(workout.type).toBe('strength')
    expect(workout.minutes).toBe(40)
    expect(workout.watts).toBeNull()
    expect(workout.kcal_est).toBe(150)
  })

  it('outros usam as calorias do Strava x 0,7', () => {
    const workout = mapActivityToWorkout(
      {
        id: 125,
        sport_type: 'Walk',
        start_date_local: '2026-09-08T10:00:00Z',
        elapsed_time: 30 * 60,
        calories: 200,
      },
      user,
    )
    expect(workout.type).toBe('other')
    expect(workout.kcal_est).toBe(140)
  })

  it('usa o campo antigo type quando sport_type falta e guarda o raw inteiro', () => {
    const activity = { id: 126, type: 'Ride', start_date_local: '2026-09-08T08:00:00Z' }
    const workout = mapActivityToWorkout(activity, user)
    expect(workout.type).toBe('bike')
    expect(workout.kcal_est).toBe(0) // sem watts nem minutos, nunca inventar
    expect(workout.raw).toEqual(activity)
  })
})
