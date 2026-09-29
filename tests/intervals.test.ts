import { describe, expect, it } from 'vitest'
import {
  isEmptyStravaCopy,
  mapActivity,
  mapIcuType,
  mapWellness,
  syncMatch,
  syncedAgo,
} from '../api/_lib/rules/intervals'

// Fase 7 — intervals.icu: mapeamento defensivo das atividades e do bem-estar.
const garminRide = {
  id: 'i123456',
  name: 'Ciclismo indoor',
  type: 'VirtualRide',
  start_date: '2026-09-29T06:10:00Z',
  start_date_local: '2026-09-29T07:10:00',
  moving_time: 2700,
  elapsed_time: 2760,
  distance: 0,
  average_heartrate: 132.4,
  max_heartrate: 141,
  icu_average_watts: 139,
  icu_weighted_avg_watts: 142,
  average_cadence: 88.2,
  calories: 520,
  icu_training_load: 48,
  trainer: true,
  source: 'GARMIN_CONNECT',
}

describe('tipos', () => {
  it('Ride, VirtualRide e trainer → bicicleta; WeightTraining → ginásio; o resto → outro', () => {
    expect(mapIcuType('Ride', false).type).toBe('bike')
    expect(mapIcuType('VirtualRide', null).type).toBe('bike')
    expect(mapIcuType('Workout', true).type).toBe('strength')
    expect(mapIcuType('WeightTraining', false).type).toBe('strength')
    expect(mapIcuType('Walk', false)).toEqual({ type: 'other', sport: 'caminhada' })
    expect(mapIcuType('Swim', false)).toEqual({ type: 'other', sport: 'natacao' })
    expect(mapIcuType('Rowing', false)).toEqual({ type: 'other', sport: 'outro' })
    expect(mapIcuType(null, true).type).toBe('bike')
  })
})

describe('atividade', () => {
  it('bicicleta do Garmin: minutos em movimento, watts do dispositivo, batimentos', () => {
    expect(mapActivity(garminRide)).toMatchObject({
      external_id: 'i123456',
      type: 'bike',
      minutes: 45,
      watts: 139,
      watts_source: 'device',
      np_w: 142,
      avg_hr: 132,
      max_hr: 141,
      cadence: 88,
      kcal_device: 520,
      distance_km: null,
      started_at: '2026-09-29T06:10:00.000Z',
    })
  })

  it('sem watts nem batimentos ficam a null (nunca zeros)', () => {
    const walk = mapActivity({ id: 7, type: 'Walk', moving_time: 2400, elapsed_time: 2500, distance: 3200 })
    expect(walk).toMatchObject({ type: 'other', sport: 'caminhada', minutes: 40, watts: null, avg_hr: null, distance_km: 3.2 })
  })

  it('ginásio conta o tempo total', () => {
    expect(mapActivity({ id: 9, type: 'WeightTraining', moving_time: 1500, elapsed_time: 3000 }).minutes).toBe(50)
  })

  it('valores impossíveis não entram', () => {
    const odd = mapActivity({ ...garminRide, average_heartrate: 20, icu_average_watts: 1500 })
    expect(odd.avg_hr).toBeNull()
    expect(odd.watts).toBeNull()
  })

  it('cópias vazias do Strava ficam de fora', () => {
    expect(isEmptyStravaCopy({ id: 1, source: 'STRAVA' })).toBe(true)
    expect(isEmptyStravaCopy(garminRide)).toBe(false)
  })
})

describe('fusão silenciosa', () => {
  const habitual = { id: 'fav', type: 'bike' as const, date: '2026-09-29', minutes: 45, started_at: '2026-09-29T06:12:00Z' }

  it('junta à Bicicleta habitual (início ±15 min, duração ±5 %)', () => {
    const a = { type: 'bike' as const, date: '2026-09-29', minutes: 44, started_at: '2026-09-29T06:10:00Z' }
    expect(syncMatch(a, [habitual])?.id).toBe('fav')
  })

  it('não junta com início a mais de 15 min ou duração muito diferente', () => {
    expect(syncMatch({ type: 'bike', date: '2026-09-29', minutes: 45, started_at: '2026-09-29T06:40:00Z' }, [habitual])).toBeNull()
    expect(syncMatch({ type: 'bike', date: '2026-09-29', minutes: 55, started_at: '2026-09-29T06:10:00Z' }, [habitual])).toBeNull()
  })
})

describe('bem-estar', () => {
  it('peso, FC em repouso, sono em minutos e passos', () => {
    expect(mapWellness({ id: '2026-09-29', weight: 84.63, restingHR: 52, sleepSecs: 25200, steps: 8421 })).toEqual({
      date: '2026-09-29',
      weightKg: 84.6,
      restingHr: 52,
      sleepMinutes: 420,
      steps: 8421,
    })
  })

  it('valores em falta ou impossíveis ficam a null', () => {
    expect(mapWellness({ id: '2026-09-29', weight: 0, sleepSecs: null })).toMatchObject({ weightKg: null, sleepMinutes: null })
  })

  it('«sincronizado há …»', () => {
    const now = new Date('2026-09-29T10:00:00Z')
    expect(syncedAgo('2026-09-29T09:56:00Z', now)).toBe('há 4 min')
    expect(syncedAgo('2026-09-29T07:00:00Z', now)).toBe('há 3 h')
    expect(syncedAgo(null, now)).toBeNull()
  })
})
